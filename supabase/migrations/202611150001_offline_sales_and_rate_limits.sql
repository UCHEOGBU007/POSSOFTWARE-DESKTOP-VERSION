BEGIN;

-- The row itself is the rate-limit event. Clients cannot inspect or insert
-- events directly; only trusted SECURITY DEFINER routines can write them.
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_rate_limits_lookup_idx
  ON public.api_rate_limits (actor_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS api_rate_limits_created_idx
  ON public.api_rate_limits (created_at);
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS was_offline boolean NOT NULL DEFAULT false;

-- Older installations may still have nullable legacy credential columns;
-- newer baselines remove them entirely. Handle both shapes without failure.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'merchants'
      AND column_name = 'password_hash') THEN
    ALTER TABLE public.merchants ALTER COLUMN password_hash DROP NOT NULL;
    REVOKE ALL (password_hash) ON TABLE public.merchants FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'pin') THEN
    ALTER TABLE public.staff ALTER COLUMN pin DROP NOT NULL;
    REVOKE ALL (pin) ON TABLE public.staff FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outlets' AND column_name = 'pin') THEN
    ALTER TABLE public.outlets ALTER COLUMN pin DROP NOT NULL;
    REVOKE ALL (pin) ON TABLE public.outlets FROM anon, authenticated;
  END IF;
END;
$$;

