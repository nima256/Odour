const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeVariantValue,
  findColorVariant,
  findSizeVariant,
  getAvailableQuantity,
} = require('../services/variantStock');

test('اعداد فارسی و عربی در نام سایز برای تطبیق تنوع نرمال می‌شوند', () => {
  assert.equal(normalizeVariantValue(' ۴۲ '), '42');
  assert.equal(normalizeVariantValue('٤٢'), '42');
});

test('رنگ و سایز با شناسه یا نام پیدا می‌شوند', () => {
  const product = {
    colors: [{ _id: 'c1', name: 'مشکی', countInStock: 2, isOutOfStock: false }],
    sizes: [{ _id: 's1', size: '۴۲', countInStock: 1, isOutOfStock: false }],
  };
  assert.equal(findColorVariant(product, { selectedVariantId: 'c1' }).name, 'مشکی');
  assert.equal(findSizeVariant(product, { selectedSize: '42' })._id, 's1');
});

test('موجودی قابل خرید کمترین موجودی کلی و تنوع انتخابی است', () => {
  const product = { countInStock: 10, isOutOfStock: false };
  const color = { countInStock: 4, isOutOfStock: false };
  const size = { countInStock: 2, isOutOfStock: false };
  assert.equal(getAvailableQuantity(product, color, size), 2);
});

test('تنوعی که دستی ناموجود شده قابل خرید نیست حتی اگر عدد موجودی مثبت باشد', () => {
  const product = { countInStock: 10, isOutOfStock: false };
  const color = { countInStock: 4, isOutOfStock: true };
  assert.equal(getAvailableQuantity(product, color, null), 0);
});

test('اگر موجودی تنوع خالی باشد از موجودی کلی محصول استفاده می‌شود', () => {
  const product = { countInStock: 7, isOutOfStock: false };
  const color = { isOutOfStock: false };
  assert.equal(getAvailableQuantity(product, color, null), 7);
});
