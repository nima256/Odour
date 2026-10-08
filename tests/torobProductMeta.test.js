
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE_VARIANT_ID, getVariantKey, parseVariantKey } = require('../helper/torobProductMeta');

test('Torob color x size variants get one unique combination key', () => {
  const a = getVariantKey({ colorId: 'c1', sizeId: 's1' });
  const b = getVariantKey({ colorId: 'c1', sizeId: 's2' });
  const c = getVariantKey({ colorId: 'c2', sizeId: 's1' });
  assert.equal(a, 'c1--size-s1');
  assert.equal(new Set([a, b, c]).size, 3);
});

test('Torob variant key round-trips color and size identity', () => {
  assert.deepEqual(parseVariantKey('c1--size-s2'), { variantKey: 'c1--size-s2', colorId: 'c1', sizeId: 's2' });
  assert.deepEqual(parseVariantKey('size-s2'), { variantKey: 'size-s2', colorId: '', sizeId: 's2' });
  assert.deepEqual(parseVariantKey('c1'), { variantKey: 'c1', colorId: 'c1', sizeId: '' });
  assert.deepEqual(parseVariantKey(''), { variantKey: BASE_VARIANT_ID, colorId: '', sizeId: '' });
});
