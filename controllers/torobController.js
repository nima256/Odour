const mongoose = require("mongoose");
const Product = require("../models/Product");
const {
  getProductGender,
  buildVariantTitle,
} = require("../helper/torobProductMeta");

const BASE_URL = (process.env.SITE_BASE_URL || process.env.SITE_URL || "https://odour.ir")
  .replace(/\/+$/, "");
const PAGE_SIZE = 100;
const BASE_VARIANT_ID = "base";

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
  if (Array.isArray(categoryDetails)) {
    return categoryDetails[0]?.name || "";
  }

  return categoryDetails?.name || "";
};

const getOptionId = (option, fallback) => {
  if (!option) return "";
  if (option._id) return String(option._id);
  if (option.variantId) return String(option.variantId);
  return fallback;
};

const getVariantKey = ({ colorId = "", sizeId = "" } = {}) => {
  if (colorId && sizeId) return `${colorId}--size-${sizeId}`;
  if (colorId) return colorId;
  if (sizeId) return `size-${sizeId}`;
  return BASE_VARIANT_ID;
};

const getProductVariants = (product) => {
  const colors = Array.isArray(product.colors)
    ? product.colors.filter((color) => String(color?.name || "").trim())
    : [];
  const sizes = Array.isArray(product.sizes)
    ? product.sizes.filter((size) => String(size?.size || "").trim())
    : [];

  if (!colors.length && !sizes.length) {
    return [{
      color: null,
      size: null,
      colorId: "",
      sizeId: "",
      variantKey: BASE_VARIANT_ID,
      index: 0,
    }];
  }

  const colorOptions = colors.length ? colors : [null];
  const sizeOptions = sizes.length ? sizes : [null];
  const variants = [];

  colorOptions.forEach((color, colorIndex) => {
    sizeOptions.forEach((size, sizeIndex) => {
      const colorId = getOptionId(color, `color-${colorIndex + 1}`);
      const sizeId = getOptionId(size, `size-${sizeIndex + 1}`);
      variants.push({
        color,
        size,
        colorId,
        sizeId,
        variantKey: getVariantKey({ colorId, sizeId }),
        index: variants.length,
      });
    });
  });

  return variants;
};

const hasStockValue = (value) =>
  value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));

const getVariantAvailability = (product, descriptor = {}) => {
  const options = [descriptor.color, descriptor.size].filter(Boolean);

  if (options.some((option) => option?.isOutOfStock === true)) return false;

  const optionStocks = options
    .map((option) => option?.countInStock)
    .filter(hasStockValue)
    .map(Number);

  // موجودی تنوع، در صورت ثبت، بر موجودی کلی محصول اولویت دارد.
  if (optionStocks.length > 0) {
    return optionStocks.every((stock) => stock > 0);
  }

  return product.isOutOfStock !== true && Number(product.countInStock || 0) > 0;
};

const buildSpec = (product, color = null, size = null) => {
  const spec = {};

  if (Array.isArray(product.specifications)) {
    for (const item of product.specifications) {
      const key = String(item?.key || "").trim();
      const value = String(item?.value || "").trim();
      if (key && value) spec[key] = value;
    }
  }

  if (color?.name) spec["رنگ"] = String(color.name).trim();
  if (size?.size) spec["سایز"] = String(size.size).trim();

  const gender = getProductGender(product);
  if (gender && !spec["جنسیت"]) spec["جنسیت"] = gender;

  if (product.weight !== undefined && product.weight !== null && product.weight !== "") {
    const weight = String(product.weight);
    spec["وزن"] = /گرم/.test(weight) ? weight : `${weight} گرم`;
  }

  return spec;
};

