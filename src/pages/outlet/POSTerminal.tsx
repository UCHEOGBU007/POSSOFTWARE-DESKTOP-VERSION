// import { useEffect, useState } from "react";
// import {
//   Search,
//   ShoppingCart,
//   Plus,
//   Minus,
//   Trash2,
//   Tag,
//   User,
//   CreditCard,
//   Banknote,
//   Smartphone,
//   Building2,
//   X,
//   Printer,
//   RotateCcw,
//   ChevronUp,
//   Package,
// } from "lucide-react";
// import { useAuth } from "@/contexts/AuthContext";
// import { usePOS } from "@/contexts/POSContext";
// import { db } from "@/db/database";
// import Button from "@/components/ui/Button.tsx";
// import Modal from "@/components/ui/Modal.tsx";
// import Badge from "@/components/ui/Badge.tsx";
// import { useToast } from "@/components/ui/Toast.tsx";
// import { formatCurrency, clsx } from "@/utils/helpers";
// import type { Product, Category, Customer, PaymentMethod } from "@/types";

// const paymentMethods: {
//   key: PaymentMethod;
//   label: string;
//   icon: React.ReactNode;
// }[] = [
//   { key: "cash", label: "Cash", icon: <Banknote size={18} /> },
//   { key: "card", label: "Card", icon: <CreditCard size={18} /> },
//   { key: "transfer", label: "Transfer", icon: <Building2 size={18} /> },
// ];

// export default function POSTerminal() {
//   const { outletSession } = useAuth();
//   const outlet = outletSession!.outlet;
//   const staff = outletSession!.staff;
//   const { success, error: showError } = useToast();
//   const pos = usePOS();

//   const [products, setProducts] = useState<Product[]>([]);
//   const [categories, setCategories] = useState<Category[]>([]);
//   const [customers, setCustomers] = useState<Customer[]>([]);
//   const [search, setSearch] = useState("");
//   const [activeCat, setActiveCat] = useState("");
//   const [showPayModal, setShowPayModal] = useState(false);
//   const [showReceiptModal, setShowReceiptModal] = useState(false);
//   const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
//   const [amountPaid, setAmountPaid] = useState("");
//   const [showCustomerModal, setShowCustomerModal] = useState(false);
//   const [customerSearch, setCustomerSearch] = useState("");
//   const [processing, setProcessing] = useState(false);

//   // Responsive state: Controls mobile cart drawer open/close
//   const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

//   useEffect(() => {
//     const load = async () => {
//       const [prods, cats, custs] = await Promise.all([
//         db.products
//           .where("outletId")
//           .equals(outlet.id)
//           .filter((p) => p.isActive)
//           .toArray(),
//         db.categories.where("outletId").equals(outlet.id).toArray(),
//         db.customers.where("outletId").equals(outlet.id).toArray(),
//       ]);
//       setProducts(prods);
//       setCategories(cats);
//       setCustomers(custs);
//     };
//     load();
//   }, [outlet.id]);

//   useEffect(() => {
//     pos.setTaxRate(outlet.taxEnabled ? 7.5 : 0);
//   }, [outlet.taxEnabled]);

//   const filtered = products.filter((p) => {
//     const q = search.toLowerCase();
//     const matchSearch =
//       !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
//     const matchCat = !activeCat || p.categoryId === activeCat;
//     return matchSearch && matchCat;
//   });

//   const handleCheckout = async () => {
//     if (pos.cart.length === 0) return;

//     const stockErrors = pos.cart
//       .map((item) => {
//         const product = products.find((p) => p.id === item.productId);
//         if (!product) return `Product ${item.productName} is unavailable.`;
//         if (product.trackStock && item.qty > product.stock) {
//           return `${item.productName} only has ${product.stock} ${product.unit} left.`;
//         }
//         return null;
//       })
//       .filter(Boolean) as string[];

//     if (stockErrors.length > 0) {
//       showError(stockErrors[0]);
//       return;
//     }

//     const paid =
//       payMethod === "cash" ? parseFloat(amountPaid || "0") : pos.cartTotal;
//     if (payMethod === "cash" && paid < pos.cartTotal) {
//       showError("Amount paid is less than total.");
//       return;
//     }
//     setProcessing(true);
//     try {
//       await pos.completeSale(
//         outlet.id,
//         payMethod,
//         paid,
//         staff?.id,
//         staff?.name,
//       );
//       setShowPayModal(false);
//       setShowReceiptModal(true);
//       setIsMobileCartOpen(false);
//       success("Sale completed!");
//     } catch (err: any) {
//       showError(err.message);
//     } finally {
//       setProcessing(false);
//       setAmountPaid("");
//     }
//   };

//   const filteredCustomers = customers.filter((c) => {
//     const q = customerSearch.toLowerCase();
//     return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q);
//   });

//   return (
//     <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-pos-bg relative">
//       {/* Product Grid Area */}
//       <div className="flex-1 flex flex-col overflow-hidden">
//         {/* Top Header & Search Bar */}
//         <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-3 border-b border-pos-border bg-pos-bg sticky top-0 z-10">
//           <div className="flex items-center gap-2 sm:gap-3">
//             <div className="relative flex-1 max-w-sm">
//               <Search
//                 size={15}
//                 className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-muted"
//               />
//               <input
//                 placeholder="Search products..."
//                 value={search}
//                 onChange={(e) => setSearch(e.target.value)}
//                 className="w-full bg-pos-input border border-pos-border rounded-lg pl-9 pr-3 py-2 text-sm text-pos-text placeholder:text-pos-muted/50 focus:outline-none focus:border-blue-500"
//               />
//             </div>
//             {outlet.taxEnabled && (
//               <Badge variant="info">VAT {pos.taxRate}%</Badge>
//             )}
//             {staff && (
//               <div className="hidden sm:flex items-center gap-1.5 text-xs text-pos-muted bg-pos-card border border-pos-border px-2.5 py-1.5 rounded-lg">
//                 <User size={12} />
//                 {staff.name}
//               </div>
//             )}
//           </div>

//           {/* Categories Bar */}
//           <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none">
//             <button
//               onClick={() => setActiveCat("")}
//               className={clsx(
//                 "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all touch-manipulation",
//                 !activeCat
//                   ? "bg-blue-600 text-white"
//                   : "bg-pos-card text-pos-muted border border-pos-border hover:text-pos-text",
//               )}
//             >
//               All
//             </button>
//             {categories.map((c) => (
//               <button
//                 key={c.id}
//                 onClick={() => setActiveCat(activeCat === c.id ? "" : c.id)}
//                 className={clsx(
//                   "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all touch-manipulation",
//                   activeCat === c.id
//                     ? "bg-blue-600 text-white"
//                     : "bg-pos-card text-pos-muted border border-pos-border hover:text-pos-text",
//                 )}
//               >
//                 {c.name}
//               </button>
//             ))}
//           </div>
//         </div>

//         {/* Product Cards Grid */}
//         <div className="flex-1 overflow-y-auto p-3 sm:p-4 pb-24 md:pb-4">
//           {filtered.length === 0 ? (
//             <div className="flex flex-col items-center justify-center h-full text-center text-pos-muted">
//               <Search size={40} className="mb-3 opacity-30" />
//               <p className="text-sm">No products found.</p>
//             </div>
//           ) : (
//             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
//               {filtered.map((p) => {
//                 const inCart = pos.cart.find((i) => i.productId === p.id);
//                 const outOfStock = p.trackStock && p.stock === 0;
//                 const imageUrl = (p as any).image || (p as any).imageUrl;

//                 return (
//                   <button
//                     key={p.id}
//                     disabled={outOfStock}
//                     onClick={() => {
//                       if (outOfStock) return;
//                       if (p.trackStock) {
//                         const currentQty = inCart?.qty ?? 0;
//                         if (currentQty + 1 > p.stock) {
//                           showError("Cannot add more items than are in stock.");
//                           return;
//                         }
//                       }
//                       pos.addToCart(p);
//                     }}
//                     className={clsx(
//                       "text-left p-3 rounded-xl border transition-all duration-150 group active:scale-[0.98] touch-manipulation flex flex-col justify-between",
//                       outOfStock
//                         ? "border-pos-border bg-pos-card opacity-50 cursor-not-allowed"
//                         : inCart
//                           ? "border-blue-500 bg-blue-600/10 hover:bg-blue-600/15"
//                           : "border-pos-border bg-pos-card hover:border-blue-500/50 hover:bg-pos-hover",
//                     )}
//                   >
//                     <div>
//                       {/* Image & Badge Header */}
//                       <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-pos-bg mb-2.5 flex items-center justify-center border border-pos-border/50">
//                         {imageUrl ? (
//                           <img
//                             src={imageUrl}
//                             alt={p.name}
//                             className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
//                             onError={(e) => {
//                               // Hide broken images and display fallback icon
//                               (e.target as HTMLElement).style.display = "none";
//                               const parent = (e.target as HTMLElement)
//                                 .parentElement;
//                               if (parent) {
//                                 const fallback =
//                                   parent.querySelector(".img-fallback");
//                                 if (fallback)
//                                   fallback.classList.remove("hidden");
//                               }
//                             }}
//                           />
//                         ) : null}
//                         <div
//                           className={clsx(
//                             "img-fallback flex flex-col items-center justify-center text-pos-muted group-hover:text-blue-400 transition-colors",
//                             imageUrl ? "hidden" : "flex",
//                           )}
//                         >
//                           <Package size={24} className="opacity-60" />
//                         </div>

