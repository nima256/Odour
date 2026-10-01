// Catalogue querying shared by the server-rendered shop/category pages and the
// JSON filter API, so the first page and every filtered page are identical.
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { CARD_FIELDS, getCategoryTreeIds } = require("./storefront");
const { FIELDS, FILTER_FACETS, splitList, fieldForKey, normalize } = require("./fragranceProfile");
const { productPricing, productUrl, productImage, isInStock } = require("./viewHelpers");

const SORTS = {
  popular: { label: "محبوب‌ترین", sort: { rating: -1, reviewsNum: -1, createdAt: -1 } },
  newest: { label: "جدیدترین", sort: { createdAt: -1 } },
  "price-low": { label: "ارزان‌ترین", sort: { finalPrice: 1, createdAt: -1 } },
  "price-high": { label: "گران‌ترین", sort: { finalPrice: -1, createdAt: -1 } },
  rating: { label: "بیشترین امتیاز", sort: { rating: -1, createdAt: -1 } },
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toArray = (value) =>
  (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 30);
const toNumber = (value) => {
  const n = Number(String(value || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Normalizes query-string input (new names + the legacy ones used before the redesign).
function parseFilters(query = {}) {
  const facets = {};
  for (const facet of FILTER_FACETS) {
    const values = toArray(query[facet.param]);
    if (values.length) facets[facet.param] = values;
  }
  const sort = SORTS[query.sort] ? query.sort : SORTS[query.sortBy] ? query.sortBy : "popular";
  return {
    search: String(query.search || query.searchQuery || query.q || "").trim().slice(0, 80),
    categories: toArray(query.category),
    categoryIds: toArray(query.categories).filter((id) => mongoose.Types.ObjectId.isValid(id)),
    brands: toArray(query.brand || query.brands),
    minPrice: toNumber(query.minPrice),
    maxPrice: toNumber(query.maxPrice),
    discount: ["1", "true"].includes(String(query.discount || query.discountOnly)),
    inStock: ["1", "true"].includes(String(query.inStock)),
    facets,
    sort,
    page: Math.max(1, parseInt(query.page, 10) || 1),
    limit: Math.min(48, Math.max(4, parseInt(query.limit, 10) || 24)),
  };
}

async function resolveCategoryIds(filters, scopeCategoryId) {
  const roots = [];
  if (scopeCategoryId) roots.push(scopeCategoryId);
  if (filters.categories.length) {
    const found = await Category.find({ slug: { $in: filters.categories }, isActive: true }).select("_id").lean();
    roots.push(...found.map((c) => c._id));
  }
  roots.push(...filters.categoryIds.map((id) => new mongoose.Types.ObjectId(id)));
  if (!roots.length) return null;

  // Category filters chosen by the shopper narrow the scope (OR between them).
  const chosen = scopeCategoryId && roots.length > 1 ? roots.slice(1) : roots;
  const ids = [];
  for (const root of chosen) ids.push(...(await getCategoryTreeIds(root)));
  return ids;
}

// Query shared by results and facet counts: everything except the shopper's
// facet/brand/price/stock refinements.
async function buildContextQuery(filters, { scopeCategoryId } = {}) {
  const query = { isPublished: true };
  const categoryIds = await resolveCategoryIds(filters, scopeCategoryId);
  if (categoryIds) query.category = { $in: categoryIds };
  if (filters.search) {
    // Persian/Arabic variants of ی and ک are both common in product names.
    const terms = filters.search
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .map((term) => escapeRegex(term).replace(/[یي]/g, "[یي]").replace(/[کك]/g, "[کك]"));
    query.$and = terms.map((term) => ({
      $or: [
        { name: { $regex: term, $options: "i" } },
        { englishName: { $regex: term, $options: "i" } },
        { brandName: { $regex: term, $options: "i" } },
        { tags: { $regex: term, $options: "i" } },
      ],
    }));
  }
  return query;
}

function applyRefinements(contextQuery, filters) {
  const query = { ...contextQuery, $and: [...(contextQuery.$and || [])] };
  if (filters.brands.length) query.brandName = { $in: filters.brands };
  if (filters.minPrice || filters.maxPrice) {
    query.finalPrice = {};
    if (filters.minPrice) query.finalPrice.$gte = filters.minPrice;
    if (filters.maxPrice) query.finalPrice.$lte = filters.maxPrice;
  }
  if (filters.discount) {
    query.offerPrice = { $gt: 0 };
    query.$and.push({ $expr: { $lt: ["$offerPrice", "$price"] } });
  }
  if (filters.inStock) query.countInStock = { $gt: 0 };

  for (const facet of FILTER_FACETS) {
    const values = filters.facets[facet.param];
    if (!values) continue;
    const keyPatterns = facet.fields.map((f) => FIELDS[f].pattern);
    query.$and.push({
      $or: values.map((value) => ({
        specifications: {
          $elemMatch: {
            key: { $in: keyPatterns },
            value: { $regex: escapeRegex(normalize(value)), $options: "i" },
          },
        },
      })),
    });
  }
  if (!query.$and.length) delete query.$and;
  return query;
}

// Shape sent to the browser for client-rendered cards (filters, search, recently viewed).
function toCard(product) {
  return {
    id: String(product._id),
    name: product.name,
    brand: product.brandName || "",
    url: productUrl(product),
    image: productImage(product, 0),
    image2: product.images && product.images[1] ? product.images[1].url : null,
    pricing: productPricing(product),
    inStock: isInStock(product),
    rating: Number(product.rating) || 0,
    isNew: Boolean(product.isNewProduct),
    needsOptions: Boolean((product.colors && product.colors.length) || (product.sizes && product.sizes.length)),
  };
}

async function listProducts(filters, options = {}) {
  const context = await buildContextQuery(filters, options);
  const query = applyRefinements(context, filters);
  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query)
      .select(CARD_FIELDS)
      .sort(SORTS[filters.sort].sort)
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .lean(),
  ]);
  return { context, total, products, page: filters.page, pages: Math.max(1, Math.ceil(total / filters.limit)) };
}

// Facet options + counts for the current context (category/search), computed
// from the matching products so only values that actually exist are offered.
async function buildFacets(contextQuery) {
  const products = await Product.find(contextQuery)
    .select("brandName specifications finalPrice price offerPrice countInStock")
    .lean();

  const brands = new Map();
  const facetValues = Object.fromEntries(FILTER_FACETS.map((f) => [f.param, new Map()]));
  let min = Infinity;
  let max = 0;
  let discounted = 0;
  let inStock = 0;

  for (const p of products) {
    if (p.brandName) brands.set(p.brandName, (brands.get(p.brandName) || 0) + 1);
    const price = Number(p.finalPrice) || Number(p.price) || 0;
    if (price) { min = Math.min(min, price); max = Math.max(max, price); }
    if (Number(p.offerPrice) > 0 && Number(p.offerPrice) < Number(p.price)) discounted++;
    if (Number(p.countInStock) > 0) inStock++;

    const seen = new Set();
    for (const spec of p.specifications || []) {
      const field = fieldForKey(spec.key);
      if (!field) continue;
      for (const facet of FILTER_FACETS) {
        if (!facet.fields.includes(field)) continue;
        let values = splitList(spec.value);
        if (field === "accords") values = values.map((v) => v.split(/[:：]/)[0]);
        for (const value of values) {
          const id = `${facet.param}:${value}`;
          if (!value || value.length > 30 || seen.has(id)) continue;
          seen.add(id);
          const map = facetValues[facet.param];
          map.set(value, (map.get(value) || 0) + 1);
        }
      }
    }
  }

  const sortEntries = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fa")).map(([value, count]) => ({ value, count }));

  return {
    total: products.length,
    brands: sortEntries(brands),
    facets: FILTER_FACETS.map((f) => ({ param: f.param, label: f.label, options: sortEntries(facetValues[f.param]).slice(0, 24) }))
      .filter((f) => f.options.length > 0),
    price: products.length ? { min: Number.isFinite(min) ? min : 0, max } : null,
    discounted,
    inStock,
  };
}

// Current filters as removable chips (used to render "active filters").
function activeFilterChips(filters, categoryNames = {}) {
  const chips = [];
  filters.categories.forEach((slug) => chips.push({ param: "category", value: slug, label: categoryNames[slug] || slug }));
  filters.brands.forEach((b) => chips.push({ param: "brand", value: b, label: b }));
  if (filters.discount) chips.push({ param: "discount", value: "1", label: "فقط تخفیف‌دار" });
  if (filters.inStock) chips.push({ param: "inStock", value: "1", label: "فقط موجود" });
  if (filters.minPrice) chips.push({ param: "minPrice", value: String(filters.minPrice), label: "از قیمت مشخص" });
  if (filters.maxPrice) chips.push({ param: "maxPrice", value: String(filters.maxPrice), label: "تا قیمت مشخص" });
  for (const facet of FILTER_FACETS) {
    (filters.facets[facet.param] || []).forEach((v) => chips.push({ param: facet.param, value: v, label: v }));
  }
  if (filters.search) chips.push({ param: "search", value: filters.search, label: `«${filters.search}»` });
  return chips;
}

module.exports = { SORTS, parseFilters, buildContextQuery, listProducts, buildFacets, toCard, activeFilterChips, escapeRegex };
