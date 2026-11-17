BEGIN;

ALTER TABLE public.merchants
  ALTER COLUMN currency SET DEFAULT 'IDR';
ALTER TABLE public.outlets
  ALTER COLUMN currency SET DEFAULT 'IDR';
UPDATE public.outlets o
SET currency = COALESCE(m.currency, 'IDR')
FROM public.merchants m
WHERE m.id = o.merchant_id AND o.currency IS NULL;

ALTER TABLE public.merchants
  DROP CONSTRAINT IF EXISTS merchants_tier_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_tier_check
  CHECK (tier IN ('basic', 'standard', 'premium', 'starter', 'business', 'growth', 'enterprise'));
ALTER TABLE public.merchants
  DROP CONSTRAINT IF EXISTS merchants_requested_tier_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_requested_tier_check
  CHECK (requested_tier IS NULL OR requested_tier IN ('basic', 'standard', 'premium', 'starter', 'business', 'growth', 'enterprise'));
UPDATE public.merchants
SET requested_tier = CASE requested_tier
  WHEN 'basic' THEN 'starter'
  WHEN 'standard' THEN 'business'
  WHEN 'premium' THEN 'enterprise'
  ELSE requested_tier
END
WHERE requested_tier IN ('basic', 'standard', 'premium');

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  plan_code text PRIMARY KEY,
  display_name text NOT NULL,
  currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  monthly_price bigint NOT NULL CHECK (monthly_price >= 0),
  annual_price bigint NOT NULL CHECK (annual_price >= 0),
  included_outlets integer NOT NULL CHECK (included_outlets > 0),
  overage_price_monthly bigint NOT NULL DEFAULT 0 CHECK (overage_price_monthly >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  CHECK (annual_price <= monthly_price * 12)
);

INSERT INTO public.subscription_plans (
  plan_code, display_name, monthly_price, annual_price, included_outlets,
  overage_price_monthly, features, is_public
) VALUES
  ('starter', 'STOCKURA Starter', 149000, 1490000, 1, 0,
    '{"pos":true,"inventory":true,"reports":true}'::jsonb, true),
  ('business', 'STOCKURA Business', 699000, 6990000, 5, 0,
    '{"pos":true,"inventory":true,"reports":true,"staff_management":true}'::jsonb, true),
  ('growth', 'STOCKURA Growth', 2490000, 24900000, 20, 0,
    '{"pos":true,"inventory":true,"reports":true,"staff_management":true,"multi_warehouse":true}'::jsonb, true),
  ('enterprise', 'STOCKURA Enterprise 50', 14900000, 149000000, 50, 199000,
    '{"pos":true,"inventory":true,"reports":true,"staff_management":true,"centralized_inventory":true,"multi_warehouse":true,"purchase_orders":true,"stock_transfers":true,"mobile_dashboard":true,"offline_sync":true,"role_management":true,"priority_support":true,"audit_logs":true}'::jsonb, true),
  ('legacy_basic', 'Legacy Basic', 200000, 2220000, 1, 0, '{}'::jsonb, false),
  ('legacy_standard', 'Legacy Standard', 230000, 2553000, 5, 0, '{}'::jsonb, false),
  ('legacy_premium', 'Legacy Premium', 300000, 3330000, 50, 0, '{}'::jsonb, false)
ON CONFLICT (plan_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  currency = EXCLUDED.currency,
  monthly_price = EXCLUDED.monthly_price,
  annual_price = EXCLUDED.annual_price,
  included_outlets = EXCLUDED.included_outlets,
  overage_price_monthly = EXCLUDED.overage_price_monthly,
  features = EXCLUDED.features,
  is_public = EXCLUDED.is_public;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.subscription_plans(plan_code),
  amount bigint NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'IDR' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'trial', 'canceled')),
  auto_renew boolean NOT NULL DEFAULT false,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancellation_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS subscriptions_tenant_period_idx
  ON public.subscriptions (tenant_id, starts_at DESC, expires_at DESC);
CREATE INDEX IF NOT EXISTS subscriptions_active_period_idx
  ON public.subscriptions (starts_at, expires_at)
  WHERE status IN ('active', 'trial');

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  invoice_type text NOT NULL CHECK (invoice_type IN ('subscription', 'outlet_overage')),
  plan_code text REFERENCES public.subscription_plans(plan_code),
  billing_cycle text CHECK (billing_cycle IN ('monthly', 'yearly')),
  outlet_quantity integer NOT NULL DEFAULT 0 CHECK (outlet_quantity >= 0),
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  due_date timestamptz NOT NULL,
  period_starts_at timestamptz,
  period_ends_at timestamptz,
  status text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'under_review', 'paid', 'void')),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CHECK (
    (invoice_type = 'subscription' AND plan_code IS NOT NULL AND billing_cycle IS NOT NULL AND outlet_quantity = 0)
    OR
    (invoice_type = 'outlet_overage' AND plan_code = 'enterprise' AND billing_cycle IS NULL AND outlet_quantity > 0)
  ),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS invoices_tenant_created_idx
  ON public.invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_due_idx
  ON public.invoices (status, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_open_type_per_tenant_idx
  ON public.invoices (tenant_id, invoice_type)
  WHERE status IN ('awaiting_payment', 'under_review');

CREATE TABLE IF NOT EXISTS public.payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'qris')),
  amount bigint NOT NULL CHECK (amount > 0),
  reference text NOT NULL CHECK (length(trim(reference)) BETWEEN 1 AND 160),
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text
);