//                         {inCart && (
//                           <span className="absolute top-2 right-2 bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-md shadow-md z-10">
//                             {inCart.qty}
//                           </span>
//                         )}
//                       </div>

//                       <p className="text-sm font-medium text-pos-text leading-tight mb-1 line-clamp-2">
//                         {p.name}
//                       </p>
//                       <p className="text-xs text-pos-muted mb-2 truncate">
//                         {p.sku}
//                       </p>
//                     </div>

//                     <div>
//                       <p className="text-sm font-bold text-blue-400">
//                         {formatCurrency(p.price)}
//                       </p>
//                       {p.trackStock && (
//                         <p
//                           className={clsx(
//                             "text-xs mt-1",
//                             p.stock <= p.lowStockAlert
//                               ? "text-amber-400"
//                               : "text-pos-muted",
//                           )}
//                         >
//                           {outOfStock ? "Out of stock" : `${p.stock} ${p.unit}`}
//                         </p>
//                       )}
//                     </div>
//                   </button>
//                 );
//               })}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Mobile Cart Overlay Background */}
//       {isMobileCartOpen && (
//         <div
//           onClick={() => setIsMobileCartOpen(false)}
//           className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 md:hidden transition-opacity"
//         />
//       )}

//       {/* Cart Container (Responsive Side Drawer on Desktop/Tablet, Bottom Drawer on Mobile) */}
//       <div
//         className={clsx(
//           "bg-pos-sidebar border-t md:border-t-0 md:border-l border-pos-border flex flex-col z-40 transition-transform duration-300 ease-in-out",
//           // Mobile View Positioning (Bottom Sheet / Overlay)
//           "fixed inset-x-0 bottom-0 h-[85vh] rounded-t-2xl shadow-2xl md:shadow-none md:rounded-none md:static",
//           // Tablet, Laptop, Desktop Resizing
//           "md:w-72 lg:w-80 xl:w-96 md:h-full md:translate-y-0",
//           // Toggle slide visibility on mobile screens
//           isMobileCartOpen
//             ? "translate-y-0"
//             : "translate-y-full md:translate-y-0",
//         )}
//       >
//         {/* Cart Header */}
//         <div className="px-4 py-3.5 border-b border-pos-border flex items-center justify-between shrink-0">
//           <div className="flex items-center gap-2">
//             <ShoppingCart size={18} className="text-blue-400" />
//             <span className="font-semibold text-pos-text">Cart</span>
//             {pos.cart.length > 0 && (
//               <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
//                 {pos.cart.length}
//               </span>
//             )}
//           </div>
//           <div className="flex items-center gap-1">
//             <button
//               onClick={() => setShowCustomerModal(true)}
//               className={clsx(
//                 "p-2 rounded-lg transition-colors text-xs flex items-center gap-1 touch-manipulation",
//                 pos.selectedCustomer
//                   ? "text-blue-400 bg-blue-500/10"
//                   : "text-pos-muted hover:text-pos-text hover:bg-pos-hover",
//               )}
//               title="Select customer"
//             >
//               <User size={16} />
//             </button>
//             {pos.cart.length > 0 && (
//               <button
//                 onClick={pos.clearCart}
//                 className="p-2 rounded-lg text-pos-muted hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation"
//                 title="Clear cart"
//               >
//                 <RotateCcw size={16} />
//               </button>
//             )}
//             {/* Close button for Mobile Drawer */}
//             <button
//               onClick={() => setIsMobileCartOpen(false)}
//               className="p-2 rounded-lg text-pos-muted hover:text-pos-text md:hidden touch-manipulation"
//               title="Close cart"
//             >
//               <X size={18} />
//             </button>
//           </div>
//         </div>

//         {/* Selected Customer Banner */}
//         {pos.selectedCustomer && (
//           <div className="mx-3 mt-3 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center justify-between shrink-0">
//             <div className="flex items-center gap-2 text-blue-400 text-xs truncate mr-2">
//               <User size={12} className="shrink-0" />
//               <span className="truncate">{pos.selectedCustomer.name}</span>
//             </div>
//             <button
//               onClick={() => pos.setSelectedCustomer(null)}
//               className="text-pos-muted hover:text-red-400 transition-colors shrink-0 p-1"
//             >
//               <X size={12} />
//             </button>
//           </div>
//         )}

//         {/* Cart Items List */}
//         <div className="flex-1 overflow-y-auto py-2">
//           {pos.cart.length === 0 ? (
//             <div className="flex flex-col items-center justify-center h-full text-center p-6 text-pos-muted">
//               <ShoppingCart size={36} className="mb-3 opacity-25" />
//               <p className="text-sm">Cart is empty</p>
//               <p className="text-xs mt-1">Tap a product to add</p>
//             </div>
//           ) : (
//             pos.cart.map((item) => (
//               <div
//                 key={item.productId}
//                 className="px-3 py-2.5 flex items-center gap-2 hover:bg-pos-hover transition-colors border-b border-pos-border/40 last:border-0"
//               >
//                 <div className="flex-1 min-w-0">
//                   <p className="text-sm font-medium text-pos-text truncate">
//                     {item.productName}
//                   </p>
//                   <p className="text-xs text-pos-muted">
//                     {formatCurrency(item.unitPrice)} × {item.qty}
//                   </p>
//                 </div>
//                 <div className="flex items-center gap-1 shrink-0">
//                   <button
//                     onClick={() => pos.updateQty(item.productId, item.qty - 1)}
//                     className="w-7 h-7 rounded-md bg-pos-hover flex items-center justify-center text-pos-muted hover:text-pos-text active:bg-pos-border transition-colors touch-manipulation"
//                   >
//                     <Minus size={14} />
//                   </button>
//                   <span className="w-6 text-center text-sm font-medium text-pos-text">
//                     {item.qty}
//                   </span>
//                   <button
//                     onClick={() => pos.updateQty(item.productId, item.qty + 1)}
//                     className="w-7 h-7 rounded-md bg-pos-hover flex items-center justify-center text-pos-muted hover:text-pos-text active:bg-pos-border transition-colors touch-manipulation"
//                   >
//                     <Plus size={14} />
//                   </button>
//                   <button
//                     onClick={() => pos.removeFromCart(item.productId)}
//                     className="w-7 h-7 rounded-md flex items-center justify-center text-pos-muted hover:text-red-400 transition-colors ml-0.5 touch-manipulation"
//                   >
//                     <Trash2 size={14} />
//                   </button>
//                 </div>
//                 <p className="text-sm font-semibold text-pos-text min-w-18 text-right shrink-0">
//                   {formatCurrency(item.total)}
//                 </p>
//               </div>
//             ))
//           )}
//         </div>

//         {/* Cart Summary & Action Footer */}
//         {pos.cart.length > 0 && (
//           <div className="border-t border-pos-border p-3 space-y-2 shrink-0 bg-pos-sidebar">
//             <div className="flex items-center gap-2">
//               <Tag size={14} className="text-pos-muted shrink-0" />
//               <input
//                 type="number"
//                 min="0"
//                 max="100"
//                 placeholder="Global discount %"
//                 value={pos.globalDiscount || ""}
//                 onChange={(e) =>
//                   pos.setGlobalDiscount(parseFloat(e.target.value) || 0)
//                 }
//                 className="flex-1 bg-pos-input border border-pos-border rounded-lg px-2 py-1.5 text-xs text-pos-text focus:outline-none focus:border-blue-500"
//               />
//             </div>
//             <div className="space-y-1 text-sm">
//               <div className="flex justify-between text-pos-muted">
//                 <span>Subtotal</span>
//                 <span>{formatCurrency(pos.cartSubtotal)}</span>
//               </div>
//               {pos.cartDiscount > 0 && (
//                 <div className="flex justify-between text-red-400">
//                   <span>Discount</span>
//                   <span>-{formatCurrency(pos.cartDiscount)}</span>
//                 </div>
//               )}
//               {outlet.taxEnabled && (
//                 <div className="flex justify-between text-pos-muted">
//                   <span>VAT ({pos.taxRate}%)</span>
//                   <span>{formatCurrency(pos.cartTax)}</span>
//                 </div>
//               )}
//               <div className="flex justify-between font-bold text-base text-pos-text pt-1 border-t border-pos-border">
//                 <span>Total</span>
//                 <span className="text-blue-400">
//                   {formatCurrency(pos.cartTotal)}
//                 </span>
//               </div>
//             </div>
//             <Button
//               className="w-full py-3 text-base touch-manipulation"
//               size="lg"
//               icon={<CreditCard size={18} />}
//               onClick={() => setShowPayModal(true)}
//             >
//               Charge {formatCurrency(pos.cartTotal)}
//             </Button>
//           </div>
//         )}
//       </div>

