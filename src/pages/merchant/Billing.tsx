import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  FileText,
  RefreshCw,
} from "lucide-react";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import {
  cancelSubscriptionAtPeriodEnd,
  createOutletOverageInvoice,
  createSubscriptionInvoice,
  loadTenantBilling,
  loadBillingPaymentInstructions,
  requireBillingConfiguration,
  submitInvoicePayment,
  type TenantBillingData,
} from "@/lib/billing";
import type {
  BillingCycle,
  PaymentMethodManual,
  PlanCode,
  Subscription,
} from "@/types";
import { BILLING_PLANS, TIER_LIMITS } from "@/types";
import { formatCurrency, formatDateShort } from "@/utils/helpers";

const emptyBillingData: TenantBillingData = {
  plans: [],
  subscriptions: [],
  invoices: [],
  submissions: [],
  payments: [],
  activeOutlets: 0,
  overageOutlets: 0,
};

export default function BillingPage() {
  const { merchantSession, refreshMerchantSubscription } = useAuth();
  const { error: showError, success } = useToast();
  const merchant = merchantSession?.merchant;
  const [data, setData] = useState(emptyBillingData);
  const [paymentInstructions, setPaymentInstructions] = useState<Awaited<ReturnType<typeof loadBillingPaymentInstructions>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>("starter");
  const [overageQuantity, setOverageQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethodManual>("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [submittingInvoiceId, setSubmittingInvoiceId] = useState<string | null>(
    null,
  );

  const refresh = async () => {
    if (!merchant?.id) return;
    setLoading(true);
    try {
      requireBillingConfiguration();
      const [next, instructions] = await Promise.all([
        loadTenantBilling(merchant.id),
        loadBillingPaymentInstructions(),
      ]);
      setData(next);
      setPaymentInstructions(instructions);
      await refreshMerchantSubscription();
      const current = next.subscriptions.find(isCurrentSubscription);
      const currentPlan = current?.planCode;
      if (currentPlan && currentPlan in BILLING_PLANS) {
        setSelectedPlan(currentPlan as PlanCode);
      } else if (merchant.tier in BILLING_PLANS) {
        setSelectedPlan(merchant.tier as PlanCode);
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to load billing details.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [merchant?.id]);

  const currentSubscription = useMemo(
    () => data.subscriptions.find(isCurrentSubscription) ?? null,
    [data.subscriptions],
  );
  const currentPlan = currentSubscription
    ? BILLING_PLANS[currentSubscription.planCode as PlanCode]
    : undefined;
  const currentPlanName = currentSubscription
    ? currentPlan?.name ?? TIER_LIMITS[currentSubscription.planCode].name
    : undefined;
  const scheduledSubscription = useMemo(
    () =>
      data.subscriptions.find(
        (subscription) =>
          subscription.startsAt > new Date().toISOString() &&
          subscription.status !== "canceled",
      ) ?? null,
    [data.subscriptions],
  );
  const selectedPlanDetails = data.plans.find(
    (plan) => plan.planCode === selectedPlan,
  );
  const annualSavings = selectedPlanDetails
    ? selectedPlanDetails.monthlyPrice * 12 - selectedPlanDetails.annualPrice
    : 0;
  const annualSavingsPercent = selectedPlanDetails
    ? (annualSavings / (selectedPlanDetails.monthlyPrice * 12)) * 100
    : 0;
  const openSubscriptionInvoice = data.invoices.some(
    (invoice) =>
      invoice.invoiceType === "subscription" &&
      new Date(invoice.dueDate).getTime() > Date.now() &&
      ["awaiting_payment", "under_review"].includes(invoice.status),
  );
  const openOverageInvoice = data.invoices.some(
    (invoice) =>
      invoice.invoiceType === "outlet_overage" &&
      new Date(invoice.dueDate).getTime() > Date.now() &&
      ["awaiting_payment", "under_review"].includes(invoice.status),
  );

  const requestSubscriptionInvoice = async () => {
    setBusy(true);
    try {
      const invoice = await createSubscriptionInvoice(selectedPlan, billingCycle);
      success(
        `Invoice ${invoice.invoiceNumber} created. Your plan changes only after payment is verified.`,
      );
      await refresh();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to create the invoice.",
      );
    } finally {
      setBusy(false);
    }
  };

  const requestOverageInvoice = async () => {
    setBusy(true);
    try {
      const invoice = await createOutletOverageInvoice(overageQuantity);
      success(
        `Invoice ${invoice.invoiceNumber} created for ${overageQuantity} additional outlet-month(s).`,
      );
      await refresh();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to create the overage invoice.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submittingInvoiceId) return;
    const invoice = data.invoices.find(
      (item) => item.id === submittingInvoiceId,
    );
    if (!invoice) {
      showError("Invoice not found. Refresh billing and try again.");
      return;
    }

    setBusy(true);
    try {
      await submitInvoicePayment({
        invoiceId: invoice.id,
        paymentMethod,
        amount: invoice.amount,
        reference: paymentReference,
        note: paymentNote,
      });
      success("Payment submitted for manual verification.");
      setSubmittingInvoiceId(null);
      setPaymentReference("");
      setPaymentNote("");
      await refresh();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to submit payment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelPlan = async () => {
    if (
      !window.confirm(
        "Cancel renewal at the end of the current paid period? Your service stays active until then.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await cancelSubscriptionAtPeriodEnd();
      success("Cancellation scheduled for the end of the paid period.");
      await refresh();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to cancel the plan.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!merchant) {
    return <div className="p-8 text-center text-pos-muted">Loading billing…</div>;
  }

  return (
    <div>
      <Header
        title="Subscription & Billing"
        subtitle="Review your plan, request invoices, and track verified payments."
        actions={
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => void refresh()}
            loading={loading}
          >
            Refresh
          </Button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        {!loading && data.plans.length === 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            Billing is not ready. Apply the Supabase billing migration before
            issuing or paying invoices.
          </div>
        )}

        <Card>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-lg font-semibold text-pos-text">
                Current subscription
              </h2>
              <p className="mt-1 text-sm text-pos-muted">
                {currentSubscription
                  ? currentPlanName ?? currentSubscription.planCode
                  : "No active subscription"}
                {currentSubscription
                  ? ` · ${currentSubscription.billingCycle} billing`
                  : ""}
              </p>
            </div>
            {currentSubscription ? (
              <Badge
                variant={
                  currentSubscription.adminOverride ||
                  currentSubscription.status === "trial"
                    ? "info"
                    : "success"
                }
                dot
              >
                {currentSubscription.adminOverride
                  ? "Complimentary admin access"
                  : currentSubscription.status === "trial"
                    ? "Trial"
                    : "Active"}
              </Badge>
            ) : (
              <Badge variant="danger" dot>
                Expired
              </Badge>
            )}
          </div>
          <div className="mt-5 grid gap-4 border-t border-pos-border pt-5 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-pos-muted">
                Current price
              </p>
              <p className="mt-1 font-semibold text-pos-text">
                {currentSubscription?.adminOverride
                  ? "No charge · admin override"
                  : currentSubscription
                    ? formatCurrency(
                      currentSubscription.amount,
                      currentSubscription.currency,
                    )
                    : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-pos-muted">
                Renewal / expiry
              </p>
              <p className="mt-1 font-semibold text-pos-text">
                {currentSubscription
                  ? formatDateShort(currentSubscription.expiresAt)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-pos-muted">
                Active outlet usage
              </p>
              <p className="mt-1 font-semibold text-pos-text">
                {data.activeOutlets} /{" "}
                {currentPlan?.maxOutlets ??
                  TIER_LIMITS[currentSubscription?.planCode ?? merchant.tier]
                    .maxOutlets}
                {data.overageOutlets > 0
                  ? ` + ${data.overageOutlets} paid overage`
                  : ""}
              </p>
            </div>
          </div>
          {scheduledSubscription && (
            <p className="mt-4 rounded-lg bg-blue-500/10 p-3 text-sm text-blue-300">
              {scheduledSubscription.adminOverride
                ? "A complimentary admin plan adjustment"
                : scheduledSubscription.planCode}{" "}
              is scheduled to start{" "}
              {formatDateShort(scheduledSubscription.startsAt)} after the
              current subscription ends.
            </p>
          )}
          {currentSubscription?.cancelAtPeriodEnd && (
            <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
              Cancellation is scheduled. Access remains available through{" "}
              {formatDateShort(currentSubscription.expiresAt)}.
            </p>
          )}
          {!currentSubscription && (
            <div className="mt-4 flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>
                Your subscription is not active. Create an invoice below.
                Access returns after the payment is verified by an administrator.
              </span>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-pos-text">Plans</h2>
            <p className="mt-1 text-sm text-pos-muted">
              Annual plans cost 10 monthly payments: two months free (16.7%
              savings). A requested plan starts after the current paid period.
              Subscriptions do not renew automatically; payment is manual.
            </p>
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {(["monthly", "yearly"] as const).map((cycle) => (
              <button
                key={cycle}
                type="button"
                onClick={() => setBillingCycle(cycle)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  billingCycle === cycle
                    ? "bg-blue-600 text-white"
                    : "border border-pos-border text-pos-muted"
                }`}
              >
                {cycle === "monthly" ? "Monthly" : "Annual · save 2 months"}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.plans.map((plan) => {
              const isSelected = selectedPlan === plan.planCode;
              const amount =
                billingCycle === "yearly"
                  ? plan.annualPrice
                  : plan.monthlyPrice;
              return (
                <button
                  key={plan.planCode}
                  type="button"
                  onClick={() => setSelectedPlan(plan.planCode)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-pos-border bg-pos-card hover:border-blue-500/50"
                  }`}
                >
                  <p className="font-semibold text-pos-text">{plan.name}</p>
                  <p className="mt-2 text-xl font-bold text-blue-400">
                    {formatCurrency(amount)}
                  </p>
                  <p className="text-xs text-pos-muted">
                    / {billingCycle === "yearly" ? "year" : "month"}
                  </p>
                  <p className="mt-3 text-sm text-pos-muted">
                    {plan.maxOutlets} included outlet
                    {plan.maxOutlets > 1 ? "s" : ""}
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-pos-muted">
                    {plan.features.slice(0, 5).map((feature) => (
                      <li key={feature}>• {feature}</li>
                    ))}
                  </ul>
                  {billingCycle === "yearly" && (
                    <p className="mt-3 text-xs font-medium text-emerald-400">
                      Save {formatCurrency(plan.monthlyPrice * 2)}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {selectedPlanDetails && billingCycle === "yearly" && (
            <p className="mt-4 text-sm text-pos-muted">
              Monthly equivalent:{" "}
              {formatCurrency(selectedPlanDetails.annualPrice / 12)} · Annual
              total: {formatCurrency(selectedPlanDetails.annualPrice)} · Savings:{" "}
              {formatCurrency(annualSavings)} (
              {annualSavingsPercent.toFixed(1)}%)
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              onClick={requestSubscriptionInvoice}
              loading={busy}
              disabled={
                loading ||
                data.plans.length === 0 ||
                !selectedPlanDetails ||
                openSubscriptionInvoice
              }
              icon={<FileText size={16} />}
            >
              Create {billingCycle} invoice
            </Button>
            {currentSubscription && !currentSubscription.cancelAtPeriodEnd && (
              <Button
                variant="ghost"
                onClick={cancelPlan}
                loading={busy}
                disabled={loading}
              >
                Cancel at period end
              </Button>
            )}
          </div>
          {openSubscriptionInvoice && (
            <p className="mt-3 text-xs text-amber-300">
              Resolve your existing subscription invoice before requesting
              another plan invoice.
            </p>
          )}
          {selectedPlanDetails && (
            <p className="mt-3 text-xs text-pos-muted">
              New subscription amount:{" "}
              {formatCurrency(
                billingCycle === "yearly"
                  ? selectedPlanDetails.annualPrice
                  : selectedPlanDetails.monthlyPrice,
              )}
              {currentSubscription
                ? `, effective after ${formatDateShort(currentSubscription.expiresAt)}.`
                : ", effective after payment verification."}
            </p>
          )}
        </Card>

        {currentPlan?.planCode === "enterprise" && (
          <Card>
            <h2 className="text-lg font-semibold text-pos-text">
              Enterprise outlet overage
            </h2>
            <p className="mt-1 text-sm text-pos-muted">
              Add prepaid outlet capacity for Rp199,000 per active outlet-month.
              Overage invoices are monthly even when your base plan is annual.
              New outlets above the included 50 are enabled only after manual
              payment verification.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Input
                label="Additional outlet-months"
                type="number"
                min={1}
                max={50}
                value={overageQuantity}
                onChange={(event) =>
                  setOverageQuantity(
                    Math.min(50, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
              />
              <Button
                onClick={requestOverageInvoice}
                loading={busy}
                disabled={busy || loading || openOverageInvoice}
                icon={<FileText size={16} />}
              >
                Invoice {formatCurrency(199_000 * overageQuantity)}
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <div className="mb-4 flex items-center gap-2">
            <FileText size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-pos-text">Invoices</h2>
          </div>
          {data.invoices.length === 0 ? (
            <p className="text-sm text-pos-muted">No invoices yet.</p>
          ) : (
            <div className="space-y-4">
              {data.invoices.map((invoice) => {
                const rejectedSubmission = data.submissions.find(
                  (item) =>
                    item.invoiceId === invoice.id && item.status === "rejected",
                );
                const isPaying = submittingInvoiceId === invoice.id;
                return (
                  <div
                    key={invoice.id}
                    className="rounded-lg border border-pos-border p-4"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div>
                        <p className="font-semibold text-pos-text">
                          {invoice.invoiceNumber}
                        </p>
                        <p className="mt-1 text-xs text-pos-muted">
                          {invoice.invoiceType === "subscription"
                            ? `${invoice.planCode} · ${invoice.billingCycle}`
                            : `${invoice.outletQuantity} overage outlet-month(s)`}
                          {" · due "}
                          {formatDateShort(invoice.dueDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <strong className="text-pos-text">
                          {formatCurrency(invoice.amount)}
                        </strong>
                        <Badge
                          variant={
                            invoice.status === "awaiting_payment" &&
                            new Date(invoice.dueDate).getTime() <= Date.now()
                              ? "danger"
                              : invoice.status === "paid"
                              ? "success"
                              : invoice.status === "under_review"
                                ? "info"
                                : invoice.status === "void"
                                  ? "muted"
                                  : "warning"
                          }
                        >
                          {invoice.status === "awaiting_payment" &&
                          new Date(invoice.dueDate).getTime() <= Date.now()
                            ? "expired"
                            : invoice.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                    {invoice.status === "awaiting_payment" &&
                      new Date(invoice.dueDate).getTime() > Date.now() && (
                      <div className="mt-4">
                        {isPaying ? (
                          <form
                            onSubmit={submitPayment}
                            className="grid gap-3 md:grid-cols-2"
                          >
                            <label className="text-sm text-pos-muted">
                              Payment method
                              <select
                                value={paymentMethod}
                                onChange={(event) =>
                                  setPaymentMethod(
                                    event.target.value as PaymentMethodManual,
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-pos-border bg-pos-card px-3 py-2 text-pos-text"
                              >
                                <option value="bank_transfer">
                                  Bank transfer
                                </option>
                                <option value="qris">QRIS</option>
                              </select>
                            </label>
                            {paymentMethod === "bank_transfer" && paymentInstructions && (
                              <div className="rounded-lg border border-pos-border bg-pos-card p-3 text-sm text-pos-text md:col-span-2">
                                <p className="font-semibold">Bank transfer instructions</p>
                                <p className="mt-1">{paymentInstructions.bankName} · {paymentInstructions.accountHolder}</p>
                                <p className="font-mono">{paymentInstructions.accountNumber || "Bank details not configured yet"}</p>
                                {paymentInstructions.paymentNotes && <p className="mt-1 text-pos-muted">{paymentInstructions.paymentNotes}</p>}
                              </div>
                            )}
                            {paymentMethod === "qris" && paymentInstructions?.qrisImageUrl && (
                              <div className="rounded-lg border border-pos-border p-3 md:col-span-2">
                                <p className="mb-2 text-sm font-semibold text-pos-text">Scan to pay via QRIS</p>
                                <img src={paymentInstructions.qrisImageUrl} alt="Merchant billing QRIS payment code" className="max-h-72 rounded-lg object-contain" />
                                {paymentInstructions.paymentNotes && <p className="mt-2 text-sm text-pos-muted">{paymentInstructions.paymentNotes}</p>}
                              </div>
                            )}
                            <Input
                              label="Transfer reference"
                              value={paymentReference}
                              onChange={(event) =>
                                setPaymentReference(event.target.value)
                              }
                              maxLength={160}
                              required
                            />
                            <Input
                              label="Note (optional)"
                              value={paymentNote}
                              onChange={(event) =>
                                setPaymentNote(event.target.value)
                              }
                              maxLength={1000}
                            />
                            <div className="flex items-end gap-2">
                              <Button type="submit" loading={busy}>
                                Submit payment for review
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setSubmittingInvoiceId(null)}
                              >
                                Close
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <Button
                            variant="outline"
                            onClick={() => setSubmittingInvoiceId(invoice.id)}
                            icon={<CreditCard size={15} />}
                          >
                            Submit manual payment
                          </Button>
                        )}
                      </div>
                    )}
                    {invoice.status === "awaiting_payment" &&
                      new Date(invoice.dueDate).getTime() <= Date.now() && (
                        <p className="mt-3 text-sm text-amber-300">
                          This invoice expired. Request a new invoice to
                          continue.
                        </p>
                      )}
                    {invoice.status === "awaiting_payment" &&
                      rejectedSubmission?.rejectionReason && (
                        <p className="mt-3 text-sm text-rose-300">
                          Previous payment rejected:{" "}
                          {rejectedSubmission.rejectionReason}
                        </p>
                      )}
                    {invoice.status === "under_review" && (
                      <p className="mt-3 text-sm text-blue-300">
                        Payment submitted. Subscription access changes only
                        after an administrator verifies the payment.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-2">
            <CreditCard size={18} className="text-emerald-400" />
            <h2 className="text-lg font-semibold text-pos-text">
              Verified payment history
            </h2>
          </div>
          {data.payments.length === 0 ? (
            <p className="text-sm text-pos-muted">
              Payments appear here after they have been verified.
            </p>
          ) : (
            <div className="divide-y divide-pos-border">
              {data.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-pos-text">
                      {formatCurrency(payment.amount)}
                    </p>
                    <p className="text-xs text-pos-muted">
                      {payment.paymentMethod.replace(/_/g, " ")} ·{" "}
                      {payment.reference} · {formatDateShort(payment.paidAt)}
                    </p>
                  </div>
                  <CheckCircle size={16} className="text-emerald-400" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function isCurrentSubscription(subscription: Subscription) {
  const now = new Date().toISOString();
  return (
    subscription.status !== "canceled" &&
    subscription.startsAt <= now &&
    subscription.expiresAt > now
  );
}
