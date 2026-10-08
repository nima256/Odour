'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/bulkVariantInventoryCsv');

const p = (extra = {}) => ({
  _id: '66aaaaaaaaaaaaaaaaaaaaaa',
  name: 'محصول تست',
  isPublished: true,
  countInStock: 2,
  isOutOfStock: false,
  stockRevision: 0,
  variantInventoryConfigured: false,
  variantStocks: [],
  colors: [
    { _id: '66bbbbbbbbbbbbbbbbbbbbbb', name: 'مشکی', rgb: '#000', countInStock: undefined },
    { _id: '66cccccccccccccccccccccc', name: 'قرمز', rgb: '#f00', countInStock: undefined },
  ],
  sizes: [
    { _id: '66dddddddddddddddddddddd', size: 'M', countInStock: undefined },
    { _id: '66eeeeeeeeeeeeeeeeeeeeee', size: 'L', countInStock: undefined },
  ],
  price: 100,
  ...extra,
});

function rowsFor(manifest, choices) {
  return manifest.products[0].pairs.map((pair, index) => ({
    product_id: manifest.products[0].id,
    product_name: manifest.products[0].name,
    old_total: String(manifest.products[0].oldTotal),
    color: pair.color,
    size: pair.size,
    existing_color_stock: pair.existingColorStock === '' ? '' : String(pair.existingColorStock),
    existing_size_stock: pair.existingSizeStock === '' ? '' : String(pair.existingSizeStock),
    offer_YES_NO: choices[index][0],
    new_stock: String(choices[index][1]),
    row_id: pair.rowId,
  }));
}

test('exports ambiguous multi-color x multi-size product', () => {
  const out = B.createExport([p()], 'db');
  assert.equal(out.eligible, 1);
  assert.equal(out.manifest.products[0].pairs.length, 4);
});

test('YES rows become exact matrix; NO rows disappear', () => {
  const product = p();
  const out = B.createExport([product], 'db');
  const rows = rowsFor(out.manifest, [['YES',1],['NO',0],['YES',1],['NO',0]]);
  const result = B.preview(out.manifest, rows, [product]);
  assert.equal(result.selected, 1);
  assert.equal(result.invalid, 0);
  assert.equal(result.selectedProducts[0].variantStocks.length, 2);
  assert.equal(result.totalAfter, 2);
});

test('NO with positive stock is rejected', () => {
  const product = p();
  const out = B.createExport([product], 'db');
  const rows = rowsFor(out.manifest, [['YES',1],['NO',1],['YES',1],['NO',0]]);
  const result = B.preview(out.manifest, rows, [product], { allowTotalChanges: true });
  assert.equal(result.invalid, 1);
  assert.equal(result.planSha, '');
});

test('aggregate total changes require explicit opt-in', () => {
  const product = p();
  const out = B.createExport([product], 'db');
  const rows = rowsFor(out.manifest, [['YES',2],['YES',2],['NO',0],['NO',0]]);
  const blocked = B.preview(out.manifest, rows, [product]);
  assert.equal(blocked.invalid, 1);
  const allowed = B.preview(out.manifest, rows, [product], { allowTotalChanges: true });
  assert.equal(allowed.invalid, 0);
  assert.equal(allowed.totalDelta, 2);
});

test('partial product is never selected', () => {
  const product = p();
  const out = B.createExport([product], 'db');
  const rows = rowsFor(out.manifest, [['YES',1],['',0],['YES',1],['NO',0]]);
  const result = B.preview(out.manifest, rows, [product], { allowTotalChanges: true });
  assert.equal(result.selected, 0);
  assert.equal(result.partial, 1);
});
