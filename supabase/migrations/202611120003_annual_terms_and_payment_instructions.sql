BEGIN;

-- Annual terms must last twelve months, including existing trial rows as well
-- as future registrations.
UPDATE public.subscriptions
SET expires_at = starts_at + interval '1 year'
WHERE status IN ('trial', 'active')
  AND billing_cycle = 'yearly';

UPDATE public.merchants m
SET subscription_expiry = s.expires_at,
    updated_at = now()
FROM public.subscriptions s
WHERE s.tenant_id = m.id
  AND s.status = 'trial'
  AND s.billing_cycle = 'yearly'
  AND s.starts_at <= now()
  AND m.subscription_expiry IS DISTINCT FROM s.expires_at;

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

CREATE TABLE public.billing_payment_instructions (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  bank_name text NOT NULL DEFAULT '',
  account_holder text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_number_sha256 text NOT NULL DEFAULT '',
  payment_notes text NOT NULL DEFAULT '',
  qris_image_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
INSERT INTO public.billing_payment_instructions (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.billing_payment_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_payment_instructions_read ON public.billing_payment_instructions
  FOR SELECT TO authenticated USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = auth.uid() AND m.approval_status = 'approved'
    )
  );
CREATE POLICY billing_payment_instructions_admin_update ON public.billing_payment_instructions
  FOR UPDATE TO authenticated USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
GRANT SELECT, UPDATE ON public.billing_payment_instructions TO authenticated;

-- QRIS instructions are public to signed-in merchants; only platform admins
-- may upload or replace them.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('billing-payment-instructions', 'billing-payment-instructions', true, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];
CREATE POLICY billing_qris_public_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'billing-payment-instructions');
CREATE POLICY billing_qris_admin_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'billing-payment-instructions' AND public.is_platform_admin()
  );
CREATE POLICY billing_qris_admin_update ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'billing-payment-instructions' AND public.is_platform_admin()
  ) WITH CHECK (
    bucket_id = 'billing-payment-instructions' AND public.is_platform_admin()
  );
CREATE POLICY billing_qris_admin_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'billing-payment-instructions' AND public.is_platform_admin()
  );

COMMIT;
