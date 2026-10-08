const mongoose = require("mongoose");
const Product = require("../models/Product");
const {
  BASE_VARIANT_ID,
  getVariantKey,
  parseVariantKey,
  getProductGender,
  buildVariantTitle,
} = require("../helper/torobProductMeta");
const variantMatrix = require("../services/variantMatrix");

const BASE_URL = (process.env.SITE_BASE_URL || process.env.SITE_URL || "https://odour.ir")
  .replace(/\/+$/, "");
const PAGE_SIZE = 100;
const MAX_PAGE_UNIQUE_LENGTH = 200;
const EXACT_VARIANTS_ENABLED = ["1", "true", "yes"].includes(
  String(process.env.ODOUR_TOROB_EXACT_VARIANTS_ENABLED || "").trim().toLowerCase()
);

const clean = (value) => String(value ?? "").trim();
const normalizeHost = (value) => clean(value).replace(/^www\./i, "").toLowerCase();

const safeIsoDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
};

const getDateAdded = (product) =>
  safeIsoDate(product.publishedAt || product.createdAt || new Date());

const getDateUpdated = (product) =>
  safeIsoDate(product.updatedAt || product.publishedAt || product.createdAt || new Date());

const getImageUrl = (image) => {
  const rawUrl = typeof image === "string" ? image : image?.url;
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) return `${BASE_URL}${rawUrl}`;
  return `${BASE_URL}/${rawUrl.replace(/^\/+/, "")}`;
};

const getCategoryName = (product) => {
  if (product.catName) return product.catName;
  if (product.subCat) return product.subCat;
  const categoryDetails = product.categoryDetails;
  if (Array.isArray(categoryDetails)) return categoryDetails[0]?.name || "";
  return categoryDetails?.name || "";
};

const withVariantKeys = (descriptors) => descriptors
  .map((descriptor) => ({
    ...descriptor,
    variantKey: getVariantKey({ colorId: descriptor.colorId, sizeId: descriptor.sizeId }),
  }))
  .sort((a, b) => String(a.variantKey).localeCompare(String(b.variantKey), "en"))
  .map((descriptor, index) => ({ ...descriptor, index }));

const getLegacyProductVariants = (product) => withVariantKeys(variantMatrix.allDescriptors(product));
const getExactProductVariants = (product) => withVariantKeys(variantMatrix.descriptorsForFeed(product));
const getProductVariants = (product) => EXACT_VARIANTS_ENABLED
  ? getExactProductVariants(product)
  : getLegacyProductVariants(product);

const getVariantAvailability = (product, descriptor = {}) => (
  EXACT_VARIANTS_ENABLED
    ? variantMatrix.availableQuantity(product, descriptor.color || null, descriptor.size || null)
    : variantMatrix.legacyAvailableQuantity(product, descriptor.color || null, descriptor.size || null)
) > 0;

const buildSpec = (product, color = null, size = null) => {
  const spec = {};
  if (Array.isArray(product.specifications)) {
    for (const item of product.specifications) {
      const key = clean(item?.key);
      const value = clean(item?.value);
      if (key && value) spec[key] = value;
    }
  }
  if (color?.name) spec["رنگ"] = clean(color.name);
  if (size?.size) spec["سایز"] = clean(size.size);
  const gender = getProductGender(product);
  if (gender && !spec["جنسیت"]) spec["جنسیت"] = gender;
  if (product.weight !== undefined && product.weight !== null && product.weight !== "") {
    const weight = String(product.weight);
    spec["وزن"] = /گرم/.test(weight) ? weight : `${weight} گرم`;
  }
  return spec;
};

const buildPageUrl = (product, descriptor = null) => {
  const slugOrId = product.slug || String(product._id);
  const url = new URL(`/productDetails/${encodeURIComponent(slugOrId)}`, BASE_URL);
  const variant = descriptor || getProductVariants(product)[0] || {};
  const colorId = clean(variant.colorId);
  const sizeId = clean(variant.sizeId);
  const variantKey = clean(variant.variantKey) || getVariantKey({ colorId, sizeId });

  // One landing URL = one exact Torob offer. `variant` contains the complete
  // color×size identity; color/size are repeated only to preselect storefront UI.
  if (variantKey && variantKey !== BASE_VARIANT_ID) url.searchParams.set("variant", variantKey);
  if (colorId) url.searchParams.set("color", colorId);
  if (sizeId) url.searchParams.set("size", sizeId);
  return url.toString();
};

