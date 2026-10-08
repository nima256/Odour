const express = require("express");
const {
  torobApiV3,
  torobSitemapXml,
  torobSitemapHtml,
} = require("../controllers/torobController");

const {
  getProductGender,
  buildPersianVariantTitle,
  buildVariantTitle,
  getVariantKey,
  parseVariantKey,
} = require("../helper/torobProductMeta");

const { torobAuth } = require("../middlewares/torobAuth");

const router = express.Router();
const SITE_BASE_URL = (process.env.SITE_BASE_URL || process.env.SITE_URL || "https://www.odour.ir").replace(/\/+$/, "");

router.use(express.json({ limit: "1mb" }));
router.use(express.urlencoded({ extended: true }));

// این middleware باید قبل از route صفحه محصول اجرا شود تا EJS بتواند
// query مربوط به variant را به صورت server-side در title/meta/canonical استفاده کند.
router.use((req, res, next) => {
  const rawVariant = typeof req.query.variant === "string" ? req.query.variant.trim() : "";
  const safeVariant = /^[a-zA-Z0-9_-]{1,160}$/.test(rawVariant) ? rawVariant : "";
  const parsedVariant = parseVariantKey(safeVariant);

  const rawColor = typeof req.query.color === "string" ? req.query.color.trim() : "";
  const safeColor = /^[a-zA-Z0-9_-]{1,100}$/.test(rawColor) ? rawColor : "";
  const rawSize = typeof req.query.size === "string" ? req.query.size.trim() : "";
  const safeSize = /^[a-zA-Z0-9_-]{1,100}$/.test(rawSize) ? rawSize : "";

  res.locals.requestedTorobVariantKey = safeVariant;
  res.locals.requestedTorobColorId = safeColor || parsedVariant.colorId;
  res.locals.requestedTorobVariantId = res.locals.requestedTorobColorId; // legacy view compatibility
  res.locals.requestedTorobSizeId = safeSize || parsedVariant.sizeId;
  res.locals.torobMetaHelper = {
    getProductGender,
    buildPersianVariantTitle,
    buildVariantTitle,
    getVariantKey,
    parseVariantKey,
  };
  res.locals.siteBaseUrl = SITE_BASE_URL;
  next();
});

router.post("/torob_api/v3/products", torobAuth, torobApiV3);

// هر دو آدرس XML هستند تا آدرس قبلی نیز برای ترب معتبر باقی بماند.
router.get("/torob-sitemap", torobSitemapXml);
router.get("/torob-sitemap.xml", torobSitemapXml);
router.get("/torob-sitemap-view", torobSitemapHtml);

module.exports = router;