//       {/* Floating Bottom Bar (Visible ONLY on Mobile when Cart has Items and Drawer is Closed) */}
//       {!isMobileCartOpen && pos.cart.length > 0 && (
//         <div className="fixed bottom-0 inset-x-0 bg-pos-sidebar border-t border-pos-border p-3 flex items-center justify-between z-20 md:hidden shadow-lg">
//           <button
//             onClick={() => setIsMobileCartOpen(true)}
//             className="flex items-center gap-2 text-left text-pos-text"
//           >
//             <div className="relative bg-blue-600/20 p-2 rounded-lg text-blue-400">
//               <ShoppingCart size={20} />
//               <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
//                 {pos.cart.length}
//               </span>
//             </div>
//             <div>
//               <p className="text-xs text-pos-muted flex items-center gap-0.5 font-medium">
//                 View Cart <ChevronUp size={12} />
//               </p>
//               <p className="text-sm font-bold text-blue-400">
//                 {formatCurrency(pos.cartTotal)}
//               </p>
//             </div>
//           </button>
//           <Button
//             size="md"
//             icon={<CreditCard size={16} />}
//             onClick={() => setShowPayModal(true)}
//             className="touch-manipulation"
//           >
//             Pay Now
//           </Button>
//         </div>
//       )}

//       {/* Payment Modal */}
//       <Modal
//         open={showPayModal}
//         onClose={() => setShowPayModal(false)}
//         title="Complete Payment"
//         size="sm"
//         footer={
//           <div className="flex gap-3">
//             <Button
//               variant="outline"
//               onClick={() => setShowPayModal(false)}
//               className="flex-1"
//             >
//               Cancel
//             </Button>
//             <Button
//               className="flex-1"
//               onClick={handleCheckout}
//               loading={processing}
//               icon={<CreditCard size={16} />}
//             >
//               Confirm Sale
//             </Button>
//           </div>
//         }
//       >
//         <div className="space-y-4">
//           <div className="bg-pos-bg rounded-xl p-4 text-center">
//             <p className="text-xs text-pos-muted uppercase tracking-widest mb-1">
//               Amount Due
//             </p>
//             <p className="text-3xl font-bold text-blue-400">
//               {formatCurrency(pos.cartTotal)}
//             </p>
//           </div>
//           <div>
//             <p className="text-xs font-medium text-pos-muted uppercase tracking-wide mb-2">
//               Payment Method
//             </p>
//             <div className="grid grid-cols-2 gap-2">
//               {paymentMethods.map((m) => (
//                 <button
//                   key={m.key}
//                   onClick={() => setPayMethod(m.key)}
//                   className={clsx(
//                     "flex items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150 text-sm touch-manipulation",
//                     payMethod === m.key
//                       ? "border-blue-500 bg-blue-600/10 text-blue-400"
//                       : "border-pos-border bg-pos-card text-pos-muted hover:text-pos-text",
//                   )}
//                 >
//                   {m.icon}
//                   {m.label}
//                 </button>
//               ))}
//             </div>
//           </div>
//           {payMethod === "cash" && (
//             <div className="space-y-2">
//               <p className="text-xs font-medium text-pos-muted uppercase tracking-wide">
//                 Amount Tendered
//               </p>
//               <input
//                 type="number"
//                 placeholder={pos.cartTotal.toString()}
//                 value={amountPaid}
//                 onChange={(e) => setAmountPaid(e.target.value)}
//                 className="w-full bg-pos-input border border-pos-border rounded-lg px-3 py-2.5 text-lg font-bold text-pos-text focus:outline-none focus:border-blue-500 text-center"
//               />
//               {parseFloat(amountPaid) >= pos.cartTotal && (
//                 <div className="flex items-center justify-between text-sm p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
//                   <span className="text-pos-muted">Change</span>
//                   <span className="font-bold text-emerald-400">
//                     {formatCurrency(parseFloat(amountPaid) - pos.cartTotal)}
//                   </span>
//                 </div>
//               )}
//             </div>
//           )}
//         </div>
//       </Modal>

//       {/* Receipt Modal */}
//       <Modal
//         open={showReceiptModal}
//         onClose={() => {
//           setShowReceiptModal(false);
//           pos.clearLastSale();
//         }}
//         title="Sale Complete"
//         size="sm"
//         footer={
//           <div className="flex gap-3">
//             <Button
//               variant="outline"
//               className="flex-1"
//               onClick={() => {
//                 setShowReceiptModal(false);
//                 pos.clearLastSale();
//               }}
//             >
//               New Sale
//             </Button>
//             <Button
//               variant="secondary"
//               icon={<Printer size={16} />}
//               onClick={() => window.print()}
//             >
//               Print Receipt
//             </Button>
//           </div>
//         }
//       >
//         {pos.lastSale && (
//           <div className="space-y-4" id="receipt-content">
//             <div className="text-center">
//               <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
//                 <ShoppingCart size={22} className="text-emerald-400" />
//               </div>
//               <p className="font-bold text-pos-text text-lg">{outlet.name}</p>
//               <p className="text-sm text-pos-muted">Sale Receipt</p>
//               <p className="text-xs text-pos-muted font-mono mt-1">
//                 {pos.lastSale.receiptNumber}
//               </p>
//             </div>
//             <div className="bg-pos-bg rounded-xl p-4 space-y-2 text-sm">
//               {pos.lastSale.items.map((item) => (
//                 <div key={item.productId} className="flex justify-between">
//                   <span className="text-pos-muted">
//                     {item.productName} × {item.qty}
//                   </span>
//                   <span className="text-pos-text">
//                     {formatCurrency(item.total)}
//                   </span>
//                 </div>
//               ))}
//               <div className="border-t border-pos-border pt-2 mt-2 space-y-1">
//                 {pos.lastSale.discountAmount > 0 && (
//                   <div className="flex justify-between text-red-400">
//                     <span>Discount</span>
//                     <span>-{formatCurrency(pos.lastSale.discountAmount)}</span>
//                   </div>
//                 )}
//                 <div className="flex justify-between text-pos-muted">
//                   <span>Tax</span>
//                   <span>{formatCurrency(pos.lastSale.taxAmount)}</span>
//                 </div>
//                 <div className="flex justify-between font-bold text-pos-text text-base">
//                   <span>Total</span>
//                   <span className="text-blue-400">
//                     {formatCurrency(pos.lastSale.total)}
//                   </span>
//                 </div>
//                 {pos.lastSale.paymentMethod === "cash" &&
//                   pos.lastSale.change > 0 && (
//                     <div className="flex justify-between text-emerald-400 font-medium">
//                       <span>Change</span>
//                       <span>{formatCurrency(pos.lastSale.change)}</span>
//                     </div>
//                   )}
//               </div>
//             </div>
//             <div className="text-center text-xs text-pos-muted">
//               <p>{outlet.receiptFooter || "Thank you for your patronage!"}</p>
//             </div>
//           </div>
//         )}
//       </Modal>