const buildImageLinks = (product, color) => {
  const links = [];
  const addImage = (image) => {
    const url = getImageUrl(image);
    if (url && !links.includes(url)) links.push(url);
  };
  if (color?.image) addImage(color.image);
  if (Array.isArray(product.images)) product.images.forEach(addImage);
  return links;
};

const pageUnique = (product, descriptor = null) => {
  const variant = descriptor || getProductVariants(product)[0] || {};
  return `${String(product?._id || "")}_${clean(variant.variantKey) || BASE_VARIANT_ID}`;
};

const formatProductForTorob = (product, variantDescriptor = null) => {
  const descriptor = variantDescriptor || getProductVariants(product)[0];
  if (!descriptor) throw new Error(`No Torob variant for product ${String(product?._id || "?")}`);

  const color = descriptor.color || null;
  const size = descriptor.size || null;
  const colorName = clean(color?.name);
  const sizeName = clean(size?.size);
  const availability = getVariantAvailability(product, descriptor);
  const regularPrice = Number(product.price || 0);
  const salePrice = Number(product.offerPrice || 0);
  const effectivePrice = salePrice > 0 ? salePrice : regularPrice;
  const currentPrice = availability ? effectivePrice : 0;
  const oldPrice = availability && salePrice > 0 && regularPrice > salePrice ? regularPrice : null;

  const subtitleParts = [product.lilDescription || ""];
  if (colorName) subtitleParts.push(`رنگ ${colorName}`);
  if (sizeName) subtitleParts.push(`سایز ${sizeName}`);

  return {
    page_unique: pageUnique(product, descriptor),
    page_url: buildPageUrl(product, descriptor),
    // Every variation of one Mongo product shares exactly one group id.
    // Do not use an editable/custom value here: Torob uses this field to group variants.
    product_group_id: String(product._id),
    title: buildVariantTitle(product, color, size),
    subtitle: subtitleParts.filter(Boolean).join(" - "),
    current_price: Math.max(0, Math.trunc(currentPrice)),
    old_price: oldPrice === null ? null : Math.max(0, Math.trunc(oldPrice)),
    availability,
    category_name: getCategoryName(product),
    image_links: buildImageLinks(product, color),
    spec: buildSpec(product, color, size),
    guarantee: product.guarantee || "گارانتی اصالت و سلامت فیزیکی کالا",
    short_desc: product.lilDescription || "",
    date_added: getDateAdded(product),
    date_updated: getDateUpdated(product),
  };
};

const findVariantByKey = (product, variantKey) =>
  getProductVariants(product).find((item) => item.variantKey === clean(variantKey)) || null;

const findExactVariantByParts = (product, colorId = "", sizeId = "") => {
  const wantedColor = clean(colorId);
  const wantedSize = clean(sizeId);
  const candidates = getProductVariants(product).filter((item) =>
    (!wantedColor || item.colorId === wantedColor) &&
    (!wantedSize || item.sizeId === wantedSize)
  );
  return candidates.length === 1 ? candidates[0] : null;
};

const resolveVariantRequest = (product, request = {}) => {
  const variantKey = clean(request.variantKey);
  const colorId = clean(request.colorId);
  const sizeId = clean(request.sizeId);

  if (variantKey) {
    const keyed = findVariantByKey(product, variantKey);
    if (keyed) {
      if (colorId && keyed.colorId !== colorId) return null;
      if (sizeId && keyed.sizeId !== sizeId) return null;
      return keyed;
    }

    // Compatibility with old Odour URLs: ?variant=<colorId>&size=<sizeId>.
    if (request.legacyVariantId) {
      return findExactVariantByParts(product, request.legacyVariantId, sizeId);
    }
    return null;
  }

  if (colorId || sizeId) return findExactVariantByParts(product, colorId, sizeId);

  // A bare parent URL is only an exact product lookup when the parent has one offer.
  const variants = getProductVariants(product);
  return variants.length === 1 ? variants[0] : null;
};

