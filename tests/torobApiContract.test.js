'use strict';

process.env.ODOUR_TOROB_EXACT_VARIANTS_ENABLED = 'true';
process.env.SITE_BASE_URL = 'https://www.odour.ir';
process.env.SITE_URL = 'https://www.odour.ir';

const test = require('node:test');
const assert = require('node:assert/strict');
const productModelPath = require.resolve('../models/Product');
const Product = {};
require.cache[productModelPath] = {
  id: productModelPath,
  filename: productModelPath,
  loaded: true,
  exports: Product,
};
const controller = require('../controllers/torobController');
const torob = controller._private;

const oid = (suffix) => `64b000000000000000000${suffix}`.slice(0, 24);
const product = {
  _id: oid('001'),
  name: 'عطر تست',
  englishName: 'Test Perfume',
  slug: 'test-perfume',
  oldSlugs: ['old-test-perfume'],
  isPublished: true,
  publishedAt: new Date('2026-01-01T10:00:00Z'),
  createdAt: new Date('2026-01-01T09:00:00Z'),
  updatedAt: new Date('2026-01-02T10:00:00Z'),
  price: 1000000,
  offerPrice: 900000,
  countInStock: 10,
  isOutOfStock: false,
  lilDescription: 'محصول تست ترب',
  specifications: [{ key: 'کشور', value: 'فرانسه' }],
  images: [{ url: '/uploads/test.webp' }],
  colors: [
    { _id: oid('101'), name: 'مشکی', image: { url: '/uploads/black.webp' } },
    { _id: oid('102'), name: 'سفید', image: { url: '/uploads/white.webp' } },
  ],
  sizes: [
    { _id: oid('201'), size: '50 میلی لیتر' },
    { _id: oid('202'), size: '100 میلی لیتر' },
  ],
  variantInventoryConfigured: true,
  variantStocks: [
    { colorId: oid('101'), sizeId: oid('201'), countInStock: 2, isOutOfStock: false },
    { colorId: oid('101'), sizeId: oid('202'), countInStock: 3, isOutOfStock: false },
    { colorId: oid('102'), sizeId: oid('201'), countInStock: 4, isOutOfStock: false },
    { colorId: oid('102'), sizeId: oid('202'), countInStock: 1, isOutOfStock: false },
  ],
};

const responseRecorder = () => {
  const state = { statusCode: 200, body: null };
  return {
    state,
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
  };
};

const queryResult = (value) => ({
  sort() { return this; },
  populate() { return this; },
  select() { return this; },
  lean() { return Promise.resolve(value); },
});

test('every color x size offer has distinct Torob identity and exact landing URL', () => {
  const variants = torob.getProductVariants(product);
  assert.equal(variants.length, 4);

  const items = variants.map((variant) => torob.formatProductForTorob(product, variant));
  assert.equal(new Set(items.map((item) => item.page_unique)).size, 4);
  assert.equal(new Set(items.map((item) => item.page_url)).size, 4);
  assert.deepEqual(new Set(items.map((item) => item.product_group_id)), new Set([String(product._id)]));

  for (const item of items) {
    assert.ok(item.spec['رنگ']);
    assert.ok(item.spec['سایز']);

    const byUnique = torob.parsePageUnique(item.page_unique);
    assert.ok(byUnique);
    const uniqueVariant = torob.findVariantByKey(product, byUnique.variantKey);
    assert.ok(uniqueVariant);
    assert.equal(torob.formatProductForTorob(product, uniqueVariant).page_unique, item.page_unique);

    const byUrl = torob.parseProductPageUrl(item.page_url);
    assert.ok(byUrl);
    const urlVariant = torob.resolveVariantRequest(product, byUrl);
    assert.ok(urlVariant);
    assert.equal(torob.formatProductForTorob(product, urlVariant).page_unique, item.page_unique);
  }
});

test('page_url lookup tolerates Torob tracking params and old Odour URL shape', () => {
  const variant = torob.getProductVariants(product)[0];
  const item = torob.formatProductForTorob(product, variant);

  const tracked = new URL(item.page_url);
  tracked.searchParams.set('utm_source', 'torob');
  tracked.searchParams.set('utm_medium', 'sync');
  const parsedTracked = torob.parseProductPageUrl(tracked.toString());
  const trackedVariant = torob.resolveVariantRequest(product, parsedTracked);
  assert.equal(trackedVariant.variantKey, variant.variantKey);

  const legacy = new URL(`/productDetails/${product.slug}`, 'https://www.odour.ir');
  legacy.searchParams.set('variant', variant.colorId);
  legacy.searchParams.set('size', variant.sizeId);
  const parsedLegacy = torob.parseProductPageUrl(legacy.toString());
  const legacyVariant = torob.resolveVariantRequest(product, parsedLegacy);
  assert.equal(legacyVariant.variantKey, variant.variantKey);
});

test('ambiguous parent URL never silently resolves to the first variation', () => {
  const bare = torob.parseProductPageUrl(`https://www.odour.ir/productDetails/${product.slug}`);
  assert.ok(bare);
  assert.equal(torob.resolveVariantRequest(product, bare), null);
});

test('Torob v3 request modes accept both single-product lookups and official cursor mode', () => {
  assert.equal(torob.validateRequestMode({ page_urls: ['https://www.odour.ir/productDetails/x'] }).mode, 'urls');
  assert.equal(torob.validateRequestMode({ page_uniques: ['abc'] }).mode, 'uniques');
  assert.equal(torob.validateRequestMode({ page: 1, sort: 'date_added_desc' }).mode, 'pagination');
  assert.equal(torob.validateRequestMode({ sort: 'product_id_desc' }).mode, 'cursor');
  assert.equal(torob.validateRequestMode({ cursor: 'abc', sort: 'product_id_desc' }).mode, 'cursor');
  assert.ok(torob.validateRequestMode({ page_urls: Array(101).fill('https://www.odour.ir/productDetails/x') }).error);
});

test('POST page_uniques returns exactly the requested variation', async () => {
  const variant = torob.getProductVariants(product)[2];
  const item = torob.formatProductForTorob(product, variant);
  const originalFind = Product.find;
  Product.find = () => queryResult([product]);
  try {
    const res = responseRecorder();
    await controller.torobApiV3({ body: { page_uniques: [item.page_unique] } }, res);
    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.total, 1);
    assert.equal(res.state.body.products.length, 1);
    assert.equal(res.state.body.products[0].page_unique, item.page_unique);
    assert.equal(res.state.body.products[0].page_url, item.page_url);
  } finally {
    Product.find = originalFind;
  }
});

test('POST page_urls returns exactly the requested variation', async () => {
  const variant = torob.getProductVariants(product)[3];
  const item = torob.formatProductForTorob(product, variant);
  const originalFindOne = Product.findOne;
  Product.findOne = () => queryResult(product);
  try {
    const res = responseRecorder();
    const tracked = new URL(item.page_url);
    tracked.searchParams.set('utm_source', 'torob');
    await controller.torobApiV3({ body: { page_urls: [tracked.toString()] } }, res);
    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.total, 1);
    assert.equal(res.state.body.products.length, 1);
    assert.equal(res.state.body.products[0].page_unique, item.page_unique);
    assert.equal(res.state.body.products[0].page_url, item.page_url);
  } finally {
    Product.findOne = originalFindOne;
  }
});
