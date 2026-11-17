import { db } from "../db/database";
import { getSupabaseConfigStatus, supabase } from "./supabase";
import type {
  Merchant,
  Outlet,
  Category,
  Product,
  Sale,
  Customer,
  Staff,
  Expense,
  StockMovement,
  AuditLog,
} from "../types";

export type SyncTable =
  | "merchants"
  | "outlets"
  | "categories"
  | "products"
  | "sales"
  | "customers"
  | "staff"
  | "expenses"
  | "stockMovements"
  | "auditLogs";

export type SyncableRecord =
  | Merchant
  | Outlet
  | Category
  | Product
  | Sale
  | Customer
  | Staff
  | Expense
  | StockMovement
  | AuditLog;

const SUPABASE_TABLE_MAP: Record<SyncTable, string> = {
  merchants: "merchants",
  outlets: "outlets",
  categories: "categories",
  products: "products",
  sales: "sales",
  customers: "customers",
  staff: "staff",
  expenses: "expenses",
  stockMovements: "stock_movements",
  auditLogs: "audit_logs",
};

const FIELD_MAP: Record<SyncTable, Record<string, string>> = {
  merchants: {
    businessName: "business_name",
    ownerName: "owner_name",
    passwordHash: "password_hash",
    subscriptionStatus: "subscription_status",
    subscriptionExpiry: "subscription_expiry",
    taxRate: "tax_rate",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  outlets: {
    merchantId: "merchant_id",
    outletCode: "outlet_code",
    logo: "logo",
    currency: "currency",
    taxRate: "tax_rate",
    isActive: "is_active",
    taxEnabled: "tax_enabled",
    receiptFooter: "receipt_footer",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  categories: {
    outletId: "outlet_id",
    createdAt: "created_at",
  },
  products: {
    outletId: "outlet_id",
    categoryId: "category_id",
    costPrice: "cost_price",
    lowStockAlert: "low_stock_alert",
    trackStock: "track_stock",
    isActive: "is_active",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  sales: {
    outletId: "outlet_id",
    receiptNumber: "receipt_number",
    taxAmount: "tax_amount",
    discountAmount: "discount_amount",
    amountPaid: "amount_paid",
    paymentMethod: "payment_method",
    customerId: "customer_id",
    customerName: "customer_name",
    staffId: "staff_id",
    staffName: "staff_name",
    createdAt: "created_at",
  },
  customers: {
    outletId: "outlet_id",
    loyaltyPoints: "loyalty_points",
    totalSpent: "total_spent",
    visitCount: "visit_count",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  staff: {
    outletId: "outlet_id",
    name: "name",
    email: "email",
    phone: "phone",
    pin: "pin",
    role: "role",
    isActive: "is_active",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  expenses: {
    outletId: "outlet_id",
    date: "expense_date",
    staffId: "staff_id",
    createdAt: "created_at",
  },
  stockMovements: {
    outletId: "outlet_id",
    productId: "product_id",
    productName: "product_name",
    prevStock: "prev_stock",
    newStock: "new_stock",
    saleId: "sale_id",
    createdAt: "created_at",
  },
  auditLogs: {
    outletId: "outlet_id",
    actorId: "actor_id",
    actorName: "actor_name",
    actorRole: "actor_role",
    productId: "product_id",
    productName: "product_name",
    saleId: "sale_id",
    receiptNumber: "receipt_number",
    createdAt: "created_at",
  },
};

export async function recordAuditLog(log: AuditLog) {
  await db.auditLogs.put(log);
  return syncRecord("auditLogs", log);
}

function getSupabaseTableName(table: SyncTable) {
  return SUPABASE_TABLE_MAP[table] ?? table;
}

function toSupabasePayload(table: SyncTable, record: SyncableRecord) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    // Credentials must only ever be handled by Supabase Auth / a trusted
    // Edge Function. Dexie is an offline cache, not a credential store.
    if (
      value === undefined ||
      key === "syncStatus" ||
      key === "passwordHash" ||
      key === "pin" ||
      key === "pendingReason" ||
      key === "syncError" ||
      key === "globalDiscountPercent" ||
      key === "taxRatePercent" ||
      key === "wasOffline"
    )
      continue;
    const mappedKey = FIELD_MAP[table]?.[key] ?? key;
    payload[mappedKey] = value;
  }
  return payload;
}

export async function syncPendingDataForOutlet(outletId: string) {
  const { isConfigured } = getSupabaseConfigStatus();
  if (!isConfigured || !outletId) return;

  await syncPendingSalesForOutlet(outletId);

  // Parent records first so foreign-key references are always valid. Sale
  // rows and sale movements are committed only through record_sale_v2.
  const orderedTables: SyncTable[] = [
    "categories",
    "products",
    "customers",
    "expenses",
    "stockMovements",
    "auditLogs",
  ];
  for (const table of orderedTables) {
    const dexieTable = (db as Record<string, any>)[table];
    const records = await dexieTable
      .where("outletId")
      .equals(outletId)
      .filter(
        (record: {
          syncStatus: string;
          pendingReason?: string;
          type?: string;
        }) =>
          record.syncStatus === "pending" &&
          record.pendingReason !== "offline-sale" &&
          !(table === "stockMovements" && record.type === "sale"),
      )
      .toArray();
    for (const record of records) await syncRecord(table, record);
  }
}

/** Replay the durable local sale queue using the original sale UUID as the
 * database idempotency key. A timed-out request can safely be retried. */
export async function syncPendingSalesForOutlet(outletId: string) {
  if (!getSupabaseConfigStatus().isConfigured || !navigator.onLine || !outletId)
    return;

  const queued = await db.sales
    .where("[outletId+syncStatus]")
    .equals([outletId, "pending"])
    .sortBy("createdAt");

  for (const sale of queued) {
    try {
      const { data, error } = await supabase.rpc("record_sale_v2", {
        p_sale_id: sale.id,
        p_outlet_id: sale.outletId,
        p_receipt_number: sale.receiptNumber,
        p_items: sale.items.map((item) => ({
          product_id: item.productId,
          quantity: item.qty,
          discount_percent: item.discount,
          unit_price: item.unitPrice,
        })),
        p_global_discount_percent: sale.globalDiscountPercent ?? 0,
        p_payment_method: sale.paymentMethod,
        p_amount_paid: sale.amountPaid,
        p_customer_id: sale.customerId ?? null,
        p_note: sale.note?.slice(0, 500) ?? null,
        p_sold_at: sale.createdAt,
        p_offline: true,
        p_tax_rate_percent: sale.taxRatePercent ?? 0,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | Record<string, any>
        | null;
      if (!row?.id) throw new Error("The server did not confirm this sale.");

      const localTotal = sale.total;
      const serverTotal = Number(row.total);
      await db.sales.put({
        ...sale,
        id: row.id,
        receiptNumber: row.receipt_number,
        items: (row.items ?? []).map((item: Record<string, any>) => ({
          productId: item.productId ?? item.product_id,
          productName: item.productName ?? item.product_name,
          sku: item.sku ?? "",
          qty: Number(item.qty ?? item.quantity),
          unitPrice: Number(item.unitPrice ?? item.unit_price),
          discount: Number(item.discount ?? item.discount_percent ?? 0),
          total: Number(item.total),
        })),
        subtotal: Number(row.subtotal),
        taxAmount: Number(row.tax_amount),
        discountAmount: Number(row.discount_amount),
        total: serverTotal,
        amountPaid: Number(row.amount_paid),
        change: Number(row.change),
        paymentMethod: row.payment_method,
        createdAt: row.created_at,
        wasOffline: Boolean(row.was_offline),
        syncStatus: "synced",
        syncError:
          Math.abs(localTotal - serverTotal) > 0.01
            ? `Offline receipt total ${localTotal.toFixed(2)} was adjusted to ${serverTotal.toFixed(2)} by the server. Review this sale.`
            : undefined,
      });

      // The server RPC already wrote stock and movement rows atomically.
      await db.stockMovements
        .where("saleId")
        .equals(sale.id)
        .delete();

      if (sale.customerId) {
        const { data: cloudCustomer, error: customerError } = await supabase
          .from("customers")
          .select("loyalty_points, total_spent, visit_count, updated_at")
          .eq("id", sale.customerId)
          .maybeSingle();
        const cachedCustomer = await db.customers.get(sale.customerId);
        if (!customerError && cloudCustomer && cachedCustomer) {
          await db.customers.put({
            ...cachedCustomer,
            loyaltyPoints: Number(cloudCustomer.loyalty_points),
            totalSpent: Number(cloudCustomer.total_spent),
            visitCount: Number(cloudCustomer.visit_count),
            updatedAt: cloudCustomer.updated_at,
          });
        }
      }

      const saleProducts = new Set(sale.items.map((item) => item.productId));
      for (const productId of saleProducts) {
        const cached = await db.products.get(productId);
        if (!cached || cached.pendingReason !== "offline-sale") continue;
        const stillQueued = await db.sales
          .where("[outletId+syncStatus]")
          .equals([outletId, "pending"])
          .toArray();
        const queuedQuantity = stillQueued.reduce(
          (sum, queuedSale) =>
            sum +
            queuedSale.items
              .filter((item) => item.productId === productId)
              .reduce((itemSum, item) => itemSum + item.qty, 0),
          0,
        );
        const { data: cloudProduct, error: productError } = await supabase
          .from("products")
          .select("stock, updated_at")
          .eq("id", productId)
          .maybeSingle();
        if (productError || !cloudProduct) continue;
        await db.products.update(productId, {
          stock: Math.max(0, Number(cloudProduct.stock) - queuedQuantity),
          updatedAt: cloudProduct.updated_at,
          syncStatus: queuedQuantity > 0 ? "pending" : "synced",
          pendingReason: queuedQuantity > 0 ? "offline-sale" : undefined,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sync this sale.";
      await db.sales.update(sale.id, { syncError: message.slice(0, 500) });
      // A failure for one queued sale must not prevent later, independent
      // sales from reaching the server.
      console.warn(`Offline sale ${sale.receiptNumber} remains queued:`, error);
    }
  }
}

export async function syncRecord(
  table: SyncTable,
  recordOrId: SyncableRecord | { id: string } | string,
  operation: "upsert" | "delete" = "upsert",
) {
  const { isConfigured } = getSupabaseConfigStatus();
  if (!isConfigured) return { ok: false, skipped: true };

  const id = typeof recordOrId === "string" ? recordOrId : recordOrId.id;
  if (!id) return { ok: false, skipped: true };

  try {
    const supabaseTable = getSupabaseTableName(table);
    if (operation === "delete") {
      const { error } = await supabase
        .from(supabaseTable)
        .delete()
        .eq("id", id);
      if (error) throw error;
      return { ok: true, deleted: true };
    }

    if (typeof recordOrId === "string") {
      return { ok: false, skipped: true };
    }

    const payload = toSupabasePayload(table, recordOrId as SyncableRecord);
    const { error } = await supabase
      .from(supabaseTable)
      .upsert([payload], { onConflict: "id" });

    if (error) throw error;

    // Safely update Dexie table status if table exists on local db
    const dexieTable = (db as Record<string, any>)[table];
    if (dexieTable && typeof dexieTable.update === "function") {
      await dexieTable.update(id, { syncStatus: "synced" });
    }

    return { ok: true, synced: true };
  } catch (error) {
    console.warn(`Supabase sync failed for ${table}:`, error);
    return { ok: false, error };
  }
}

export async function syncPendingData() {
  const { isConfigured } = getSupabaseConfigStatus();
  if (!isConfigured) return;

  const tables: Array<{ table: SyncTable; field: string }> = [
    { table: "merchants", field: "syncStatus" },
    { table: "outlets", field: "syncStatus" },
    { table: "categories", field: "syncStatus" },
    { table: "products", field: "syncStatus" },
    { table: "customers", field: "syncStatus" },
    { table: "staff", field: "syncStatus" },
    { table: "expenses", field: "syncStatus" },
    { table: "stockMovements", field: "syncStatus" },
    { table: "auditLogs", field: "syncStatus" },
  ];

  for (const entry of tables) {
    const dexieTable = (db as Record<string, any>)[entry.table];
    if (!dexieTable) continue;

    try {
      const records = await dexieTable
        .where(entry.field)
        .equals("pending")
        .toArray();

      for (const record of records) {
        if (
          record.pendingReason === "offline-sale" ||
          (entry.table === "stockMovements" && record.type === "sale")
        )
          continue;
        await syncRecord(entry.table, record, "upsert");
      }
    } catch (err) {
      console.warn(`Failed to process pending sync for ${entry.table}:`, err);
    }
  }
}
