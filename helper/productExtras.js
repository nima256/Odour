// Normalises the Phase 2 product fields sent by the admin editor (inventory,
// presentation and structured fragrance data) into what the Product schema
// expects. Unknown keys inside `fragrance` are dropped.
const BADGES = ["", "new", "bestseller", "limited", "exclusive"];
const SEASONS = ["بهار", "تابستان", "پاییز", "زمستان"];
const DAY_NIGHT = ["روز", "شب"];

const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// Accepts an array or a comma / «،» / newline separated string.
function list(v, max = 40, limit = 12) {
  const raw = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,،\n]/);
  return [...new Set(raw.map((x) => text(x, max)).filter(Boolean))].slice(0, limit);
}

function intOr(v, fallback, min = -Infinity, max = Infinity) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeAccords(v) {
  let items = v;
  if (typeof v === "string") {
    // "چوبی:100، گلی:80" or one per line
    items = v.split(/[,،\n]/).map((part) => {
      const [name, strength] = part.split(/[:=]/);
      return { name, strength };
    });
  }
  if (!Array.isArray(items)) return [];
  return items
    .map((a) => ({ name: text(a && a.name, 40), strength: intOr(a && a.strength, 0, 0, 100) }))
    .filter((a) => a.name)
    .slice(0, 8);
}

function normalizeImage(v) {
  if (!v || typeof v !== "object") return undefined;
  const url = text(v.url, 500);
  if (!url || !url.startsWith("/uploads/") || url.includes("..")) return undefined;
  return { url, filename: text(v.filename, 200) || url.split("/").pop() };
}

function normalizeFragrance(f) {
  if (!f || typeof f !== "object") return undefined;
  return {
    family: text(f.family, 60),
    concentration: text(f.concentration, 40),
    gender: text(f.gender, 30),
    volume: text(f.volume, 40),
    top: list(f.top),
    heart: list(f.heart),
    base: list(f.base),
    accords: normalizeAccords(f.accords),
    longevity: text(f.longevity, 40),
    sillage: text(f.sillage, 40),
    seasons: list(f.seasons).filter((s) => SEASONS.includes(s)),
    dayNight: list(f.dayNight).filter((s) => DAY_NIGHT.includes(s)),
    occasions: list(f.occasions),
    story: text(f.story, 2000),
    usage: text(f.usage, 1000),
    ingredients: text(f.ingredients, 2000),
    identityImage: normalizeImage(f.identityImage),
  };
}

// Mutates and returns `body`; only touches keys that were actually sent.
function normalizeProductExtras(body) {
  if (!body || typeof body !== "object") return body;
  delete body.rating;
  delete body.reviewsNum;
  if ("sku" in body) body.sku = text(body.sku, 60);
  if ("lowStockThreshold" in body) body.lowStockThreshold = intOr(body.lowStockThreshold, 3, 0, 1000);
  if ("badge" in body) body.badge = BADGES.includes(body.badge) ? body.badge : "";
  if ("collectionName" in body) body.collectionName = text(body.collectionName, 60);
  if ("sortPriority" in body) body.sortPriority = intOr(body.sortPriority, 0, -1000, 1000);
  if ("isNewProduct" in body) body.isNewProduct = body.isNewProduct === true || body.isNewProduct === "true";
  if ("fragrance" in body) {
    const fragrance = normalizeFragrance(body.fragrance);
    if (fragrance) body.fragrance = fragrance;
    else delete body.fragrance;
  }
  return body;
}

module.exports = { normalizeProductExtras, normalizeFragrance, list };