CREATE INDEX IF NOT EXISTS payment_submissions_tenant_created_idx
  ON public.payment_submissions (tenant_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS payment_submissions_pending_idx
  ON public.payment_submissions (submitted_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_submission_id uuid NOT NULL UNIQUE REFERENCES public.payment_submissions(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'qris')),
  amount bigint NOT NULL CHECK (amount > 0),
  reference text NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payments_tenant_paid_idx
  ON public.payments (tenant_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS public.outlet_overage_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE RESTRICT,
  outlet_quantity integer NOT NULL CHECK (outlet_quantity > 0),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS outlet_overage_entitlements_active_idx
  ON public.outlet_overage_entitlements (tenant_id, starts_at, expires_at);

CREATE TABLE IF NOT EXISTS public.billing_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_audit_logs_tenant_created_idx
  ON public.billing_audit_logs (tenant_id, created_at DESC);

INSERT INTO public.subscriptions (
  tenant_id, plan_code, amount, currency, billing_cycle, starts_at, expires_at, status
)
SELECT
  m.id,
  CASE m.tier
    WHEN 'basic' THEN 'legacy_basic'
    WHEN 'standard' THEN 'legacy_standard'
    WHEN 'premium' THEN 'legacy_premium'
    ELSE m.tier
  END,
  CASE
    WHEN m.billing_cycle = 'yearly' THEN p.annual_price
    ELSE p.monthly_price
  END,
  m.currency,
  COALESCE(m.billing_cycle, 'monthly'),
  m.created_at,
  GREATEST(m.subscription_expiry, m.created_at + interval '1 second'),
  CASE m.subscription_status
    WHEN 'trial' THEN 'trial'
    WHEN 'active' THEN 'active'
    ELSE 'canceled'
  END
FROM public.merchants m
JOIN public.subscription_plans p
  ON p.plan_code = CASE m.tier
    WHEN 'basic' THEN 'legacy_basic'
    WHEN 'standard' THEN 'legacy_standard'
    WHEN 'premium' THEN 'legacy_premium'
    ELSE m.tier
  END
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.tenant_id = m.id
);

CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq;

CREATE OR REPLACE FUNCTION public.current_subscription(p_tenant_id uuid)
RETURNS public.subscriptions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s
  FROM public.subscriptions s
  WHERE s.tenant_id = p_tenant_id
    AND s.status IN ('active', 'trial')
    AND s.starts_at <= now()
    AND s.expires_at > now()
  ORDER BY s.starts_at DESC, s.created_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.subscription_access_is_active(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.merchants m
    JOIN public.subscriptions s ON s.tenant_id = m.id
    WHERE m.id = p_tenant_id
      AND m.approval_status = 'approved'
      AND s.status IN ('active', 'trial')
      AND s.starts_at <= now()
      AND s.expires_at > now()
  )
$$;

CREATE OR REPLACE FUNCTION public.outlet_limit_for_tenant(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p.included_outlets, 0) + CASE WHEN s.plan_code = 'enterprise'
    THEN COALESCE((
      SELECT sum(e.outlet_quantity)::integer
      FROM public.outlet_overage_entitlements e
      WHERE e.tenant_id = p_tenant_id
        AND e.starts_at <= now()
        AND e.expires_at > now()
    ), 0)
    ELSE 0
  END
  FROM public.current_subscription(p_tenant_id) s
  LEFT JOIN public.subscription_plans p ON p.plan_code = s.plan_code
$$;

CREATE OR REPLACE FUNCTION public.outlet_is_entitled(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH target AS (
    SELECT o.id, o.merchant_id, o.is_active
    FROM public.outlets o
    WHERE o.id = p_outlet_id
  ),
  active_ranked AS (
    SELECT o.id,
      row_number() OVER (ORDER BY o.created_at, o.id) AS outlet_rank
    FROM public.outlets o
    JOIN target t ON t.merchant_id = o.merchant_id
    WHERE o.is_active
  )
  SELECT CASE
    WHEN NOT t.is_active THEN true
    ELSE COALESCE((
      SELECT r.outlet_rank <= public.outlet_limit_for_tenant(t.merchant_id)
      FROM active_ranked r
      WHERE r.id = t.id
    ), false)
  END
  FROM target t
$$;

CREATE OR REPLACE FUNCTION public.enforce_outlet_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer;
  v_active_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
  ) THEN
    RAISE EXCEPTION 'An outlet cannot be reassigned to another tenant'
      USING errcode = '42501';
  END IF;

  IF NEW.is_active AND (
    TG_OP = 'INSERT' OR NOT OLD.is_active
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.merchant_id::text));

    IF NOT public.subscription_access_is_active(NEW.merchant_id) THEN
      RAISE EXCEPTION 'An active subscription is required to activate an outlet'
        USING errcode = '42501';
    END IF;

    v_limit := public.outlet_limit_for_tenant(NEW.merchant_id);
    SELECT count(*)::integer INTO v_active_count
    FROM public.outlets o
    WHERE o.merchant_id = NEW.merchant_id
      AND o.is_active
      AND (TG_OP = 'INSERT' OR o.id <> OLD.id);

    IF v_active_count >= COALESCE(v_limit, 0) THEN
      RAISE EXCEPTION 'Outlet limit reached. Upgrade your plan or purchase Enterprise overage outlets.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_sale_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  SELECT merchant_id INTO v_merchant_id
  FROM public.outlets
  WHERE id = NEW.outlet_id AND is_active;
  IF NOT FOUND
    OR NOT public.subscription_access_is_active(v_merchant_id)
    OR NOT public.outlet_is_entitled(NEW.outlet_id) THEN
    RAISE EXCEPTION 'This outlet is not covered by an active subscription'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_enforce_subscription_entitlement ON public.sales;
