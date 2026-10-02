// Idempotent startup migrations. Safe to run on every boot.
const User = require("../models/User");
const Product = require("../models/Product");
const Banner = require("../models/Banner");

// Phone + OTP accounts have no email. The original schema created a plain
// unique index on `email`, which treats every missing email as `null` and
// would reject the second email-less account. Replace it with a partial
// unique index that only covers real email strings.
async function ensureUserEmailIndex() {
  const collection = User.collection;
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound") return; // fresh database
    throw error;
  }

  const current = indexes.find((index) => index.name === "email_1");
  if (current && !current.partialFilterExpression) {
    await collection.dropIndex("email_1");
    console.log("[migration] dropped legacy non-partial users.email_1 index");
  }

  await collection.createIndex(
    { email: 1 },
    { name: "email_1", unique: true, partialFilterExpression: { email: { $type: "string" } } }
  );
}

// Backfill Product.finalPrice for products saved before the field existed.
async function backfillFinalPrice() {
  const cursor = Product.find({ finalPrice: { $exists: false } })
    .select("price offerPrice")
    .lean()
    .cursor();
  let ops = [];
  let total = 0;
  for await (const product of cursor) {
    ops.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { finalPrice: Product.computeFinalPrice(product.price, product.offerPrice) } },
      },
    });
    if (ops.length === 500) {
      await Product.bulkWrite(ops, { ordered: false });
      total += ops.length;
      ops = [];
    }
  }
  if (ops.length) {
    await Product.bulkWrite(ops, { ordered: false });
    total += ops.length;
  }
  if (total) console.log(`[migration] backfilled finalPrice on ${total} products`);
}

// First run after the banner system shipped: recreate the storefront's
// promotional banners from images already on the site. Admins manage them
// from then on; nothing is inserted once any banner exists.
const img = (name) => ({ url: `/images/banners/${name}.webp`, filename: `${name}.webp` });
const editorial = (name) => ({ url: `/images/editorial/${name}-1100.webp`, filename: `${name}-1100.webp` });
const DEFAULT_BANNERS = [
  {
    placement: "home_hero", order: 1, theme: "cream",
    eyebrow: "عطر، آرایش و مراقبت", title: "هر رایحه، یک داستان",
    subtitle: "مجموعه‌ای از بهترین عطرها، محصولات آرایشی و مراقبتی؛ اصل، با ارسال سریع و تضمین اصالت.",
    ctaText: "شروع خرید", url: "/shop",
  },
  {
    placement: "home_promo", order: 1, theme: "dark",
    eyebrow: "Odour Perfume", title: "عطرهایی که امضای شما می‌شوند",
    subtitle: "از آمواج و کرید تا زرجوف؛ رایحه‌های ماندگار از برندهای معتبر جهانی.",
    ctaText: "مشاهده عطرها", url: "/category/ادکلن",
    image: img("promo-perfume"), mobileImage: img("promo-perfume-m"), imageAlt: "مجموعه عطرهای آمواج روی سنگ مرمر",
  },
  {
    placement: "home_collection", order: 1, theme: "olive",
    eyebrow: "کالکشن فصل", title: "رایحه‌های گرم پاییز و زمستان",
    subtitle: "نت‌های چوبی، عنبری و ادویه‌ای برای روزهای خنک؛ انتخاب‌شده برای ماندگاری بیشتر.",
    ctaText: "دیدن کالکشن", url: "/shop?season=پاییز",
    image: img("collection-amouage"), imageAlt: "بطری عطر آمواج",
  },
  { placement: "home_category", order: 1, title: "عطر و ادکلن", url: "/category/ادکلن", image: editorial("perfume"), imageAlt: "عطر و ادکلن" },
  { placement: "home_category", order: 2, title: "مراقبت پوست", url: "/category/مراقبت-پوستی", image: editorial("skin"), imageAlt: "محصولات مراقبت پوست" },
  { placement: "home_category", order: 3, title: "مراقبت مو", url: "/category/مراقبت-مو", image: editorial("hair"), imageAlt: "محصولات مراقبت مو" },
  { placement: "home_category", order: 4, title: "محصولات آرایشی", url: "/category/محصولات-آرایشی", image: editorial("beauty"), imageAlt: "محصولات آرایشی" },
  {
    placement: "home_editorial", order: 1, theme: "dark",
    eyebrow: "داستان اودر", title: "اصالت، پیش از هر چیز",
    subtitle: "هر محصول اودر مستقیم از تأمین‌کنندگان معتبر تهیه می‌شود و با ضمانت اصالت به دست شما می‌رسد.",
    ctaText: "درباره اودر", url: "/about-us",
    image: img("editorial-bottles"), mobileImage: img("editorial-bottles-m"), imageAlt: "بطری‌های عطر در نور ملایم",
  },
  {
    placement: "home_strip", order: 1, theme: "olive",
    title: "تخفیف‌های این هفته", subtitle: "عطرها و محصولات منتخب با قیمت ویژه، تا پایان موجودی.",
    ctaText: "مشاهده تخفیف‌ها", url: "/shop?discount=1",
  },
  {
    placement: "shop_top", order: 1, theme: "cream", categorySlug: "مراقبت-پوستی",
    eyebrow: "مراقبت پوست", title: "روتین روزانه پوست شما",
    subtitle: "سرم، ضدآفتاب و آبرسان از برندهای کره‌ای و اروپایی.",
    image: img("shop-skin"), mobileImage: img("shop-skin-m"), imageAlt: "محصولات مراقبت پوست",
  },
  {
    placement: "shop_top", order: 2, theme: "cream", categorySlug: "مراقبت-مو",
    eyebrow: "مراقبت مو", title: "موهای سالم و درخشان",
    subtitle: "ماسک، شامپو و ابزار حالت‌دهی برای هر نوع مو.",
    image: img("shop-hair"), mobileImage: img("shop-hair-m"), imageAlt: "محصولات مراقبت مو",
  },
  {
    placement: "shop_top", order: 3, theme: "cream", categorySlug: "",
    eyebrow: "پیشنهاد اودر", title: "زیبایی، با انتخاب دقیق",
    subtitle: "هر محصول با ضمانت اصالت و ارسال سریع.",
    ctaText: "تخفیف‌ها", url: "/shop?discount=1",
    image: img("shop-beauty"), mobileImage: img("shop-beauty-m"), imageAlt: "محصولات آرایشی",
  },
];

async function seedDefaultBanners() {
  if ((await Banner.estimatedDocumentCount()) > 0) return;
  await Banner.insertMany(DEFAULT_BANNERS);
  console.log(`[migration] created ${DEFAULT_BANNERS.length} default banners`);
}

// Ratings were removed from the storefront; drop the now-unused index.
async function dropRatingIndex() {
  const indexes = await Product.collection.indexes().catch(() => []);
  if (indexes.some((i) => i.name === "rating_-1")) {
    await Product.collection.dropIndex("rating_-1");
    console.log("[migration] dropped products.rating index");
  }
}

async function runStartupMigrations() {
  // Never block the site from starting because of a migration.
  await ensureUserEmailIndex().catch((error) => console.error("[migration] users.email index:", error.message));
  await backfillFinalPrice().catch((error) => console.error("[migration] finalPrice:", error.message));
  await seedDefaultBanners().catch((error) => console.error("[migration] banners:", error.message));
  await dropRatingIndex().catch((error) => console.error("[migration] rating index:", error.message));
}

module.exports = { runStartupMigrations };
