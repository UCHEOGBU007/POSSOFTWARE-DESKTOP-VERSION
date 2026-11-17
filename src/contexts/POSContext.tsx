import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  CartItem,
  Product,
  PaymentMethod,
  Sale,
  Customer,
  StockMovement,
} from "../types";
import { db } from "../db/database";
import { getSupabaseConfigStatus, supabase } from "../lib/supabase";
import { generateId, generateReceiptNumber } from "../utils/helpers";

interface POSContextType {
  cart: CartItem[];
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  updateItemDiscount: (productId: string, discount: number) => void;
  clearCart: () => void;
  cartSubtotal: number;
  cartTax: number;
  cartTotal: number;
  cartDiscount: number;
  globalDiscount: number;
  setGlobalDiscount: (d: number) => void;
  taxRate: number;
  setTaxRate: (r: number) => void;
  selectedCustomer: Customer | null;
  setSelectedCustomer: (c: Customer | null) => void;
  completeSale: (
    outletId: string,
    paymentMethod: PaymentMethod,
    amountPaid: number,
    staffId?: string,
    staffName?: string,
    note?: string,
  ) => Promise<Sale>;
  lastSale: Sale | null;
  clearLastSale: () => void;
}

const POSContext = createContext<POSContextType | null>(null);

function isNetworkFailure(error: unknown) {
  const value = error as { message?: string; name?: string; status?: number };
  return (
    value?.status === 0 ||
    value?.name === "FunctionsFetchError" ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(
      value?.message ?? "",
    )
  );
}

function applyCloudSale(sale: Sale, row: Record<string, any>) {
  sale.id = row.id;
  sale.receiptNumber = row.receipt_number;
  sale.items = (row.items ?? []).map((item: Record<string, any>) => ({
    productId: item.productId ?? item.product_id,
    productName: item.productName ?? item.product_name,
    sku: item.sku ?? "",
    qty: Number(item.qty ?? item.quantity),
    unitPrice: Number(item.unitPrice ?? item.unit_price),
    discount: Number(item.discount ?? item.discount_percent ?? 0),
    total: Number(item.total),
  }));
  sale.subtotal = Number(row.subtotal);
  sale.taxAmount = Number(row.tax_amount);
  sale.discountAmount = Number(row.discount_amount);
  sale.total = Number(row.total);
  sale.amountPaid = Number(row.amount_paid);
  sale.change = Number(row.change);
  sale.paymentMethod = row.payment_method;
  sale.createdAt = row.created_at;
  sale.wasOffline = Boolean(row.was_offline);
  sale.syncStatus = "synced";
  delete sale.syncError;
}

