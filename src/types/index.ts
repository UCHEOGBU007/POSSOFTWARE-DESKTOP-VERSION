export type PlanCode = "starter" | "business" | "growth" | "enterprise";
export type LegacyMerchantTier = "basic" | "standard" | "premium";
export type LegacySubscriptionPlanCode =
  | "legacy_basic"
  | "legacy_standard"
  | "legacy_premium";
export type SubscriptionPlanCode = PlanCode | LegacySubscriptionPlanCode;
export type MerchantTier = PlanCode | LegacyMerchantTier;
export type SubscriptionStatus = "active" | "expired" | "trial";
export type MerchantApprovalStatus = "pending" | "approved" | "rejected";
export type PaymentMethod = "cash" | "transfer" | "card" | "qris";
export type SaleStatus = "completed" | "refunded" | "void";
export type StaffRole = "manager" | "cashier";
export type StockMovementType = "in" | "out" | "adjust" | "sale" | "return";
export type AuditAction =
  | "product_added"
  | "product_edited"
  | "product_deleted"
  | "sale_refunded";
export type SyncStatus = "pending" | "synced";
export type BillingCycle = "monthly" | "yearly";
export type InvoiceStatus =
  | "awaiting_payment"
  | "under_review"
  | "paid"
  | "void";
export type InvoiceType = "subscription" | "outlet_overage";
export type PaymentMethodManual = "bank_transfer" | "qris";
export type PaymentSubmissionStatus = "pending" | "confirmed" | "rejected";

export interface BillingPlan {
  planCode: PlanCode;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  maxOutlets: number;
  overagePriceMonthly: number;
  features: string[];
}

export const BILLING_PLANS: Record<PlanCode, BillingPlan> = {
  starter: {
    planCode: "starter",
    name: "STOCKURA Starter",
    monthlyPrice: 149_000,
    annualPrice: 1_490_000,
    maxOutlets: 1,
    overagePriceMonthly: 0,
    features: ["Point of sale", "Inventory", "Sales reports"],
  },
  business: {
    planCode: "business",
    name: "STOCKURA Business",
    monthlyPrice: 699_000,
    annualPrice: 6_990_000,
    maxOutlets: 5,
    overagePriceMonthly: 0,
    features: [
      "Everything in Starter",
      "Up to 5 outlets",
      "Staff management",
    ],
  },
  growth: {
    planCode: "growth",
    name: "STOCKURA Growth",
    monthlyPrice: 2_490_000,
    annualPrice: 24_900_000,
    maxOutlets: 20,
    overagePriceMonthly: 0,
    features: [
      "Everything in Business",
      "Up to 20 outlets",
      "Multi-warehouse management",
    ],
  },
  enterprise: {
    planCode: "enterprise",
    name: "STOCKURA Enterprise 50",
    monthlyPrice: 14_900_000,
    annualPrice: 149_000_000,
    maxOutlets: 50,
    overagePriceMonthly: 199_000,
    features: [
      "50 included outlets",
      "Unlimited POS terminals",
      "Centralized inventory",
      "Multi-warehouse management",
      "Purchase orders and stock transfers",
      "Mobile dashboard and offline-first sync",
      "Role management, priority support, and audit logs",
      "Additional outlets: Rp199,000 per active outlet-month",
    ],
  },
};