//       {/* Customer Selection Modal */}
//       <Modal
//         open={showCustomerModal}
//         onClose={() => setShowCustomerModal(false)}
//         title="Select Customer"
//         size="sm"
//       >
//         <div className="space-y-3">
//           <input
//             placeholder="Search by name or phone..."
//             value={customerSearch}
//             onChange={(e) => setCustomerSearch(e.target.value)}
//             className="w-full bg-pos-input border border-pos-border rounded-lg px-3 py-2 text-sm text-pos-text focus:outline-none focus:border-blue-500"
//           />
//           <div className="space-y-1.5 max-h-64 overflow-y-auto">
//             {filteredCustomers.map((c) => (
//               <button
//                 key={c.id}
//                 onClick={() => {
//                   pos.setSelectedCustomer(c);
//                   setShowCustomerModal(false);
//                 }}
//                 className={clsx(
//                   "w-full text-left px-3 py-2.5 rounded-lg border transition-all touch-manipulation",
//                   pos.selectedCustomer?.id === c.id
//                     ? "border-blue-500 bg-blue-600/10"
//                     : "border-pos-border bg-pos-card hover:bg-pos-hover",
//                 )}
//               >
//                 <p className="text-sm font-medium text-pos-text">{c.name}</p>
//                 <p className="text-xs text-pos-muted">
//                   {c.phone} · {c.loyaltyPoints} pts
//                 </p>
//               </button>
//             ))}
//             {filteredCustomers.length === 0 && (
//               <p className="text-center text-sm text-pos-muted py-4">
//                 No customers found.
//               </p>
//             )}
//           </div>
//           {pos.selectedCustomer && (
//             <Button
//               variant="outline"
//               className="w-full"
//               onClick={() => {
//                 pos.setSelectedCustomer(null);
//                 setShowCustomerModal(false);
//               }}
//             >
//               Remove Customer
//             </Button>
//           )}
//         </div>
//       </Modal>
//     </div>
//   );
// }

import { useEffect, useState } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Tag,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  X,
  Printer,
  RotateCcw,
  ChevronUp,
  Package,
  Wifi,
  Bluetooth,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePOS } from "@/contexts/POSContext";
import { db } from "@/db/database";
import { getSupabaseConfigStatus, supabase } from "@/lib/supabase";
import { syncPendingDataForOutlet } from "@/lib/sync";
import Button from "@/components/ui/Button.tsx";
import Modal from "@/components/ui/Modal.tsx";
import Badge from "@/components/ui/Badge.tsx";
import { useToast } from "@/components/ui/Toast.tsx";
import { formatCurrency, formatDate, clsx } from "@/utils/helpers";
import type { Product, Category, Customer, PaymentMethod } from "@/types";

/* ==========================================================================
   WEB BLUETOOTH TYPES & AMBIENT EXTENSIONS
   ========================================================================== */
declare global {
  interface Window {
    electron?: {
      printing: {
        getPrinters(): Promise<ReceiptPrinter[]>;
        print(printerName?: string): Promise<{ success: boolean; error?: string }>;
        sendNetworkReceipt(host: string, port: number, data: Uint8Array): Promise<{ success: boolean }>;
      };
    };
  }

  interface Navigator {
    bluetooth?: {
      requestDevice(options?: Record<string, any>): Promise<any>;
    };
  }
}

type ReceiptPrinter = {
  name: string;
  displayName: string;
  description: string;
};

type BluetoothRemoteGATTCharacteristic = any;

/* ==========================================================================
   PRINTING UTILITIES & HARDWARE ABSTRACTION LAYER (ESC/POS & THERMAL PRINTERS)
   ========================================================================== */

/**
 * Generates raw ESC/POS binary buffer for standard 58mm / 80mm thermal printers.
 *
 * SCALABILITY NOTE:
 * If you need to support custom logos, QR codes, or different character sets
 * (e.g. Chinese, Arabic, Cyrillic), extend this byte encoder function using an
 * external ESC/POS library like `esc-pos-encoder` or `@node-escpos/core`.
 */
function generateEscPosBuffer(sale: any, outlet: any, lineWidth = 42): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  const addStr = (str: string) => parts.push(encoder.encode(str));
  const addBytes = (bytes: number[]) => parts.push(new Uint8Array(bytes));
  const addWrapped = (value: string, width = lineWidth) => {
    const characters = Array.from(value);
    for (let index = 0; index < characters.length; index += width) {
      addStr(`${characters.slice(index, index + width).join("")}\n`);
    }
  };

  // ESC/POS Command Byte Constants
  const INIT = [0x1b, 0x40];
  const ALIGN_CENTER = [0x1b, 0x61, 0x01];
  const ALIGN_LEFT = [0x1b, 0x61, 0x00];
  const ALIGN_RIGHT = [0x1b, 0x61, 0x02];
  const BOLD_ON = [0x1b, 0x45, 0x01];
  const BOLD_OFF = [0x1b, 0x45, 0x00];
  const DOUBLE_SIZE = [0x1d, 0x21, 0x11];
  const NORMAL_SIZE = [0x1d, 0x21, 0x00];
  const CUT_PAPER = [0x1d, 0x56, 0x41, 0x00];

  // 1. Initialize Printer
  addBytes(INIT);

  // 2. Receipt Header
  addBytes(ALIGN_CENTER);
  addBytes(DOUBLE_SIZE);
  addBytes(BOLD_ON);
  addWrapped(outlet.name, Math.floor(lineWidth / 2));
  addBytes(NORMAL_SIZE);
  addBytes(BOLD_OFF);
  addWrapped(outlet.address);
  if (outlet.phone) addStr(`${outlet.phone}\n`);
  addStr("Sale Receipt\n");
  addStr(`${sale.receiptNumber}\n`);
  addStr(`${formatDate(sale.createdAt)}\n`);
  if (sale.staffName) addWrapped(`Cashier: ${sale.staffName}`);
  if (sale.customerName) addWrapped(`Customer: ${sale.customerName}`);
  addStr(`${"-".repeat(lineWidth)}\n`);

  // 3. Item List
  addBytes(ALIGN_LEFT);
  sale.items.forEach((item: any) => {
    addWrapped(`${item.productName} x${item.qty}`);
    addStr(`  ${formatCurrency(item.unitPrice, outlet.currency ?? "IDR")} each\n`);
    if (item.discount > 0) addStr(`  Item discount ${item.discount}%\n`);
    addBytes(ALIGN_RIGHT);
    addStr(`${formatCurrency(item.total, outlet.currency ?? "IDR")}\n`);
    addBytes(ALIGN_LEFT);
  });
  addStr(`${"-".repeat(lineWidth)}\n`);

  // 4. Financial Totals
  addStr(`Subtotal: ${formatCurrency(sale.subtotal, outlet.currency ?? "IDR")}\n`);
  if (sale.discountAmount > 0) {
    addStr(
      `Discount: -${formatCurrency(sale.discountAmount, outlet.currency ?? "IDR")}\n`,
    );
  }
  addStr(`Tax: ${formatCurrency(sale.taxAmount, outlet.currency ?? "IDR")}\n`);
  addBytes(BOLD_ON);
  addStr(`TOTAL: ${formatCurrency(sale.total, outlet.currency ?? "IDR")}\n`);
  addBytes(BOLD_OFF);
  addStr(`Payment: ${String(sale.paymentMethod).toUpperCase()}\n`);
  addStr(`Paid: ${formatCurrency(sale.amountPaid, outlet.currency ?? "IDR")}\n`);
  if (sale.change > 0) addStr(`Change: ${formatCurrency(sale.change, outlet.currency ?? "IDR")}\n`);
  if (sale.syncStatus === "pending") addStr("OFFLINE - PENDING SYNC\n");
  if (sale.syncError) addWrapped(`REVIEW: ${sale.syncError}`);

  // 5. Receipt Footer & Paper Cut Command
  addStr(`${"-".repeat(lineWidth)}\n`);
  addBytes(ALIGN_CENTER);
  addWrapped(outlet.receiptFooter || "Thank you for your patronage!");
  addStr("\n\n");
  addBytes(CUT_PAPER);

  // Merge byte arrays into a single contiguous Uint8Array
  const totalLength = parts.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const paymentMethods: {
  key: PaymentMethod;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "cash", label: "Cash", icon: <Banknote size={18} /> },
  { key: "transfer", label: "Transfer", icon: <Building2 size={18} /> },
  { key: "card", label: "Card", icon: <CreditCard size={18} /> },
  { key: "qris", label: "QRIS", icon: <Smartphone size={18} /> },
];

