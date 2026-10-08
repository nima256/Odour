'use strict';

const crypto = require('node:crypto');
const matrix = require('../services/variantMatrix');

const VERSION = 1;
const HEADERS = [
  'product_id',
  'product_name',
  'old_total',
  'color',
  'size',
  'existing_color_stock',
  'existing_size_stock',
  'offer_YES_NO',
  'new_stock',
  'row_id',
];

const hash = (value) => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');

const qty = (value) => Math.max(0, Number(value) || 0);
const asId = (value) => value === undefined || value === null ? '' : String(value);
const display = (value, fallback = '') => {
  const text = String(value ?? fallback).replace(/[\r\n\t]/g, ' ').trim();
  return /^[\s]*[=+@\-]/.test(text) ? `'${text}` : text;
};

const safeInteger = (value) => {
  const normalized = String(value ?? '')
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : NaN;
};

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const toCsv = (rows) => `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

function parseCsv(value) {
  const text = String(value || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw new Error(`Invalid CSV quote at character ${i}`);
      quoted = true;
      continue;
    }
    if (c === ',') { row.push(field); field = ''; closed = false; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.length > 1 || row[0] !== '' || rows.length) rows.push(row);
      row = []; field = ''; closed = false;
      continue;
    }
    if (closed) throw new Error('Unexpected text after closing CSV quote');
    field += c;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) throw new Error('CSV is empty');
  const [header, ...body] = rows;
  if (JSON.stringify(header) !== JSON.stringify(HEADERS)) {
    throw new Error('CSV headers changed. Edit only offer_YES_NO and new_stock; save as UTF-8 CSV.');
  }
  if (body.some((r) => r.length !== HEADERS.length)) throw new Error('CSV row has wrong number of columns.');
  return body.map((r) => Object.fromEntries(HEADERS.map((key, index) => [key, r[index]])));
}

function inferStatus(product) {
  if (matrix.configured(product)) return { status: 'configured' };
  const colors = matrix.validColors(product);
  const sizes = matrix.validSizes(product);
  const descriptors = matrix.allDescriptors(product);

  if (!colors.length && !sizes.length) return { status: 'safe' };
  if (colors.length <= 1 && sizes.length <= 1) return { status: 'safe' };
  if (colors.length > 1 && sizes.length <= 1 && colors.every((c) => c.countInStock !== undefined && c.countInStock !== null)) return { status: 'safe' };
  if (sizes.length > 1 && colors.length <= 1 && sizes.every((s) => s.countInStock !== undefined && s.countInStock !== null)) return { status: 'safe' };

  return {
    status: 'review',
    reason: colors.length > 1 && sizes.length > 1 ? 'color-size-intersection-unknown' : 'shared-stock-cannot-be-split',
    descriptors,
  };
}

const snapshotFields = (product) => ({
  _id: product._id,
  name: product.name,
  isPublished: product.isPublished,
  colors: product.colors,
  sizes: product.sizes,
  variantInventoryConfigured: product.variantInventoryConfigured,
  variantStocks: product.variantStocks,
  countInStock: product.countInStock,
  isOutOfStock: product.isOutOfStock,
  stockRevision: product.stockRevision,
  updatedAt: product.updatedAt,
  price: product.price,
  offerPrice: product.offerPrice,
  slug: product.slug,
  images: product.images,
});
const snapshotHash = (product) => hash(snapshotFields(product));

function exportProduct(product) {
  const id = asId(product._id);
  const inferred = inferStatus(product);
  if (inferred.status !== 'review') return { skip: inferred.status, id, name: product.name };
  const descriptors = matrix.allDescriptors(product);
  if (!descriptors.length) return { skip: 'no-descriptors', id, name: product.name };
  if (descriptors.length > 400) return { skip: 'too-many-pairs', id, name: product.name };

  const pairs = descriptors.map((descriptor) => ({
    rowId: `r_${hash(`${id}\u0000${descriptor.key}`).slice(0, 24)}`,
    key: descriptor.key,
    colorId: descriptor.colorId,
    sizeId: descriptor.sizeId,
    color: descriptor.color?.name || '',
    size: descriptor.size?.size || '',
    existingColorStock: descriptor.color?.countInStock ?? '',
    existingSizeStock: descriptor.size?.countInStock ?? '',
  }));
  if (new Set(pairs.map((p) => p.rowId)).size !== pairs.length) return { skip: 'duplicate-row-id', id, name: product.name };

  const rows = pairs.map((pair) => [
    id,
    display(product.name),
    String(qty(product.countInStock)),
    display(pair.color, 'بدون رنگ'),
    display(pair.size, 'بدون سایز'),
    pair.existingColorStock === '' ? '' : String(qty(pair.existingColorStock)),
    pair.existingSizeStock === '' ? '' : String(qty(pair.existingSizeStock)),
    '',
    '',
    pair.rowId,
  ]);

  return {
    id,
    name: product.name,
    oldTotal: qty(product.countInStock),
    snapshot: snapshotHash(product),
    stockRevision: Number(product.stockRevision || 0),
    pairs,
    rows,
  };
}

function createExport(products, database) {
  const all = products.map(exportProduct);
  const eligible = all.filter((x) => !x.skip);
  const skipped = all.filter((x) => x.skip).map((x) => ({ id: x.id, name: x.name, reason: x.skip }));
  const manifest = {
    version: VERSION,
    database,
    createdAt: new Date().toISOString(),
    products: eligible.map(({ id, name, oldTotal, snapshot, stockRevision, pairs }) => ({ id, name, oldTotal, snapshot, stockRevision, pairs })),
    skipped,
  };
  return {
    manifest,
    table: toCsv([HEADERS, ...eligible.flatMap((x) => x.rows)]),
    eligible: eligible.length,
    skipped,
  };
}

function preview(manifest, inputRows, products, { allowTotalChanges = false } = {}) {
  if (manifest.version !== VERSION) throw new Error('Unsupported manifest version');
  const byId = new Map(products.map((p) => [asId(p._id), p]));
  const rowIndex = new Map();
  for (const group of manifest.products) {
    for (const pair of group.pairs) {
      if (rowIndex.has(pair.rowId)) throw new Error(`Duplicate row_id in manifest: ${pair.rowId}`);
      rowIndex.set(pair.rowId, { group, pair });
    }
  }
  if (inputRows.length !== rowIndex.size) throw new Error(`Missing/extra CSV rows: expected ${rowIndex.size}, received ${inputRows.length}`);

  const entries = new Map();
  for (const row of inputRows) {
    const found = rowIndex.get(row.row_id);
    if (!found) throw new Error(`Unknown row_id ${row.row_id}; re-export instead of editing read-only columns.`);
    const { group, pair } = found;
    const expected = {
      product_id: group.id,
      product_name: display(group.name),
      old_total: String(group.oldTotal),
      color: display(pair.color, 'بدون رنگ'),
      size: display(pair.size, 'بدون سایز'),
      existing_color_stock: pair.existingColorStock === '' ? '' : String(qty(pair.existingColorStock)),
      existing_size_stock: pair.existingSizeStock === '' ? '' : String(qty(pair.existingSizeStock)),
    };
    for (const [key, value] of Object.entries(expected)) {
      if (row[key] !== value) throw new Error(`Read-only column ${key} changed in row ${row.row_id}.`);
    }
    if (entries.has(row.row_id)) throw new Error(`Duplicate row_id ${row.row_id}`);
    entries.set(row.row_id, row);
  }

  const selected = [];
  const untouched = [];
  const partial = [];
  const stale = [];
  const errors = [];

  for (const group of manifest.products) {
    const rows = group.pairs.map((pair) => entries.get(pair.rowId));
    const touched = rows.filter((row) => row.offer_YES_NO.trim() !== '' || row.new_stock.trim() !== '');
    if (!touched.length) { untouched.push({ id: group.id, name: group.name }); continue; }
    if (rows.some((row) => row.offer_YES_NO.trim() === '' || row.new_stock.trim() === '')) {
      partial.push({ id: group.id, name: group.name, filled: rows.filter((row) => row.offer_YES_NO.trim() !== '' && row.new_stock.trim() !== '').length, total: rows.length });
      continue;
    }

    const live = byId.get(group.id);
    const exportedNow = live ? exportProduct(live) : null;
    if (!live || snapshotHash(live) !== group.snapshot || live.variantInventoryConfigured === true || !exportedNow || exportedNow.skip ||
      JSON.stringify(exportedNow.pairs) !== JSON.stringify(group.pairs)) {
      stale.push({ id: group.id, name: group.name });
      continue;
    }

    const proposal = allocate(group, live, rows, { allowTotalChanges });
    if (proposal.errors.length) errors.push({ id: group.id, name: group.name, issues: proposal.errors });
    else selected.push(proposal);
  }

  const plan = selected.map((x) => ({ id: x.id, snapshot: x.snapshot, variantStocks: x.variantStocks, newTotal: x.newTotal }));
  const planSha = selected.length && !partial.length && !stale.length && !errors.length
    ? hash({ database: manifest.database, allowTotalChanges, plan })
    : '';

  return {
    database: manifest.database,
    exportedProducts: manifest.products.length,
    selected: selected.length,
    untouched: untouched.length,
    partial: partial.length,
    stale: stale.length,
    invalid: errors.length,
    totalBefore: selected.reduce((sum, x) => sum + x.oldTotal, 0),
    totalAfter: selected.reduce((sum, x) => sum + x.newTotal, 0),
    totalDelta: selected.reduce((sum, x) => sum + x.delta, 0),
    changedTotals: selected.filter((x) => x.delta !== 0).length,
    combinationsBefore: selected.reduce((sum, x) => sum + matrix.descriptorsForFeed(x.product).length, 0),
    combinationsAfter: selected.reduce((sum, x) => sum + x.variantStocks.length, 0),
    sampleSelected: selected.slice(0, 8).map((x) => ({ id: x.id, name: x.name, old: x.oldTotal, new: x.newTotal, offered: x.variantStocks.length })),
    partialSamples: partial.slice(0, 10),
    staleSamples: stale.slice(0, 10),
    errorSamples: errors.slice(0, 10),
    planSha,
    selectedProducts: selected,
  };
}

function allocate(group, product, rows, { allowTotalChanges = false } = {}) {
  const errors = [];
  const stocks = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const pair = group.pairs[index];
    const offer = row.offer_YES_NO.trim().toUpperCase();
    const stock = safeInteger(row.new_stock);
    if (!['YES', 'NO'].includes(offer)) errors.push(`${pair.color || 'بدون رنگ'} / ${pair.size || 'بدون سایز'}: offer_YES_NO must be YES or NO`);
    if (!Number.isSafeInteger(stock) || stock < 0) errors.push(`${pair.color || 'بدون رنگ'} / ${pair.size || 'بدون سایز'}: new_stock must be a non-negative integer`);
    if (offer === 'NO' && stock !== 0) errors.push(`${pair.color || 'بدون رنگ'} / ${pair.size || 'بدون سایز'}: NO requires new_stock=0`);
    if (offer === 'YES' && Number.isSafeInteger(stock) && stock >= 0) {
      stocks.push({ colorId: pair.colorId, sizeId: pair.sizeId, countInStock: stock });
    }
  }
  if (!stocks.length) errors.push('At least one real color × size combination must be YES.');
  let normalized = [];
  if (!errors.length) {
    try { normalized = matrix.normalizeRows(product, stocks); }
    catch (error) { errors.push(error.message); }
  }
  const newTotal = matrix.totalMatrixStock(normalized);
  const oldTotal = qty(product.countInStock);
  if (!allowTotalChanges && newTotal !== oldTotal) {
    errors.push(`New matrix total ${newTotal} does not equal old aggregate stock ${oldTotal}. Re-run check with --allow-total-changes only if this recount is intentional.`);
  }
  if (errors.length) return { errors };
  return {
    errors: [],
    id: group.id,
    name: group.name,
    snapshot: group.snapshot,
    product,
    oldTotal,
    newTotal,
    delta: newTotal - oldTotal,
    variantStocks: normalized,
  };
}

module.exports = {
  VERSION,
  HEADERS,
  parseCsv,
  createExport,
  exportProduct,
  preview,
  allocate,
  snapshotHash,
  hash,
  safeInteger,
  inferStatus,
};