CREATE TRIGGER sales_enforce_subscription_entitlement
  BEFORE INSERT OR UPDATE OF outlet_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_entitlement();

DROP TRIGGER IF EXISTS outlets_enforce_entitlement ON public.outlets;
CREATE TRIGGER outlets_enforce_entitlement
  BEFORE INSERT OR UPDATE OF is_active, merchant_id ON public.outlets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_outlet_entitlement();

CREATE OR REPLACE FUNCTION public.is_staff_of_outlet(outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
    JOIN public.outlets o ON o.id = s.outlet_id
    WHERE s.id = auth.uid()
      AND s.outlet_id = $1
      AND s.is_active = true
      AND o.is_active = true
      AND public.subscription_access_is_active(o.merchant_id)
      AND public.outlet_is_entitled(o.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_merchant_of_outlet(outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets o
    JOIN public.merchants m ON m.id = o.merchant_id
    WHERE o.id = $1
      AND o.merchant_id = auth.uid()
      AND m.approval_status = 'approved'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_outlet(outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets o
    WHERE o.id = $1
      AND o.is_active
      AND public.subscription_access_is_active(o.merchant_id)
      AND public.outlet_is_entitled(o.id)
      AND (
        o.merchant_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.staff s
          WHERE s.id = auth.uid() AND s.outlet_id = o.id AND s.is_active
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_outlet(outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_access_outlet($1)
    AND (
      public.is_merchant_of_outlet($1)
      OR EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id = auth.uid() AND s.outlet_id = $1
          AND s.role = 'manager' AND s.is_active
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.create_subscription_invoice(
  p_plan_code text,
  p_billing_cycle text,
  p_idempotency_key uuid
) RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans;
  v_invoice public.invoices;
  v_start timestamptz;
  v_amount bigint;
BEGIN
  IF auth.uid() IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Authentication and an idempotency key are required'
      USING errcode = '42501';
  END IF;
  IF p_billing_cycle IS NULL OR p_billing_cycle NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'Invalid billing cycle' USING errcode = '22023';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans
  WHERE plan_code = p_plan_code AND is_public;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan is unavailable' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = auth.uid() AND approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Approved tenant account required' USING errcode = '42501';
  END IF;

  UPDATE public.invoices
  SET status = 'void'
  WHERE tenant_id = auth.uid()
    AND invoice_type = 'subscription'
    AND status = 'awaiting_payment'
    AND due_date <= now();

  SELECT * INTO v_invoice FROM public.invoices
  WHERE tenant_id = auth.uid() AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_invoice.plan_code IS DISTINCT FROM p_plan_code
      OR v_invoice.billing_cycle IS DISTINCT FROM p_billing_cycle THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different invoice'
        USING errcode = '22023';
    END IF;
    RETURN v_invoice;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
  WHERE tenant_id = auth.uid()
    AND invoice_type = 'subscription'
    AND status IN ('awaiting_payment', 'under_review')
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_invoice.plan_code = p_plan_code
      AND v_invoice.billing_cycle = p_billing_cycle THEN
      RETURN v_invoice;
    END IF;
    RAISE EXCEPTION 'Resolve your existing subscription invoice before requesting another'
      USING errcode = '22023';
  END IF;

  v_amount := CASE WHEN p_billing_cycle = 'yearly'
    THEN v_plan.annual_price ELSE v_plan.monthly_price END;

  SELECT GREATEST(now(), COALESCE(max(s.expires_at), now()))
  INTO v_start
  FROM public.subscriptions s
  WHERE s.tenant_id = auth.uid()
    AND s.status IN ('active', 'trial')
    AND s.expires_at > now();

  INSERT INTO public.invoices (
    tenant_id, invoice_number, invoice_type, plan_code, billing_cycle,
    amount, due_date, period_starts_at, idempotency_key
  ) VALUES (
    auth.uid(),
    'INV-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('public.invoice_number_seq')::text, 7, '0'),
    'subscription', p_plan_code, p_billing_cycle,
    v_amount, now() + interval '7 days', v_start, p_idempotency_key
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, invoice_id, details)
  VALUES (auth.uid(), auth.uid(), 'invoice_created', v_invoice.id,
    jsonb_build_object('plan_code', p_plan_code, 'billing_cycle', p_billing_cycle, 'amount', v_amount));

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_outlet_overage_invoice(
  p_outlet_quantity integer,
  p_idempotency_key uuid
) RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans;
  v_subscription public.subscriptions;
  v_invoice public.invoices;
BEGIN
  IF auth.uid() IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Authentication and an idempotency key are required'
      USING errcode = '42501';
  END IF;
  IF p_outlet_quantity IS NULL OR p_outlet_quantity < 1 OR p_outlet_quantity > 50 THEN
    RAISE EXCEPTION 'Overage quantity must be between 1 and 50' USING errcode = '22023';
  END IF;
  UPDATE public.invoices
  SET status = 'void'
  WHERE tenant_id = auth.uid()
    AND invoice_type = 'outlet_overage'
    AND status = 'awaiting_payment'
    AND due_date <= now();

  SELECT * INTO v_subscription FROM public.current_subscription(auth.uid());
  IF NOT FOUND OR v_subscription.plan_code <> 'enterprise' THEN
    RAISE EXCEPTION 'Enterprise subscription required for outlet overage'
      USING errcode = '42501';
  END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE plan_code = 'enterprise';

  SELECT * INTO v_invoice FROM public.invoices
  WHERE tenant_id = auth.uid() AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_invoice.invoice_type <> 'outlet_overage'
      OR v_invoice.outlet_quantity <> p_outlet_quantity THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different invoice'
        USING errcode = '22023';
    END IF;
    RETURN v_invoice;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
  WHERE tenant_id = auth.uid()
    AND invoice_type = 'outlet_overage'
    AND status IN ('awaiting_payment', 'under_review')
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_invoice.outlet_quantity = p_outlet_quantity THEN
      RETURN v_invoice;
    END IF;
    RAISE EXCEPTION 'Resolve your existing overage invoice before requesting another'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.invoices (
    tenant_id, invoice_number, invoice_type, plan_code, outlet_quantity,
    amount, due_date, period_starts_at, period_ends_at, idempotency_key
  ) VALUES (
    auth.uid(),
    'INV-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('public.invoice_number_seq')::text, 7, '0'),
    'outlet_overage', 'enterprise', p_outlet_quantity,
    v_plan.overage_price_monthly * p_outlet_quantity,
    now() + interval '7 days', now(), now() + interval '1 month', p_idempotency_key
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, invoice_id, details)
  VALUES (auth.uid(), auth.uid(), 'outlet_overage_invoice_created', v_invoice.id,
    jsonb_build_object('outlets', p_outlet_quantity, 'monthly_rate', v_plan.overage_price_monthly));

  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_invoice_payment(
  p_invoice_id uuid,
  p_payment_method text,
  p_amount bigint,
  p_reference text,
  p_note text DEFAULT NULL
) RETURNS public.payment_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices;
  v_submission public.payment_submissions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('bank_transfer', 'qris')
    OR p_reference IS NULL OR length(trim(p_reference)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Invalid payment details' USING errcode = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = p_invoice_id AND tenant_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_invoice.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Invoice is not available for payment submission'
      USING errcode = '22023';
  END IF;
  IF v_invoice.due_date <= now() THEN
    RAISE EXCEPTION 'Invoice expired. Create a new invoice before submitting payment'
      USING errcode = '22023';
  END IF;
  IF p_amount IS DISTINCT FROM v_invoice.amount THEN
    RAISE EXCEPTION 'Submitted amount must match the invoice total'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.payment_submissions (
    invoice_id, tenant_id, payment_method, amount, reference, note
  ) VALUES (
    v_invoice.id, auth.uid(), p_payment_method, p_amount, trim(p_reference), left(p_note, 1000)
  ) RETURNING * INTO v_submission;

  UPDATE public.invoices SET status = 'under_review' WHERE id = v_invoice.id;
  INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, invoice_id, details)
  VALUES (auth.uid(), auth.uid(), 'payment_submitted', v_invoice.id,
    jsonb_build_object('submission_id', v_submission.id, 'amount', p_amount));
  RETURN v_submission;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_invoice_payment(
  p_submission_id uuid,
  p_approve boolean,
  p_rejection_reason text DEFAULT NULL
) RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission public.payment_submissions;
  v_invoice public.invoices;
  v_subscription public.subscriptions;
  v_plan public.subscription_plans;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required' USING errcode = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'A payment decision is required' USING errcode = '22023';
  END IF;

  SELECT * INTO v_submission FROM public.payment_submissions
  WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment submission is no longer pending' USING errcode = '22023';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = v_submission.invoice_id FOR UPDATE;
  IF v_invoice.status <> 'under_review'
    OR v_submission.amount <> v_invoice.amount THEN
    RAISE EXCEPTION 'Invoice or payment amount is no longer valid' USING errcode = '22023';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.payment_submissions
    SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
        rejection_reason = left(COALESCE(p_rejection_reason, 'Payment could not be verified'), 500)
    WHERE id = v_submission.id;
    UPDATE public.invoices SET status = 'awaiting_payment' WHERE id = v_invoice.id;
    INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, invoice_id, details)
    VALUES (v_invoice.tenant_id, auth.uid(), 'payment_rejected', v_invoice.id,
      jsonb_build_object('submission_id', v_submission.id, 'reason', p_rejection_reason));
    RETURN v_invoice;
  END IF;

  INSERT INTO public.payments (
    invoice_id, payment_submission_id, tenant_id, payment_method,
    amount, reference, confirmed_by
  ) VALUES (
    v_invoice.id, v_submission.id, v_invoice.tenant_id, v_submission.payment_method,
    v_submission.amount, v_submission.reference, auth.uid()
  );
  UPDATE public.payment_submissions
  SET status = 'confirmed', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = v_submission.id;
  UPDATE public.invoices SET status = 'paid', paid_at = now() WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  IF v_invoice.invoice_type = 'subscription' THEN
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE plan_code = v_invoice.plan_code;
    SELECT GREATEST(now(), COALESCE(max(s.expires_at), now()))
      INTO v_start
    FROM public.subscriptions s
    WHERE s.tenant_id = v_invoice.tenant_id
      AND s.status IN ('active', 'trial')
      AND s.expires_at > now();
    v_end := CASE WHEN v_invoice.billing_cycle = 'yearly'
      THEN v_start + interval '1 year'
      ELSE v_start + interval '1 month' END;
    UPDATE public.invoices
    SET period_starts_at = v_start, period_ends_at = v_end
    WHERE id = v_invoice.id
    RETURNING * INTO v_invoice;

    INSERT INTO public.subscriptions (
      tenant_id, plan_code, amount, currency, billing_cycle, starts_at, expires_at, status
    ) VALUES (
      v_invoice.tenant_id, v_invoice.plan_code, v_invoice.amount,
      'IDR', v_invoice.billing_cycle, v_start, v_end, 'active'
    ) RETURNING * INTO v_subscription;

    UPDATE public.merchants
    SET tier = CASE WHEN v_start <= now() THEN v_invoice.plan_code ELSE tier END,
        subscription_status = 'active',
        subscription_expiry = v_end,
        billing_cycle = v_invoice.billing_cycle,
        updated_at = now()
    WHERE id = v_invoice.tenant_id;
  ELSE
    v_start := now();
    v_end := v_start + interval '1 month';
    UPDATE public.invoices
    SET period_starts_at = v_start, period_ends_at = v_end
    WHERE id = v_invoice.id
    RETURNING * INTO v_invoice;
    INSERT INTO public.outlet_overage_entitlements (
      tenant_id, invoice_id, outlet_quantity, starts_at, expires_at
    ) VALUES (
      v_invoice.tenant_id, v_invoice.id, v_invoice.outlet_quantity,
      v_start, v_end
    );
  END IF;

  INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, invoice_id, details)
  VALUES (v_invoice.tenant_id, auth.uid(), 'payment_confirmed', v_invoice.id,
    jsonb_build_object('submission_id', v_submission.id, 'amount', v_invoice.amount));
  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_subscription_at_period_end()
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription public.subscriptions;
BEGIN
  SELECT * INTO v_subscription
  FROM public.subscriptions s
  WHERE s.tenant_id = auth.uid()
    AND s.status IN ('active', 'trial')
    AND s.starts_at <= now()
    AND s.expires_at > now()
  ORDER BY s.starts_at DESC, s.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active subscription to cancel' USING errcode = '22023';
  END IF;

  UPDATE public.subscriptions
  SET cancel_at_period_end = true,
      cancellation_requested_at = now(),
      auto_renew = false
  WHERE id = v_subscription.id
  RETURNING * INTO v_subscription;

  INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, details)
  VALUES (auth.uid(), auth.uid(), 'subscription_cancel_requested',
    jsonb_build_object('subscription_id', v_subscription.id, 'expires_at', v_subscription.expires_at));
  RETURN v_subscription;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_billing_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mrr numeric;
  v_paid_tenants integer;
  v_arr numeric;
  v_cancelled integer;
  v_trials integer;
  v_active integer;
  v_outlets integer;
  v_revenue_by_plan jsonb;
  v_top_enterprise jsonb;
  v_churn_rate numeric;
  v_churned integer;
  v_starting_tenants integer;
  v_monthly_revenue jsonb;
  v_customer_growth jsonb;
  v_revenue_growth_30d numeric;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required' USING errcode = '42501';
  END IF;

  SELECT COALESCE(sum(
    CASE WHEN s.billing_cycle = 'yearly' THEN s.amount::numeric / 12 ELSE s.amount END
  ), 0), count(DISTINCT s.tenant_id)::integer
  INTO v_mrr, v_paid_tenants
  FROM public.subscriptions s
  JOIN public.merchants m ON m.id = s.tenant_id
  WHERE s.status = 'active' AND s.starts_at <= now() AND s.expires_at > now()
    AND m.approval_status = 'approved' AND s.currency = 'IDR';

  SELECT count(*)::integer INTO v_active
  FROM public.merchants m
  WHERE m.approval_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.tenant_id = m.id AND s.status = 'active'
        AND s.starts_at <= now() AND s.expires_at > now()
    );
  SELECT count(DISTINCT s.tenant_id)::integer INTO v_trials
  FROM public.subscriptions s
  JOIN public.merchants m ON m.id = s.tenant_id AND m.approval_status = 'approved'
  WHERE s.status = 'trial' AND s.starts_at <= now() AND s.expires_at > now();
  SELECT count(DISTINCT s.tenant_id)::integer INTO v_cancelled
  FROM public.subscriptions s
  JOIN public.merchants m ON m.id = s.tenant_id
  WHERE s.cancellation_requested_at >= now() - interval '30 days'
    AND m.approval_status = 'approved';
  SELECT count(*)::integer INTO v_outlets FROM public.outlets;

  SELECT count(DISTINCT s.tenant_id)::integer INTO v_starting_tenants
  FROM public.subscriptions s
  JOIN public.merchants m ON m.id = s.tenant_id
  WHERE s.status = 'active'
    AND s.starts_at <= now() - interval '30 days'
    AND s.expires_at > now() - interval '30 days'
    AND m.approval_status = 'approved';
  SELECT count(DISTINCT s.tenant_id)::integer INTO v_churned
  FROM public.subscriptions s
  JOIN public.merchants m ON m.id = s.tenant_id
  WHERE s.status = 'active'
    AND s.expires_at > now() - interval '30 days'
    AND s.expires_at <= now()
    AND m.approval_status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.subscriptions next_sub
      WHERE next_sub.tenant_id = s.tenant_id
        AND next_sub.starts_at <= now()
        AND next_sub.expires_at > now()
        AND next_sub.status = 'active'
    );
  v_churn_rate := CASE WHEN v_starting_tenants = 0 THEN 0
    ELSE round(v_churned::numeric * 100 / v_starting_tenants, 2) END;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', to_char(months.month_start, 'Mon YY'),
      'amount', COALESCE(revenue.amount, 0))
    ORDER BY months.month_start
  ), '[]'::jsonb)
  INTO v_monthly_revenue
  FROM generate_series(
    date_trunc('month', now()) - interval '11 months',
    date_trunc('month', now()),
    interval '1 month'
  ) AS months(month_start)
  LEFT JOIN (
    SELECT date_trunc('month', p.paid_at) AS month_start, sum(p.amount)::numeric AS amount
    FROM public.payments p
    WHERE p.paid_at >= date_trunc('month', now()) - interval '11 months'
    GROUP BY date_trunc('month', p.paid_at)
  ) revenue USING (month_start);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', to_char(months.month_start, 'Mon YY'),
      'tenants', (
        SELECT count(*)::integer FROM public.merchants m
        WHERE m.created_at < months.month_start + interval '1 month'
      ))
    ORDER BY months.month_start
  ), '[]'::jsonb)
  INTO v_customer_growth
  FROM generate_series(
    date_trunc('month', now()) - interval '11 months',
    date_trunc('month', now()),
    interval '1 month'
  ) AS months(month_start);

  SELECT CASE WHEN previous.amount = 0 THEN 0
    ELSE round((recent.amount - previous.amount) * 100 / previous.amount, 2) END
  INTO v_revenue_growth_30d
  FROM (
    SELECT COALESCE(sum(p.amount), 0)::numeric AS amount
    FROM public.payments p WHERE p.paid_at >= now() - interval '30 days'
  ) recent
  CROSS JOIN (
    SELECT COALESCE(sum(p.amount), 0)::numeric AS amount
    FROM public.payments p
    WHERE p.paid_at >= now() - interval '60 days'
      AND p.paid_at < now() - interval '30 days'
  ) previous;

  SELECT COALESCE(jsonb_object_agg(plan_code, plan_mrr), '{}'::jsonb)
  INTO v_revenue_by_plan
  FROM (
    SELECT s.plan_code,
      sum(CASE WHEN s.billing_cycle = 'yearly' THEN s.amount::numeric / 12 ELSE s.amount END) AS plan_mrr
    FROM public.subscriptions s
    JOIN public.merchants m ON m.id = s.tenant_id
    WHERE s.status = 'active' AND s.starts_at <= now() AND s.expires_at > now()
      AND m.approval_status = 'approved' AND s.currency = 'IDR'
    GROUP BY s.plan_code
  ) revenue;

  SELECT COALESCE(jsonb_agg(to_jsonb(customers)), '[]'::jsonb)
  INTO v_top_enterprise
  FROM (
    SELECT m.id, m.business_name, count(o.id)::integer AS active_outlets
    FROM public.merchants m
    JOIN public.subscriptions s ON s.tenant_id = m.id
      AND s.plan_code = 'enterprise' AND s.status = 'active'
      AND s.starts_at <= now() AND s.expires_at > now()
    LEFT JOIN public.outlets o ON o.merchant_id = m.id AND o.is_active
    WHERE m.approval_status = 'approved'
    GROUP BY m.id, m.business_name
    ORDER BY count(o.id) DESC, m.business_name
    LIMIT 10
  ) customers;

  v_arr := v_mrr * 12;
  RETURN jsonb_build_object(
    'mrr', v_mrr,
    'arr', v_arr,
    'active_tenants', v_active,
    'cancelled_tenants', v_cancelled,
    'trial_tenants', v_trials,
    'revenue_by_plan', v_revenue_by_plan,
    'revenue_forecast_12m', v_arr,
    'average_revenue_per_tenant', CASE WHEN v_paid_tenants = 0 THEN 0 ELSE round(v_mrr / v_paid_tenants, 2) END,
    'churn_rate_30d', v_churn_rate,
    'total_outlets', v_outlets,
    'monthly_revenue', v_monthly_revenue,
    'customer_growth', v_customer_growth,
    'revenue_growth_30d', v_revenue_growth_30d,
    'top_enterprise_customers', v_top_enterprise
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_merchant(
  p_merchant_id uuid,
  p_approval_status text DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_subscription_expiry timestamptz DEFAULT NULL
) RETURNS public.merchants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant public.merchants;
  v_plan_code text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required' USING errcode = '42501';
  END IF;
  IF p_approval_status IS NOT NULL AND p_approval_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid approval status' USING errcode = '22023';
  END IF;
  IF p_tier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subscription_plans
    WHERE plan_code = p_tier AND is_public
  ) THEN
    RAISE EXCEPTION 'Invalid plan code' USING errcode = '22023';
  END IF;
  IF p_approval_status = 'approved' AND p_subscription_expiry IS NULL THEN
    RAISE EXCEPTION 'A trial expiry is required when approving a merchant' USING errcode = '22023';
  END IF;
  IF p_approval_status = 'approved' AND p_subscription_expiry <= now() THEN
    RAISE EXCEPTION 'Trial expiry must be in the future' USING errcode = '22023';
  END IF;
  IF p_approval_status = 'approved' AND EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = p_merchant_id AND approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'An approved merchant cannot be re-approved to extend a trial'
      USING errcode = '22023';
  END IF;
  IF p_tier IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = p_merchant_id AND approval_status = 'approved'
      AND tier IS DISTINCT FROM p_tier
  ) THEN
    RAISE EXCEPTION 'Plan changes require a paid invoice'
      USING errcode = '42501';
  END IF;

  UPDATE public.merchants
  SET approval_status = COALESCE(p_approval_status, approval_status),
      tier = COALESCE(p_tier, requested_tier, tier),
      subscription_status = CASE
        WHEN p_approval_status = 'approved' THEN 'trial'
        WHEN p_approval_status = 'rejected' THEN 'expired'
        ELSE subscription_status
      END,
      subscription_expiry = COALESCE(p_subscription_expiry, subscription_expiry),
      billing_cycle = COALESCE(billing_cycle, 'monthly'),
      approved_at = CASE WHEN p_approval_status = 'approved' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN p_approval_status = 'approved' THEN auth.uid() ELSE approved_by END,
      updated_at = now()
  WHERE id = p_merchant_id
  RETURNING * INTO v_merchant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Merchant not found' USING errcode = 'P0002';
  END IF;

  IF p_approval_status = 'approved' THEN
    v_plan_code := CASE COALESCE(p_tier, v_merchant.tier)
      WHEN 'basic' THEN 'starter'
      WHEN 'standard' THEN 'business'
      WHEN 'premium' THEN 'enterprise'
      ELSE COALESCE(p_tier, v_merchant.tier)
    END;
    UPDATE public.merchants
    SET tier = v_plan_code, requested_tier = v_plan_code
    WHERE id = p_merchant_id
    RETURNING * INTO v_merchant;

    UPDATE public.subscriptions
    SET plan_code = v_plan_code,
        amount = 0,
        billing_cycle = COALESCE(v_merchant.billing_cycle, 'monthly'),
        starts_at = now(),
        expires_at = p_subscription_expiry,
        status = 'trial'
    WHERE tenant_id = p_merchant_id
      AND status = 'trial';
    IF NOT FOUND THEN
      INSERT INTO public.subscriptions (
        tenant_id, plan_code, amount, currency, billing_cycle, starts_at, expires_at, status
      ) VALUES (
        p_merchant_id, v_plan_code, 0, 'IDR',
        COALESCE(v_merchant.billing_cycle, 'monthly'), now(), p_subscription_expiry, 'trial'
      );
    END IF;
  END IF;

  INSERT INTO public.billing_audit_logs (tenant_id, actor_id, action, details)
  VALUES (p_merchant_id, auth.uid(), 'merchant_approval_updated',
    jsonb_build_object('approval_status', p_approval_status, 'plan_code', p_tier));
  RETURN v_merchant;
