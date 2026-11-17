BEGIN;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS admin_override boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS subscriptions_admin_override_idx
  ON public.subscriptions (tenant_id, starts_at)
  WHERE admin_override AND status IN ('active', 'trial');

CREATE OR REPLACE FUNCTION public.admin_billing_tenants()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenants jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'business_name', m.business_name,
      'email', m.email,
      'active_outlets', (
        SELECT count(*)::integer
        FROM public.outlets o
        WHERE o.merchant_id = m.id AND o.is_active
      ),
      'current_subscription', CASE WHEN current_sub.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', current_sub.id,
          'plan_code', current_sub.plan_code,
          'billing_cycle', current_sub.billing_cycle,
          'starts_at', current_sub.starts_at,
          'expires_at', current_sub.expires_at,
          'amount', current_sub.amount,
          'currency', current_sub.currency,
          'admin_override', current_sub.admin_override
        )
      END,
      'scheduled_subscription', CASE WHEN scheduled_sub.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', scheduled_sub.id,
          'plan_code', scheduled_sub.plan_code,
          'billing_cycle', scheduled_sub.billing_cycle,
          'starts_at', scheduled_sub.starts_at,
          'expires_at', scheduled_sub.expires_at,
          'amount', scheduled_sub.amount,
          'currency', scheduled_sub.currency,
          'admin_override', scheduled_sub.admin_override
        )
      END
    ) ORDER BY m.business_name
  ), '[]'::jsonb)
  INTO v_tenants
  FROM public.merchants m
  LEFT JOIN LATERAL (
    SELECT s.*
    FROM public.subscriptions s
    WHERE s.tenant_id = m.id
      AND s.status IN ('active', 'trial')
      AND s.starts_at <= now()
      AND s.expires_at > now()
    ORDER BY s.starts_at DESC, s.created_at DESC
    LIMIT 1
  ) current_sub ON true
  LEFT JOIN LATERAL (
    SELECT s.*
    FROM public.subscriptions s
    WHERE s.tenant_id = m.id
      AND s.status IN ('active', 'trial')
      AND s.starts_at > now()
      AND s.expires_at > now()
    ORDER BY s.starts_at, s.created_at DESC
    LIMIT 1
  ) scheduled_sub ON true
  WHERE m.approval_status = 'approved';

  RETURN v_tenants;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_apply_subscription_override(
  p_tenant_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_reason text
) RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans;
  v_subscription public.subscriptions;
  v_tenant public.merchants;
  v_start timestamptz;
  v_end timestamptz;
  v_active_outlets integer;
  v_outlet_limit integer;
  v_overage_slots integer;
  v_replaced_overrides integer;
  v_voided_invoices integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required' USING errcode = '42501';
  END IF;
  IF p_tenant_id IS NULL
    OR p_plan_code IS NULL
    OR p_billing_cycle IS NULL
    OR p_billing_cycle NOT IN ('monthly', 'yearly')
    OR p_reason IS NULL
    OR length(trim(p_reason)) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Tenant, plan, billing cycle, and a 5-500 character reason are required'
      USING errcode = '22023';
  END IF;

  SELECT * INTO v_plan
  FROM public.subscription_plans
  WHERE plan_code = p_plan_code AND is_public;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan is unavailable' USING errcode = '22023';
  END IF;

  SELECT * INTO v_tenant
  FROM public.merchants
  WHERE id = p_tenant_id AND approval_status = 'approved'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved tenant not found' USING errcode = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  UPDATE public.invoices
  SET status = 'void'
  WHERE tenant_id = p_tenant_id
    AND status = 'awaiting_payment'
    AND due_date <= now();
  GET DIAGNOSTICS v_voided_invoices = ROW_COUNT;

  IF v_voided_invoices > 0 THEN
    INSERT INTO public.billing_audit_logs (
      tenant_id, actor_id, action, details
    ) VALUES (
      p_tenant_id, auth.uid(), 'admin_override_voided_expired_invoices',
      jsonb_build_object('count', v_voided_invoices, 'reason', trim(p_reason))
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.tenant_id = p_tenant_id
      AND i.status IN ('awaiting_payment', 'under_review')
  ) THEN
    RAISE EXCEPTION 'Resolve open or under-review invoices before changing the plan'
      USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.tenant_id = p_tenant_id
      AND s.status IN ('active', 'trial')
      AND s.starts_at > now()
      AND NOT s.admin_override
  ) THEN
    RAISE EXCEPTION 'A paid plan change is already scheduled; resolve it before applying an admin override'
      USING errcode = '22023';
  END IF;

  SELECT GREATEST(now(), COALESCE(max(s.expires_at), now()))
  INTO v_start
  FROM public.subscriptions s
  WHERE s.tenant_id = p_tenant_id
    AND s.status IN ('active', 'trial')
    AND s.expires_at > now()
    AND NOT (s.admin_override AND s.starts_at > now());

  v_end := CASE WHEN p_billing_cycle = 'yearly'
    THEN v_start + interval '1 year'
    ELSE v_start + interval '1 month'
  END;

  SELECT count(*)::integer INTO v_active_outlets
  FROM public.outlets o
  WHERE o.merchant_id = p_tenant_id AND o.is_active;

  v_outlet_limit := v_plan.included_outlets;
  IF p_plan_code = 'enterprise' THEN
    SELECT COALESCE(sum(e.outlet_quantity), 0)::integer
    INTO v_overage_slots
    FROM public.outlet_overage_entitlements e
    WHERE e.tenant_id = p_tenant_id
      AND e.starts_at <= v_start
      AND e.expires_at >= v_end;
    v_outlet_limit := v_outlet_limit + v_overage_slots;
  END IF;

  IF v_active_outlets > v_outlet_limit THEN
    RAISE EXCEPTION 'Plan allows % outlets for the full term, but % are active. Reduce outlets or arrange valid Enterprise overage before changing the plan.',
      v_outlet_limit, v_active_outlets
      USING errcode = '22023';
  END IF;

  UPDATE public.subscriptions
  SET status = 'canceled'
  WHERE tenant_id = p_tenant_id
    AND admin_override
    AND status IN ('active', 'trial')
    AND starts_at > now();
  GET DIAGNOSTICS v_replaced_overrides = ROW_COUNT;

  IF v_replaced_overrides > 0 THEN
    INSERT INTO public.billing_audit_logs (
      tenant_id, actor_id, action, details
    ) VALUES (
      p_tenant_id, auth.uid(), 'admin_complimentary_plan_override_replaced',
      jsonb_build_object('replaced_count', v_replaced_overrides, 'reason', trim(p_reason))
    );
  END IF;

  INSERT INTO public.subscriptions (
    tenant_id, plan_code, amount, currency, billing_cycle, starts_at, expires_at,
    status, auto_renew, admin_override
  ) VALUES (
    p_tenant_id, p_plan_code, 0, 'IDR', p_billing_cycle, v_start, v_end,
    'trial', false, true
  ) RETURNING * INTO v_subscription;

  IF v_start <= now() THEN
    UPDATE public.merchants
    SET tier = p_plan_code,
        subscription_status = 'trial',
        subscription_expiry = v_end,
        billing_cycle = p_billing_cycle,
        updated_at = now()
    WHERE id = p_tenant_id;
  END IF;

  INSERT INTO public.billing_audit_logs (
    tenant_id, actor_id, action, details
  ) VALUES (
    p_tenant_id, auth.uid(), 'admin_complimentary_plan_override',
    jsonb_build_object(
      'subscription_id', v_subscription.id,
      'plan_code', p_plan_code,
      'billing_cycle', p_billing_cycle,
      'starts_at', v_start,
      'expires_at', v_end,
      'active_outlets', v_active_outlets,
      'outlet_limit', v_outlet_limit,
      'reason', trim(p_reason)
    )
  );

  RETURN v_subscription;
