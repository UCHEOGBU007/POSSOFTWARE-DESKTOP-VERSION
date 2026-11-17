import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LogOut,
  RefreshCw,
  Users,
  Clock,
  UserX,
  Layers,
  Search,
  Calendar,
  Filter,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import Button from "@/components/ui/Button";
import type { MerchantTier } from "@/types";
import { MerchantList, type MerchantRow } from "./MerchantList";
export default function MerchantManagement() {
  const { logoutAdmin, adminSession } = useAuth();
  const { success, error: showError } = useToast();
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    try {
      const [
        { data: merchantRows, error: merchantError },
        { data: outletRows, error: outletError },
      ] = await Promise.all([
        supabase
          .from("merchants")
          .select(
            "id, business_name, owner_name, email, phone, tier, subscription_status, subscription_expiry, approval_status, requested_tier, billing_cycle, approved_at, deletion_scheduled_at, currency, tax_rate, created_at, updated_at",
          )
          .order("created_at", { ascending: false }),
        supabase.from("outlets").select("merchant_id"),
      ]);

      if (merchantError || outletError) throw merchantError || outletError;

      const counts = new Map<string, number>();
      (outletRows ?? []).forEach((outlet: { merchant_id: string }) =>
        counts.set(
          outlet.merchant_id,
          (counts.get(outlet.merchant_id) ?? 0) + 1,
        ),
      );

      setMerchants(
        (merchantRows ?? []).map((row: any) => ({
          id: row.id,
          businessName: row.business_name,
          ownerName: row.owner_name,
          email: row.email,
          phone: row.phone,
          passwordHash: "",
          tier: row.tier,
          subscriptionStatus: row.subscription_status,
          subscriptionExpiry: row.subscription_expiry,
          approvalStatus: row.approval_status,
          requestedTier: row.requested_tier ?? undefined,
          billingCycle: row.billing_cycle ?? undefined,
          approvedAt: row.approved_at ?? undefined,
          deletionScheduledAt: row.deletion_scheduled_at ?? undefined,
          currency: row.currency,
          taxRate: Number(row.tax_rate),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          syncStatus: "synced",
          outletCount: counts.get(row.id) ?? 0,
        })),
      );
    } catch (error: any) {
      showError(error.message || "Unable to load merchant accounts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const expiring = useMemo(
    () =>
      merchants.filter((m) => {
        const days =
          (new Date(m.subscriptionExpiry).getTime() - Date.now()) / 86_400_000;
        return m.approvalStatus === "approved" && days >= 0 && days <= 14;
      }),
    [merchants],
  );

  const stats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    const plans: Record<MerchantTier, number> = {
      basic: 0,
      standard: 0,
      premium: 0,
      starter: 0,
      business: 0,
      growth: 0,
      enterprise: 0,
    };

    merchants.forEach((m) => {
      if (m.approvalStatus === "approved") {
        approved++;
        if (plans[m.tier] !== undefined) plans[m.tier]++;
      } else if (m.approvalStatus === "rejected") {
        rejected++;
      } else {
        pending++;
      }
    });

    return { pending, approved, rejected, plans };
  }, [merchants]);

  const filteredMerchants = useMemo(() => {
    return merchants.filter((m) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        m.businessName.toLowerCase().includes(q) ||
        m.ownerName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q);

      const matchesStatus =
        approvalFilter === "all" || m.approvalStatus === approvalFilter;

      let matchesDate = true;
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && new Date(m.createdAt) >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && new Date(m.createdAt) <= end;
      }

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [merchants, searchQuery, startDate, endDate, approvalFilter]);

  const hasActiveFilters =
    searchQuery || startDate || endDate || approvalFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStartDate("");
    setEndDate("");
    setApprovalFilter("all");
  };

  const update = async (
    merchant: MerchantRow,
    approval?: "approved" | "rejected",
    tier?: MerchantTier,
  ) => {
    setSavingId(merchant.id);
    try {
      const { error } = await supabase.functions.invoke("admin-merchant", {
        body: {
          merchantId: merchant.id,
          approvalStatus: approval ?? null,
          tier: tier ?? null,
          expiry:
            approval === "approved"
              ? new Date(Date.now() + 30 * 86_400_000).toISOString()
              : null,
        },
      });
      if (error) throw error;
      success("Merchant account updated.");
      await load();
    } catch (error: any) {
      showError(error.message || "Merchant update failed or not found.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-pos-bg p-3 sm:p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-pos-text">
            Merchant Management
          </h1>
          <p className="text-xs sm:text-sm text-pos-muted">
            Signed in as {adminSession?.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/dashboard"
            className="rounded-lg border border-pos-border px-4 py-2 text-sm text-pos-text hover:bg-pos-hover"
          >
            Billing dashboard
          </Link>
          <Button
            variant="outline"
            icon={<RefreshCw size={15} />}
            onClick={load}
            className="w-full sm:w-auto"
          >
            Refresh
          </Button>
          <Button
            variant="danger"
            icon={<LogOut size={15} />}
            onClick={logoutAdmin}
            className="w-full sm:w-auto"
          >
            Sign out
          </Button>
        </div>
      </header>

      {/* Above the fold metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-pos-border bg-pos-card p-4 space-y-2">
          <div className="flex items-center justify-between text-pos-muted">
            <span className="text-xs font-medium uppercase tracking-wider">
              Active Accounts
            </span>
            <Users size={18} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-pos-text">
            {stats.approved}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-pos-border/40 text-xs text-pos-muted">
            <span>
              Starter: <strong>{stats.plans.starter}</strong>
            </span>
            <span>·</span>
            <span>
              Business: <strong>{stats.plans.business}</strong>
            </span>
            <span>·</span>
            <span>
              Growth: <strong>{stats.plans.growth}</strong>
            </span>
            <span>·</span>
            <span>
              Enterprise: <strong>{stats.plans.enterprise}</strong>
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-pos-border bg-pos-card p-4 space-y-2">
          <div className="flex items-center justify-between text-pos-muted">
            <span className="text-xs font-medium uppercase tracking-wider">
              Pending Approvals
            </span>
            <Clock size={18} className="text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-pos-text">
            {stats.pending}
          </div>
          <p className="text-xs text-pos-muted pt-1 border-t border-pos-border/40">
            Requires admin action
          </p>
        </div>

        <div className="rounded-xl border border-pos-border bg-pos-card p-4 space-y-2">
          <div className="flex items-center justify-between text-pos-muted">
            <span className="text-xs font-medium uppercase tracking-wider">
              Rejected Users
            </span>
            <UserX size={18} className="text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-pos-text">
            {stats.rejected}
          </div>
          <p className="text-xs text-pos-muted pt-1 border-t border-pos-border/40">
            Access denied accounts
          </p>
        </div>

        <div className="rounded-xl border border-pos-border bg-pos-card p-4 space-y-2">
          <div className="flex items-center justify-between text-pos-muted">
            <span className="text-xs font-medium uppercase tracking-wider">
              Total Merchants
            </span>
            <Layers size={18} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-pos-text">
            {merchants.length}
          </div>
          <p className="text-xs text-pos-muted pt-1 border-t border-pos-border/40">
            All registered records
          </p>
        </div>
      </section>

      {expiring.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs sm:text-sm text-amber-200">
          {expiring.length} approved merchant account(s) expire within 14 days.
        </section>
      )}

      {/* Filter bar */}
      <section className="rounded-xl border border-pos-border bg-pos-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-muted h-4 w-4" />
            <input
              type="text"
              placeholder="Search name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-pos-input border border-pos-border rounded-lg text-pos-text focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-muted h-4 w-4" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-pos-input border border-pos-border rounded-lg text-pos-text focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-muted h-4 w-4" />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-pos-input border border-pos-border rounded-lg text-pos-text focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-muted h-4 w-4" />
            <select
              value={approvalFilter}
              onChange={(e) => setApprovalFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-pos-input border border-pos-border rounded-lg text-pos-text focus:outline-none focus:ring-1 focus:ring-amber-500 capitalize"
            >
              <option value="all">All Approvals</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 border-t border-pos-border/40 text-xs">
            <span className="text-pos-muted">
              Showing {filteredMerchants.length} of {merchants.length} merchants
            </span>
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium"
            >
              <X size={14} /> Clear filters
            </button>
          </div>
        )}
      </section>

      {/* List Component */}
      <MerchantList
        merchants={filteredMerchants}
        loading={loading}
        savingId={savingId}
        onUpdate={update}
      />
    </main>
  );
}
