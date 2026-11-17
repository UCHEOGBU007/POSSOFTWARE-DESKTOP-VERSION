import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  BarChart3,
  Building2,
  CreditCard,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { StatCard } from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import {
  applyAdminSubscriptionOverride,
  loadAdminBillingTenants,
  loadAdminBillingAnalytics,
  loadAdminPaymentQueue,
  type AdminBillingTenant,
  reviewPaymentSubmission,
  loadBillingPaymentInstructions,
  saveBillingPaymentInstructions,
  type BillingPaymentInstructions,
  type AdminPaymentQueueItem,
} from "@/lib/billing";
import type { BillingAnalytics, BillingCycle, PlanCode } from "@/types";
import { BILLING_PLANS } from "@/types";
import { formatCurrency, formatDateShort } from "@/utils/helpers";

export default function BillingDashboard() {
  const { logoutAdmin, adminSession } = useAuth();
  const { error: showError, success } = useToast();
  const [analytics, setAnalytics] = useState<BillingAnalytics | null>(null);
  const [queue, setQueue] = useState<AdminPaymentQueueItem[]>([]);
  const [tenants, setTenants] = useState<AdminBillingTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const selectedTenantIdRef = useRef("");
  const [overridePlan, setOverridePlan] = useState<PlanCode>("starter");
  const [overrideCycle, setOverrideCycle] = useState<BillingCycle>("monthly");
  const [overrideReason, setOverrideReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busySubmissionId, setBusySubmissionId] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState<BillingPaymentInstructions>({
    bankName: "", accountHolder: "", accountNumber: "", accountNumberSha256: "", paymentNotes: "", qrisImageUrl: "",
  });
  const [qrisImage, setQrisImage] = useState<File | null>(null);
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextAnalytics, nextQueue, nextTenants] = await Promise.all([
        loadAdminBillingAnalytics(),
        loadAdminPaymentQueue(),
        loadAdminBillingTenants(),
      ]);
      setAnalytics(nextAnalytics);
      setQueue(nextQueue);
      setTenants(nextTenants);
      setPaymentSettings(await loadBillingPaymentInstructions());
      const currentSelection = nextTenants.find(
        (tenant) => tenant.id === selectedTenantIdRef.current,
      );
      if (!currentSelection) {
        const firstTenant = nextTenants[0];
        selectedTenantIdRef.current = firstTenant?.id ?? "";
        setSelectedTenantId(selectedTenantIdRef.current);
        const initialSubscription =
          firstTenant?.scheduledSubscription ??
          firstTenant?.currentSubscription;
        if (initialSubscription) {
          if (isPlanCode(initialSubscription.planCode)) {
            setOverridePlan(initialSubscription.planCode);
          }
          setOverrideCycle(initialSubscription.billingCycle);
        }
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to load billing dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const planRevenue = useMemo(() => {
    const items = Object.entries(analytics?.revenue_by_plan ?? {}).sort(
      (left, right) => right[1] - left[1],
    );
    return {
      items,
      max: Math.max(...items.map(([, amount]) => amount), 1),
    };
  }, [analytics]);
  const revenueChartMax = Math.max(
    ...(analytics?.monthly_revenue.map((month) => month.amount) ?? []),
    1,
  );
  const customerChartMax = Math.max(
    ...(analytics?.customer_growth.map((month) => month.tenants) ?? []),
    1,
  );
  const selectedTenant = tenants.find(
    (tenant) => tenant.id === selectedTenantId,
  );
  const selectedPlanDetails = BILLING_PLANS[overridePlan];

  const selectTenant = (tenantId: string) => {
    selectedTenantIdRef.current = tenantId;
    setSelectedTenantId(tenantId);
    const tenant = tenants.find((item) => item.id === tenantId);
    const planCode =
      tenant?.scheduledSubscription?.planCode ??
      tenant?.currentSubscription?.planCode;
    const cycle =
      tenant?.scheduledSubscription?.billingCycle ??
      tenant?.currentSubscription?.billingCycle;
    setOverridePlan(isPlanCode(planCode) ? planCode : "starter");
    setOverrideCycle(cycle ?? "monthly");
  };

  const review = async (item: AdminPaymentQueueItem, approve: boolean) => {
    const rejectionReason = approve
      ? undefined
      : window.prompt("Why is this payment being rejected?");
    if (!approve && rejectionReason === null) return;

    setBusySubmissionId(item.submission.id);
    try {
      await reviewPaymentSubmission(
        item.submission.id,
        approve,
        rejectionReason ?? undefined,
      );
      success(
        approve
          ? "Payment verified. The subscription or outlet capacity is now active."
          : "Payment rejected. The invoice is open for another submission.",
      );
      await refresh();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to review this payment.",
      );
    } finally {
      setBusySubmissionId(null);
    }
  };

  const savePaymentSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingPaymentSettings(true);
    try {
      await saveBillingPaymentInstructions({ ...paymentSettings, qrisImage });
      setPaymentSettings(await loadBillingPaymentInstructions());
      setQrisImage(null);
      success("Client payment instructions saved.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to save payment instructions.");
    } finally {
      setSavingPaymentSettings(false);
    }
  };

  const applyOverride = async () => {
    if (!selectedTenant) {
      showError("Select an approved tenant first.");
      return;
    }
    if (overrideReason.trim().length < 5) {
      showError("Enter a reason of at least five characters.");
      return;
    }

    const startsAt =
      selectedTenant.currentSubscription &&
      new Date(selectedTenant.currentSubscription.expiresAt).getTime() >
        Date.now()
        ? selectedTenant.currentSubscription.expiresAt
        : new Date().toISOString();
    const effectiveDate = formatDateShort(startsAt);
    if (
      !window.confirm(
        `This is a no-charge admin override; it creates no invoice or payment record and is excluded from paid MRR. The ${selectedPlanDetails.name} ${overrideCycle} term is scheduled for ${effectiveDate}. Continue?`,
      )
    ) {
      return;
    }

    setSavingOverride(true);
    try {
      await applyAdminSubscriptionOverride({
        tenantId: selectedTenant.id,
        planCode: overridePlan,
        billingCycle: overrideCycle,
        reason: overrideReason,
      });
      success(
        `Complimentary ${selectedPlanDetails.name} ${overrideCycle} adjustment scheduled from ${effectiveDate}.`,
      );
      setOverrideReason("");
      await refresh();
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Unable to apply the admin plan adjustment.",
      );
    } finally {
      setSavingOverride(false);
    }
  };

  return (
    <main className="min-h-screen space-y-6 bg-pos-bg p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-pos-text">
            SaaS Billing Dashboard
          </h1>
          <p className="mt-1 text-sm text-pos-muted">
            Signed in as {adminSession?.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw size={15} />}
            onClick={() => void refresh()}
            loading={loading}
          >
            Refresh
          </Button>
          <Link
            to="/admin/merchants"
            className="inline-flex items-center rounded-lg border border-pos-border px-4 py-2 text-sm text-pos-text hover:bg-pos-hover"
          >
            Merchant approvals
          </Link>
          <Button variant="danger" onClick={logoutAdmin}>
            Sign out
          </Button>
        </div>
      </header>

      {analytics && (
        <>
          <p className="text-sm text-pos-muted">
            MRR and ARR include approved, active IDR subscriptions only.
            Historical subscriptions retained in another currency are excluded
            until converted; revenue charts count verified IDR payments.
          </p>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Monthly recurring revenue"
              value={formatCurrency(analytics.mrr)}
              icon={<CreditCard size={18} />}
              iconColor="text-emerald-400"
            />
            <StatCard
              label="Annual recurring revenue"
              value={formatCurrency(analytics.arr)}
              icon={<TrendingUp size={18} />}
              iconColor="text-blue-400"
            />
            <StatCard
              label="Paid active tenants"
              value={String(analytics.active_tenants)}
              icon={<Users size={18} />}
              iconColor="text-indigo-400"
            />
            <StatCard
              label="12-month run-rate forecast"
              value={formatCurrency(analytics.revenue_forecast_12m)}
              icon={<BarChart3 size={18} />}
              iconColor="text-cyan-400"
            />
            <StatCard
              label="Trial / complimentary tenants"
              value={String(analytics.trial_tenants)}
              icon={<Building2 size={18} />}
              iconColor="text-amber-400"
            />
            <StatCard
              label="Cancellation requests · 30d"
              value={String(analytics.cancelled_tenants)}
              icon={<Users size={18} />}
              iconColor="text-rose-400"
            />
            <StatCard
              label="Average MRR per paid tenant"
              value={formatCurrency(analytics.average_revenue_per_tenant)}
              icon={<CreditCard size={18} />}
            />
            <StatCard
              label="Collected revenue growth · 30d"
              value={`${analytics.revenue_growth_30d}%`}
              icon={<TrendingUp size={18} />}
              iconColor={
                analytics.revenue_growth_30d < 0
                  ? "text-rose-400"
                  : "text-emerald-400"
              }
            />
            <StatCard
              label="Total outlets · 30-day churn"
              value={`${analytics.total_outlets} · ${analytics.churn_rate_30d}%`}
              icon={<Building2 size={18} />}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-pos-text">
                Verified revenue growth · last 12 months
              </h2>
              <div className="flex h-48 items-end gap-2">
                {analytics.monthly_revenue.map((month) => (
                  <div
                    key={month.month}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                    title={`${month.month}: ${formatCurrency(month.amount)}`}
                  >
                    <div className="flex h-full w-full items-end">
                      <div
                        className="w-full rounded-t bg-emerald-500/80"
                        style={{
                          height: `${Math.max(3, (month.amount / revenueChartMax) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="truncate text-[10px] text-pos-muted">
                      {month.month}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-pos-muted">
                Cash recorded after an administrator verifies a payment. This
                is collected revenue, not recognized accounting revenue.
              </p>
            </Card>

            <Card>
              <h2 className="mb-4 text-lg font-semibold text-pos-text">
                Cumulative customer growth
              </h2>
              <div className="flex h-48 items-end gap-2">
                {analytics.customer_growth.map((month) => (
                  <div
                    key={month.month}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                    title={`${month.month}: ${month.tenants} tenants`}
                  >
                    <div className="flex h-full w-full items-end">
                      <div
                        className="w-full rounded-t bg-blue-500/80"
                        style={{
                          height: `${Math.max(3, (month.tenants / customerChartMax) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="truncate text-[10px] text-pos-muted">
                      {month.month}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-pos-muted">
                Registered tenants by month; includes pending, trial, and
                cancelled accounts.
              </p>
            </Card>

            <Card>
              <h2 className="mb-4 text-lg font-semibold text-pos-text">
                MRR by plan
              </h2>
              {planRevenue.items.length === 0 ? (
                <p className="text-sm text-pos-muted">
                  No paid subscriptions are active yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {planRevenue.items.map(([plan, amount]) => (
                    <div key={plan}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="capitalize text-pos-text">{plan}</span>
                        <span className="text-pos-muted">
                          {formatCurrency(amount)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-pos-hover">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{
                            width: `${Math.min(100, (amount / planRevenue.max) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-pos-muted">
                Annual subscriptions are normalized to one-twelfth of their
                contracted value. Forecast is current MRR × 12, not guaranteed
                cash collection.
              </p>
            </Card>

            <Card>
              <h2 className="mb-4 text-lg font-semibold text-pos-text">
                Top Enterprise customers
              </h2>
              {analytics.top_enterprise_customers.length === 0 ? (
                <p className="text-sm text-pos-muted">
                  No active Enterprise subscriptions yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {analytics.top_enterprise_customers.map((customer) => (
                    <div
                      key={customer.id}
                      className="flex items-center justify-between gap-3 border-b border-pos-border pb-3 last:border-0"
                    >
                      <span className="font-medium text-pos-text">
                        {customer.business_name}
                      </span>
                      <Badge variant="info">
                        {customer.active_outlets} outlets
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        </>
      )}

      <Card>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-pos-text">
            Manual plan adjustment
          </h2>
          <p className="mt-1 text-sm text-pos-muted">
            For a tenant-requested change handled directly by your team. This
            creates complimentary access, not an invoice or payment record, and
            does not count toward paid MRR. Paid changes should use invoice
            verification.
          </p>
        </div>

        {tenants.length === 0 ? (
          <p className="text-sm text-pos-muted">
            No approved tenants are available to adjust.
          </p>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-pos-text">Tenant</span>
              <select
                value={selectedTenantId}
                onChange={(event) => selectTenant(event.target.value)}
                className="w-full rounded-lg border border-pos-border bg-pos-card px-3 py-2 text-sm text-pos-text"
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.businessName} · {tenant.email}
                  </option>
                ))}
              </select>
            </label>

            {selectedTenant && (
              <>
                <div className="rounded-lg border border-pos-border p-3 text-sm">
                  <p className="font-medium text-pos-text">
                    Active outlets: {selectedTenant.activeOutlets}
                  </p>
                  <p className="mt-1 text-pos-muted">
                    Current:{" "}
                    {describeSubscription(selectedTenant.currentSubscription)}
                  </p>
                  {selectedTenant.scheduledSubscription && (
                    <p className="mt-1 text-pos-muted">
                      Already scheduled:{" "}
                      {describeSubscription(
                        selectedTenant.scheduledSubscription,
                      )}
                    </p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-pos-text">
                      Service plan
                    </span>
                    <select
                      value={overridePlan}
                      onChange={(event) => {
                        if (isPlanCode(event.target.value)) {
                          setOverridePlan(event.target.value);
                        }
                      }}
                      className="w-full rounded-lg border border-pos-border bg-pos-card px-3 py-2 text-sm text-pos-text"
                    >
                      {Object.values(BILLING_PLANS).map((plan) => (
                        <option key={plan.planCode} value={plan.planCode}>
                          {plan.name} · {plan.maxOutlets} included outlets
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-pos-text">
                      Term
                    </span>
                    <select
                      value={overrideCycle}
                      onChange={(event) => {
                        if (
                          event.target.value === "monthly" ||
                          event.target.value === "yearly"
                        ) {
                          setOverrideCycle(event.target.value);
                        }
                      }}
                      className="w-full rounded-lg border border-pos-border bg-pos-card px-3 py-2 text-sm text-pos-text"
                    >
                      <option value="monthly">One month</option>
                      <option value="yearly">One year</option>
                    </select>
                  </label>
                </div>

                {selectedTenant.activeOutlets > selectedPlanDetails.maxOutlets && (
                  <p className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>
                      The selected plan includes {selectedPlanDetails.maxOutlets}{" "}
                      outlets. The change will be rejected unless existing
                      outlets fit the new capacity or verified Enterprise
                      overage covers the full term. No outlets are deactivated
                      automatically.
                    </span>
                  </p>
                )}

                <Input
                  label="Reason (required for audit)"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Client-requested plan adjustment"
                  maxLength={500}
                />
                <p className="text-xs text-pos-muted">
                  The new term begins after the current paid-through date. If
                  there is no active term, it begins when this change is
                  confirmed. Monthly lasts one month; yearly lasts one year.
                </p>
                <Button
                  onClick={() => void applyOverride()}
                  loading={savingOverride}
                  disabled={
                    loading ||
                    savingOverride ||
                    overrideReason.trim().length < 5
                  }
                >
                  Apply complimentary adjustment
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-pos-text">Client payment instructions</h2>
          <p className="mt-1 text-sm text-pos-muted">These bank details and QRIS image are shown to signed-in clients when they choose how to pay.</p>
        </div>
        <form onSubmit={savePaymentSettings} className="grid gap-4 md:grid-cols-2">
          <Input label="Bank name" value={paymentSettings.bankName} onChange={(event) => setPaymentSettings({ ...paymentSettings, bankName: event.target.value })} maxLength={120} />
          <Input label="Account holder" value={paymentSettings.accountHolder} onChange={(event) => setPaymentSettings({ ...paymentSettings, accountHolder: event.target.value })} maxLength={160} />
          <Input label="Account number" value={paymentSettings.accountNumber} onChange={(event) => setPaymentSettings({ ...paymentSettings, accountNumber: event.target.value })} maxLength={80} />
          <label className="text-sm text-pos-muted">QRIS scan image (PNG, JPEG, or WebP; max 5 MB)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setQrisImage(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-pos-text" />
          </label>
          <label className="text-sm text-pos-muted md:col-span-2">Payment notes
            <textarea value={paymentSettings.paymentNotes} onChange={(event) => setPaymentSettings({ ...paymentSettings, paymentNotes: event.target.value })} maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border border-pos-border bg-pos-card px-3 py-2 text-pos-text" />
          </label>
          {paymentSettings.qrisImageUrl && <div className="md:col-span-2"><p className="mb-2 text-sm text-pos-muted">Current QRIS image</p><img src={paymentSettings.qrisImageUrl} alt="Saved QRIS payment code" className="max-h-56 rounded-lg object-contain" /></div>}
          <p className="text-xs text-pos-muted md:col-span-2">Account number SHA-256: {paymentSettings.accountNumberSha256 || "Not set"}. The original number is retained so clients can make transfers.</p>
          <div><Button type="submit" loading={savingPaymentSettings} disabled={loading || savingPaymentSettings}>Save payment instructions</Button></div>
        </form>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-pos-text">
              Manual payment verification
            </h2>
            <p className="mt-1 text-sm text-pos-muted">
              Confirm the received IDR transfer against your bank or QRIS
              provider before granting subscription or outlet access.
            </p>
          </div>
          <Badge variant={queue.length > 0 ? "warning" : "success"}>
            {queue.length} pending
          </Badge>
        </div>

        {loading && <p className="text-sm text-pos-muted">Loading billing…</p>}
        {!loading && queue.length === 0 && (
          <p className="text-sm text-pos-muted">
            No payments are waiting for review.
          </p>
        )}
        <div className="space-y-4">
          {queue.map((item) => (
            <div
              key={item.submission.id}
              className="rounded-lg border border-pos-border p-4"
            >
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div>
                  <p className="font-semibold text-pos-text">
                    {item.businessName} · {formatCurrency(item.submission.amount)}
                  </p>
                  <p className="mt-1 text-xs text-pos-muted">
                    {item.email} · {item.invoice.invoiceNumber} ·{" "}
                    {item.invoice.invoiceType === "subscription"
                      ? `${item.invoice.planCode} ${item.invoice.billingCycle}`
                      : `${item.invoice.outletQuantity} overage outlet-month(s)`}
                  </p>
                  <p className="mt-1 text-xs text-pos-muted">
                    {item.submission.paymentMethod.replace("_", " ")} · Ref:{" "}
                    {item.submission.reference} · Submitted{" "}
                    {formatDateShort(item.submission.submittedAt)}
                  </p>
                  {item.submission.note && (
                    <p className="mt-1 text-xs text-pos-muted">
                      Note: {item.submission.note}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="success"
                    icon={<BadgeCheck size={15} />}
                    loading={busySubmissionId === item.submission.id}
                    disabled={Boolean(busySubmissionId)}
                    onClick={() => void review(item, true)}
                  >
                    Verify payment
                  </Button>
                  <Button
                    variant="danger"
                    loading={busySubmissionId === item.submission.id}
                    disabled={Boolean(busySubmissionId)}
                    onClick={() => void review(item, false)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}

function isPlanCode(value: string | undefined): value is PlanCode {
  return value === "starter" ||
    value === "business" ||
    value === "growth" ||
    value === "enterprise";
}

function describeSubscription(
  subscription: AdminBillingTenant["currentSubscription"],
) {
  if (!subscription) return "No active term";
  const planName = isPlanCode(subscription.planCode)
    ? BILLING_PLANS[subscription.planCode].name
    : subscription.planCode;
  return `${planName} · ${subscription.billingCycle} · through ${formatDateShort(subscription.expiresAt)}${
    subscription.adminOverride ? " · complimentary" : ""
  }`;
}