-- Remove credentials and PIN RPCs left by older deployments when present.
DO $$
BEGIN
  IF to_regprocedure('public.verify_staff_pin(text,text,inet)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.verify_staff_pin(text,text,inet) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.pair_terminal_outlet(text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.pair_terminal_outlet(text,text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.fetch_paired_outlet_staff(text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.fetch_paired_outlet_staff(text,text) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limit integer;
  v_window_seconds integer;
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required' USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'sale_checkout' THEN v_limit := 60; v_window_seconds := 60;
    WHEN 'admin_mutation' THEN v_limit := 30; v_window_seconds := 60;
    WHEN 'billing_mutation' THEN v_limit := 8; v_window_seconds := 300;
    WHEN 'staff_provision' THEN v_limit := 10; v_window_seconds := 300;
    ELSE RAISE EXCEPTION 'Unknown rate-limit action' USING ERRCODE = '22023';
  END CASE;

  -- Serialize requests by actor/action so concurrent calls cannot all pass
  -- the count check at the same time.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_action, 0));
  DELETE FROM public.api_rate_limits
  WHERE actor_id = v_actor AND action = p_action
    AND created_at < now() - interval '1 day';
  SELECT count(*)::integer INTO v_count
  FROM public.api_rate_limits
  WHERE actor_id = v_actor AND action = p_action
    AND created_at >= now() - make_interval(secs => v_window_seconds);

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Request limit exceeded. Try again shortly.'
      USING ERRCODE = '53300';
  END IF;

  INSERT INTO public.api_rate_limits (actor_id, action) VALUES (v_actor, p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_api_rate_limits()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.api_rate_limits WHERE created_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_api_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_api_rate_limits() TO service_role;

-- A sale's UUID is generated and durably stored by the terminal before any
-- network request. Reusing that UUID makes a timeout/retry idempotent.
CREATE OR REPLACE FUNCTION public.record_sale_v2(
  p_sale_id uuid,
  p_outlet_id uuid,
  p_receipt_number text,
  p_items jsonb,
  p_global_discount_percent numeric,
  p_payment_method text,
  p_amount_paid numeric,
  p_customer_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_sold_at timestamptz DEFAULT NULL,
  p_offline boolean DEFAULT false,
  p_tax_rate_percent numeric DEFAULT NULL
) RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_outlet public.outlets%ROWTYPE;
  v_merchant public.merchants%ROWTYPE;
  v_customer_name text := NULL;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_qty integer;
  v_discount numeric;
  v_unit_price numeric;
  v_subtotal numeric := 0;
  v_item_discount numeric := 0;
  v_global_discount numeric := 0;
  v_discount_total numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_sale public.sales%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_sold_at timestamptz := COALESCE(p_sold_at, now());
BEGIN
  IF p_sale_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated sale ID required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.consume_api_rate_limit('sale_checkout');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_sale_id::text, 1));

  IF jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A sale must contain between 1 and 100 items' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS items(element)
    GROUP BY element->>'product_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Each product may appear only once in a sale' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('cash', 'transfer', 'card', 'qris')
    OR p_amount_paid IS NULL OR p_amount_paid < 0
    OR p_global_discount_percent IS NULL
    OR p_global_discount_percent < 0 OR p_global_discount_percent > 100 THEN
    RAISE EXCEPTION 'Invalid payment or discount details' USING ERRCODE = '22023';
  END IF;
  IF p_receipt_number IS NULL
    OR p_receipt_number !~ '^[A-Z0-9-]{4,40}$'
    OR p_receipt_number NOT LIKE upper(substr(p_outlet_id::text, 1, 4)) || '-%' THEN
    RAISE EXCEPTION 'Invalid receipt number' USING ERRCODE = '22023';
  END IF;
  IF v_sold_at < now() - interval '30 days'
    OR v_sold_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Sale time is outside the allowed offline sync window' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_staff
  FROM public.staff
  WHERE id = auth.uid() AND outlet_id = p_outlet_id AND is_active;
  IF NOT FOUND OR NOT public.is_staff_of_outlet(p_outlet_id) THEN
    RAISE EXCEPTION 'Active staff access to this outlet is required' USING ERRCODE = '42501';
  END IF;

  -- Return the prior result on a retry after the server committed but the
  -- terminal lost the response.
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF FOUND THEN
    IF v_sale.outlet_id <> p_outlet_id THEN
      RAISE EXCEPTION 'Sale ID is already in use' USING ERRCODE = '23505';
    END IF;
    RETURN v_sale;
  END IF;

  SELECT * INTO v_outlet FROM public.outlets
  WHERE id = p_outlet_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target outlet is disabled or inactive' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_outlet.merchant_id;
  IF NOT FOUND OR v_merchant.approval_status <> 'approved'
    OR v_merchant.subscription_status NOT IN ('active', 'trial')
    OR v_merchant.subscription_expiry <= now() THEN
    RAISE EXCEPTION 'Merchant subscription is inactive or expired' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers
    WHERE id = p_customer_id AND outlet_id = p_outlet_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is not registered to this outlet' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR v_item IN SELECT element FROM jsonb_array_elements(p_items) AS items(element) LOOP
    v_qty := (v_item->>'quantity')::integer;
    v_discount := COALESCE((v_item->>'discount_percent')::numeric, 0);
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 10000
      OR v_discount < 0 OR v_discount > 100 THEN
      RAISE EXCEPTION 'Invalid item quantity or discount' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_product FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND outlet_id = p_outlet_id AND is_active
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected product is unavailable' USING ERRCODE = '22023';
    END IF;
    IF v_product.track_stock AND v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (available %, requested %)',
        v_product.name, v_product.stock, v_qty USING ERRCODE = '22023';
    END IF;

    v_unit_price := CASE WHEN p_offline
      THEN (v_item->>'unit_price')::numeric
      ELSE v_product.price
    END;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid offline item price' USING ERRCODE = '22023';
    END IF;
    IF p_offline AND v_unit_price > v_product.price THEN
      RAISE EXCEPTION 'Offline price exceeds the current catalog price for %', v_product.name
        USING ERRCODE = '22023';
    END IF;
    v_subtotal := v_subtotal + (v_unit_price * v_qty);
    v_item_discount := v_item_discount +
      (v_unit_price * v_qty * v_discount / 100);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'sku', v_product.sku,
      'qty', v_qty,
      'unitPrice', v_unit_price,
      'discount', v_discount,
      'total', round(v_unit_price * v_qty * (1 - v_discount / 100), 2)
    ));

    IF v_product.track_stock THEN
      UPDATE public.products
      SET stock = stock - v_qty, updated_at = now()
      WHERE id = v_product.id;
    END IF;
  END LOOP;

  v_global_discount := (v_subtotal - v_item_discount)
    * p_global_discount_percent / 100;
  v_discount_total := round(v_item_discount + v_global_discount, 2);
  IF p_offline THEN
    IF p_tax_rate_percent IS NULL OR p_tax_rate_percent < 0
      OR p_tax_rate_percent > LEAST(COALESCE(v_outlet.tax_rate, 0), 100) THEN
      RAISE EXCEPTION 'Invalid offline tax rate' USING ERRCODE = '22023';
    END IF;
    v_tax := round((v_subtotal - v_discount_total) * p_tax_rate_percent / 100, 2);
  ELSE
    v_tax := CASE WHEN v_outlet.tax_enabled
      THEN round((v_subtotal - v_discount_total) * v_outlet.tax_rate / 100, 2)
      ELSE 0 END;
  END IF;
  v_total := round(v_subtotal - v_discount_total + v_tax, 2);
  IF p_amount_paid < v_total THEN
    RAISE EXCEPTION 'Amount paid (%) is less than server total (%)', p_amount_paid, v_total
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sales (
    id, outlet_id, receipt_number, items, subtotal, tax_amount, discount_amount,
    total, amount_paid, change, payment_method, customer_id, customer_name,
    staff_id, staff_name, note, created_at, was_offline
  ) VALUES (
    p_sale_id, p_outlet_id, p_receipt_number, v_items, v_subtotal, v_tax,
    v_discount_total, v_total, p_amount_paid, p_amount_paid - v_total,
    p_payment_method, p_customer_id, v_customer_name, v_staff.id, v_staff.name,
    left(p_note, 500), v_sold_at, p_offline
  ) RETURNING * INTO v_sale;

  FOR v_item IN SELECT element FROM jsonb_array_elements(v_items) AS items(element) LOOP
    SELECT * INTO v_product FROM public.products
    WHERE id = (v_item->>'productId')::uuid;
    IF v_product.track_stock THEN
      INSERT INTO public.stock_movements (
        outlet_id, product_id, product_name, type, qty, prev_stock,
        new_stock, sale_id, created_at
      ) VALUES (
        p_outlet_id, v_product.id, v_product.name, 'sale',
        -(v_item->>'qty')::integer,
        v_product.stock + (v_item->>'qty')::integer,
        v_product.stock, v_sale.id, v_sold_at
      );
    END IF;
  END LOOP;

  IF p_customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET total_spent = total_spent + v_total,
        visit_count = visit_count + 1,
        loyalty_points = loyalty_points + floor(v_total / 100)::integer,
        updated_at = now()
    WHERE id = p_customer_id AND outlet_id = p_outlet_id;
  END IF;

  RETURN v_sale;