export default function POSTerminal() {
  const { outletSession } = useAuth();
  const outlet = outletSession!.outlet;
  const staff = outletSession!.staff;
  const outletCurrency = outlet.currency ?? "IDR";
  const { success, error: showError } = useToast();
  const pos = usePOS();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [processing, setProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSaleCount, setPendingSaleCount] = useState(0);
  const [saleReviewCount, setSaleReviewCount] = useState(0);

  // Responsive state: Controls mobile cart drawer open/close
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

  /* --------------------------------------------------------------------------
     PRINTER HARDWARE STATES (Bluetooth & Wireless/Network Printer Configurations)
     -------------------------------------------------------------------------- */
  const [printType, setPrintType] = useState<
    "system" | "bluetooth" | "network"
  >("system");
  const isElectron = Boolean(window.electron?.printing);
  const [printers, setPrinters] = useState<ReceiptPrinter[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(
    localStorage.getItem("pos_receipt_printer") || "",
  );
  const [networkPrinterIp, setNetworkPrinterIp] = useState(
    localStorage.getItem("pos_network_printer_host") || "192.168.1.100",
  );
  const [browserPrintBridge, setBrowserPrintBridge] = useState(
    localStorage.getItem("pos_network_printer_url") || "",
  );
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<"58" | "80">(
    localStorage.getItem("pos_receipt_paper_width") === "58" ? "58" : "80",
  );
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!showReceiptModal || !isElectron || !window.electron?.printing) return;
    window.electron.printing.getPrinters().then((available) => {
      setPrinters(available);
    }).catch((err: unknown) => {
      console.warn("Unable to read installed printers", err);
    });
  }, [isElectron, showReceiptModal]);

  useEffect(() => {
    const load = async () => {
      const { isConfigured } = getSupabaseConfigStatus();
      let prods: Product[];
      if (isConfigured) {
        const cachedProducts = await db.products
          .where("outletId")
          .equals(outlet.id)
          .toArray();
        try {
          if (navigator.onLine) await syncPendingDataForOutlet(outlet.id);
          const { data, error } = await supabase
            .from("products")
            .select("*")
            .eq("outlet_id", outlet.id)
            .eq("is_active", true);
          if (error) throw error;
          prods = (data ?? []).map((row: any) => ({
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
          }));
          const cloudProductIds = new Set(prods.map((product) => product.id));
          const localPending = cachedProducts.filter(
            (product) => product.syncStatus === "pending",
          );
          for (const pendingProduct of localPending) {
            const index = prods.findIndex((product) => product.id === pendingProduct.id);
            if (index >= 0) prods[index] = pendingProduct;
            else prods.push(pendingProduct);
          }
          await db.products.bulkPut(prods);
          await db.products.bulkDelete(
            cachedProducts
              .filter(
                (product) =>
                  !cloudProductIds.has(product.id) &&
                  product.syncStatus !== "pending",
              )
              .map((product) => product.id),
          );
        } catch (error) {
          console.warn("Using the cached product catalog:", error);
          prods = cachedProducts.filter((product) => product.isActive);
        }
      } else {
        prods = await db.products
          .where("outletId")
          .equals(outlet.id)
          .filter((p) => p.isActive)
          .toArray();
      }
      const [cats, custs] = await Promise.all([
        db.categories.where("outletId").equals(outlet.id).toArray(),
        db.customers.where("outletId").equals(outlet.id).toArray(),
      ]);
      setProducts(prods);
      setCategories(cats);
      setCustomers(custs);
    };
    load();
    const refreshTimer = window.setInterval(load, 30_000);
    return () => window.clearInterval(refreshTimer);
  }, [outlet.id]);

  useEffect(() => {
    pos.setTaxRate(outlet.taxEnabled ? (outlet.taxRate ?? 7.5) : 0);
  }, [outlet.taxEnabled, outlet.taxRate]);

  useEffect(() => {
    let active = true;
    const updateQueueState = async () => {
      const [pending, review] = await Promise.all([
        db.sales
          .where("[outletId+syncStatus]")
          .equals([outlet.id, "pending"])
          .count(),
        db.sales
          .where("outletId")
          .equals(outlet.id)
          .filter((sale) => Boolean(sale.syncError))
          .count(),
      ]);
      if (active) {
        setPendingSaleCount(pending);
        setSaleReviewCount(review);
      }
    };
    const refreshAndSync = async () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine && getSupabaseConfigStatus().isConfigured) {
        await syncPendingDataForOutlet(outlet.id);
        const cachedProducts = await db.products
          .where("outletId")
          .equals(outlet.id)
          .filter((product) => product.isActive)
          .toArray();
        if (active) setProducts(cachedProducts);
      }
      await updateQueueState();
    };
    const handleOnline = () => void refreshAndSync();
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const timer = window.setInterval(() => void refreshAndSync(), 15_000);
    void updateQueueState();
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(timer);
    };
  }, [outlet.id]);

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchCat = !activeCat || p.categoryId === activeCat;
    return matchSearch && matchCat;
  });

  const handleCheckout = async () => {
    if (pos.cart.length === 0) return;

    const stockErrors = pos.cart
      .map((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) return `Product ${item.productName} is unavailable.`;
        if (product.trackStock && item.qty > product.stock) {
          return `${item.productName} only has ${product.stock} ${product.unit} left.`;
        }
        return null;
      })
      .filter(Boolean) as string[];

    if (stockErrors.length > 0) {
      showError(stockErrors[0]);
      return;
    }

    const paid =
      payMethod === "cash" ? parseFloat(amountPaid || "0") : pos.cartTotal;
    if (payMethod === "cash" && paid < pos.cartTotal) {
      showError("Amount paid is less than total.");
      return;
    }
    setProcessing(true);
    try {
      const completedSale = await pos.completeSale(
        outlet.id,
        payMethod,
        paid,
        staff?.id,
        staff?.name,
      );
      setProducts(
        await db.products
          .where("outletId")
          .equals(outlet.id)
          .filter((product) => product.isActive)
          .toArray(),
      );
      const [pending, review] = await Promise.all([
        db.sales
          .where("[outletId+syncStatus]")
          .equals([outlet.id, "pending"])
          .count(),
        db.sales
          .where("outletId")
          .equals(outlet.id)
          .filter((sale) => Boolean(sale.syncError))
          .count(),
      ]);
      setPendingSaleCount(pending);
      setSaleReviewCount(review);
      setShowPayModal(false);
      setShowReceiptModal(true);
      setIsMobileCartOpen(false);
      success(
        completedSale.syncStatus === "pending"
          ? "Sale saved offline and queued to sync."
          : "Sale completed!",
      );
    } catch (err: any) {
      showError(err.message);
    } finally {
      setProcessing(false);
      setAmountPaid("");
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = customerSearch.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q);
  });

  /* ==========================================================================
     HARDWARE PRINTING DISPATCHER & CONNECTION HANDLERS
     ========================================================================== */

  /**
   * Bluetooth Print Handler using Web Bluetooth API.
   * Scans for paired Bluetooth thermal printers, establishes GATT connection,
   * and writes byte chunks to the serial characteristic.
   */
  const handleBluetoothPrint = async () => {
    // In Electron, pair Bluetooth printers with the operating system first;
    // they then appear in the installed printer list and use the native spooler.
    if (isElectron) {
      if (!selectedPrinter) {
        showError("Pair the Bluetooth printer in your operating system, then select it from Installed printer.");
        return;
      }
      await handleSystemPrint();
      return;
    }
    if (!navigator.bluetooth) {
      showError("Web Bluetooth is not supported on this browser/device.");
      return;
    }

    if (!pos.lastSale) {
      showError("No sale receipt available to print.");
      return;
    }

    setIsPrinting(true);
    try {
      // Prompt user to select a paired Bluetooth Thermal Printer
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb", // Standard ESC/POS UUID
          "00001101-0000-1000-8000-00805f9b34fb", // SPP UUID
          "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC UUID
        ],
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not connect to printer GATT server.");

      // Discover writable printer service & characteristic
      const services = await server.getPrimaryServices();
      let printCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

      for (const service of services) {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            printCharacteristic = char;
            break;
          }
        }
        if (printCharacteristic) break;
      }

      if (!printCharacteristic) {
        throw new Error("No writable printing characteristic found on device.");
      }

      // BLE characteristics commonly accept at most 20 bytes per write.
      const data = generateEscPosBuffer(
        pos.lastSale,
        outlet,
        receiptPaperWidth === "58" ? 32 : 42,
      );
      const chunkSize = 20;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        if (printCharacteristic.writeValueWithoutResponse) {
          await printCharacteristic.writeValueWithoutResponse(chunk);
        } else {
          await printCharacteristic.writeValue(chunk);
        }
      }

      success("Receipt printed successfully via Bluetooth!");
    } catch (err: any) {
      if (err.name !== "NotFoundError") {
        showError(err.message || "Failed to print via Bluetooth.");
      }
    } finally {
      setIsPrinting(false);
    }
  };

  /**
   * Wireless / Network Print Handler.
   * Sends raw binary ESC/POS buffer over HTTP to a LAN IP, Print Agent Gateway,
   * or proxy server (e.g. QZ Tray, Epson ePOS, Star WebPRNT, or local Node print bridge).
   */
  const handleNetworkPrint = async () => {
    if (!pos.lastSale) {
      showError("No sale receipt available to print.");
      return;
    }

    setIsPrinting(true);

    try {
      const data = generateEscPosBuffer(
        pos.lastSale,
        outlet,
        receiptPaperWidth === "58" ? 32 : 42,
      );
      if (isElectron && window.electron?.printing) {
        localStorage.setItem("pos_network_printer_host", networkPrinterIp.trim());
        await window.electron.printing.sendNetworkReceipt(
          networkPrinterIp.trim(),
          9100,
          data,
        );
      } else {
        const targetUrl = browserPrintBridge.trim();
        if (!/^https?:\/\//i.test(targetUrl)) {
          throw new Error("Enter the URL of a compatible local HTTP print bridge.");
        }
        localStorage.setItem("pos_network_printer_url", targetUrl);
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: data.buffer as BodyInit,
        });
        if (!response.ok) {
          throw new Error(`Print bridge returned status ${response.status}`);
        }
      }

      success("Receipt sent to Network Printer!");
    } catch (err: any) {
      showError(
        `Wireless print failed: ${err.message}. Check printer IP, port, and connection.`,
      );
    } finally {
      setIsPrinting(false);
    }
  };

  /**
   * Master Print Trigger Dispatcher.
   * Routes the print action based on the cashier's active selection.
   */
  const handleSystemPrint = async () => {
    if (!pos.lastSale) {
      showError("No sale receipt available to print.");
      return;
    }
    document.documentElement.dataset.printReceipt = "true";
    document.documentElement.dataset.receiptWidth = receiptPaperWidth;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    setIsPrinting(true);
    try {
      if (isElectron && window.electron?.printing) {
        const result = await window.electron.printing.print(selectedPrinter || undefined);
        if (!result.success) throw new Error(result.error || "The print job was not accepted.");
      } else {
        window.print();
      }
      success("Receipt sent to the printer.");
    } catch (err: any) {
      showError(`Receipt printing failed: ${err.message}`);
    } finally {
      delete document.documentElement.dataset.printReceipt;
      delete document.documentElement.dataset.receiptWidth;
      setIsPrinting(false);
    }
  };

  const handlePrint = () => {
    if (printType === "bluetooth") {
      void handleBluetoothPrint();
    } else if (printType === "network") {
      void handleNetworkPrint();
    } else {
      void handleSystemPrint();
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-pos-bg relative">
      {/* 
        PRINT STYLESHEET ISOLATION:
        Ensures window.print() only renders the receipt modal content (#receipt-content)
        and hides the rest of the POS interface when printing via OS print drivers.
      */}
      <style>{`
        @media print {
          @page { margin: 0; }
          html, body, #root {
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #fff !important;
          }
          body * {
            overflow: visible !important;
            max-height: none !important;
          }
          body * { visibility: hidden !important; }
          #receipt-content, #receipt-content * { visibility: visible !important; }
          #receipt-content {
            position: fixed !important;
            inset: 0 auto auto 0 !important;
            display: block !important;
            width: 72mm !important;
            max-width: 72mm !important;
            margin: 0 !important;
            padding: 3mm !important;
            box-sizing: border-box !important;
            overflow: visible !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font: 10pt/1.3 Arial, sans-serif !important;
            box-shadow: none !important;
          }
          html[data-receipt-width="58"] #receipt-content {
            width: 48mm !important;
            max-width: 48mm !important;
          }
          #receipt-content * {
            color: #000 !important;
            background-color: transparent !important;
            border-color: #aaa !important;
            box-shadow: none !important;
            text-shadow: none !important;
            overflow-wrap: anywhere !important;
          }
          #receipt-content img { max-width: 36mm !important; max-height: 18mm !important; }
          #receipt-content .receipt-line { break-inside: avoid; }
        }
      `}</style>

      {(!isOnline || pendingSaleCount > 0 || saleReviewCount > 0) && (
        <div className="absolute top-2 right-2 z-30 max-w-[min(94vw,32rem)] rounded-lg border border-amber-500/40 bg-amber-950/95 px-3 py-2 text-xs text-amber-100 shadow-lg">
          {!isOnline ? (
            <span>Offline. New sales are saved on this terminal and queued.</span>
          ) : pendingSaleCount > 0 ? (
            <span>{pendingSaleCount} sale(s) waiting to sync.</span>
          ) : null}
          {saleReviewCount > 0 && (
            <span className="ml-2">
              {saleReviewCount} sale(s) need total or sync review.
            </span>
          )}
          {isOnline && pendingSaleCount > 0 && (
            <button
              className="ml-2 underline"
              onClick={() => void syncPendingDataForOutlet(outlet.id)}
            >
              Retry sync
            </button>
          )}
        </div>
      )}

      {/* Product Grid Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header & Search Bar */}
        <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-3 border-b border-pos-border bg-pos-bg sticky top-0 z-10">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-muted"
              />
              <input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-pos-input border border-pos-border rounded-lg pl-9 pr-3 py-2 text-sm text-pos-text placeholder:text-pos-muted/50 focus:outline-none focus:border-blue-500"
              />
            </div>
            {outlet.taxEnabled && (
              <Badge variant="info">VAT {pos.taxRate}%</Badge>
            )}
            {staff && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-pos-muted bg-pos-card border border-pos-border px-2.5 py-1.5 rounded-lg">
                <User size={12} />
                {staff.name}
              </div>
            )}
          </div>

          {/* Categories Bar */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setActiveCat("")}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all touch-manipulation",
                !activeCat
                  ? "bg-blue-600 text-white"
                  : "bg-pos-card text-pos-muted border border-pos-border hover:text-pos-text",
              )}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(activeCat === c.id ? "" : c.id)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all touch-manipulation",
                  activeCat === c.id
                    ? "bg-blue-600 text-white"
                    : "bg-pos-card text-pos-muted border border-pos-border hover:text-pos-text",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Product Cards Grid */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 pb-24 md:pb-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-pos-muted">
              <Search size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No products found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
              {filtered.map((p) => {
                const inCart = pos.cart.find((i) => i.productId === p.id);
                const outOfStock = p.trackStock && p.stock === 0;
                const imageUrl = (p as any).image || (p as any).imageUrl;

                return (
                  <button
                    key={p.id}
                    disabled={outOfStock}
                    onClick={() => {
                      if (outOfStock) return;
                      if (p.trackStock) {
                        const currentQty = inCart?.qty ?? 0;
                        if (currentQty + 1 > p.stock) {
                          showError("Cannot add more items than are in stock.");
                          return;
                        }
                      }
                      pos.addToCart(p);
                    }}
                    className={clsx(
                      "text-left p-3 rounded-xl border transition-all duration-150 group active:scale-[0.98] touch-manipulation flex flex-col justify-between",
                      outOfStock
                        ? "border-pos-border bg-pos-card opacity-50 cursor-not-allowed"
                        : inCart
                          ? "border-blue-500 bg-blue-600/10 hover:bg-blue-600/15"
                          : "border-pos-border bg-pos-card hover:border-blue-500/50 hover:bg-pos-hover",
                    )}
                  >
                    <div>
                      {/* Image & Badge Header */}
                      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-pos-bg mb-2.5 flex items-center justify-center border border-pos-border/50">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={p.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                              const parent = (e.target as HTMLElement)
                                .parentElement;
                              if (parent) {
                                const fallback =
                                  parent.querySelector(".img-fallback");
                                if (fallback)
                                  fallback.classList.remove("hidden");
                              }
                            }}
                          />
                        ) : null}
                        <div
                          className={clsx(
                            "img-fallback flex flex-col items-center justify-center text-pos-muted group-hover:text-blue-400 transition-colors",
                            imageUrl ? "hidden" : "flex",
                          )}
                        >
                          <Package size={24} className="opacity-60" />
                        </div>

                        {inCart && (
                          <span className="absolute top-2 right-2 bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-md shadow-md z-10">
                            {inCart.qty}
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-medium text-pos-text leading-tight mb-1 line-clamp-2">
                        {p.name}
                      </p>
                      <p className="text-xs text-pos-muted mb-2 truncate">
                        {p.sku}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-bold text-blue-400">
                        {formatCurrency(p.price, outletCurrency)}
                      </p>
                      {p.trackStock && (
                        <p
                          className={clsx(
                            "text-xs mt-1",
                            p.stock <= p.lowStockAlert
                              ? "text-amber-400"
                              : "text-pos-muted",
                          )}
                        >
                          {outOfStock ? "Out of stock" : `${p.stock} ${p.unit}`}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Cart Overlay Background */}
      {isMobileCartOpen && (
        <div
          onClick={() => setIsMobileCartOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 md:hidden transition-opacity"
        />
      )}

      {/* Cart Container (Responsive Side Drawer on Desktop/Tablet, Bottom Drawer on Mobile) */}
      <div
        className={clsx(
          "bg-pos-sidebar border-t md:border-t-0 md:border-l border-pos-border flex flex-col z-40 transition-transform duration-300 ease-in-out",
          "fixed inset-x-0 bottom-0 h-[85vh] rounded-t-2xl shadow-2xl md:shadow-none md:rounded-none md:static",
          "md:w-72 lg:w-80 xl:w-96 md:h-full md:translate-y-0",
          isMobileCartOpen
            ? "translate-y-0"
            : "translate-y-full md:translate-y-0",
        )}
      >
        {/* Cart Header */}
        <div className="px-4 py-3.5 border-b border-pos-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-blue-400" />
            <span className="font-semibold text-pos-text">Cart</span>
            {pos.cart.length > 0 && (
              <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {pos.cart.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCustomerModal(true)}
              className={clsx(
                "p-2 rounded-lg transition-colors text-xs flex items-center gap-1 touch-manipulation",
                pos.selectedCustomer
                  ? "text-blue-400 bg-blue-500/10"
                  : "text-pos-muted hover:text-pos-text hover:bg-pos-hover",
              )}
              title="Select customer"
            >
              <User size={16} />
            </button>
            {pos.cart.length > 0 && (
              <button
                onClick={pos.clearCart}
                className="p-2 rounded-lg text-pos-muted hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation"
                title="Clear cart"
              >
                <RotateCcw size={16} />
              </button>
            )}
            <button
              onClick={() => setIsMobileCartOpen(false)}
              className="p-2 rounded-lg text-pos-muted hover:text-pos-text md:hidden touch-manipulation"
              title="Close cart"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Selected Customer Banner */}
        {pos.selectedCustomer && (
          <div className="mx-3 mt-3 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-blue-400 text-xs truncate mr-2">
              <User size={12} className="shrink-0" />
              <span className="truncate">{pos.selectedCustomer.name}</span>
            </div>
            <button
              onClick={() => pos.setSelectedCustomer(null)}
              className="text-pos-muted hover:text-red-400 transition-colors shrink-0 p-1"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto py-2">
          {pos.cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-pos-muted">
              <ShoppingCart size={36} className="mb-3 opacity-25" />
              <p className="text-sm">Cart is empty</p>
              <p className="text-xs mt-1">Tap a product to add</p>
            </div>
          ) : (
            pos.cart.map((item) => (
              <div
                key={item.productId}
                className="px-3 py-2.5 flex items-center gap-2 hover:bg-pos-hover transition-colors border-b border-pos-border/40 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-pos-text truncate">
                    {item.productName}
                  </p>
                  <p className="text-xs text-pos-muted">
                    {formatCurrency(item.unitPrice, outletCurrency)} ×{" "}
                    {item.qty}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => pos.updateQty(item.productId, item.qty - 1)}
                    className="w-7 h-7 rounded-md bg-pos-hover flex items-center justify-center text-pos-muted hover:text-pos-text active:bg-pos-border transition-colors touch-manipulation"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center text-sm font-medium text-pos-text">
                    {item.qty}
                  </span>
                  <button
                    onClick={() => pos.updateQty(item.productId, item.qty + 1)}
                    className="w-7 h-7 rounded-md bg-pos-hover flex items-center justify-center text-pos-muted hover:text-pos-text active:bg-pos-border transition-colors touch-manipulation"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => pos.removeFromCart(item.productId)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-pos-muted hover:text-red-400 transition-colors ml-0.5 touch-manipulation"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-sm font-semibold text-pos-text min-w-18 text-right shrink-0">
                  {formatCurrency(item.total, outletCurrency)}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Cart Summary & Action Footer */}
        {pos.cart.length > 0 && (
          <div className="border-t border-pos-border p-3 space-y-2 shrink-0 bg-pos-sidebar">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-pos-muted shrink-0" />
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Global discount %"
                value={pos.globalDiscount || ""}
                onChange={(e) =>
                  pos.setGlobalDiscount(parseFloat(e.target.value) || 0)
                }
                className="flex-1 bg-pos-input border border-pos-border rounded-lg px-2 py-1.5 text-xs text-pos-text focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-pos-muted">
                <span>Subtotal</span>
                <span>{formatCurrency(pos.cartSubtotal, outletCurrency)}</span>
              </div>
              {pos.cartDiscount > 0 && (
                <div className="flex justify-between text-red-400">
                  <span>Discount</span>
                  <span>
                    -{formatCurrency(pos.cartDiscount, outletCurrency)}
                  </span>
                </div>
              )}
              {outlet.taxEnabled && (
                <div className="flex justify-between text-pos-muted">
                  <span>VAT ({pos.taxRate}%)</span>
                  <span>{formatCurrency(pos.cartTax, outletCurrency)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base text-pos-text pt-1 border-t border-pos-border">
                <span>Total</span>
                <span className="text-blue-400">
                  {formatCurrency(pos.cartTotal, outletCurrency)}
                </span>
              </div>
            </div>
            <Button
              className="w-full py-3 text-base touch-manipulation"
              size="lg"
              icon={<CreditCard size={18} />}
              onClick={() => setShowPayModal(true)}
            >
              Charge {formatCurrency(pos.cartTotal, outletCurrency)}
            </Button>
          </div>
        )}
      </div>

      {/* Floating Bottom Bar (Visible ONLY on Mobile when Cart has Items and Drawer is Closed) */}
      {!isMobileCartOpen && pos.cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-pos-sidebar border-t border-pos-border p-3 flex items-center justify-between z-20 md:hidden shadow-lg">
          <button
            onClick={() => setIsMobileCartOpen(true)}
            className="flex items-center gap-2 text-left text-pos-text"
          >
            <div className="relative bg-blue-600/20 p-2 rounded-lg text-blue-400">
              <ShoppingCart size={20} />
              <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {pos.cart.length}
              </span>
            </div>
            <div>
              <p className="text-xs text-pos-muted flex items-center gap-0.5 font-medium">
                View Cart <ChevronUp size={12} />
              </p>
              <p className="text-sm font-bold text-blue-400">
                {formatCurrency(pos.cartTotal, outletCurrency)}
              </p>
            </div>
          </button>
          <Button
            size="md"
            icon={<CreditCard size={16} />}
            onClick={() => setShowPayModal(true)}
            className="touch-manipulation"
          >
            Pay Now
          </Button>
        </div>
      )}

      {/* Payment Modal */}
      <Modal
        open={showPayModal}
        onClose={() => setShowPayModal(false)}
        title="Complete Payment"
        size="sm"
        footer={
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowPayModal(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleCheckout}
              loading={processing}
              icon={<CreditCard size={16} />}
            >
              Confirm Sale
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-pos-bg rounded-xl p-4 text-center">
            <p className="text-xs text-pos-muted uppercase tracking-widest mb-1">
              Amount Due
            </p>
            <p className="text-3xl font-bold text-blue-400">
              {formatCurrency(pos.cartTotal, outletCurrency)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-pos-muted uppercase tracking-wide mb-2">
              Payment Method
            </p>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setPayMethod(m.key)}
                  className={clsx(
                    "flex items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150 text-sm touch-manipulation",
                    payMethod === m.key
                      ? "border-blue-500 bg-blue-600/10 text-blue-400"
                      : "border-pos-border bg-pos-card text-pos-muted hover:text-pos-text",
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {payMethod === "cash" && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-pos-muted uppercase tracking-wide">
                Amount Tendered
              </p>
              <input
                type="number"
                placeholder={pos.cartTotal.toString()}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="w-full bg-pos-input border border-pos-border rounded-lg px-3 py-2.5 text-lg font-bold text-pos-text focus:outline-none focus:border-blue-500 text-center"
              />
              {parseFloat(amountPaid) >= pos.cartTotal && (
                <div className="flex items-center justify-between text-sm p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <span className="text-pos-muted">Change</span>
                  <span className="font-bold text-emerald-400">
                    {formatCurrency(
                      parseFloat(amountPaid) - pos.cartTotal,
                      outletCurrency,
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Receipt Modal (WITH MULTI-PRINTER HARDWARE SUPPORT) */}
      <Modal
        open={showReceiptModal}
        onClose={() => {
          setShowReceiptModal(false);
          pos.clearLastSale();
        }}
        title="Sale Complete"
        size="sm"
        footer={
          <div className="flex flex-col gap-3 w-full">
            <label className="flex items-center justify-between gap-3 text-xs text-pos-muted">
              <span>Thermal paper width</span>
              <select
                value={receiptPaperWidth}
                onChange={(event) => {
                  const width = event.target.value === "58" ? "58" : "80";
                  setReceiptPaperWidth(width);
                  localStorage.setItem("pos_receipt_paper_width", width);
                }}
                className="rounded-lg border border-pos-border bg-pos-input px-3 py-2 text-sm text-pos-text"
              >
                <option value="58">58 mm</option>
                <option value="80">80 mm</option>
              </select>
            </label>
            {isElectron && (
              <label className="space-y-1 text-xs text-pos-muted">
                <span>Installed printer (USB, paired Bluetooth, or Wi-Fi)</span>
                <select
                  value={selectedPrinter}
                  onChange={(event) => {
                    setSelectedPrinter(event.target.value);
                    localStorage.setItem("pos_receipt_printer", event.target.value);
                    if (event.target.value) setPrintType("system");
                  }}
                  className="w-full rounded-lg border border-pos-border bg-pos-input px-3 py-2 text-sm text-pos-text"
                >
                  <option value="">Use operating system print dialog</option>
                  {printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName || printer.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* PRINTER HARDWARE MODE SELECTOR */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-pos-bg rounded-lg border border-pos-border">
              <button
                onClick={() => setPrintType("system")}
                className={clsx(
                  "flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-all",
                  printType === "system"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-pos-muted hover:text-pos-text",
                )}
                title="Use System Printer / Driver / AirPrint"
              >
                <Printer size={13} /> System
              </button>
              <button
                onClick={() => setPrintType("bluetooth")}
                className={clsx(
                  "flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-all",
                  printType === "bluetooth"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-pos-muted hover:text-pos-text",
                )}
                title={isElectron
                  ? "Use a Bluetooth printer paired and installed in your operating system"
                  : "Connect to a Bluetooth Low Energy printer that exposes writable GATT"}
              >
                <Bluetooth size={13} /> Bluetooth
              </button>
              <button
                onClick={() => setPrintType("network")}
                className={clsx(
                  "flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-all",
                  printType === "network"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-pos-muted hover:text-pos-text",
                )}
                title="Print via Wi-Fi / LAN / Local Print Gateway"
              >
                <Wifi size={13} /> Wireless
              </button>
            </div>

            {printType === "network" && (
              <div className="space-y-2 rounded-lg border border-pos-border bg-pos-bg p-3">
                {isElectron ? (
                  <>
                    <p className="text-xs text-pos-muted">
                      Sends raw ESC/POS to a LAN printer on standard port 9100.
                    </p>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <input
                        aria-label="Network printer IPv4 address"
                        value={networkPrinterIp}
                        onChange={(event) => setNetworkPrinterIp(event.target.value)}
                        placeholder="192.168.1.100"
                        className="min-w-0 rounded-lg border border-pos-border bg-pos-input px-3 py-2 text-sm text-pos-text"
                      />
                      <span className="text-xs text-pos-muted">:9100</span>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-pos-muted">
                      Browser printing requires a compatible local HTTP print bridge.
                    </p>
                    <input
                      aria-label="Local HTTP print bridge URL"
                      value={browserPrintBridge}
                      onChange={(event) => setBrowserPrintBridge(event.target.value)}
                      placeholder="http://localhost:8080/print"
                      className="w-full rounded-lg border border-pos-border bg-pos-input px-3 py-2 text-sm text-pos-text"
                    />
                  </>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowReceiptModal(false);
                  pos.clearLastSale();
                }}
              >
                New Sale
              </Button>
              <Button
                variant="secondary"
                icon={<Printer size={16} />}
                onClick={handlePrint}
                loading={isPrinting}
              >
                {printType === "bluetooth"
                  ? "Print via BT"
                  : printType === "network"
                    ? "Print via Wi-Fi"
                    : "Print Receipt"}
              </Button>
            </div>
          </div>
        }
      >
        {pos.lastSale && (
          <div className="space-y-4" id="receipt-content">
            <div className="text-center">
              {outlet.logo ? (
                <img
                  src={outlet.logo}
                  alt={`${outlet.name} logo`}
                  className="mx-auto mb-2 h-14 max-w-36 object-contain"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                  <ShoppingCart size={22} className="text-emerald-400" />
                </div>
              )}

              <p className="font-bold text-pos-text text-lg">{outlet.name}</p>
              <p className="text-xs text-pos-muted">{outlet.address}</p>
              {outlet.phone && <p className="text-xs text-pos-muted">{outlet.phone}</p>}
              <p className="text-sm text-pos-muted">Sale Receipt</p>
              <p className="text-xs text-pos-muted font-mono mt-1">
                {pos.lastSale.receiptNumber}
              </p>
              <p className="text-xs text-pos-muted">{formatDate(pos.lastSale.createdAt)}</p>
              {pos.lastSale.staffName && <p className="text-xs text-pos-muted">Cashier: {pos.lastSale.staffName}</p>}
              {pos.lastSale.customerName && <p className="text-xs text-pos-muted">Customer: {pos.lastSale.customerName}</p>}
              {pos.lastSale.syncStatus === "pending" && (
                <p className="mt-1 text-xs font-semibold text-amber-500">
                  Saved on this terminal · waiting to sync
                </p>
              )}
              {pos.lastSale.syncError && (
                <p className="mt-1 text-xs text-red-500">
                  {pos.lastSale.syncError}
                </p>
              )}
            </div>
            <div className="bg-pos-bg rounded-xl p-4 space-y-2 text-sm">
              {pos.lastSale.items.map((item) => (
                <div key={item.productId} className="flex justify-between">
                  <span className="text-pos-muted">
                    {item.productName} × {item.qty}
                  </span>
                  <span className="text-pos-text">
                    {formatCurrency(item.total, outletCurrency)}
                  </span>
                </div>
              ))}
              <div className="border-t border-pos-border pt-2 mt-2 space-y-1">
                <div className="flex justify-between text-pos-muted">
                  <span>Subtotal</span>
                  <span>{formatCurrency(pos.lastSale.subtotal, outletCurrency)}</span>
                </div>
                {pos.lastSale.discountAmount > 0 && (
                  <div className="flex justify-between text-red-400">
                    <span>Discount</span>
                    <span>
                      -
                      {formatCurrency(
                        pos.lastSale.discountAmount,
                        outletCurrency,
                      )}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-pos-muted">
                  <span>Tax</span>
                  <span>
                    {formatCurrency(pos.lastSale.taxAmount, outletCurrency)}
                  </span>
                </div>
                <div className="flex justify-between text-pos-muted">
                  <span>Payment</span>
                  <span className="capitalize">{pos.lastSale.paymentMethod}</span>
                </div>
                <div className="flex justify-between text-pos-muted">
                  <span>Paid</span>
                  <span>{formatCurrency(pos.lastSale.amountPaid, outletCurrency)}</span>
                </div>
                <div className="flex justify-between font-bold text-pos-text text-base">
                  <span>Total</span>
                  <span className="text-blue-400">
                    {formatCurrency(pos.lastSale.total, outletCurrency)}
                  </span>
                </div>
                {pos.lastSale.change > 0 && (
                    <div className="flex justify-between text-emerald-400 font-medium">
                      <span>Change</span>
                      <span>
                        {formatCurrency(pos.lastSale.change, outletCurrency)}
                      </span>
                    </div>
                  )}
              </div>
            </div>
            <div className="text-center text-xs text-pos-muted">
              <p>{outlet.receiptFooter || "Thank you for your patronage!"}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Customer Selection Modal */}
      <Modal
        open={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        title="Select Customer"
        size="sm"
      >
        <div className="space-y-3">
          <input
            placeholder="Search by name or phone..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full bg-pos-input border border-pos-border rounded-lg px-3 py-2 text-sm text-pos-text focus:outline-none focus:border-blue-500"
          />
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  pos.setSelectedCustomer(c);
                  setShowCustomerModal(false);
                }}
                className={clsx(
                  "w-full text-left px-3 py-2.5 rounded-lg border transition-all touch-manipulation",
                  pos.selectedCustomer?.id === c.id
                    ? "border-blue-500 bg-blue-600/10"
                    : "border-pos-border bg-pos-card hover:bg-pos-hover",
                )}
              >
                <p className="text-sm font-medium text-pos-text">{c.name}</p>
                <p className="text-xs text-pos-muted">
                  {c.phone} · {c.loyaltyPoints} pts
                </p>
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <p className="text-center text-sm text-pos-muted py-4">
                No customers found.
              </p>
            )}
          </div>
          {pos.selectedCustomer && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                pos.setSelectedCustomer(null);
                setShowCustomerModal(false);
              }}
            >
              Remove Customer
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