export interface Subscription {
  id: string;
  tenantId: string;
  planCode: SubscriptionPlanCode;
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  startsAt: string;
  expiresAt: string;
  status: "active" | "trial" | "canceled";
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  adminOverride: boolean;
  createdAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  planCode: SubscriptionPlanCode | null;
  billingCycle: BillingCycle | null;
  outletQuantity: number;
  amount: number;
  currency: "IDR";
  dueDate: string;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  status: InvoiceStatus;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentSubmission {
  id: string;
  invoiceId: string;
  tenantId: string;
  paymentMethod: PaymentMethodManual;
  amount: number;
  reference: string;
  note: string | null;
  status: PaymentSubmissionStatus;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  tenantId: string;
  paymentMethod: PaymentMethodManual;
  amount: number;
  reference: string;
  paidAt: string;
}

export interface BillingAnalytics {
  mrr: number;
  arr: number;
  active_tenants: number;
  cancelled_tenants: number;
  trial_tenants: number;
  revenue_by_plan: Record<string, number>;
  revenue_forecast_12m: number;
  average_revenue_per_tenant: number;
  churn_rate_30d: number;
  total_outlets: number;
  monthly_revenue: { month: string; amount: number }[];
  customer_growth: { month: string; tenants: number }[];
  revenue_growth_30d: number;
  top_enterprise_customers: {
    id: string;
    business_name: string;
    active_outlets: number;
  }[];
}

export interface Merchant {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  passwordHash: string;
  tier: MerchantTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiry: string;
  approvalStatus: MerchantApprovalStatus;
  requestedTier?: MerchantTier;
  billingCycle?: BillingCycle;
  approvedAt?: string;
  deletionScheduledAt?: string;
  address?: string;
  logo?: string;
  currency: string;
  taxRate: number;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface Outlet {
  id: string;
  merchantId: string;
  outletCode?: string;
  name: string;
  address: string;
  phone?: string;
  logo?: string;
  currency?: string;
  taxRate?: number;
  pin: string;
  isActive: boolean;
  taxEnabled: boolean;
  receiptFooter?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface Category {
  id: string;
  outletId: string;
  name: string;
  color?: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface Product {
  id: string;
  outletId: string;
  categoryId?: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  price: number;
  costPrice: number;
  stock: number;
  lowStockAlert: number;
  unit: string;
  image?: string;
  isActive: boolean;
  trackStock: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  /** Marks cached stock decrements that are represented by queued sales. */
  pendingReason?: "offline-sale";
}

export interface AuditLog {
  id: string;
  outletId: string;
  action: AuditAction;
  actorId?: string;
  actorName: string;
  actorRole?: string;
  productId?: string;
  productName?: string;
  saleId?: string;
  receiptNumber?: string;
  details?: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface SaleItem {
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface Sale {
  id: string;
  outletId: string;
  receiptNumber: string;
  items: SaleItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  amountPaid: number;
  change: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  customerId?: string;
  customerName?: string;
  staffId?: string;
  staffName?: string;
  note?: string;
  /** Global cart discount captured for idempotent offline sale replay. */
  globalDiscountPercent?: number;
  taxRatePercent?: number;
  wasOffline?: boolean;
  /** Last server replay failure; the sale remains safely queued locally. */
  syncError?: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface Customer {
  id: string;
  outletId: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  loyaltyPoints: number;
  totalSpent: number;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface Staff {
  id: string;
  outletId: string;
  name: string;
  email: string;
  phone?: string;
  pin?: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface Expense {
  id: string;
  outletId: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  staffId?: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface StockMovement {
  id: string;
  outletId: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  qty: number;
  prevStock: number;
  newStock: number;
  note?: string;
  saleId?: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export const TIER_LIMITS: Record<
  MerchantTier | LegacySubscriptionPlanCode,
  { maxOutlets: number; price: number; yearlyPrice: number; name: string }
> = {
  starter: {
    maxOutlets: 1,
    price: BILLING_PLANS.starter.monthlyPrice,
    yearlyPrice: BILLING_PLANS.starter.annualPrice,
    name: "Starter",
  },
  business: {
    maxOutlets: 5,
    price: BILLING_PLANS.business.monthlyPrice,
    yearlyPrice: BILLING_PLANS.business.annualPrice,
    name: "Business",
  },
  growth: {
    maxOutlets: 20,
    price: BILLING_PLANS.growth.monthlyPrice,
    yearlyPrice: BILLING_PLANS.growth.annualPrice,
    name: "Growth",
  },
  enterprise: {
    maxOutlets: 50,
    price: BILLING_PLANS.enterprise.monthlyPrice,
    yearlyPrice: BILLING_PLANS.enterprise.annualPrice,
    name: "Enterprise 50",
  },
  basic: { maxOutlets: 1, price: 200000, yearlyPrice: 2220000, name: "Basic" },
  standard: {
    maxOutlets: 5,
    price: 230000,
    yearlyPrice: 2553000,
    name: "Standard",
  },
  premium: {
    maxOutlets: 50,
    price: 300000,
    yearlyPrice: 3330000,
    name: "Premium",
  },
  legacy_basic: {
    maxOutlets: 1,
    price: 200000,
    yearlyPrice: 2220000,
    name: "Legacy Basic",
  },
  legacy_standard: {
    maxOutlets: 5,
    price: 230000,
    yearlyPrice: 2553000,
    name: "Legacy Standard",
  },
  legacy_premium: {
    maxOutlets: 50,
    price: 300000,
    yearlyPrice: 3330000,
    name: "Legacy Premium",
  },
};

export interface CartItem extends SaleItem {}

export interface DashboardStats {
  todaySales: number;
  todayRevenue: number;
  totalProducts: number;
  lowStockCount: number;
  totalCustomers: number;
  monthlyRevenue: number;
}
