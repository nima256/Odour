const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFragranceProfile } = require("../helper/fragranceProfile");
const { productBadge, isLowStock } = require("../helper/viewHelpers");
const { normalizeProductExtras } = require("../helper/productExtras");
const Banner = require("../models/Banner");

test("کارت محصول حداکثر یک برچسب معنادار دارد", () => {
  assert.equal(productBadge({ price: 100 }), null);
  assert.equal(productBadge({ price: 100, isNewProduct: true }).kind, "new");
  const sale = productBadge({ price: 200, offerPrice: 150, isNewProduct: true });
  assert.equal(sale.kind, "sale");
  // A manual badge chosen in the admin wins over the automatic sale/new badge.
  assert.equal(productBadge({ price: 200, offerPrice: 150, badge: "exclusive" }).kind, "exclusive");
  assert.equal(productBadge({ price: 100, badge: "unknown" }), null);
});

test("هشدار موجودی از حد تعیین‌شده برای هر محصول پیروی می‌کند", () => {
  assert.equal(isLowStock({ countInStock: 3 }), true);
  assert.equal(isLowStock({ countInStock: 4 }), false);
  assert.equal(isLowStock({ countInStock: 8, lowStockThreshold: 10 }), true);
  assert.equal(isLowStock({ countInStock: 0, lowStockThreshold: 10 }), false);
});

test("داده ساختاریافته رایحه بر ردیف‌های مشخصات اولویت دارد", () => {
  const profile = parseFragranceProfile(
    [
      { key: "نت پایه", value: "وانیل" },
      { key: "ماندگاری", value: "۴ ساعت" },
      { key: "کشور سازنده", value: "فرانسه" },
    ],
    {
      base: ["عود", "عنبر"],
      longevity: "۱۲ ساعت",
      accords: [{ name: "چوبی", strength: 100 }, { name: "ادویه‌ای" }],
      seasons: ["پاییز"],
      dayNight: ["شب"],
      story: "داستان",
      identityImage: { url: "/uploads/x.webp" },
    }
  );
  assert.deepEqual(profile.notes.base, ["عود", "عنبر"]);
  assert.equal(profile.longevity, "۱۲ ساعت");
  assert.equal(profile.accords[0].strength, 100);
  assert.ok(profile.accords[1].strength > 0);
  assert.ok(profile.seasons.find((s) => s.label === "پاییز").active);
  assert.equal(profile.time.night, true);
  assert.equal(profile.time.day, false);
  assert.equal(profile.story, "داستان");
  assert.equal(profile.identityImage, "/uploads/x.webp");
  assert.equal(profile.others[0].key, "کشور سازنده");
  assert.equal(profile.hasFragranceData, true);
});

test("فیلدهای جدید ویرایشگر محصول پاک‌سازی می‌شوند", () => {
  const body = normalizeProductExtras({
    rating: 5,
    sku: "  AB-1  ",
    lowStockThreshold: "-4",
    badge: "hacker",
    sortPriority: "12.7",
    fragrance: {
      top: "ترنج، فلفل صورتی,ترنج",
      accords: "چوبی:100، گلی:250",
      seasons: ["پاییز", "ماه"],
      dayNight: ["شب", "ظهر"],
      identityImage: { url: "javascript:alert(1)" },
      extra: "ignored",
    },
  });
  assert.equal(body.rating, undefined);
  assert.equal(body.sku, "AB-1");
  assert.equal(body.lowStockThreshold, 0);
  assert.equal(body.badge, "");
  assert.equal(body.sortPriority, 13);
  assert.deepEqual(body.fragrance.top, ["ترنج", "فلفل صورتی"]);
  assert.deepEqual(body.fragrance.accords, [{ name: "چوبی", strength: 100 }, { name: "گلی", strength: 100 }]);
  assert.deepEqual(body.fragrance.seasons, ["پاییز"]);
  assert.deepEqual(body.fragrance.dayNight, ["شب"]);
  assert.equal(body.fragrance.identityImage, undefined);
  assert.equal(body.fragrance.extra, undefined);
});

test("لینک بنر فقط مسیر داخلی یا http(s) می‌پذیرد", () => {
  const check = (url) => new Banner({ placement: "home_promo", title: "t", url }).validateSync();
  assert.equal(check("/shop?discount=1"), undefined);
  assert.equal(check("https://example.com"), undefined);
  assert.ok(check("//evil.example"));
  assert.ok(check("javascript:alert(1)"));
  assert.ok(new Banner({ placement: "nowhere", title: "t" }).validateSync());
});
