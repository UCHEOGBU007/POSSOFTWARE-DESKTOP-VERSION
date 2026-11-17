import { createClient } from "npm:@supabase/supabase-js@2";

const configuredOrigins = [
  Deno.env.get("APP_ORIGIN") ?? "",
  ...(Deno.env.get("APP_ORIGINS") ?? "").split(","),
]
  .map((origin) => origin.trim())
  .filter(Boolean);

function headersFor(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigin = configuredOrigins.length
    ? configuredOrigins.includes(origin)
      ? origin
      : ""
    : "*";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headersFor(request),
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: headersFor(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization) {
    return json(request, { error: "Authentication required" }, 401);
  }
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Staff provisioning environment is incomplete");
    return json(request, { error: "Staff service is unavailable" }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser();
  const user = userData.user;
  if (authError || !user) {
    return json(request, { error: "Authentication required" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
      return json(request, { error: "Request body is too large" }, 413);
    }
    const value: unknown = JSON.parse(rawBody);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return json(request, { error: "Request body must be an object" }, 400);
    }
    body = value as Record<string, unknown>;
  } catch {
    return json(request, { error: "Request body must be valid JSON" }, 400);
  }

  const outletId = typeof body.outletId === "string" ? body.outletId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const role = body.role;
  const initialPassword =
    typeof body.initialPassword === "string" ? body.initialPassword : "";
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuidPattern.test(outletId) ||
    name.length < 1 || name.length > 100 ||
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    phone.length > 32 ||
    (role !== "manager" && role !== "cashier") ||
    initialPassword.length < 12 || initialPassword.length > 128
  ) {
    return json(request, { error: "Invalid staff account details" }, 400);
  }

  const { error: rateError } = await userClient.rpc("consume_api_rate_limit", {
    p_action: "staff_provision",
  });
  if (rateError) {
    if (rateError.code === "53300") {
      return json(request, { error: "Staff creation limit reached. Try again later." }, 429);
    }
    console.error("Staff provisioning rate-limit check failed", {
      userId: user.id,
      code: rateError.code,
    });
    return json(request, { error: "Staff service is unavailable" }, 503);
  }

  const [{ data: merchant, error: merchantError }, { data: outlet, error: outletError }] =
    await Promise.all([
      userClient
        .from("merchants")
        .select("id, approval_status")
        .eq("id", user.id)
        .maybeSingle(),
      userClient
        .from("outlets")
        .select("id, merchant_id, is_active")
        .eq("id", outletId)
        .maybeSingle(),
    ]);
  if (
    merchantError || outletError || !merchant || !outlet ||
    merchant.id !== outlet.merchant_id || outlet.merchant_id !== user.id
  ) {
    return json(request, { error: "Outlet not found or access denied" }, 403);
  }
  if (merchant.approval_status !== "approved" || !outlet.is_active) {
    return json(request, { error: "An approved account and active outlet are required" }, 403);
  }

  const now = new Date().toISOString();
  const { data: subscription, error: subscriptionError } = await userClient
    .from("subscriptions")
    .select("id")
    .eq("tenant_id", user.id)
    .in("status", ["active", "trial"])
    .lte("starts_at", now)
    .gt("expires_at", now)
    .limit(1)
    .maybeSingle();
  if (subscriptionError || !subscription) {
    return json(request, { error: "An active subscription is required" }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    app_metadata: { account_type: "staff" },
    user_metadata: { full_name: name },
  });
  if (createError || !authUser.user) {
    return json(
      request,
      { error: createError?.message ?? "Unable to create staff login" },
      400,
    );
  }

  const { error: profileError } = await adminClient.from("staff").insert({
    id: authUser.user.id,
    outlet_id: outletId,
    name,
    email,
    phone: phone || null,
    role,
    is_active: true,
  });
  if (profileError) {
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(
      authUser.user.id,
    );
    if (rollbackError) {
      console.error("Staff profile failed and Auth rollback also failed", {
        userId: user.id,
        staffId: authUser.user.id,
        profileCode: profileError.code,
        rollbackCode: rollbackError.status,
      });
    }
    return json(request, { error: "Unable to finish staff account setup" }, 500);
  }

  return json(request, { id: authUser.user.id }, 201);
});
