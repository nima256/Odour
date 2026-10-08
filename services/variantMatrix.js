'use strict';

const asId = (value) => value === undefined || value === null ? '' : String(value);
const qty = (value) => Math.max(0, Number(value) || 0);

const validColors = (product) => Array.isArray(product?.colors)
  ? product.colors.filter((c) => c && String(c.name || '').trim())
  : [];
const validSizes = (product) => Array.isArray(product?.sizes)
  ? product.sizes.filter((s) => s && String(s.size || '').trim())
  : [];

const colorIdOf = (color) => color ? asId(color._id || color.variantId) : '';
const sizeIdOf = (size) => size ? asId(size._id || size.variantId) : '';
const pairKey = (colorId = '', sizeId = '') => `${asId(colorId) || '-'}|${asId(sizeId) || '-'}`;

const allDescriptors = (product) => {
  const colors = validColors(product);
  const sizes = validSizes(product);
  const colorOptions = colors.length ? colors : [null];
  const sizeOptions = sizes.length ? sizes : [null];
  const result = [];
  for (const color of colorOptions) {
    for (const size of sizeOptions) {
      const colorId = colorIdOf(color);
      const sizeId = sizeIdOf(size);
      result.push({ color, size, colorId, sizeId, key: pairKey(colorId, sizeId) });
    }
  }
  return result;
};

const configured = (product) => product?.variantInventoryConfigured === true;

const rowKey = (row) => pairKey(row?.colorId, row?.sizeId);
const rowMap = (product) => new Map((product?.variantStocks || []).map((row) => [rowKey(row), row]));

const descriptorRow = (product, descriptor) => rowMap(product).get(pairKey(descriptor?.colorId, descriptor?.sizeId)) || null;

const descriptorsForFeed = (product) => {
  const all = allDescriptors(product);
  if (!configured(product)) {
    const colors = validColors(product);
    const sizes = validSizes(product);
    // Old multi-color + multi-size products are ambiguous. Do not invent a Cartesian
    // product for Torob until an admin confirms the real combinations.
    if (colors.length > 1 && sizes.length > 1) return [];
    return all;
  }
  const rows = rowMap(product);
  const matched = all.filter((descriptor) => rows.has(descriptor.key));
  if (matched.length !== rows.size) {
    throw new Error(`Stale variant matrix for product ${String(product?._id || '')}; review color/size combinations`);
  }
  return matched;
};

const isOffered = (product, colorVariant = null, sizeVariant = null) => {
  if (!configured(product)) return true;
  return rowMap(product).has(pairKey(colorIdOf(colorVariant), sizeIdOf(sizeVariant)));
};

const legacyAvailableQuantity = (product, colorVariant = null, sizeVariant = null) => {
  const globalStock = qty(product?.countInStock);
  if (!product || product.isOutOfStock || globalStock <= 0) return 0;
  let available = globalStock;
  for (const variant of [colorVariant, sizeVariant].filter(Boolean)) {
    if (variant.isOutOfStock) return 0;
    if (variant.countInStock !== undefined && variant.countInStock !== null && variant.countInStock !== '') {
      available = Math.min(available, qty(variant.countInStock));
    }
  }
  return available;
};

const availableQuantity = (product, colorVariant = null, sizeVariant = null) => {
  if (!product || product.isOutOfStock) return 0;
  if (!configured(product)) return legacyAvailableQuantity(product, colorVariant, sizeVariant);
  const row = rowMap(product).get(pairKey(colorIdOf(colorVariant), sizeIdOf(sizeVariant)));
  if (!row || row.isOutOfStock === true) return 0;
  return qty(row.countInStock);
};

const totalMatrixStock = (productOrRows) => {
  const rows = Array.isArray(productOrRows) ? productOrRows : productOrRows?.variantStocks;
  return (rows || []).reduce((sum, row) => sum + qty(row?.countInStock), 0);
};

// Sellable stock differs from physical stock when an admin manually pauses a
// variant. countInStock keeps the physical total, while this helper is used to
// decide whether the product/variant is actually purchasable.
const totalAvailableMatrixStock = (productOrRows) => {
  const rows = Array.isArray(productOrRows) ? productOrRows : productOrRows?.variantStocks;
  return (rows || []).reduce((sum, row) => (
    row?.isOutOfStock === true ? sum : sum + qty(row?.countInStock)
  ), 0);
};

const normalizeRows = (product, incomingRows) => {
  const descriptors = new Map(allDescriptors(product).map((d) => [d.key, d]));
  const seen = new Set();
  const rows = [];
  for (const raw of Array.isArray(incomingRows) ? incomingRows : []) {
    const colorId = asId(raw?.colorId);
    const sizeId = asId(raw?.sizeId);
    const key = pairKey(colorId, sizeId);
    if (!descriptors.has(key)) throw new Error(`ترکیب رنگ/سایز نامعتبر است: ${key}`);
    if (seen.has(key)) throw new Error(`ترکیب رنگ/سایز تکراری است: ${key}`);
    seen.add(key);
    rows.push({
      colorId,
      sizeId,
      countInStock: qty(raw?.countInStock),
      isOutOfStock: raw?.isOutOfStock === true || raw?.isOutOfStock === 'true',
    });
  }
  return rows;
};

const descriptorFromIds = (product, colorId = '', sizeId = '') =>
  allDescriptors(product).find((d) => d.colorId === asId(colorId) && d.sizeId === asId(sizeId)) || null;

module.exports = {
  asId,
  qty,
  validColors,
  validSizes,
  colorIdOf,
  sizeIdOf,
  pairKey,
  allDescriptors,
  configured,
  rowMap,
  descriptorRow,
  descriptorsForFeed,
  isOffered,
  legacyAvailableQuantity,
  availableQuantity,
  totalMatrixStock,
  totalAvailableMatrixStock,
  normalizeRows,
  descriptorFromIds,
};
