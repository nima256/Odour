#!/usr/bin/env node
/*
 * DEVELOPMENT ONLY — fills a local database with a realistic perfume catalogue
 * (structured fragrance data, badges, stock levels) so the storefront and admin
 * can be designed and tested with believable content.
 *
 *   DB_URL=mongodb://127.0.0.1:27017/odour node scripts/seed-sample-catalog.js
 *   DB_URL=mongodb://127.0.0.1:27017/odour node scripts/seed-sample-catalog.js --remove
 *
 * Safety:
 *  - refuses to run when NODE_ENV=production;
 *  - refuses non-local database hosts unless SEED_ALLOW_REMOTE=1 is set
 *    (e.g. a docker-compose "mongo" service) — never point it at production;
 *  - every product it creates carries an "SMP-" SKU; --remove deletes only those.
 *  - existing products are never modified.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");

const DB_URL = process.env.DB_URL || "mongodb://127.0.0.1:27017/odour";
const SKU_PREFIX = "SMP-";
const UPLOADS = path.join(__dirname, "..", "public", "uploads", "products");

function assertSafeTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed sample data with NODE_ENV=production.");
  }
  let host = "";
  try {
    host = new URL(DB_URL.replace(/^mongodb(\+srv)?:\/\//, "http://")).hostname;
  } catch (_) {
    throw new Error("DB_URL is not a valid MongoDB connection string.");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to seed non-local database host "${host}". Set SEED_ALLOW_REMOTE=1 only for a disposable dev database.`);
  }
  if (/\+srv/.test(DB_URL) || /prod/i.test(DB_URL)) {
    throw new Error("DB_URL looks like a hosted/production database. Sample data is for local development only.");
  }
  return host;
}

// Images that already ship with the repository (public/uploads/products/<dir>).
function imagesFor(dirSuffix) {
  if (!fs.existsSync(UPLOADS)) return [];
  const dir = fs.readdirSync(UPLOADS).find((d) => d.endsWith(dirSuffix));
  if (!dir) return [];
  return fs
    .readdirSync(path.join(UPLOADS, dir))
    .filter((f) => /\.(webp|jpe?g|png)$/i.test(f))
    .sort()
    .slice(0, 4)
    .map((f) => ({ url: `/uploads/products/${dir}/${f}`, filename: f }));
}

const USAGE_EDP = "از فاصله‌ی ۱۵ سانتی‌متری روی نقاط نبض (مچ، پشت گوش و گردن) اسپری کنید. برای ماندگاری بیشتر پوست را پیش از استفاده مرطوب کنید و پس از اسپری، مچ‌ها را به هم نمالید.";
const INGREDIENTS_EDP = "Alcohol Denat., Parfum (Fragrance), Aqua (Water), Limonene, Linalool, Coumarin, Citral, Geraniol";

const SAMPLES = [
  {
    dir: "آمواج_مدل_Dia_40", name: "ادکلن زنانه آمواج مدل Dia 40", englishName: "Amouage Dia 40", brand: ["آمواج", "Amouage"], gender: "women",
    price: 18900000, offerPrice: 0, stock: 6, badge: "exclusive", collectionName: "کالکشن کلاسیک", sortPriority: 90,
    lil: "رایحه‌ای پودری و درخشان از آلدهید، هلو و زنبق؛ ظریف و ماندگار.",
    fragrance: {
      family: "گلی پودری", concentration: "ادو پرفیوم", gender: "زنانه", volume: "۱۰۰ میلی‌لیتر",
      top: ["آلدهید", "هلو", "گل محمدی"], heart: ["زنبق", "رز", "گل صدتومانی"], base: ["مشک", "صندل", "کندر"],
      accords: [{ name: "پودری", strength: 100 }, { name: "گلی", strength: 88 }, { name: "میوه‌ای", strength: 62 }, { name: "مشکی", strength: 55 }, { name: "چوبی", strength: 40 }],
      longevity: "۸ تا ۱۰ ساعت", sillage: "متوسط", seasons: ["بهار", "پاییز"], dayNight: ["روز"], occasions: ["محل کار", "مهمانی روزانه"],
      story: "دیا یعنی «روز»؛ رایحه‌ای برای ساعت‌های روشن. آغاز درخشان آلدهیدی آن آرام‌آرام به قلبی پودری از زنبق و رز می‌رسد و روی پوست ردّی نرم و تمیز از مشک باقی می‌گذارد.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "آمواج_مدل_Jubilation_40", name: "ادکلن مردانه آمواج مدل Jubilation 40", englishName: "Amouage Jubilation 40", brand: ["آمواج", "Amouage"], gender: "men",
    price: 21500000, offerPrice: 0, stock: 4, badge: "exclusive", collectionName: "کالکشن کلاسیک", sortPriority: 95,
    lil: "عود، کندر و عسل در ترکیبی شرقی و باشکوه؛ امضای لوکس آمواج.",
    fragrance: {
      family: "چوبی شرقی", concentration: "پرفیوم", gender: "مردانه", volume: "۱۰۰ میلی‌لیتر",
      top: ["تمشک سیاه", "گشنیز", "پرتقال"], heart: ["کندر", "عسل", "رز"], base: ["عود", "عنبر", "لادن", "مُر"],
      accords: [{ name: "چوبی", strength: 100 }, { name: "بخوری", strength: 90 }, { name: "عنبری", strength: 78 }, { name: "شیرین", strength: 58 }, { name: "ادویه‌ای", strength: 46 }],
      longevity: "بیش از ۱۲ ساعت", sillage: "قوی", seasons: ["پاییز", "زمستان"], dayNight: ["شب"], occasions: ["مراسم رسمی", "شب‌های زمستان"],
      story: "جشنی از مواد اولیه‌ی عمان: کندر و مُر در کنار عود و عسل. جوبیلیشن ۴۰ رایحه‌ای پرحجم و گرم است که آرام باز می‌شود و تا پایان شب همراه شما می‌ماند.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "آمواج_مدل_Guidance_46", name: "ادکلن آمواج مدل Guidance 46", englishName: "Amouage Guidance 46", brand: ["آمواج", "Amouage"], gender: "unisex",
    price: 23800000, offerPrice: 21900000, stock: 3, badge: "", collectionName: "کالکشن اکستریت", sortPriority: 80,
    lil: "گلابی، فندق و اسمانتوس روی بستری از صندل و وانیل.",
    fragrance: {
      family: "عنبری گلی", concentration: "اکستریت د پرفیوم", gender: "یونیسکس", volume: "۱۰۰ میلی‌لیتر",
      top: ["گلابی", "فندق", "کندر"], heart: ["اسمانتوس", "رز", "یاس"], base: ["صندل", "وانیل", "عنبر"],
      accords: [{ name: "عنبری", strength: 100 }, { name: "گلی", strength: 82 }, { name: "آجیلی", strength: 66 }, { name: "وانیلی", strength: 60 }, { name: "میوه‌ای", strength: 44 }],
      longevity: "بیش از ۱۲ ساعت", sillage: "قوی", seasons: ["پاییز", "زمستان"], dayNight: ["روز", "شب"], occasions: ["مهمانی", "قرار عاشقانه"],
      story: "گایدنس با شیرینی کرم‌مانند گلابی و فندق آغاز می‌شود و در قلب، گل‌های اسمانتوس و رز را با درخشش کندر همراه می‌کند؛ رایحه‌ای مخملی و امن برای هر دو جنس.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "کرید_مدل_Aventus_for_Her", name: "ادکلن زنانه کرید مدل Aventus for Her", englishName: "Creed Aventus for Her", brand: ["کرید", "Creed"], gender: "women",
    price: 16400000, offerPrice: 14800000, stock: 9, badge: "bestseller", collectionName: "", sortPriority: 85,
    lil: "سیب سبز و ترنج با قلبی از رز؛ تازه، جسور و شیک.",
    fragrance: {
      family: "شیپر میوه‌ای", concentration: "ادو پرفیوم", gender: "زنانه", volume: "۷۵ میلی‌لیتر",
      top: ["سیب سبز", "لیمو", "ترنج", "فلفل صورتی"], heart: ["رز", "صندل", "استیراکس"], base: ["مشک", "هلو", "پچولی"],
      accords: [{ name: "میوه‌ای", strength: 100 }, { name: "مرکباتی", strength: 80 }, { name: "گلی", strength: 72 }, { name: "تازه", strength: 60 }, { name: "چوبی", strength: 42 }],
      longevity: "۶ تا ۸ ساعت", sillage: "متوسط تا قوی", seasons: ["بهار", "تابستان"], dayNight: ["روز"], occasions: ["محل کار", "روزمره"],
      story: "نسخه‌ی زنانه‌ی اونتوس، شخصیتی مستقل دارد: آغازی ترد از سیب سبز و ترنج، قلبی گلی و پایه‌ای از مشک و پچولی که حس اعتمادبه‌نفس را تا عصر حفظ می‌کند.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "کرید_مدل_Acqua_Fiorentina", name: "ادکلن زنانه کرید مدل Acqua Fiorentina", englishName: "Creed Acqua Fiorentina", brand: ["کرید", "Creed"], gender: "women",
    price: 15200000, offerPrice: 0, stock: 0, badge: "", collectionName: "", sortPriority: 20,
    lil: "رایحه‌ای گلی و میوه‌ای الهام‌گرفته از باغ‌های فلورانس.",
    fragrance: {
      family: "گلی میوه‌ای", concentration: "ادو پرفیوم", gender: "زنانه", volume: "۷۵ میلی‌لیتر",
      top: ["ترنج", "انگور فرنگی سیاه"], heart: ["بنفشه", "میخک", "یاس بنفش"], base: ["مشک", "چوب توس"],
      accords: [{ name: "گلی", strength: 100 }, { name: "میوه‌ای", strength: 76 }, { name: "پودری", strength: 54 }, { name: "مشکی", strength: 48 }],
      longevity: "۵ تا ۷ ساعت", sillage: "ملایم", seasons: ["بهار"], dayNight: ["روز"], occasions: ["روزمره"],
      story: "ادای احترامی به فلورانس در بهار؛ گل‌های بنفش و میوه‌های تیره روی پوستی گرم.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "زرجوف_مدل_Erba_Gold", name: "ادکلن زرجوف مدل Erba Gold", englishName: "Xerjoff Erba Gold", brand: ["زرجوف", "Xerjoff"], gender: "unisex",
    price: 19600000, offerPrice: 0, stock: 5, badge: "new", collectionName: "", sortPriority: 70,
    lil: "زنجبیل، ملون و گلابی؛ تازه و آفتابی با پایه‌ای عنبری.",
    fragrance: {
      family: "میوه‌ای آروماتیک", concentration: "ادو پرفیوم", gender: "یونیسکس", volume: "۱۰۰ میلی‌لیتر",
      top: ["زنجبیل", "لیمو", "ترنج"], heart: ["ملون", "گلابی", "دارچین"], base: ["مشک", "عنبر", "وانیل"],
      accords: [{ name: "میوه‌ای", strength: 100 }, { name: "مرکباتی", strength: 78 }, { name: "ادویه‌ای", strength: 60 }, { name: "عنبری", strength: 52 }, { name: "شیرین", strength: 44 }],
      longevity: "۷ تا ۹ ساعت", sillage: "متوسط", seasons: ["بهار", "تابستان"], dayNight: ["روز"], occasions: ["سفر", "روزمره"],
      story: "اربا گلد طلای آفتاب مدیترانه است: تندی شاد زنجبیل، آب‌داری ملون و گلابی و ردّی گرم از عنبر که حال‌وهوای تابستان را تا شب نگه می‌دارد.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "زرجوف_مدل_Uden_Overdose", name: "ادکلن زرجوف مدل Uden Overdose", englishName: "Xerjoff Uden Overdose", brand: ["زرجوف", "Xerjoff"], gender: "unisex",
    price: 24500000, offerPrice: 0, stock: 2, badge: "limited", collectionName: "کالکشن محدود", sortPriority: 88,
    lil: "تنباکو، عسل و تونکا؛ رایحه‌ای گرم و اعتیادآور برای شب.",
    fragrance: {
      family: "عنبری تنباکویی", concentration: "اکستریت د پرفیوم", gender: "یونیسکس", volume: "۵۰ میلی‌لیتر",
      top: ["ترنج", "زعفران"], heart: ["تنباکو", "عسل"], base: ["لوبیای تونکا", "عنبر", "وانیل"],
      accords: [{ name: "تنباکویی", strength: 100 }, { name: "عنبری", strength: 86 }, { name: "شیرین", strength: 72 }, { name: "وانیلی", strength: 60 }, { name: "ادویه‌ای", strength: 38 }],
      longevity: "بیش از ۱۲ ساعت", sillage: "قوی", seasons: ["پاییز", "زمستان"], dayNight: ["شب"], occasions: ["مهمانی شب", "مراسم"],
      story: "اودن اوردوز تیراژ محدودی دارد و برای دوستداران رایحه‌های گرم ساخته شده: برگ تنباکوی خشک‌شده با عسل و تونکا، با درخششی از زعفران.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "ایو_سن_لورن_مدل_Libre_Intense", name: "ادکلن زنانه ایو سن لورن مدل Libre Intense", englishName: "YSL Libre Intense", brand: ["ایو سن لورن", "Yves Saint Laurent"], gender: "women",
    price: 12900000, offerPrice: 11400000, stock: 12, badge: "bestseller", collectionName: "", sortPriority: 75,
    lil: "اسطوخودوس و بهارنارنج در کنار وانیل و عنبر؛ آزاد و پرحرارت.",
    fragrance: {
      family: "عنبری فوژه", concentration: "ادو پرفیوم اینتنس", gender: "زنانه", volume: "۹۰ میلی‌لیتر",
      top: ["اسطوخودوس", "ماندارین", "ترنج"], heart: ["بهارنارنج", "ارکیده", "یاس"], base: ["وانیل", "لوبیای تونکا", "عنبر"],
      accords: [{ name: "وانیلی", strength: 100 }, { name: "آروماتیک", strength: 84 }, { name: "گلی سفید", strength: 70 }, { name: "عنبری", strength: 62 }, { name: "مرکباتی", strength: 40 }],
      longevity: "۸ تا ۱۰ ساعت", sillage: "قوی", seasons: ["پاییز", "زمستان"], dayNight: ["شب"], occasions: ["مهمانی", "قرار عاشقانه"],
      story: "تقابل جسورانه‌ی اسطوخودوس فرانسوی و بهارنارنج مراکشی؛ لیبره اینتنس نسخه‌ی گرم‌تر و عمیق‌تر لیبره است با وانیل و عنبر در پایه.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "دلئون_مدل_Grey_Vetiver", name: "ادکلن مردانه دلئون مدل Grey Vetiver", englishName: "Delon Grey Vetiver", brand: ["دلئون", "Delon"], gender: "men",
    price: 2450000, offerPrice: 2190000, stock: 18, badge: "", collectionName: "", sortPriority: 40,
    lil: "وتیور، گریپ‌فروت و خزه‌ی بلوط؛ تمیز، رسمی و همه‌فصل.",
    fragrance: {
      family: "چوبی آروماتیک", concentration: "ادو پرفیوم", gender: "مردانه", volume: "۱۰۰ میلی‌لیتر",
      top: ["گریپ‌فروت", "بهارنارنج", "مریم‌گلی"], heart: ["وتیور", "جوز هندی", "زنبق"], base: ["خزه بلوط", "عنبر", "چوب"],
      accords: [{ name: "چوبی", strength: 100 }, { name: "خاکی", strength: 74 }, { name: "مرکباتی", strength: 66 }, { name: "آروماتیک", strength: 58 }],
      longevity: "۶ تا ۸ ساعت", sillage: "متوسط", seasons: ["بهار", "تابستان", "پاییز"], dayNight: ["روز"], occasions: ["محل کار", "جلسه رسمی"],
      story: "رایحه‌ای برای کت‌وشلوار و صبح‌های کاری: وتیور خشک و خاکی با تلخی تازه‌ی گریپ‌فروت و پایه‌ای مرتب از خزه‌ی بلوط.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "دلئون_مدل_Santal_Blanc", name: "ادکلن مردانه دلئون مدل Santal Blanc", englishName: "Delon Santal Blanc", brand: ["دلئون", "Delon"], gender: "men",
    price: 2390000, offerPrice: 0, stock: 2, badge: "", collectionName: "", sortPriority: 30,
    lil: "صندل سفید، انجیر و فلفل؛ نرم، کرمی و آرام.",
    fragrance: {
      family: "چوبی", concentration: "ادو پرفیوم", gender: "مردانه", volume: "۱۰۰ میلی‌لیتر",
      top: ["فلفل صورتی", "انجیر"], heart: ["صندل سفید", "یاس"], base: ["مشک", "شیر نارگیل"],
      accords: [{ name: "چوبی", strength: 100 }, { name: "کرمی", strength: 72 }, { name: "ادویه‌ای", strength: 48 }, { name: "مشکی", strength: 44 }],
      longevity: "۵ تا ۷ ساعت", sillage: "ملایم", seasons: ["پاییز", "بهار"], dayNight: ["روز", "شب"], occasions: ["روزمره"],
      story: "صندل سفید با شیرینی ملایم انجیر و گرمای فلفل؛ رایحه‌ای پوست‌مانند و آرام برای استفاده‌ی هرروزه.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "دلئون_مدل_Noble_Oud", name: "ادکلن مردانه دلئون مدل Noble Oud", englishName: "Delon Noble Oud", brand: ["دلئون", "Delon"], gender: "men",
    price: 2690000, offerPrice: 0, stock: 7, badge: "new", collectionName: "", sortPriority: 45,
    lil: "عود و زعفران با رز دمشقی؛ شرقی، باوقار و ماندگار.",
    fragrance: {
      family: "چوبی شرقی", concentration: "ادو پرفیوم", gender: "مردانه", volume: "۱۰۰ میلی‌لیتر",
      top: ["زعفران", "هل"], heart: ["رز دمشقی", "عود"], base: ["چرم", "عنبر", "پچولی"],
      accords: [{ name: "عودی", strength: 100 }, { name: "ادویه‌ای گرم", strength: 76 }, { name: "چرمی", strength: 62 }, { name: "گلی", strength: 48 }],
      longevity: "۸ تا ۱۰ ساعت", sillage: "قوی", seasons: ["پاییز", "زمستان"], dayNight: ["شب"], occasions: ["مهمانی", "مراسم رسمی"],
      story: "ترکیبی کلاسیک از سنت عطرسازی شرق: عود دودی و زعفران، با رز دمشقی که تندی آن را نرم می‌کند.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
  {
    dir: "لویس_وارل_مدل_My_Dream", name: "ادکلن زنانه لویس وارل مدل My Dream", englishName: "Louis Varel My Dream", brand: ["لویس وارل", "Louis Varel"], gender: "women",
    price: 1650000, offerPrice: 1390000, stock: 22, badge: "", collectionName: "", sortPriority: 35,
    lil: "رایحه‌ای گلی و شیرین با گلابی و یاس؛ لطیف و روزمره.",
    fragrance: {
      family: "گلی میوه‌ای", concentration: "ادو پرفیوم", gender: "زنانه", volume: "۱۰۰ میلی‌لیتر",
      top: ["گلابی", "توت قرمز"], heart: ["یاس", "گل صدتومانی"], base: ["وانیل", "مشک"],
      accords: [{ name: "گلی", strength: 100 }, { name: "میوه‌ای", strength: 80 }, { name: "شیرین", strength: 66 }, { name: "مشکی", strength: 40 }],
      longevity: "۵ تا ۶ ساعت", sillage: "متوسط", seasons: ["بهار", "تابستان"], dayNight: ["روز"], occasions: ["روزمره", "دانشگاه"],
      story: "رایحه‌ای سبک و خوش‌بو برای هر روز: آب‌داری گلابی و توت، قلبی از یاس و گل صدتومانی و ردّی نرم از وانیل.",
      usage: USAGE_EDP, ingredients: INGREDIENTS_EDP,
    },
  },
];

async function findOrCreateCategory(name, parentId = null) {
  const existing = await Category.findOne({ name, categoryType: "product" });
  if (existing) return existing;
  return Category.create({ categoryType: "product", name, slug: name.replace(/\s+/g, "-"), parentId });
}

async function findOrCreateBrand(name, englishName) {
  const existing = await Brand.findOne({ name });
  if (existing) return existing;
  return Brand.create({ name, englishName, slug: name.replace(/\s+/g, "-") });
}

async function seed() {
  const root = await findOrCreateCategory("ادکلن");
  const men = await findOrCreateCategory("ادکلن مردانه", root._id);
  const women = await findOrCreateCategory("ادکلن زنانه", root._id);
  const catFor = { men: [root, men], women: [root, women], unisex: [root, men, women] };

  let created = 0;
  let skipped = 0;
  for (const [i, s] of SAMPLES.entries()) {
    const sku = `${SKU_PREFIX}${String(i + 1).padStart(3, "0")}`;
    if (await Product.exists({ sku })) { skipped += 1; continue; }
    const images = imagesFor(s.dir);
    if (!images.length) { console.warn(`  - no images for ${s.englishName}, skipped`); skipped += 1; continue; }
    const brand = await findOrCreateBrand(s.brand[0], s.brand[1]);
    const cats = catFor[s.gender];
    const leaf = cats[cats.length - 1];
    await Product.create({
      name: s.name,
      englishName: s.englishName,
      slug: `${s.englishName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${sku.toLowerCase()}`,
      lilDescription: s.lil,
      description: `<p>${s.lil}</p><p>${s.englishName} با ضمانت اصالت کالا از اودر عرضه می‌شود. هر بطری پیش از ارسال از نظر پلمب، کد ردیابی و سلامت فیزیکی بررسی می‌شود.</p>`,
      images: images.map((img, k) => ({ ...img, alt: k ? `${s.name} - تصویر ${k + 1}` : s.name })),
      price: s.price,
      offerPrice: s.offerPrice || undefined,
      discount: s.offerPrice ? Math.round((1 - s.offerPrice / s.price) * 100) : 0,
      category: cats.map((c) => c._id),
      catName: root.name,
      subCat: leaf.name,
      brand: brand._id,
      brandName: brand.name,
      countInStock: s.stock,
      isOutOfStock: s.stock <= 0,
      isPublished: true,
      isPopular: s.sortPriority >= 80,
      isFeatured: Boolean(s.offerPrice),
      isNewProduct: s.badge === "new",
      sku,
      lowStockThreshold: 3,
      badge: s.badge,
      collectionName: s.collectionName,
      sortPriority: s.sortPriority,
      fragrance: s.fragrance,
      specifications: [
        { key: "حجم", value: s.fragrance.volume },
        { key: "غلظت", value: s.fragrance.concentration },
        { key: "کشور سازنده", value: s.brand[1] === "Amouage" ? "عمان" : s.brand[1] === "Xerjoff" ? "ایتالیا" : s.brand[1] === "Creed" || s.brand[1] === "Yves Saint Laurent" ? "فرانسه" : "امارات" },
      ],
    });
    created += 1;
  }
  console.log(`Sample catalogue: ${created} created, ${skipped} skipped (already present or missing images).`);
}

async function remove() {
  const { deletedCount } = await Product.deleteMany({ sku: { $regex: `^${SKU_PREFIX}` } });
  console.log(`Removed ${deletedCount} sample products.`);
}

(async () => {
  try {
    const host = assertSafeTarget();
    await mongoose.connect(DB_URL);
    console.log(`Connected to local database on ${host}.`);
    if (process.argv.includes("--remove")) await remove();
    else await seed();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
})();
