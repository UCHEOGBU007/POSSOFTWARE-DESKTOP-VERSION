import { getSupabaseConfigStatus, supabase } from "@/lib/supabase";
import type {
  BillingAnalytics,
  BillingCycle,
  BillingPlan,
  Invoice,
  PaymentRecord,
  PaymentSubmission,
  PaymentMethodManual,
  PlanCode,
  SubscriptionPlanCode,
  Subscription,
} from "@/types";
import { BILLING_PLANS } from "@/types";
import { generateId } from "@/utils/helpers";

export interface TenantBillingData {
  plans: BillingPlan[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  submissions: PaymentSubmission[];
  payments: PaymentRecord[];
  activeOutlets: number;
  overageOutlets: number;
}

export interface BillingPaymentInstructions {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  accountNumberSha256: string;
  paymentNotes: string;
  qrisImageUrl: string;
}

const paymentInstructionsBucket = "billing-payment-instructions";

export async function loadBillingPaymentInstructions(): Promise<BillingPaymentInstructions> {
  requireBillingConfiguration();
  const { data, error } = await supabase
    .from("billing_payment_instructions")
    .select("bank_name, account_holder, account_number, account_number_sha256, payment_notes, qris_image_url")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return {
    bankName: String(data?.bank_name ?? ""),
    accountHolder: String(data?.account_holder ?? ""),
    accountNumber: String(data?.account_number ?? ""),
    accountNumberSha256: String(data?.account_number_sha256 ?? ""),
    paymentNotes: String(data?.payment_notes ?? ""),
    qrisImageUrl: String(data?.qris_image_url ?? ""),
  };
}

export async function saveBillingPaymentInstructions(input: {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  paymentNotes: string;
  qrisImage?: File | null;
}): Promise<void> {
  requireBillingConfiguration();
  let qrisImageUrl: string | undefined;
  if (input.qrisImage) {
    if (!input.qrisImage.type.startsWith("image/") || input.qrisImage.size > 5 * 1024 * 1024) {
      throw new Error("Choose a PNG, JPEG, or WebP QRIS image under 5 MB.");
    }
    const extension = input.qrisImage.type === "image/jpeg" ? "jpg" : input.qrisImage.type.split("/")[1];
    const path = `qris.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(paymentInstructionsBucket)
      .upload(path, input.qrisImage, { upsert: true, contentType: input.qrisImage.type, cacheControl: "0" });
    if (uploadError) throw uploadError;
    qrisImageUrl = supabase.storage.from(paymentInstructionsBucket).getPublicUrl(path).data.publicUrl;
  }
  const accountNumber = input.accountNumber.trim();
  const accountNumberSha256 = accountNumber
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountNumber))))
        .map((byte) => byte.toString(16).padStart(2, "0")).join("")
    : "";
  const { error } = await supabase.from("billing_payment_instructions").update({
    bank_name: input.bankName.trim(),
    account_holder: input.accountHolder.trim(),
    account_number: accountNumber,
    account_number_sha256: accountNumberSha256,
    payment_notes: input.paymentNotes.trim(),
    ...(qrisImageUrl ? { qris_image_url: qrisImageUrl } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (error) throw error;
}

export interface AdminPaymentQueueItem {
  submission: PaymentSubmission;
  invoice: Invoice;
  businessName: string;
  email: string;
}

export interface AdminBillingTenant {
  id: string;
  businessName: string;
  email: string;
  activeOutlets: number;
  currentSubscription: AdminTenantSubscription | null;
  scheduledSubscription: AdminTenantSubscription | null;
}

export interface AdminTenantSubscription {
  id: string;
  planCode: SubscriptionPlanCode;
  billingCycle: BillingCycle;
  startsAt: string;
  expiresAt: string;
  amount: number;
  currency: string;
  adminOverride: boolean;
}

export function requireBillingConfiguration() {
  if (!getSupabaseConfigStatus().isConfigured) {
    throw new Error("Online billing requires a configured Supabase connection.");
  }
}

export async function loadTenantBilling(
  tenantId: string,
): Promise<TenantBillingData> {
  requireBillingConfiguration();
  const [planResult, subscriptionResult, invoiceResult, submissionResult, paymentResult, outletResult, overageResult] =
    await Promise.all([
      supabase
        .from("subscription_plans")
        .select(
          "plan_code, display_name, monthly_price, annual_price, included_outlets, overage_price_monthly, features",
        )
        .eq("is_public", true)
        .order("monthly_price"),
      supabase
        .from("subscriptions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("starts_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_submissions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("submitted_at", { ascending: false }),
      supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("paid_at", { ascending: false }),
      supabase
        .from("outlets")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", tenantId)
        .eq("is_active", true),
      supabase
        .from("outlet_overage_entitlements")
        .select("outlet_quantity")
        .eq("tenant_id", tenantId)
        .lte("starts_at", new Date().toISOString())
        .gt("expires_at", new Date().toISOString()),
    ]);

  const error =
    planResult.error ??
    subscriptionResult.error ??
    invoiceResult.error ??
    submissionResult.error ??
    paymentResult.error ??
    outletResult.error ??
    overageResult.error;
  if (error) throw error;

  const plans = (planResult.data ?? []).map((row) => {
    const planCode = row.plan_code as PlanCode;
    const catalogPlan = BILLING_PLANS[planCode];
    if (!catalogPlan) {
      throw new Error(`Unknown public billing plan: ${row.plan_code}`);
    }
    return {
      ...catalogPlan,
      name: row.display_name,
      monthlyPrice: Number(row.monthly_price),
      annualPrice: Number(row.annual_price),
      maxOutlets: Number(row.included_outlets),
      overagePriceMonthly: Number(row.overage_price_monthly),
      features: Object.entries(row.features ?? {})
        .filter(([, enabled]) => Boolean(enabled))
        .map(([feature]) => feature.replace(/_/g, " ")),
    };
  });

  return {
    plans,
    subscriptions: (subscriptionResult.data ?? []).map(mapSubscription),
    invoices: (invoiceResult.data ?? []).map(mapInvoice),
    submissions: (submissionResult.data ?? []).map(mapSubmission),
    payments: (paymentResult.data ?? []).map(mapPayment),
    activeOutlets: outletResult.count ?? 0,
    overageOutlets: (overageResult.data ?? []).reduce(
      (total, row) => total + Number(row.outlet_quantity),
      0,
    ),
  };
}

export async function createSubscriptionInvoice(
  planCode: PlanCode,
  billingCycle: BillingCycle,
): Promise<Invoice> {
  requireBillingConfiguration();
  const { data, error } = await supabase.rpc("create_subscription_invoice", {
    p_plan_code: planCode,
    p_billing_cycle: billingCycle,
    p_idempotency_key: generateId(),
  });
  if (error) throw error;
  return mapInvoice(data);
}

export async function createOutletOverageInvoice(
  outletQuantity: number,
): Promise<Invoice> {
  requireBillingConfiguration();
  if (!Number.isInteger(outletQuantity) || outletQuantity < 1 || outletQuantity > 50) {
    throw new Error("Choose between 1 and 50 additional outlets.");
  }
  const { data, error } = await supabase.rpc("create_outlet_overage_invoice", {
    p_outlet_quantity: outletQuantity,
    p_idempotency_key: generateId(),
  });
  if (error) throw error;
  return mapInvoice(data);
}

export async function submitInvoicePayment(input: {
  invoiceId: string;
  paymentMethod: PaymentMethodManual;
  amount: number;
  reference: string;
  note?: string;
}): Promise<PaymentSubmission> {
  requireBillingConfiguration();
  const { data, error } = await supabase.rpc("submit_invoice_payment", {
    p_invoice_id: input.invoiceId,
    p_payment_method: input.paymentMethod,
    p_amount: input.amount,
    p_reference: input.reference.trim(),
    p_note: input.note?.trim() || null,
  });
  if (error) throw error;
  return mapSubmission(data);
}

export async function cancelSubscriptionAtPeriodEnd() {
  requireBillingConfiguration();
  const { error } = await supabase.rpc("cancel_subscription_at_period_end");
  if (error) throw error;
}

export async function loadAdminBillingAnalytics(): Promise<BillingAnalytics> {
  requireBillingConfiguration();
  const { data, error } = await supabase.rpc("admin_billing_analytics");
  if (error) throw error;
  return data as BillingAnalytics;
}

export async function loadAdminBillingTenants(): Promise<AdminBillingTenant[]> {
  requireBillingConfiguration();
  const { data, error } = await supabase.rpc("admin_billing_tenants");
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("Admin tenant list returned an invalid response.");
  }

  return data.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Admin tenant list contains an invalid record.");
    }
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id),
      businessName: String(row.business_name),
      email: String(row.email),
      activeOutlets: Number(row.active_outlets),
      currentSubscription: mapAdminTenantSubscription(
        row.current_subscription,
      ),
      scheduledSubscription: mapAdminTenantSubscription(
        row.scheduled_subscription,
      ),
    };
  });
}

export async function applyAdminSubscriptionOverride(input: {
  tenantId: string;
  planCode: PlanCode;
  billingCycle: BillingCycle;
  reason: string;
}): Promise<void> {
  requireBillingConfiguration();
  const { error } = await supabase.functions.invoke("admin-merchant", {
    body: {
      action: "override_subscription",
      tenantId: input.tenantId,
      planCode: input.planCode,
      billingCycle: input.billingCycle,
      reason: input.reason.trim(),
    },
  });
  if (error) throw error;
}

export async function loadAdminPaymentQueue(): Promise<AdminPaymentQueueItem[]> {
  requireBillingConfiguration();
  const { data: rows, error } = await supabase
    .from("payment_submissions")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw error;
  if (!rows?.length) return [];

  const invoiceIds = [...new Set(rows.map((row) => row.invoice_id))];
  const tenantIds = [...new Set(rows.map((row) => row.tenant_id))];
  const [invoiceResult, merchantResult] = await Promise.all([
    supabase.from("invoices").select("*").in("id", invoiceIds),
    supabase
      .from("merchants")
      .select("id, business_name, email")
      .in("id", tenantIds),
  ]);
  if (invoiceResult.error || merchantResult.error) {
    throw invoiceResult.error ?? merchantResult.error;
  }

  const invoices = new Map(
    (invoiceResult.data ?? []).map((row) => [row.id, mapInvoice(row)]),
  );
  const merchants = new Map(
    (merchantResult.data ?? []).map((row) => [
      row.id,
      { businessName: row.business_name, email: row.email },
    ]),
  );

  return rows.flatMap((row) => {
    const invoice = invoices.get(row.invoice_id);
    const merchant = merchants.get(row.tenant_id);
    if (!invoice || !merchant) return [];
    return [{
      submission: mapSubmission(row),
      invoice,
      businessName: merchant.businessName,
      email: merchant.email,
    }];
  });
}

export async function reviewPaymentSubmission(
  submissionId: string,
  approve: boolean,
  rejectionReason?: string,
) {
  requireBillingConfiguration();
  const { error } = await supabase.functions.invoke("admin-merchant", {
    body: {
      action: "review_payment",
      submissionId,
      approve,
      rejectionReason: rejectionReason ?? null,
    },
  });
  if (error) throw error;
}

function mapSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    planCode: row.plan_code as SubscriptionPlanCode,
    amount: Number(row.amount),
    currency: String(row.currency ?? "IDR"),
    billingCycle: row.billing_cycle as BillingCycle,
    startsAt: String(row.starts_at),
    expiresAt: String(row.expires_at),
    status: row.status as Subscription["status"],
    autoRenew: Boolean(row.auto_renew),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    adminOverride: Boolean(row.admin_override),
    createdAt: String(row.created_at),
  };
}

function mapAdminTenantSubscription(
  value: unknown,
): AdminTenantSubscription | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Admin tenant list contains an invalid subscription.");
  }

  const row = value as Record<string, unknown>;
  if (row.billing_cycle !== "monthly" && row.billing_cycle !== "yearly") {
    throw new Error("Admin tenant list contains an invalid billing cycle.");
  }
  return {
    id: String(row.id),
    planCode: String(row.plan_code) as SubscriptionPlanCode,
    billingCycle: row.billing_cycle,
    startsAt: String(row.starts_at),
    expiresAt: String(row.expires_at),
    amount: Number(row.amount),
    currency: String(row.currency ?? "IDR"),
    adminOverride: Boolean(row.admin_override),
  };
}

function mapInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    invoiceNumber: String(row.invoice_number),
    invoiceType: row.invoice_type as Invoice["invoiceType"],
    planCode: (row.plan_code as SubscriptionPlanCode | null) ?? null,
    billingCycle: (row.billing_cycle as BillingCycle | null) ?? null,
    outletQuantity: Number(row.outlet_quantity),
    amount: Number(row.amount),
    currency: "IDR",
    dueDate: String(row.due_date),
    periodStartsAt: (row.period_starts_at as string | null) ?? null,
    periodEndsAt: (row.period_ends_at as string | null) ?? null,
    status: row.status as Invoice["status"],
    createdAt: String(row.created_at),
    paidAt: (row.paid_at as string | null) ?? null,
  };
}

function mapSubmission(row: Record<string, unknown>): PaymentSubmission {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    tenantId: String(row.tenant_id),
    paymentMethod: row.payment_method as PaymentMethodManual,
    amount: Number(row.amount),
    reference: String(row.reference),
    note: (row.note as string | null) ?? null,
    status: row.status as PaymentSubmission["status"],
    submittedAt: String(row.submitted_at),
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    rejectionReason: (row.rejection_reason as string | null) ?? null,
  };
}

function mapPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    tenantId: String(row.tenant_id),
    paymentMethod: row.payment_method as PaymentMethodManual,
    amount: Number(row.amount),
    reference: String(row.reference),
    paidAt: String(row.paid_at),
  };
}