END;
$$;

CREATE OR REPLACE FUNCTION public.outlet_limit_for_tenant(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH active_plan AS (
    SELECT s.plan_code
    FROM public.current_subscription(p_tenant_id) s
  ),
  active_allowance AS (
    SELECT COALESCE(p.included_outlets, 0) + CASE WHEN s.plan_code = 'enterprise'
      THEN COALESCE((
        SELECT sum(e.outlet_quantity)::integer
        FROM public.outlet_overage_entitlements e
        WHERE e.tenant_id = p_tenant_id
          AND e.starts_at <= now()
          AND e.expires_at > now()
      ), 0)
      ELSE 0
    END AS outlet_limit
    FROM active_plan s
    LEFT JOIN public.subscription_plans p ON p.plan_code = s.plan_code
  ),
  next_override AS (
    SELECT s.plan_code, s.starts_at
    FROM public.subscriptions s
    WHERE s.tenant_id = p_tenant_id
      AND s.admin_override
      AND s.status IN ('active', 'trial')
      AND s.starts_at > now()
      AND s.expires_at > now()
    ORDER BY s.starts_at, s.created_at DESC
    LIMIT 1
  ),
  next_allowance AS (
    SELECT COALESCE(p.included_outlets, 0) + CASE WHEN n.plan_code = 'enterprise'
      THEN COALESCE((
        SELECT sum(e.outlet_quantity)::integer
        FROM public.outlet_overage_entitlements e
        WHERE e.tenant_id = p_tenant_id
          AND e.starts_at <= n.starts_at
          AND e.expires_at > n.starts_at
      ), 0)
      ELSE 0
    END AS outlet_limit
    FROM next_override n
    LEFT JOIN public.subscription_plans p ON p.plan_code = n.plan_code
  )
  SELECT CASE WHEN next_allowance.outlet_limit IS NULL
    THEN COALESCE(active_allowance.outlet_limit, 0)
    ELSE LEAST(COALESCE(active_allowance.outlet_limit, 0), next_allowance.outlet_limit)
  END
  FROM (SELECT 1) AS one_row
  LEFT JOIN active_allowance ON true
  LEFT JOIN next_allowance ON true
$$;

REVOKE ALL ON FUNCTION public.admin_billing_tenants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_apply_subscription_override(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_billing_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_subscription_override(uuid, text, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.outlet_limit_for_tenant(uuid) FROM PUBLIC, anon;

COMMIT;
