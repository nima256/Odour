// Small presentation helpers shared by every storefront template (exposed via app.locals).

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function faDigits(input) {
  if (input === undefined || input === null) return "";
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[d]);
}

function faPrice(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return "";
  return faDigits(Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","));
}

const escapeAttr = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// <svg> referencing the sprite in partials/icons.ejs. Output with <%- %>.
function icon(name, className = "") {
  return `<svg class="od-icon ${escapeAttr(className)}" aria-hidden="true" focusable="false"><use href="#i-${escapeAttr(name)}"></use></svg>`;
}

// Single source of truth for how a product's price is presented.
function productPricing(product) {
  const price = Number(product?.price) || 0;
  const offer = Number(product?.offerPrice) || 0;
  const hasDiscount = offer > 0 && offer < price;
  const now = hasDiscount ? offer : price;
  return {
    now,
    was: hasDiscount ? price : null,
    hasDiscount,
    percent: hasDiscount ? Math.round(((price - offer) / price) * 100) : 0,
  };
}

// countInStock is the source of truth: some stock restores use $inc without
// re-running the save hook that maintains isOutOfStock.
function isInStock(product) {
  return Boolean(product) && Number(product.countInStock || 0) > 0;
}

// The single badge a product card shows (or null). Priority: the admin's
// editorial badge, then a real discount, then the "new" flag.
const BADGE_LABELS = { new: "جدید", bestseller: "پرفروش", limited: "محدود", exclusive: "انحصاری" };
function productBadge(product) {
  if (!product) return null;
  if (product.badge && BADGE_LABELS[product.badge]) return { kind: product.badge, label: BADGE_LABELS[product.badge] };
  const pricing = productPricing(product);
  if (pricing.hasDiscount) return { kind: "sale", label: `${faDigits(pricing.percent)}٪` };
  if (product.isNewProduct) return { kind: "new", label: BADGE_LABELS.new };
  return null;
}

function isLowStock(product) {
  const count = Number(product?.countInStock || 0);
  const threshold = Number.isFinite(Number(product?.lowStockThreshold)) ? Number(product.lowStockThreshold) : 3;
  return count > 0 && count <= threshold;
}

// Maps an admin-defined category name to one of the custom category icons.
const CATEGORY_ICON_RULES = [
  [/مردانه/, "cat-perfume-men"],
  [/زنانه/, "cat-perfume-women"],
  [/ادکلن|عطر|پرفیوم/, "cat-perfume-women"],
  [/بادی|اسپری|اسپلش|دئودورانت|بدن/, "cat-body"],
  [/مو|شامپو|hair/i, "cat-hair"],
  [/پوست|سرم|کرم|ضد آفتاب|skin/i, "cat-skin"],
  [/برقی|دستگاه|سشوار|اتو|فر کننده/, "cat-device"],
  [/جانبی|براش|اسفنج|ابزار/, "cat-brush"],
  [/آرایش|لب|رژ|صورت|چشم|makeup/i, "cat-lipstick"],
];

function categoryIcon(name, explicit) {
  if (explicit && /^cat-[a-z-]+$/.test(explicit)) return explicit;
  const value = String(name || "");
  const match = CATEGORY_ICON_RULES.find(([re]) => re.test(value));
  return match ? match[1] : "cat-default";
}

// Flat list of shopping shortcuts from the admin category tree. A perfume root
// that has subcategories (e.g. men's / women's) is expanded into them.
function categoryShortcuts(tree = [], max = 8) {
  const list = [];
  for (const root of tree) {
    if (root.children && root.children.length && /ادکلن|عطر/.test(root.name)) list.push(...root.children);
    else list.push(root);
  }
  return list.slice(0, max);
}

function productUrl(product) {
  return `/productDetails/${encodeURIComponent(product?.slug || "")}`;
}

function productImage(product, index = 0) {
  return product?.images?.[index]?.url || product?.images?.[0]?.url || "/logo.webp";
}

module.exports = {
  faDigits,
  faPrice,
  icon,
  productPricing,
  isInStock,
  isLowStock,
  productBadge,
  BADGE_LABELS,
  categoryIcon,
  categoryShortcuts,
  productUrl,
  productImage,
};