async function refreshOutletAfterSale(
  outletId: string,
  saleId: string,
  customerId?: string,
) {
  try {
    const [products, movements, customer] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("outlet_id", outletId),
      supabase
        .from("stock_movements")
        .select("*")
        .eq("sale_id", saleId),
      customerId
        ? supabase.from("customers").select("*").eq("id", customerId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (products.error) return;
    await db.products.bulkPut(
      (products.data ?? []).map((row: Record<string, any>) => ({
        id: row.id,
        outletId: row.outlet_id,
        categoryId: row.category_id ?? undefined,
        name: row.name,
        sku: row.sku,
        barcode: row.barcode ?? undefined,
        description: row.description ?? undefined,
        price: Number(row.price),
        costPrice: Number(row.cost_price),
        stock: Number(row.stock),
        lowStockAlert: Number(row.low_stock_alert),
        unit: row.unit,
        image: row.image ?? undefined,
        isActive: row.is_active,
        trackStock: row.track_stock,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        syncStatus: "synced" as const,
      })),
    );
    if (!movements.error) {
      await db.stockMovements.bulkPut(
        (movements.data ?? []).map((row: Record<string, any>) => ({
          id: row.id,
          outletId: row.outlet_id,
          productId: row.product_id,
          productName: row.product_name,
          type: row.type,
          qty: Number(row.qty),
          prevStock: Number(row.prev_stock),
          newStock: Number(row.new_stock),
          note: row.note ?? undefined,
          saleId: row.sale_id ?? undefined,
          createdAt: row.created_at,
          syncStatus: "synced" as const,
        })),
      );
    }
    if (customerId && customer.data && !customer.error) {
      const row = customer.data as Record<string, any>;
      await db.customers.put({
        id: row.id,
        outletId: row.outlet_id,
        name: row.name,
        phone: row.phone,
        email: row.email ?? undefined,
        address: row.address ?? undefined,
        loyaltyPoints: Number(row.loyalty_points),
        totalSpent: Number(row.total_spent),
        visitCount: Number(row.visit_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        syncStatus: "synced",
      });
    }
  } catch (error) {
    console.warn("Sale committed, but the local cache refresh failed:", error);
  }
}

export function POSProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(7.5);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  const addToCart = useCallback((product: Product) => {
    if (!product.isActive || (product.trackStock && product.stock <= 0)) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id
            ? {
                ...i,
                qty: i.qty + 1,
                total: (i.qty + 1) * i.unitPrice * (1 - i.discount / 100),
              }
            : i,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          qty: 1,
          unitPrice: product.price,
          discount: 0,
          total: product.price,
        },
      ];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const updateQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setCart((prev) => {
      const item = prev.find((entry) => entry.productId === productId);
      if (!item) return prev;
      // The terminal performs the authoritative stock check at checkout; this
      // only prevents malformed or non-integer cart values in the UI.
      const safeQty = Math.max(1, Math.floor(qty));
      return prev.map((i) =>
        i.productId === productId
          ? { ...i, qty: safeQty, total: safeQty * i.unitPrice * (1 - i.discount / 100) }
          : i,
      );
    });
  }, []);

  const updateItemDiscount = useCallback(
    (productId: string, discount: number) => {
      setCart((prev) =>
        prev.map((i) =>
          i.productId === productId
            ? {
                ...i,
                discount,
                total: i.qty * i.unitPrice * (1 - discount / 100),
              }
            : i,
        ),
      );
    },
    [],
  );

  const clearCart = useCallback(() => {
    setCart([]);
    setGlobalDiscount(0);
    setSelectedCustomer(null);
  }, []);

  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const cartSubtotal = cart.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const itemDiscountTotal = cart.reduce(
    (sum, i) => sum + i.qty * i.unitPrice * (i.discount / 100),
    0,
  );
  const afterItemDiscount = cartSubtotal - itemDiscountTotal;
  const globalDiscountAmount = afterItemDiscount * (globalDiscount / 100);
  const discountTotal = roundMoney(itemDiscountTotal + globalDiscountAmount);
  const taxableAmount = cartSubtotal - discountTotal;
  const cartTax = roundMoney(taxableAmount * (taxRate / 100));
  const cartTotal = roundMoney(taxableAmount + cartTax);
  const cartDiscount = discountTotal;

  const completeSale = async (
    outletId: string,
    paymentMethod: PaymentMethod,
    amountPaid: number,
    staffId?: string,
    staffName?: string,
    note?: string,
  ): Promise<Sale> => {
    if (!cart.length) throw new Error("Your cart is empty.");
    if (!Number.isFinite(globalDiscount) || globalDiscount < 0 || globalDiscount > 100) {
      throw new Error("Global discount must be between 0 and 100 percent.");
    }
    if (!Number.isFinite(amountPaid) || amountPaid < cartTotal) {
      throw new Error("Amount paid is invalid.");
    }
    for (const item of cart) {
      if (!Number.isInteger(item.qty) || item.qty < 1) {
        throw new Error("Cart quantities must be whole numbers.");
      }
    }
    const now = new Date().toISOString();
    const { isConfigured } = getSupabaseConfigStatus();
    const saleId = generateId();
    const sale: Sale = {
      id: saleId,
      outletId,
      receiptNumber: generateReceiptNumber(outletId),
      items: [...cart],
      subtotal: cartSubtotal,
      taxAmount: cartTax,
      discountAmount: cartDiscount,
      total: cartTotal,
      amountPaid,
      change: amountPaid - cartTotal,
      paymentMethod,
      status: "completed",
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name,
      staffId,
      staffName,
      note,
      globalDiscountPercent: globalDiscount,
      taxRatePercent: taxRate,
      createdAt: now,
      syncStatus: isConfigured ? "pending" : "synced",
    };

    let cloudSale: any = null;
    let queueOffline = !isConfigured || !navigator.onLine;
    let queuedForSync = isConfigured && queueOffline;
    sale.wasOffline = queuedForSync;
    if (isConfigured && !queueOffline) {
      const { data, error } = await supabase.rpc("record_sale_v2", {
        p_sale_id: saleId,
        p_outlet_id: outletId,
        p_receipt_number: sale.receiptNumber,
        p_items: cart.map(({ productId, qty, discount }) => ({
          product_id: productId,
          quantity: qty,
          discount_percent: discount,
        })),
        p_global_discount_percent: globalDiscount,
        p_payment_method: paymentMethod,
        p_amount_paid: amountPaid,
        p_customer_id: selectedCustomer?.id ?? null,
        p_note: note?.slice(0, 500) ?? null,
        p_sold_at: now,
        p_offline: false,
        p_tax_rate_percent: null,
      });
      if (error) {
        if (isNetworkFailure(error)) {
          queueOffline = true;
          queuedForSync = true;
          sale.wasOffline = true;
        }
        else throw new Error(error.message);
      } else {
        cloudSale = Array.isArray(data) ? data[0] : data;
        if (!cloudSale?.id)
          throw new Error("Sale was not confirmed by the server.");
        applyCloudSale(sale, cloudSale);
      }
    }

    const committedSale = sale;
    await db.transaction(
      "rw",
      db.sales,
      db.products,
      db.stockMovements,
      db.customers,
      async () => {
        await db.sales.put(committedSale);

        for (const item of cart) {
          const product = await db.products.get(item.productId);
          if (product && product.trackStock) {
            if (queueOffline && item.qty > product.stock) {
              throw new Error(`${product.name} is out of stock or changed while checking out.`);
            }
            const newStock = Math.max(0, product.stock - item.qty);
            await db.products.update(item.productId, {
              stock: newStock,
              updatedAt: now,
              syncStatus: queuedForSync ? "pending" : "synced",
              ...(queuedForSync ? { pendingReason: "offline-sale" } : {}),
            });
            // The database RPC writes the authoritative movement when online.
            // Only offline sales need a local movement until they are replayed.
            if (queuedForSync) {
              const stockMovement: StockMovement = {
                id: generateId(),
                outletId,
                productId: item.productId,
                productName: item.productName,
                type: "sale",
                qty: -item.qty,
                prevStock: product.stock,
                newStock,
                saleId: committedSale.id,
                createdAt: now,
                syncStatus: queuedForSync ? "pending" : "synced",
              };
              await db.stockMovements.add(stockMovement);
            }
          }
        }

      },
    );

    if (cloudSale) {
      // Keep local stock and customer totals aligned with the server. Never
      // upload a client-side stock snapshot after the RPC has changed stock.
      await refreshOutletAfterSale(
        outletId,
        committedSale.id,
        selectedCustomer?.id,
      );
    }
    setLastSale(committedSale);
    clearCart();
    return committedSale;
  };

  const clearLastSale = () => setLastSale(null);

  return (
    <POSContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQty,
        updateItemDiscount,
        clearCart,
        cartSubtotal,
        cartTax,
        cartTotal,
        cartDiscount,
        globalDiscount,
        setGlobalDiscount,
        taxRate,
        setTaxRate,
        selectedCustomer,
        setSelectedCustomer,
        completeSale,
        lastSale,
        clearLastSale,
      }}
    >
      {children}
    </POSContext.Provider>
  );
}

export function usePOS() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOS must be used within POSProvider");
  return ctx;
}