END;
$$;

DROP POLICY IF EXISTS "outlets_select" ON public.outlets;
CREATE POLICY "outlets_select" ON public.outlets FOR SELECT
  USING (merchant_id = auth.uid() OR public.is_staff_of_outlet(id));

CREATE OR REPLACE FUNCTION public.create_merchant_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_cycle text;
BEGIN
  v_plan := CASE
    WHEN new.raw_user_meta_data->>'tier' IN ('starter', 'business', 'growth', 'enterprise')
      THEN new.raw_user_meta_data->>'tier'
    WHEN new.raw_user_meta_data->>'tier' = 'standard' THEN 'business'
    WHEN new.raw_user_meta_data->>'tier' = 'premium' THEN 'enterprise'
    ELSE 'starter'
  END;
  v_cycle := CASE
    WHEN new.raw_user_meta_data->>'billing_cycle' IN ('monthly', 'yearly')
      THEN new.raw_user_meta_data->>'billing_cycle'
    ELSE 'monthly'
  END;

  INSERT INTO public.merchants (
    id, business_name, owner_name, email, phone, tier, subscription_status,
    subscription_expiry, approval_status, requested_tier, billing_cycle, currency, tax_rate
  ) VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'business_name', 'New business'),
    COALESCE(new.raw_user_meta_data->>'owner_name', 'Merchant'),
    lower(new.email),
    COALESCE(new.raw_user_meta_data->>'phone', ''),
    v_plan, 'trial', now() + interval '30 days', 'pending', v_plan, v_cycle, 'IDR', 7.5
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (
    tenant_id, plan_code, amount, currency, billing_cycle, starts_at, expires_at, status
  ) VALUES (
    new.id, v_plan, 0, 'IDR', v_cycle, now(), now() + interval '30 days', 'trial'
  ) ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_subscription_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin()
    AND (
      NEW.tier IS DISTINCT FROM OLD.tier
      OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
      OR NEW.subscription_expiry IS DISTINCT FROM OLD.subscription_expiry
      OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
      OR NEW.requested_tier IS DISTINCT FROM OLD.requested_tier
      OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.deletion_scheduled_at IS DISTINCT FROM OLD.deletion_scheduled_at
    ) THEN
    RAISE EXCEPTION 'Plan and approval fields can only be changed by an administrator'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_overage_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plans_public_read ON public.subscription_plans;