const buildPageUrl = (product, descriptorOrVariantId = null, maybeSizeId = "") => {
  const slugOrId = product.slug || String(product._id);
  const url = new URL(`/productDetails/${encodeURIComponent(slugOrId)}`, BASE_URL);

  let colorId = "";
  let sizeId = "";
  if (descriptorOrVariantId && typeof descriptorOrVariantId === "object") {
    colorId = descriptorOrVariantId.colorId || "";
    sizeId = descriptorOrVariantId.sizeId || "";
  } else {
    colorId = descriptorOrVariantId && descriptorOrVariantId !== BASE_VARIANT_ID
      ? String(descriptorOrVariantId)
      : "";
    sizeId = String(maybeSizeId || "");
  }

  if (colorId) url.searchParams.set("variant", colorId);
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

const formatProductForTorob = (product, variantDescriptor = null) => {
  const descriptor = variantDescriptor || getProductVariants(product)[0];
  const color = descriptor?.color || null;
  const size = descriptor?.size || null;
  const colorName = String(color?.name || "").trim();
  const sizeName = String(size?.size || "").trim();
  const availability = getVariantAvailability(product, descriptor);
  const regularPrice = Number(product.price || 0);
  const salePrice = Number(product.offerPrice || 0);
  const effectivePrice = salePrice > 0 ? salePrice : regularPrice;
  const currentPrice = availability ? effectivePrice : 0;
  const oldPrice = availability && salePrice > 0 && regularPrice > salePrice
    ? regularPrice
    : null;

  const subtitleParts = [product.lilDescription || ""];
  if (colorName) subtitleParts.push(`رنگ ${colorName}`);
  if (sizeName) subtitleParts.push(`سایز ${sizeName}`);

  return {
    page_unique: `${product._id}_${descriptor.variantKey}`,
    page_url: buildPageUrl(product, descriptor),
    product_group_id: String(product.product_group_id || product._id),
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
  getProductVariants(product).find((item) => item.variantKey === String(variantKey)) || null;

const findVariant = (product, variantId = "", sizeId = "") => {
  const variants = getProductVariants(product);
  const normalizedColorId = String(variantId || "");
  const normalizedSizeId = String(sizeId || "");

  if (!normalizedColorId && !normalizedSizeId) return variants[0] || null;

  return variants.find((item) => {
    const colorMatches = normalizedColorId ? item.colorId === normalizedColorId : true;
    const sizeMatches = normalizedSizeId ? item.sizeId === normalizedSizeId : true;
    return colorMatches && sizeMatches;
  }) || null;
};

const parseProductPageUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl, BASE_URL);
    const match = url.pathname.match(/^\/productDetails\/([^/?#]+)\/?$/i);
    if (!match) return null;

    let slugOrId = match[1];
    try {
      slugOrId = decodeURIComponent(slugOrId);
    } catch (_) {
      // Keep raw path segment when decoding fails.
    }

    return {
      slugOrId,
      variantId: url.searchParams.get("variant") || "",
      sizeId: url.searchParams.get("size") || "",
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

const buildResponse = ({ products, currentPage = 1, total = products.length, maxPages = 1 }) => ({
  api_version: "torob_api_v3",
  current_page: currentPage,
  total,
  max_pages: maxPages,
  products,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const validateRequestMode = (body) => {
  const hasUrls = hasOwn(body, "page_urls");
  const hasUniques = hasOwn(body, "page_uniques");
  const hasPagination = hasOwn(body, "page") || hasOwn(body, "sort");
  const modeCount = [hasUrls, hasUniques, hasPagination].filter(Boolean).length;

  if (modeCount !== 1) {
    return { error: "Provide exactly one request mode: page_urls, page_uniques, or page with sort" };
  }

  if (hasUrls) {
    if (!Array.isArray(body.page_urls) || body.page_urls.length < 1) {
      return { error: "page_urls must be a non-empty array" };
    }
    if (body.page_urls.some((value) => typeof value !== "string" || !value.trim())) {
      return { error: "every page_urls item must be a non-empty string" };
    }
    return { mode: "urls" };
  }

  if (hasUniques) {
    if (!Array.isArray(body.page_uniques) || body.page_uniques.length < 1) {
      return { error: "page_uniques must be a non-empty array" };
    }
    if (body.page_uniques.some((value) => typeof value !== "string" || !value.trim())) {
      return { error: "every page_uniques item must be a non-empty string" };
    }
    return { mode: "uniques" };
  }

  if (!hasOwn(body, "page")) return { error: "page parameter is not provided" };
  if (!hasOwn(body, "sort")) return { error: "sort parameter is not provided" };

  const page = Number.parseInt(body.page, 10);
  if (!Number.isInteger(page) || page < 1 || String(page) !== String(body.page).trim()) {
    return { error: "page must be a positive integer" };
  }
  if (!["date_added_desc", "date_updated_desc"].includes(body.sort)) {
    return { error: "sort parameter must be date_added_desc or date_updated_desc" };
  }

  return { mode: "pagination", page, sort: body.sort };
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
      for (const rawUrl of requestBody.page_urls.slice(0, PAGE_SIZE)) {
        const parsed = parseProductPageUrl(rawUrl);
        if (!parsed) continue;

        const product = await findPublishedProductBySlugOrId(parsed.slugOrId);
        if (!product) continue;

        const variant = findVariant(product, parsed.variantId, parsed.sizeId);
        if (!variant) continue;
        products.push(formatProductForTorob(product, variant));
      }
      return res.json(buildResponse({ products }));
    }

    if (validation.mode === "uniques") {
      const products = [];
      for (const unique of requestBody.page_uniques.slice(0, PAGE_SIZE)) {
        const separatorIndex = String(unique).indexOf("_");
        if (separatorIndex <= 0) continue;

        const productId = String(unique).slice(0, separatorIndex);
        const variantKey = String(unique).slice(separatorIndex + 1);
        if (!mongoose.Types.ObjectId.isValid(productId) || !variantKey) continue;

        const product = await Product.findOne({ _id: productId, isPublished: true })
          .populate("categoryDetails")
          .populate("brandDetails")
          .lean();
        if (!product) continue;

        const variant = findVariantByKey(product, variantKey);
        if (!variant) continue;
        products.push(formatProductForTorob(product, variant));
      }
      return res.json(buildResponse({ products }));
    }

    const sortQuery = validation.sort === "date_added_desc"
      ? { publishedAt: -1, createdAt: -1, _id: -1 }
      : { updatedAt: -1, _id: -1 };

    const sourceProducts = await Product.find({ isPublished: true })
      .sort(sortQuery)
      .populate("categoryDetails")
      .populate("brandDetails")
      .lean();

    const allVariants = [];
    for (const product of sourceProducts) {
      for (const variant of getProductVariants(product)) {
        allVariants.push(formatProductForTorob(product, variant));
      }
    }

    const total = allVariants.length;
    const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (validation.page - 1) * PAGE_SIZE;
    const products = allVariants.slice(start, start + PAGE_SIZE);

    return res.json(buildResponse({
      products,
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

const loadAllFormattedVariants = async () => {
  const sourceProducts = await Product.find({ isPublished: true })
    .sort({ publishedAt: -1, createdAt: -1, _id: -1 })
    .select(
      "name englishName slug colors sizes images price offerPrice countInStock isOutOfStock lilDescription specifications weight guarantee product_group_id publishedAt createdAt updatedAt catName subCat"
    )
    .lean();

  const variants = [];
  for (const product of sourceProducts) {
    for (const variant of getProductVariants(product)) {
      variants.push(formatProductForTorob(product, variant));
    }
  }
  return variants;
};

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
  getVariantAvailability,
  getVariantKey,
  findVariant,
  findVariantByKey,
  parseProductPageUrl,
  buildVariantTitle,
  getProductGender,
  buildSpec,
  buildPageUrl,
  validateRequestMode,
};