const parsePageUnique = (value) => {
  const raw = clean(value);
  if (!raw || raw.length > MAX_PAGE_UNIQUE_LENGTH) return null;
  const separatorIndex = raw.indexOf("_");
  if (separatorIndex <= 0) return null;

  const productId = raw.slice(0, separatorIndex);
  const variantKey = raw.slice(separatorIndex + 1);
  if (!mongoose.Types.ObjectId.isValid(productId) || !variantKey) return null;

  const parsed = parseVariantKey(variantKey);
  if (getVariantKey(parsed) !== variantKey) return null;
  return { productId, variantKey, raw };
};

const parseProductPageUrl = (rawUrl) => {
  try {
    const raw = clean(rawUrl);
    if (!raw || raw.length > 1500 || !/^https?:\/\//i.test(raw)) return null;
    const url = new URL(raw);
    const expected = new URL(BASE_URL);
    if (normalizeHost(url.hostname) !== normalizeHost(expected.hostname)) return null;

    const match = url.pathname.match(/^\/productDetails\/([^/?#]+)\/?$/i);
    if (!match) return null;
    if (url.searchParams.getAll("variant").length > 1) return null;
    if (url.searchParams.getAll("color").length > 1) return null;
    if (url.searchParams.getAll("size").length > 1) return null;

    let slugOrId = match[1];
    try { slugOrId = decodeURIComponent(slugOrId); } catch (_) {}

    const rawVariantKey = clean(url.searchParams.get("variant"));
    const parsedVariant = parseVariantKey(rawVariantKey);
    const explicitColorId = clean(url.searchParams.get("color"));
    const explicitSizeId = clean(url.searchParams.get("size"));

    return {
      slugOrId,
      variantKey: rawVariantKey,
      colorId: explicitColorId || parsedVariant.colorId,
      sizeId: explicitSizeId || parsedVariant.sizeId,
      // Previous Odour feed URLs used variant=<colorId> and size=<sizeId>.
      legacyVariantId: !explicitColorId && rawVariantKey &&
        !rawVariantKey.includes("--size-") && !rawVariantKey.startsWith("size-")
        ? rawVariantKey
        : "",
    };
  } catch (_) {
    return null;
  }
};

const findPublishedProductBySlugOrId = async (slugOrId) => {
  const or = [{ slug: slugOrId }, { oldSlugs: slugOrId }];
  if (mongoose.Types.ObjectId.isValid(slugOrId)) or.push({ _id: slugOrId });
  return Product.findOne({ isPublished: true, $or: or })
    .populate("categoryDetails")
    .populate("brandDetails")
    .lean();
};

const findPublishedProductsByIds = async (ids) => {
  const uniqueIds = [...new Set(ids.filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (!uniqueIds.length) return new Map();
  const rows = await Product.find({ _id: { $in: uniqueIds }, isPublished: true })
    .populate("categoryDetails")
    .populate("brandDetails")
    .lean();
  return new Map(rows.map((product) => [String(product._id), product]));
};

const buildResponse = ({
  products,
  currentPage = 1,
  total = products.length,
  maxPages = 1,
  nextCursor = null,
}) => ({
  api_version: "torob_api_v3",
  current_page: currentPage,
  total,
  max_pages: maxPages,
  next_cursor: nextCursor,
  products,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const validateLookupArray = (body, key) => {
  if (!Array.isArray(body[key]) || body[key].length < 1 || body[key].length > PAGE_SIZE) {
    return `${key} must contain between 1 and ${PAGE_SIZE} items`;
  }
  if (body[key].some((value) => typeof value !== "string" || !value.trim())) {
    return `every ${key} item must be a non-empty string`;
  }
  return "";
};

const validateRequestMode = (body) => {
  const hasUrls = hasOwn(body, "page_urls");
  const hasUniques = hasOwn(body, "page_uniques");
  const hasPage = hasOwn(body, "page");
  const hasSort = hasOwn(body, "sort");
  const hasCursor = hasOwn(body, "cursor");

  if (hasUrls) {
    if (hasUniques || hasPage || hasSort || hasCursor) {
      return { error: "Provide exactly one request mode: page_urls, page_uniques, page with sort, or cursor with product_id_desc" };
    }
    const error = validateLookupArray(body, "page_urls");
    return error ? { error } : { mode: "urls" };
  }

  if (hasUniques) {
    if (hasPage || hasSort || hasCursor) {
      return { error: "Provide exactly one request mode: page_urls, page_uniques, page with sort, or cursor with product_id_desc" };
    }
    const error = validateLookupArray(body, "page_uniques");
    return error ? { error } : { mode: "uniques" };
  }

  // Official Torob v3 cursor mode starts with {sort:"product_id_desc"}, then
  // continues with {cursor:"...",sort:"product_id_desc"}.
  if (hasCursor || (hasSort && body.sort === "product_id_desc" && !hasPage)) {
    if (hasPage) return { error: "cursor pagination must not include page" };
    if (body.sort !== "product_id_desc") return { error: "cursor pagination requires sort=product_id_desc" };
    if (hasCursor && (typeof body.cursor !== "string" || !body.cursor.trim())) {
      return { error: "cursor must be a non-empty string" };
    }
    return { mode: "cursor", cursor: hasCursor ? body.cursor.trim() : "", sort: body.sort };
  }

  if (!hasPage) return { error: "page parameter is not provided" };
  if (!hasSort) return { error: "sort parameter is not provided" };

  const page = Number.parseInt(body.page, 10);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || String(page) !== String(body.page).trim()) {
    return { error: "page must be a positive integer" };
  }
  if (!["date_added_desc", "date_updated_desc", "product_id_desc"].includes(body.sort)) {
    return { error: "sort parameter must be date_added_desc, date_updated_desc or product_id_desc" };
  }
  return { mode: "pagination", page, sort: body.sort };
};

const sortQueryFor = (sort) => sort === "date_added_desc"
  ? { publishedAt: -1, createdAt: -1, _id: -1 }
  : sort === "product_id_desc"
    ? { _id: -1 }
    : { updatedAt: -1, _id: -1 };

const loadAllFormattedVariants = async (sort = "date_added_desc") => {
  const sourceProducts = await Product.find({ isPublished: true })
    .sort(sortQueryFor(sort))
    .populate("categoryDetails")
    .populate("brandDetails")
    .lean();
  const variants = [];
  for (const product of sourceProducts) {
    for (const variant of getProductVariants(product)) {
      variants.push(formatProductForTorob(product, variant));
    }
  }
  return variants;
};

exports.torobApiV3 = async (req, res) => {
  try {
    const requestBody = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    const validation = validateRequestMode(requestBody);
    if (validation.error) return res.status(400).json({ error: validation.error });

    if (validation.mode === "urls") {
      const products = [];
      for (const rawUrl of requestBody.page_urls) {
        const parsed = parseProductPageUrl(rawUrl);
        if (!parsed) continue;
        const product = await findPublishedProductBySlugOrId(parsed.slugOrId);
        if (!product) continue;
        const variant = resolveVariantRequest(product, parsed);
        if (!variant) continue;
        const formatted = formatProductForTorob(product, variant);
        // Returning the canonical URL is allowed; the requested URL may contain UTM params
        // or may be one of Odour's older variant URL shapes.
        products.push(formatted);
      }
      return res.json(buildResponse({ products }));
    }

    if (validation.mode === "uniques") {
      const requests = requestBody.page_uniques.map(parsePageUnique);
      const lookup = await findPublishedProductsByIds(requests.filter(Boolean).map((item) => item.productId));
      const products = requests.map((request) => {
        if (!request) return null;
        const product = lookup.get(request.productId);
        if (!product) return null;
        const variant = findVariantByKey(product, request.variantKey);
        if (!variant) return null;
        const formatted = formatProductForTorob(product, variant);
        return formatted.page_unique === request.raw ? formatted : null;
      }).filter(Boolean);
      return res.json(buildResponse({ products }));
    }

    if (validation.mode === "cursor") {
      const allVariants = await loadAllFormattedVariants("product_id_desc");
      let start = 0;
      if (validation.cursor) {
        const cursorIndex = allVariants.findIndex((item) => item.page_unique === validation.cursor);
        if (cursorIndex < 0) return res.status(400).json({ error: "cursor is invalid" });
        start = cursorIndex + 1;
      }
      const products = allVariants.slice(start, start + PAGE_SIZE);
      const nextCursor = start + PAGE_SIZE < allVariants.length && products.length
        ? products[products.length - 1].page_unique
        : null;
      return res.json(buildResponse({
        products,
        currentPage: Math.floor(start / PAGE_SIZE) + 1,
        total: null,
        maxPages: null,
        nextCursor,
      }));
    }

    const allVariants = await loadAllFormattedVariants(validation.sort);
    const total = allVariants.length;
    const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (validation.page - 1) * PAGE_SIZE;
    return res.json(buildResponse({
      products: allVariants.slice(start, start + PAGE_SIZE),
      currentPage: validation.page,
      total,
      maxPages,
    }));
  } catch (error) {
    console.error("Torob API Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      ...(process.env.NODE_ENV === "development" ? { details: error.message } : {}),
    });
  }
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

exports.torobSitemapXml = async (req, res) => {
  try {
    const variants = await loadAllFormattedVariants();
    const urls = variants
      .map(
        (item) => `  <url>\n    <loc>${escapeXml(item.page_url)}</loc>\n    <lastmod>${escapeXml(
          item.date_updated
        )}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.send(xml);
  } catch (error) {
    console.error("Torob XML Sitemap Error:", error);
    return res.status(500).type("text/plain").send("خطا در تولید نقشه سایت ترب");
  }
};

exports.torobSitemapHtml = async (req, res) => {
  try {
    const variants = await loadAllFormattedVariants();
    const items = variants
      .map(
        (item, index) => `
        <li class="product-item">
          <span>${index + 1}.</span>
          <a href="${escapeHtml(item.page_url)}">${escapeHtml(item.title)}</a>
          <span class="date">${escapeHtml(
            new Date(item.date_updated).toLocaleDateString("fa-IR")
          )}</span>
        </li>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,follow">
  <title>فهرست تنوع‌های ترب</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
    h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
    .product-list { list-style: none; padding: 0; }
    .product-item { margin: 10px 0; padding: 10px; border-bottom: 1px solid #eee; }
    .product-item a { text-decoration: none; color: #2196F3; font-size: 16px; }
    .date { color: #666; font-size: 12px; margin-right: 15px; }
    .count { background: #4CAF50; color: white; padding: 5px 10px; border-radius: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>فهرست محصولات و تنوع‌های رنگ/سایز</h1>
    <p>تعداد کل URLها: <span class="count">${variants.length}</span></p>
    <p><a href="/torob-sitemap.xml">مشاهده sitemap XML</a></p>
    <ul class="product-list">${items}</ul>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    console.error("Torob HTML Sitemap Error:", error);
    return res.status(500).send("خطا در تولید فهرست ترب");
  }
};

exports.torobSitemap = exports.torobSitemapXml;

exports._private = {
  formatProductForTorob,
  getProductVariants,
  getLegacyProductVariants,
  getExactProductVariants,
  getVariantAvailability,
  EXACT_VARIANTS_ENABLED,
  getVariantKey,
  pageUnique,
  parsePageUnique,
  findVariantByKey,
  findExactVariantByParts,
  resolveVariantRequest,
  parseProductPageUrl,
  buildVariantTitle,
  getProductGender,
  buildSpec,
  buildPageUrl,
  validateRequestMode,
  loadAllFormattedVariants,
};
