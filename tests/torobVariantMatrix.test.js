'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const matrix = require('../services/variantMatrix');

const product = () => ({
  _id: 'p1',
  countInStock: 3,
  isOutOfStock: false,
  colors: [
    { _id: 'c1', name: 'مشکی', countInStock: 2 },
    { _id: 'c2', name: 'قرمز', countInStock: 1 },
  ],
  sizes: [
    { _id: 's1', size: 'M', countInStock: 2 },
    { _id: 's2', size: 'L', countInStock: 1 },
  ],
});

test('unreviewed multi-color x multi-size product is not invented for Torob', () => {
  const p = product();
  assert.equal(matrix.descriptorsForFeed(p).length, 0);
  assert.equal(matrix.allDescriptors(p).length, 4);
});

test('configured matrix exposes only real combinations including sold-out rows', () => {
  const p = product();
  p.variantInventoryConfigured = true;
  p.variantStocks = [
    { colorId: 'c1', sizeId: 's1', countInStock: 2 },
    { colorId: 'c2', sizeId: 's2', countInStock: 0 },
  ];
  const rows = matrix.descriptorsForFeed(p);
  assert.equal(rows.length, 2);
  assert.equal(matrix.availableQuantity(p, p.colors[0], p.sizes[0]), 2);
  assert.equal(matrix.availableQuantity(p, p.colors[1], p.sizes[1]), 0);
  assert.equal(matrix.availableQuantity(p, p.colors[0], p.sizes[1]), 0);
});

test('row normalization rejects fake and duplicate combinations', () => {
  const p = product();
  assert.throws(() => matrix.normalizeRows(p, [{ colorId: 'fake', sizeId: 's1', countInStock: 1 }]));
  assert.throws(() => matrix.normalizeRows(p, [
    { colorId: 'c1', sizeId: 's1', countInStock: 1 },
    { colorId: 'c1', sizeId: 's1', countInStock: 1 },
  ]));
});

test('single-axis legacy product remains feedable until explicitly configured', () => {
  const p = product();
  p.colors = [p.colors[0]];
  assert.equal(matrix.descriptorsForFeed(p).length, 2);
});

test('matrix aggregate equals sum of exact rows', () => {
  assert.equal(matrix.totalMatrixStock([{countInStock: 2}, {countInStock: 0}, {countInStock: 5}]), 7);
});


test('manual unavailable flag blocks selling without erasing physical stock', () => {
  const p = product();
  p.variantInventoryConfigured = true;
  p.variantStocks = [
    { colorId: 'c1', sizeId: 's1', countInStock: 4, isOutOfStock: true },
    { colorId: 'c2', sizeId: 's2', countInStock: 3, isOutOfStock: false },
  ];
  assert.equal(matrix.totalMatrixStock(p), 7);
  assert.equal(matrix.totalAvailableMatrixStock(p), 3);
  assert.equal(matrix.availableQuantity(p, p.colors[0], p.sizes[0]), 0);
  assert.equal(matrix.availableQuantity(p, p.colors[1], p.sizes[1]), 3);
});

test('row normalization keeps manual availability state', () => {
  const p = product();
  const rows = matrix.normalizeRows(p, [
    { colorId: 'c1', sizeId: 's1', countInStock: 2, isOutOfStock: true },
    { colorId: 'c2', sizeId: 's2', countInStock: 1, isOutOfStock: 'true' },
  ]);
  assert.equal(rows[0].isOutOfStock, true);
  assert.equal(rows[1].isOutOfStock, true);
});