END;
$$;

-- Billing mutations all append a billing audit event. This applies the same
-- server-side limit to their SECURITY DEFINER RPCs without trusting clients.
CREATE OR REPLACE FUNCTION public.rate_limit_billing_audit_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.consume_api_rate_limit('billing_mutation');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS billing_mutation_rate_limit ON public.billing_audit_logs;
CREATE TRIGGER billing_mutation_rate_limit
  BEFORE INSERT ON public.billing_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_billing_audit_insert();

-- Service-created staff Auth users must not receive merchant tenant rows.
-- app_metadata is set only by the trusted Auth Admin API, unlike user metadata.
CREATE OR REPLACE FUNCTION public.create_merchant_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_cycle text;
  v_expiry timestamptz;
BEGIN
  IF new.raw_app_meta_data->>'account_type' = 'staff' THEN
    RETURN new;
  END IF;

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
  v_expiry := now() + CASE WHEN v_cycle = 'yearly'
    THEN interval '1 year' ELSE interval '1 month' END;

  INSERT INTO public.merchants (
    id, business_name, owner_name, email, phone, tier, subscription_status,
    subscription_expiry, approval_status, requested_tier, billing_cycle, currency, tax_rate
  ) VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'business_name', 'New business'),
    COALESCE(new.raw_user_meta_data->>'owner_name', 'Merchant'),
    lower(new.email),
    COALESCE(new.raw_user_meta_data->>'phone', ''),
    v_plan, 'trial', v_expiry, 'pending', v_plan, v_cycle, 'IDR', 7.5
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (
    tenant_id, plan_code, amount, currency, billing_cycle, starts_at, expires_at, status
  ) VALUES (
    new.id, v_plan, 0, 'IDR', v_cycle, now(), v_expiry, 'trial'
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
  IF public.is_platform_admin() AND (
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
    PERFORM public.consume_api_rate_limit('admin_mutation');
  END IF;

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
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_v2(
  uuid, uuid, text, jsonb, numeric, text, numeric, uuid, text,
  timestamptz, boolean, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale_v2(
  uuid, uuid, text, jsonb, numeric, text, numeric, uuid, text,
  timestamptz, boolean, numeric
) TO authenticated;
-- Disable the old client-write path. It omitted global discounts and used a
-- hard-coded tax rate, and it was not idempotent under offline retries.
REVOKE ALL ON FUNCTION public.record_sale(uuid, jsonb, text, numeric, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- RLS helper functions are only callable from authenticated application
-- sessions; anonymous callers should not be able to probe membership status.
REVOKE ALL ON FUNCTION public.is_staff_of_outlet(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_merchant_of_outlet(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_outlet(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_outlet(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_of_outlet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_merchant_of_outlet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_outlet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_outlet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

CREATE INDEX IF NOT EXISTS sales_outlet_created_idx
  ON public.sales (outlet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_outlet_created_idx
  ON public.audit_logs (outlet_id, created_at DESC);

COMMIT;