CREATE POLICY subscription_plans_public_read ON public.subscription_plans
  FOR SELECT TO authenticated USING (is_public OR public.is_platform_admin());
DROP POLICY IF EXISTS subscriptions_tenant_read ON public.subscriptions;
CREATE POLICY subscriptions_tenant_read ON public.subscriptions
  FOR SELECT TO authenticated USING (tenant_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS invoices_tenant_read ON public.invoices;
CREATE POLICY invoices_tenant_read ON public.invoices
  FOR SELECT TO authenticated USING (tenant_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS payment_submissions_tenant_read ON public.payment_submissions;
CREATE POLICY payment_submissions_tenant_read ON public.payment_submissions
  FOR SELECT TO authenticated USING (tenant_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS payments_tenant_read ON public.payments;
CREATE POLICY payments_tenant_read ON public.payments
  FOR SELECT TO authenticated USING (tenant_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS outlet_overage_entitlements_tenant_read ON public.outlet_overage_entitlements;
CREATE POLICY outlet_overage_entitlements_tenant_read ON public.outlet_overage_entitlements
  FOR SELECT TO authenticated USING (tenant_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS billing_audit_logs_admin_read ON public.billing_audit_logs;
CREATE POLICY billing_audit_logs_admin_read ON public.billing_audit_logs
  FOR SELECT TO authenticated USING (public.is_platform_admin());

REVOKE ALL ON public.subscription_plans, public.subscriptions, public.invoices,
  public.payment_submissions, public.payments, public.outlet_overage_entitlements,
  public.billing_audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.subscription_plans, public.subscriptions,
  public.invoices, public.payment_submissions, public.payments,
  public.outlet_overage_entitlements, public.billing_audit_logs
  FROM anon, authenticated;
GRANT SELECT ON public.subscription_plans, public.subscriptions, public.invoices,
  public.payment_submissions, public.payments, public.outlet_overage_entitlements
  TO authenticated;
GRANT SELECT ON public.billing_audit_logs TO authenticated;
REVOKE ALL ON FUNCTION public.create_subscription_invoice(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_outlet_overage_invoice(integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_invoice_payment(uuid, text, bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_invoice_payment(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_subscription_at_period_end() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_billing_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_subscription_invoice(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_outlet_overage_invoice(integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_invoice_payment(uuid, text, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_invoice_payment(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_subscription_at_period_end() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_billing_analytics() TO authenticated;
REVOKE ALL ON SEQUENCE public.invoice_number_seq FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.current_subscription(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.subscription_access_is_active(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.outlet_limit_for_tenant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.outlet_is_entitled(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_outlet_entitlement() FROM PUBLIC, anon;

COMMIT;
