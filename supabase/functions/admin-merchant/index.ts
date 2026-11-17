import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN_CODES = new Set(["starter", "business", "growth", "enterprise"]);
const BILLING_CYCLES = new Set(["monthly", "yearly"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Authentication required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase function environment is incomplete");
    return json({ error: "Admin service is unavailable" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return json({ error: "Authentication required" }, 401);
  }

  let input: Record<string, unknown>;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Request body must be an object" }, 400);
    }
    input = body as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const { error: rateLimitError } = await supabase.rpc("consume_api_rate_limit", {
    p_action: "admin_mutation",
  });
  if (rateLimitError) {
    if (rateLimitError.code === "53300") {
      return json({ error: "Too many admin requests. Try again shortly." }, 429);
    }
    console.error("Admin rate-limit check failed", {
      userId: user.id,
      code: rateLimitError.code,
    });
    return json({ error: "Admin service is unavailable" }, 503);
  }

  if (input.action === "review_payment") {
    const submissionId =
      typeof input.submissionId === "string" ? input.submissionId : "";
    if (!UUID_RE.test(submissionId) || typeof input.approve !== "boolean") {
      return json({ error: "A valid submissionId and approve value are required" }, 400);
    }
    const rejectionReason =
      typeof input.rejectionReason === "string"
        ? input.rejectionReason.trim().slice(0, 500)
        : null;
    const { data, error } = await supabase.rpc("review_invoice_payment", {
      p_submission_id: submissionId,
      p_approve: input.approve,
      p_rejection_reason: rejectionReason,
    });
    if (error) {
      console.error("review_invoice_payment failed", {
        userId: user.id,
        submissionId,
        code: error.code,
        message: error.message,
      });
      return mapRpcError(error);
    }
    return json({ invoice: data });
  }

  if (input.action === "override_subscription") {
    const tenantId = typeof input.tenantId === "string" ? input.tenantId : "";
    const planCode = typeof input.planCode === "string" ? input.planCode : "";
    const billingCycle =
      typeof input.billingCycle === "string" ? input.billingCycle : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";

    if (
      !UUID_RE.test(tenantId) ||
      !PLAN_CODES.has(planCode) ||
      !BILLING_CYCLES.has(billingCycle) ||
      reason.length < 5 ||
      reason.length > 500
    ) {
      return json({
        error:
          "A valid tenant, plan, billing cycle, and 5-500 character reason are required",
      }, 400);
    }

    const { data, error } = await supabase.rpc(
      "admin_apply_subscription_override",
      {
        p_tenant_id: tenantId,
        p_plan_code: planCode,
        p_billing_cycle: billingCycle,
        p_reason: reason,
      },
    );
    if (error) {
      console.error("admin_apply_subscription_override failed", {
        userId: user.id,
        tenantId,
        planCode,
        billingCycle,
        code: error.code,
        message: error.message,
      });
      return mapRpcError(error);
    }
    return json({ subscription: data });
  }

  const merchantId =
    typeof input.merchantId === "string" ? input.merchantId : "";
  const approvalStatus =
    input.approvalStatus === null || input.approvalStatus === undefined
      ? null
      : input.approvalStatus === "approved" || input.approvalStatus === "rejected"
        ? input.approvalStatus
        : "__invalid__";
  const tier =
    input.tier === null || input.tier === undefined
      ? null
      : typeof input.tier === "string"
        ? input.tier
        : "__invalid__";
  const expiry =
    input.expiry === null || input.expiry === undefined
      ? null
      : typeof input.expiry === "string"
        ? input.expiry
        : "__invalid__";

  if (!UUID_RE.test(merchantId)) {
    return json({ error: "merchantId must be a valid UUID" }, 400);
  }
  if (approvalStatus === "__invalid__") {
    return json({ error: "approvalStatus must be approved, rejected, or null" }, 400);
  }
  if (tier !== null && !PLAN_CODES.has(tier)) {
    return json({ error: "tier must be starter, business, growth, enterprise, or null" }, 400);
  }

  let expiryValue: string | null = null;
  if (expiry !== null) {
    const parsedExpiry = new Date(expiry);
    if (Number.isNaN(parsedExpiry.getTime())) {
      return json({ error: "expiry must be a valid ISO date or null" }, 400);
    }
    expiryValue = parsedExpiry.toISOString();
  }
  if (approvalStatus === "approved" && expiryValue === null) {
    return json({ error: "expiry is required when approving a merchant" }, 400);
  }
  if (approvalStatus !== "approved" && expiryValue !== null) {
    return json({ error: "expiry is only allowed when approving a merchant" }, 400);
  }

  const { data, error } = await supabase.rpc("admin_update_merchant", {
    p_merchant_id: merchantId,
    p_approval_status: approvalStatus,
    p_tier: tier,
    p_subscription_expiry: expiryValue,
  });
  if (error) {
    console.error("admin_update_merchant failed", {
      userId: user.id,
      merchantId,
      code: error.code,
      message: error.message,
    });
    return mapRpcError(error);
  }
  return json({ merchant: data });
});

function mapRpcError(error: { code?: string; message?: string }) {
  if (error.code === "53300") {
    return json({ error: "Too many admin requests. Try again shortly." }, 429);
  }
  if (error.code === "42501") {
    return json({ error: "Platform administrator access required" }, 403);
  }
  if (error.code === "P0002") {
    return json({ error: "Record not found" }, 404);
  }
  if (error.code === "22023" || error.code === "23514") {
    return json({ error: error.message ?? "Invalid request" }, 400);
  }
  return json({ error: "Admin operation failed" }, 500);
}
