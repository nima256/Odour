const BASE_VARIANT_ID = "base";
const VARIANT_SIZE_SEPARATOR = "--size-";

const getVariantKey = ({ colorId = "", sizeId = "" } = {}) => {
  const normalizedColorId = String(colorId || "").trim();
  const normalizedSizeId = String(sizeId || "").trim();

  if (normalizedColorId && normalizedSizeId) {
    return `${normalizedColorId}${VARIANT_SIZE_SEPARATOR}${normalizedSizeId}`;
  }
  if (normalizedColorId) return normalizedColorId;
  if (normalizedSizeId) return `size-${normalizedSizeId}`;
  return BASE_VARIANT_ID;
};

const parseVariantKey = (value = "") => {
  const variantKey = String(value || "").trim();
  if (!variantKey || variantKey === BASE_VARIANT_ID) {
    return { variantKey: BASE_VARIANT_ID, colorId: "", sizeId: "" };
  }

  const separatorIndex = variantKey.indexOf(VARIANT_SIZE_SEPARATOR);
  if (separatorIndex > 0) {
    const colorId = variantKey.slice(0, separatorIndex);
    const sizeId = variantKey.slice(separatorIndex + VARIANT_SIZE_SEPARATOR.length);
    if (colorId && sizeId) return { variantKey, colorId, sizeId };
  }

  if (variantKey.startsWith("size-") && variantKey.length > 5) {
    return { variantKey, colorId: "", sizeId: variantKey.slice(5) };
  }

  return { variantKey, colorId: variantKey, sizeId: "" };
};

const DEFAULT_GENDER = String(
  process.env.TOROB_DEFAULT_GENDER || "زنانه"
).trim() || "زنانه";

const normalizePersianText = (value = "") =>
  String(value)
    .normalize("NFKC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const compactText = (value = "") =>
  normalizePersianText(value).replace(/[\s\-_]+/g, "");

const detectGenderFromText = (value = "") => {
  const text = normalizePersianText(value);
  const compact = compactText(value);

  if (!text) return null;

  const hasUnisex =
    text.includes("یونیسکس") ||
    compact.includes("یونیسکس") ||
    text.includes("زنانه و مردانه") ||
    text.includes("مردانه و زنانه") ||
    text.includes("مشترک زنانه مردانه") ||
    /(^|[^a-z])unisex([^a-z]|$)/i.test(text);

  if (hasUnisex) return "یونیسکس";

  const hasMale =
    text.includes("مردانه") ||
    text.includes("آقایان") ||
    text.includes("آقايان") ||
    /(^|[^a-z])(men|mens|men's|male|man)([^a-z]|$)/i.test(text);

  const hasFemale =
    text.includes("زنانه") ||
    text.includes("بانوان") ||
    /(^|[^a-z])(women|womens|women's|female|woman|ladies)([^a-z]|$)/i.test(text);

  if (hasMale && hasFemale) return "یونیسکس";
  if (hasMale) return "مردانه";
  if (hasFemale) return "زنانه";

  return null;
};

const findGenderSpecification = (product = {}) => {
  if (!Array.isArray(product.specifications)) return null;

  return product.specifications.find((item) => {
    const key = compactText(item?.key);
    return [
      "جنسیت",
      "مناسببرای",
      "مناسبچهکسانی",
      "گروهجنسی",
      "gender",
    ].includes(key);
  });
};

const getProductGender = (product = {}) => {
  const directGender = detectGenderFromText(product.gender || product.sex || "");
  if (directGender) return directGender;

  const genderSpec = findGenderSpecification(product);
  const specificationGender = detectGenderFromText(genderSpec?.value || "");
  if (specificationGender) return specificationGender;

  const titleGender = detectGenderFromText(
    `${product.name || ""} ${product.englishName || ""}`
  );
  if (titleGender) return titleGender;

  return detectGenderFromText(DEFAULT_GENDER) || "زنانه";
};

const buildPersianVariantTitle = (product = {}, color = null, size = null) => {
  const baseTitle = String(product.name || "").trim();
  const colorName = String(color?.name || "").trim();
  const sizeName = String(size?.size || size?.name || "").trim();
  const gender = getProductGender(product);
  const parts = [baseTitle];

  if (colorName) parts.push(`رنگ ${colorName}`);
  if (sizeName) parts.push(`سایز ${sizeName}`);

  if (gender && detectGenderFromText(baseTitle) !== gender) {
    parts.push(gender);
  }

  return parts.filter(Boolean).join(" - ");
};

const buildVariantTitle = (product = {}, color = null, size = null) => {
  const persianTitle = buildPersianVariantTitle(product, color, size);
  const englishName = String(product.englishName || "").trim();
  return englishName ? `${persianTitle} | ${englishName}` : persianTitle;
};

module.exports = {
  BASE_VARIANT_ID,
  getVariantKey,
  parseVariantKey,
  DEFAULT_GENDER,
  normalizePersianText,
  detectGenderFromText,
  findGenderSpecification,
  getProductGender,
  buildPersianVariantTitle,
  buildVariantTitle,
};
