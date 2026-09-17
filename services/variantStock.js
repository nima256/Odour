const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const normalizeVariantValue = (value) => {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .trim()
    .toLowerCase();
};

const hasTrackedStock = (variant) =>
  Boolean(variant) && variant.countInStock !== undefined && variant.countInStock !== null;

const findColorVariant = (product, { selectedColor, selectedVariantId } = {}) => {
  const colors = Array.isArray(product?.colors) ? product.colors : [];
  if (!colors.length) return null;

  if (selectedVariantId) {
    const byId = colors.find((color) => String(color?._id) === String(selectedVariantId));
    if (byId) return byId;
  }

  const normalizedColor = normalizeVariantValue(selectedColor);
  if (!normalizedColor) return null;
  return colors.find((color) => normalizeVariantValue(color?.name) === normalizedColor) || null;
};

const findSizeVariant = (product, { selectedSize, selectedSizeId } = {}) => {
  const sizes = Array.isArray(product?.sizes) ? product.sizes : [];
  if (!sizes.length) return null;

  if (selectedSizeId) {
    const byId = sizes.find((size) => String(size?._id) === String(selectedSizeId));
    if (byId) return byId;
  }

  const normalizedSize = normalizeVariantValue(selectedSize);
  if (!normalizedSize) return null;
  return sizes.find((size) => normalizeVariantValue(size?.size) === normalizedSize) || null;
};

const getAvailableQuantity = (product, colorVariant = null, sizeVariant = null) => {
  const globalStock = Math.max(0, Number(product?.countInStock || 0));
  if (!product || product.isOutOfStock || globalStock <= 0) return 0;

  let available = globalStock;

  if (colorVariant) {
    if (colorVariant.isOutOfStock) return 0;
    if (hasTrackedStock(colorVariant)) {
      available = Math.min(available, Math.max(0, Number(colorVariant.countInStock || 0)));
    }
  }

  if (sizeVariant) {
    if (sizeVariant.isOutOfStock) return 0;
    if (hasTrackedStock(sizeVariant)) {
      available = Math.min(available, Math.max(0, Number(sizeVariant.countInStock || 0)));
    }
  }

  return available;
};

module.exports = {
  normalizeVariantValue,
  hasTrackedStock,
  findColorVariant,
  findSizeVariant,
  getAvailableQuantity,
};
