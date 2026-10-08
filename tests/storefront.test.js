const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFragranceProfile, fieldForKey } = require("../helper/fragranceProfile");
const { parseFilters, activeFilterChips } = require("../helper/catalog");
const {
  productPricing,
  isInStock,
  categoryIcon,
  categoryShortcuts,
  faPrice,
  icon,
} = require("../helper/viewHelpers");

test("کلیدهای مشخصات با املای مختلف به فیلد درست نگاشت می‌شوند", () => {
  assert.equal(fieldForKey("نت آغازین"), "top");
  assert.equal(fieldForKey("نت‌های آغازین"), "top");
  assert.equal(fieldForKey("نت های پایه"), "base");
  assert.equal(fieldForKey("پخش بو"), "sillage");
  assert.equal(fieldForKey("گروه بويايي"), "family"); // Arabic ye
  assert.equal(fieldForKey("کشور سازنده"), null);
});

test("شناسنامه رایحه از مشخصات ادمین ساخته می‌شود", () => {
  const profile = parseFragranceProfile([
    { key: "آکوردهای اصلی", value: "چوبی:100، ادویه‌ای گرم:۸۰، عنبری" },
    { key: "نت پایه", value: "وانیل، مشک" },
    { key: "زمان مصرف", value: "روز و شب" },
    { key: "فصل", value: "پاییز، زمستان" },
    { key: "ماندگاری", value: "۸ ساعت" },
    { key: "کشور سازنده", value: "فرانسه" },
  ]);
  assert.deepEqual(profile.accords.map((a) => [a.name, a.strength]), [["چوبی", 100], ["ادویه‌ای گرم", 80], ["عنبری", 76]]);
  assert.deepEqual(profile.notes.base, ["وانیل", "مشک"]);
  assert.deepEqual(profile.time, { day: true, night: true, label: "روز و شب" });
  assert.deepEqual(profile.seasons.filter((s) => s.active).map((s) => s.id), ["winter", "autumn"]);
  assert.equal(profile.longevity, "۸ ساعت");
  assert.deepEqual(profile.others, [{ key: "کشور سازنده", value: "فرانسه" }]);
  assert.equal(profile.hasFragranceData, true);
});

test("محصول بدون مشخصات عطر کارت رایحه ندارد", () => {
  const profile = parseFragranceProfile([{ key: "کشور سازنده", value: "کره" }]);
  assert.equal(profile.hasFragranceData, false);
});

test("پارامترهای فیلتر جدید و قدیمی هر دو پشتیبانی می‌شوند", () => {
  const legacy = parseFilters({ searchQuery: "کرم", discountOnly: "true", sortBy: "price-low", brands: ["دیفکتو"] });
  assert.equal(legacy.search, "کرم");
  assert.equal(legacy.discount, true);
  assert.equal(legacy.sort, "price-low");
  assert.deepEqual(legacy.brands, ["دیفکتو"]);

  const modern = parseFilters({ gender: "زنانه,یونیسکس", minPrice: "۱۰۰٬۰۰۰", page: "3", limit: "500", sort: "nope" });
  assert.deepEqual(modern.facets.gender, ["زنانه", "یونیسکس"]);
  assert.equal(modern.minPrice, 100000);
  assert.equal(modern.page, 3);
  assert.equal(modern.limit, 48); // capped
  assert.equal(modern.sort, "popular"); // unknown sort falls back
  assert.equal(activeFilterChips(modern).length, 3);
});

test("قیمت نهایی فقط با تخفیف واقعی تغییر می‌کند", () => {
  assert.deepEqual(productPricing({ price: 200000, offerPrice: 150000 }), { now: 150000, was: 200000, hasDiscount: true, percent: 25 });
  assert.deepEqual(productPricing({ price: 200000, offerPrice: 250000 }), { now: 200000, was: null, hasDiscount: false, percent: 0 });
  assert.equal(faPrice(1290000), "۱,۲۹۰,۰۰۰");
});

test("موجودی بر اساس تعداد واقعی سنجیده می‌شود", () => {
  assert.equal(isInStock({ countInStock: 2, isOutOfStock: true }), true); // stale flag after $inc restore
  assert.equal(isInStock({ countInStock: 0 }), false);
});

test("میانبر دسته‌ها زیرمجموعه‌های عطر را باز می‌کند و آیکون مناسب می‌گیرد", () => {
  const list = categoryShortcuts([
    { name: "ادکلن", children: [{ name: "ادکلن مردانه" }, { name: "ادکلن زنانه" }] },
    { name: "مراقبت پوستی", children: [{ name: "سرم" }] },
  ]);
  assert.deepEqual(list.map((c) => c.name), ["ادکلن مردانه", "ادکلن زنانه", "مراقبت پوستی"]);
  assert.equal(categoryIcon("ادکلن مردانه"), "cat-perfume-men");
  assert.equal(categoryIcon("لوازم برقی آرایشی"), "cat-device");
  assert.equal(categoryIcon("چیز دیگر"), "cat-default");
});

test("آیکون ورودی را escape می‌کند", () => {
  assert.ok(!icon('x"><script>').includes("<script>"));
});
