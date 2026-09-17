const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const flash = require("connect-flash"); 
const fs = require("fs");
const { SitemapStream, streamToPromise } = require("sitemap");
const { createGzip } = require("zlib");
const Visit = require("./models/Visit");
const crypto = require("crypto"); 
const compression = require('compression');
 
function getPersianDate(date = new Date()) {
  const year = date.toLocaleDateString('fa-IR', { year: 'numeric' });
  const month = date.toLocaleDateString('fa-IR', { month: 'numeric' });
  const day = date.toLocaleDateString('fa-IR', { day: 'numeric' });
  return `${year}-${month}-${day}`;
}

require("dotenv").config();

// Set view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Public folder for css js font and etc.
app.use(express.static(path.join(__dirname, 'public/'), {
  maxAge: '30d',
  immutable: true
}));

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
  maxAge: '7d',  // 7 روز برای آپلودها
  immutable: true
}));

app.use(compression({
  level: 6, 
  threshold: 1024,
  filter: (req, res) => {
    if (req.path.match(/\.(css|js|html|svg|json|xml)$/)) {
      return true;
    }
    return compression.filter(req, res);
  }
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.raw({ limit: "50mb" }));

process.env.BSON_BUFFER_SIZE = 1024 * 1024 * 50; // 50MB

// Models
const Product = require("./models/Product");
const Category = require("./models/Category");
const Brand = require("./models/Brand");
const Weblog = require("./models/Weblog");
const User = require("./models/User");

// For production
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,
      ttl: 24 * 60 * 60, // 24 ساعت
      autoRemove: 'native'
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // فقط HTTPS در production
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 ساعت
    },
    name: 'sessionId' // نام کوکی
  })
);

app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});


// Basic Setup
// app.use(
//   session({
//     secret: "randomguys",
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//       httpOnly: true,
//       secure: false,
//       maxAge: 1000 * 60 * 60 * 1,
//     },
//   })
// );

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdn.tailwindcss.com",
          "https://cdn.quilljs.com",
          "https://cdn.jsdelivr.net",
          "https://unpkg.com",
          "https://cdnjs.cloudflare.com",
          "https://trustseal.enamad.ir",
          "https://www.zarinpal.com",
          "https://sandbox.zarinpal.com",
          "https://payment.zarinpal.com",
          "https://*.enamad.ir",  // اضافه کن
          "https://enamad.ir"      // اضافه کن
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.tailwindcss.com",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
          "https://cdn.quilljs.com",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
          "https://trustseal.enamad.ir",
          "https://*.enamad.ir",
          "https://fonts.googleapis.com/css2"  // اضافه کن
        ],
        fontSrc: [
          "'self'",
          "data:",
          "https://cdnjs.cloudflare.com",
          "https://fonts.gstatic.com",
          "https://unpkg.com",
          "https://fonts.googleapis.com"  // اضافه کن
        ],
        connectSrc: [
          "'self'",
          "https://www.zarinpal.com",
          "https://sandbox.zarinpal.com",
          "https://payment.zarinpal.com",
          "https://api.odour.ir",
          "https://trustseal.enamad.ir",
          process.env.SITE_URL,
        ],
        imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
        frameSrc: ["https://www.zarinpal.com", "https://trustseal.enamad.ir"],
        formAction: ["'self'", "https://www.zarinpal.com"],
        scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      },
    },
  })
);

app.enable('trust proxy');

app.use((req, res, next) => {
  const host = req.get('host');

  if (host === 'odour.ir') {
    return res.redirect(301, `https://www.odour.ir${req.originalUrl}`);
  }

  next();
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(async (req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/admin") &&
    !req.path.startsWith("/api") &&
    !req.path.includes(".") &&
    req.path !== "/favicon.ico"
  ) {
    try {
      const visitorId = crypto
        .createHash("md5")
        .update(`${req.ip}-${req.headers["user-agent"] || "unknown"}`)
        .digest("hex");

      // بررسی آخرین بازدید کاربر از این صفحه (در 5 دقیقه اخیر)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const lastVisit = await Visit.findOne({
        path: req.path,
        visitorId: visitorId,
        visitTimestamp: { $gte: fiveMinutesAgo }
      });

      // اگر در 5 دقیقه اخیر بازدیدی نداشته، ثبت کن
      if (!lastVisit) {
        await Visit.create({
          path: req.path,
          title: req.originalUrl || req.path,
          visitorId: visitorId,
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "",
          referer: req.headers["referer"] || "",
          visitDate: getPersianDate(),
          visitTimestamp: new Date(),
        });
      }
    } catch (error) {
      console.error("Visit tracking error:", error.message);
    }
  }
  next();
});


app.use(flash());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later",
});

const initDirectories = () => {
  const dirs = ["public/uploads", "public/uploads/temp"];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

initDirectories();

// Routes
const authenticationRoutes = require("./routes/authentication");
const mobileRoutes = require("./routes/mobile");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/order");
const adminRoutes = require("./routes/admin");
const weblogRoutes = require('./routes/weblog');
const torobRoutes = require("./routes/torobRoutes");
const { getProductVariants, buildPageUrl } = require("./controllers/torobController")._private;
const { isLoggedIn } = require("./middlewares/isLoggedIn");

// app.use("/api/", apiLimiter);
app.use("/api/authentication", authenticationRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/order", orderRoutes);
app.use('/', torobRoutes);
app.use("/admin", adminRoutes);
app.use('/', weblogRoutes);

app.locals.toPersianDigitsForSizes = function (input) {
  if (input === undefined || input === null) return "";
  return input.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
};

app.locals.toPersianDigits = function (num) {
  if (num === null || num === undefined || isNaN(num)) return "";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const withCommas = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return withCommas.replace(/\d/g, (digit) => persianDigits[digit]);
};

app.use(async (req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.ICON = req.session.icon;
  res.locals.TEXT = req.session.text;
  next();
});

function generateOrderNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000); // random 6-digit number from 100000 to 999999
  return `ORD-${randomNum}`;
}

async function getAllCategoryIds(parentId) {
  let ids = [parentId];
  const children = await Category.find({ parentId, isActive: true });
  
  for (const child of children) {
    const childIds = await getAllCategoryIds(child._id);
    ids = [...ids, ...childIds];
  }
  
  return ids;
}

app.use(async (req, res, next) => {
  // گرفتن 5 دسته‌بندی اصلی برای فوتر
  const footerCategories = await Category.find({ 
    categoryType: "product",
    parentId: null,  // فقط دسته‌بندی‌های اصلی
    isActive: true 
  })
  .limit(5)  // فقط 5 تا
  .sort({ name: 1 });  // مرتب بر اساس نام
  
  res.locals.footerCategories = footerCategories;
  next();
});


app.get("/", async (req, res) => {
  try {
    // ====== 1. دسته‌بندی‌های اصلی برای منوی نوبار (با ساختار درختی) ======
    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });
    
    // ====== 2. دسته‌بندی‌های اصلی با تعداد محصولات (برای اسلایدر هوم پیج) ======
    const parentCategories = await Category.find({ 
      categoryType: "product",
      parentId: null,
      isActive: true 
    });
    
    const products = await Product.find({ isPopular: true })
      .sort({ createdAt: -1 })
      .limit(4);
      
    // SPECIAL OFFER: در حالت جدید، ۶ جایگاه به‌صورت دستی از پنل مدیریت تعیین می‌شوند.
    // برای سازگاری با داده‌های قدیمی، تا وقتی هیچ جایگاه دستی ثبت نشده باشد
    // از محصولات قدیمی isFeatured (فقط در صورت داشتن تخفیف واقعی) استفاده می‌کنیم.
    let isFeaturedProducts = await Product.find({
      isPublished: true,
      specialOfferPosition: { $gte: 1, $lte: 6 },
      offerPrice: { $gt: 0 },
      $expr: { $lt: ["$offerPrice", "$price"] },
    })
      .sort({ specialOfferPosition: 1 })
      .limit(6);

    if (isFeaturedProducts.length === 0) {
      isFeaturedProducts = await Product.find({
        isPublished: true,
        isFeatured: true,
        offerPrice: { $gt: 0 },
        $expr: { $lt: ["$offerPrice", "$price"] },
      })
        .sort({ createdAt: -1 })
        .limit(6);
    }
      
    const isNewProduct = await Product.find({ isNewProduct: true })
      .sort({ createdAt: -1 })
      .limit(10);
      
     const perfumeProducts = await Product.aggregate([
      {
        $lookup: {
          from: 'categories', // اسم کالکشن Categories در دیتابیس
          localField: 'category',
          foreignField: '_id',
          as: 'categoryDetails'
        }
      },
      {
        $unwind: {
          path: '$categoryDetails',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $match: {
          'categoryDetails.name': 'ادکلن',
          isPublished: true
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $limit: 4
      },
      {
        $project: {
          // فیلدهایی که می‌خواهید برگردانده شوند
          name: 1,
          price: 1,
          slug: 1,
          images: 1,
          categoryDetails: 1,
          createdAt: 1
        }
      }
    ]);
    
     const haircareProducts = await Product.aggregate([
      {
        $lookup: {
          from: 'categories', // اسم کالکشن Categories در دیتابیس
          localField: 'category',
          foreignField: '_id',
          as: 'categoryDetails'
        }
      },
      {
        $unwind: {
          path: '$categoryDetails',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $match: {
          'categoryDetails.name': 'مراقبت مو',
          isPublished: true
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $limit: 4
      },
      {
        $project: {
          // فیلدهایی که می‌خواهید برگردانده شوند
          name: 1,
          price: 1,
          slug: 1,
          images: 1,
          categoryDetails: 1,
          createdAt: 1
        }
      }
    ]);
    
     const skincareProducts = await Product.aggregate([
      {
        $lookup: {
          from: 'categories', // اسم کالکشن Categories در دیتابیس
          localField: 'category',
          foreignField: '_id',
          as: 'categoryDetails'
        }
      },
      {
        $unwind: {
          path: '$categoryDetails',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $match: {
          'categoryDetails.name': 'مراقبت پوستی',
          isPublished: true
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $limit: 4
      },
      {
        $project: {
          // فیلدهایی که می‌خواهید برگردانده شوند
          name: 1,
          slug: 1,
          price: 1,
          images: 1,
          categoryDetails: 1,
          createdAt: 1
        }
      }
    ]);
    
    
    const beautyCategory = await Category.findOne({
      name: "آرایشی",
      categoryType: "product",
      isActive: true
    });
    
    let beautycareProducts = [];
    
    if (beautyCategory) {
      // آیدی خود آرایشی + تمام زیر‌دسته‌های آن
      const beautyCategoryIds = await getAllCategoryIds(beautyCategory._id);
    
      beautycareProducts = await Product.find({
        category: { $in: beautyCategoryIds },
        isPublished: true
      })
        .sort({ createdAt: -1 })
        .limit(4);
    
    } else {
      console.log("دسته آرایشی پیدا نشد");
    }
    
    const weblogs = await Weblog.find({}).sort({ createdAt: -1 }).limit(4);
    const user = await User.findById(req.session.userId);
    const cartCount = user?.cart?.length || 0;

    // تابع بازگشتی برای گرفتن همه IDهای زیرمجموعه‌ها
    async function getAllChildCategoryIds(categoryId) {
      let ids = [categoryId];
      const children = await Category.find({ parentId: categoryId, isActive: true });
      
      for (const child of children) {
        const childIds = await getAllChildCategoryIds(child._id);
        ids = [...ids, ...childIds];
      }
      
      return ids;
    }

    // محاسبه تعداد محصولات هر دسته با احتساب زیرمجموعه‌ها
    const categoriesWithCounts = await Promise.all(
      parentCategories.map(async (cat) => {
        const allCategoryIds = await getAllChildCategoryIds(cat._id);
        const count = await Product.countDocuments({ 
          category: { $in: allCategoryIds },
          isOutOfStock: { $ne: true }
        });
        
        return {
          ...cat._doc,
          productCount: count,
        };
      })
    );

    res.render("Home", {
      menuCategories,  
      categories: categoriesWithCounts,
      products,
      weblogs,
      user,
      cartCount,
      isFeaturedProducts,
      isNewProduct,
      perfumeProducts,
      haircareProducts,
      skincareProducts,
      beautycareProducts,
    });
    
  } catch (error) {
    console.error("Home page error:", error);
    res.status(500).render("500", { message: "خطای سرور" });
  }
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get(
  "/shop",
  asyncHandler(async (req, res) => {
    const products = await Product.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .populate("category")
      .populate("brand");    const categories = await Category.find({ categoryType: "product" });
    const brands = await Brand.find({});
    const user = await User.findById(req.session.userId);

    // ====== 1. دسته‌بندی‌های اصلی برای منوی نوبار (با ساختار درختی) ======
    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

    if (!products || !categories || !brands) {
      const error = new Error("خطا در بارگزاری فروشگاه");
      error.statusCode = 500;
      throw error;
    }

    const cartCount = user?.cart?.length || 0;

    // تابع بازگشتی برای گرفتن همه IDهای زیرمجموعه‌ها
    async function getAllChildCategoryIds(categoryId) {
      let ids = [categoryId];
      const children = await Category.find({ parentId: categoryId, isActive: true });
      
      for (const child of children) {
        const childIds = await getAllChildCategoryIds(child._id);
        ids = [...ids, ...childIds];
      }
      
      return ids;
    }

    // محاسبه تعداد محصولات هر دسته با احتساب زیرمجموعه‌ها
    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => {
        const allCategoryIds = await getAllChildCategoryIds(cat._id);
        const count = await Product.countDocuments({ 
          category: { $in: allCategoryIds },
          isOutOfStock: { $ne: true }
        });
        
        return {
          ...cat._doc,
          productCount: count,
        };
      })
    );

    res.render("Shop", {
      products,
      categories: categoriesWithCounts,
      brands,
      cartCount,
      user,
      menuCategories,
    });
  })
);

app.get("/api/products/filtered", async (req, res) => {
  try {
    const {
      categories = [],
      brands = [],
      maxPrice,
      searchQuery,
      discountOnly,
      sortBy,
      page = 1,
      limit = 12,
    } = req.query;

    let query = { isPublished: true };

    if (String(discountOnly) === "true") {
      query.offerPrice = { $gt: 0 };
      query.$expr = { $lt: ["$offerPrice", "$price"] };
    }

    // فیلتر دسته‌بندی‌ها
    if (categories.length > 0) {
      query.category = { $in: categories };
    }

    // فیلتر برندها
    if (brands.length > 0) {
      query.brandName = { $in: brands };
    }

    // فیلتر قیمت
    if (maxPrice) {
      query.$or = [
        { offerPrice: { $lte: maxPrice } },
        { price: { $lte: maxPrice } },
      ];
    }

    // جستجو
    if (searchQuery) {
      query.$or = [
        { name: { $regex: searchQuery, $options: "i" } },
        { lilDescription: { $regex: searchQuery, $options: "i" } },
      ];
    }

    // مرتب‌سازی
    let sortOption = {};
    switch (sortBy) {
      case "price-low":
        sortOption = { price: 1 };
        break;
      case "price-high":
        sortOption = { price: -1 };
        break;
      case "newest":
        sortOption = { createdAt: -1 };
        break;
      case "rating":
        sortOption = { rating: -1 };
        break;
      default:
        sortOption = { rating: -1, reviewsNum: -1 };
    }

    const total = await Product.countDocuments(query);
    const products = await Product.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      products,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/productDetails/:slug", async (req, res, next) => {
  try {
    const slug = req?.params?.slug;
    const user = await User.findById(req.session.userId);
    if (!slug) {
      const error = new Error("محصول انتخاب نشده است");
      error.statusCode = 400;
      throw error;
    }

    const product = await Product.findOne({ slug });
    if (!product) {
      // شاید این اسلاگ، اسلاگ قدیمی یک محصول باشد
      const redirectedProduct = await Product.findOne({ oldSlugs: slug });
      if (redirectedProduct) {
        const queryString = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
        return res.redirect(301, `/productDetails/${redirectedProduct.slug}${queryString}`);
      }
      return res.status(404).render("404"); // یا هر چیزی که الان برای ۴۰۴ داری
    }


    const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

    const priceInIRR = (product.offerPrice || product.price) * 10;

    res.render("ProductDetails", { product, user, cartCount, menuCategories, priceInIRR });
  } catch (err) {
    next(err);
  }
});

app.get(
  "/cart",
  asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      res.status(401);
      req.session.icon = "error";
      req.session.text = "ابتدا وارد حساب کاربری خود شوید";
      req.flash("error", req.session.text);
      res.redirect("/");
      return;
    }

    const user = await User.findById(req.session.userId)
      .populate("cart.productId")
      .populate("orders");

    if (!user) {
      const error = new Error("کاربر پیدا نشد");
      error.statusCode = 404;
      throw error;
    }

    const cartItems = user.cart
      .map((item) => {
        if (!item.productId) {
          console.warn(`کالای شما پیدا نشد`);
          return null;
        }
        const prod = item.productId;
        return {
          _id: prod._id,
          name: prod.name,
          slug: prod.slug,
          price: prod.price,
          offerPrice: prod.offerPrice,
          weight: prod.weight,
          image: prod.images?.[0] || "",
          quantity: item.quantity,
          selectedColor: item.selectedColor || "",
          selectedSize: item.selectedSize || ""
        };
      })
      .filter((item) => item !== null);

    const subtotal = cartItems.reduce((sum, item) => {
      const hasSpecialPrice =
        Number(item.offerPrice) > 0 && Number(item.offerPrice) < Number(item.price);
      const unitPrice = hasSpecialPrice ? Number(item.offerPrice) : Number(item.price);
      return sum + unitPrice * Number(item.quantity || 0);
    }, 0);

    let discountAmount = 0;

    if (req.session.discount) {
      const { type, amount, code, maxDiscountAmount } = req.session.discount;
      const isOdour256 = String(code || "").trim().toUpperCase() === "ODOUR256";
      const discountBaseSubtotal = isOdour256
        ? cartItems.reduce((sum, item) => {
            const hasSpecialPrice =
              Number(item.offerPrice) > 0 && Number(item.offerPrice) < Number(item.price);
            if (hasSpecialPrice) return sum;
            return sum + Number(item.price || 0) * Number(item.quantity || 0);
          }, 0)
        : subtotal;

      if (type === "percent") {
        discountAmount = Math.floor((discountBaseSubtotal * Number(amount || 0)) / 100);
        if (maxDiscountAmount) {
          discountAmount = Math.min(discountAmount, Number(maxDiscountAmount));
        }
      } else {
        discountAmount = Math.min(Number(amount || 0), discountBaseSubtotal);
      }
    }

    const finalTotal = Math.max(0, subtotal - discountAmount);

    if (!req.session.OrderNum) {
      req.session.OrderNum = generateOrderNumber();
    }


   const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

    res.render("Cart", {
      cartItems,
      user,
      OrderNum: req.session.OrderNum,
      subtotal,
      discountAmount,
      finalTotal,
      discountCode: req.session.discount?.code || null,
      activeDiscount: req.session.discount || null,
      cartCount,
      menuCategories,
    });
  })
);

app.get("/weblog", async (req, res) => {
  try {
    // دریافت مقالات با مرتب‌سازی جدیدترین اول
    const weblogs = await Weblog.find({ isPublished: true })
      .populate("categories")
      .populate("author", "fullName")
      .sort({ createdAt: -1 });  // جدیدترین اول
    
    // دریافت دسته‌بندی‌های وبلاگ (categoryType: "weblog")
    const weblogCategories = await Category.find({ 
      categoryType: "weblog",
      isActive: true 
    }).populate('children');
    
    const user = await User.findById(req.session.userId)
      .populate("cart.productId")
      .populate("orders");

    const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

    let singlePost;

    res.render("Weblog", {
      weblogs,
      weblogCategories,  // دسته‌بندی‌های وبلاگ
      user, 
      cartCount, 
      menuCategories,
      singlePost,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { message: "خطا در بارگزاری وبلاگ" });
  }
});

app.get("/about-us", async (req, res) => {
  const user = await User.findById(req.session.userId)
    .populate("cart.productId")
    .populate("orders");

  const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

  res.render("aboutus", {user, cartCount, menuCategories});
});

app.get("/connect-us", async (req, res) => {
   const user = await User.findById(req.session.userId)
    .populate("cart.productId")
    .populate("orders");
  
    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

  const cartCount = user?.cart?.length || 0;

  res.render("connect" , {user, cartCount, menuCategories});
});

app.get("/contact-us", async (req, res) => {
  const user = await User.findById(req.session.userId)
    .populate("cart.productId")
    .populate("orders");

  const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

  res.render("contact", {user, cartCount, menuCategories});
});

app.get("/terms-and-conditions", async (req, res) => {
    const user = await User.findById(req.session.userId)
    .populate("cart.productId")
    .populate("orders");

  const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

  res.render("terms", {user, cartCount, menuCategories});
});

app.get("/privacy-policy", async (req, res) => {
   const user = await User.findById(req.session.userId)
    .populate("cart.productId")
    .populate("orders");

  const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });

  res.render("privacy", {user, cartCount, menuCategories});
});

app.get("/api/weblogs/:id/related", async (req, res) => {
  try {
    const weblog = await Weblog.findById(req.params.id);
    const related = await Weblog.find({
      _id: { $ne: weblog._id },
      categories: { $in: weblog.categories },
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate("author", "name");

    res.json(related);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/weblogs/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const weblog = await Weblog.findOne({ slug })
      .populate("author", "fullName email")
      .populate("categories", "name slug");
    
    if (!weblog) {
      return res.status(404).json({ success: false, message: "مقاله یافت نشد" });
    }
    
    res.json({
      success: true,
      weblog
    });
  } catch (error) {
    console.error("Error fetching weblog:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/userProfile", async (req, res) => {
  if (!req.session.userId) {
    res.status(401);
    req.session.icon = "error";
    req.session.text = "ابتدا وارد حساب کاربری خود شوید";
    req.flash("error", req.session.text);
    res.redirect("/");
    return;
  }
  const user = await User.findById(req.session.userId).populate({
    path: "orders",
    populate: {
      path: "products.product",
      model: "Product",
    },
  });

  const currentOrders = user.orders.filter((o) =>
    ["در حال پردازش", "در حال ارسال", "بسته بندی شده"].includes(o.status)
  );
  const completedOrders = user.orders.filter(
    (o) => o.status === "تحویل داده شد"
  );
  const canceledOrders = user.orders.filter((o) => o.status === "لغو شده");

  const cartCount = user?.cart?.length || 0;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });


  res.render("UserProfile", {
    user,
    currentOrders,
    completedOrders,
    canceledOrders,
    cartCount,
    menuCategories
  });
});

app.get("/category/:slug", async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
      .populate("cart.productId")
      .populate("orders");

    const cartCount = user?.cart?.length || 0;
    const { slug } = req.params;
    
    const currentCategory = await Category.findOne({ 
      slug: slug,
      isActive: true 
    }).populate('parentId');
    
    if (!currentCategory) {
      return res.status(404).render("404", { message: "دسته‌بندی یافت نشد" });
    }
    
    // تابع بازگشتی برای گرفتن همه زیرمجموعه‌ها
    async function getAllChildCategories(parentId) {
      const children = await Category.find({ parentId, isActive: true });
      let allChildren = [...children];
      
      for (const child of children) {
        const grandChildren = await getAllChildCategories(child._id);
        allChildren = [...allChildren, ...grandChildren];
      }
      
      return allChildren;
    }
    
    const allChildCategories = await getAllChildCategories(currentCategory._id);
    
    // محاسبه تعداد محصولات برای هر زیرمجموعه
    const childCategoriesWithCount = await Promise.all(
      allChildCategories.map(async (cat) => {
        let allChildIds = [cat._id];
        
        async function getChildIds(parentId) {
          const children = await Category.find({ parentId, isActive: true });
          for (const child of children) {
            allChildIds.push(child._id);
            await getChildIds(child._id);
          }
        }
        
        await getChildIds(cat._id);
        
        const productCount = await Product.countDocuments({
          category: { $in: allChildIds },
          isOutOfStock: { $ne: true }
        });
        
        return {
          ...cat.toObject(),
          productCount
        };
      })
    );
    
    // پیدا کردن مسیر دسته‌بندی (breadcrumb)
    let breadcrumb = [];
    let parent = currentCategory;
    while (parent) {
      breadcrumb.unshift({
        name: parent.name,
        slug: parent.slug
      });
      parent = parent.parentId;
    }
    
    // پیدا کردن تمام IDهای دسته‌بندی (خودش + همه فرزندان)
    let categoryIds = [currentCategory._id];
    
    async function getAllChildIds(parentId) {
      const children = await Category.find({ parentId, isActive: true });
      for (const child of children) {
        categoryIds.push(child._id);
        await getAllChildIds(child._id);
      }
    }
    
    await getAllChildIds(currentCategory._id);
    
    const products = await Product.find({
      category: { $in: categoryIds },
      isOutOfStock: { $ne: true },
      isPublished: true
    })
      .populate("category")
      .populate("brand")
      .sort({ createdAt: -1 });
    
    const brands = await Brand.find({
      _id: { $in: [...new Set(products.map(p => p.brand?._id || p.brand).filter(Boolean))] }
    });

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });
    
    res.render("category", {
      currentCategory,
      childCategories: childCategoriesWithCount,
      products,
      brands,
      allCategories: await Category.find({ categoryType: "product", parentId: null, isActive: true }),
      breadcrumb,
      path: `/category/${slug}`,
      title: `${currentCategory.name} | فروشگاه`,
      description: `خرید ${currentCategory.name}`,
      user,
      cartCount,
      menuCategories
    });
    
  } catch (error) {
    console.error("Category page error:", error);
    res.status(500).render("500", { message: "خطای سرور" });
  }
});

function toPersianDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('fa-IR');
}

app.get('/weblog/:slug', async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
      .populate("cart.productId")
      .populate("orders");

    const cartCount = user?.cart?.length || 0;
    
    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
    const categoryMap = {};
    allCategories.forEach(cat => {
      categoryMap[cat._id] = { ...cat.toObject(), children: [] };
    });
    
    const menuCategories = [];
    allCategories.forEach(cat => {
      if (cat.parentId && categoryMap[cat.parentId]) {
        categoryMap[cat.parentId].children.push(categoryMap[cat._id]);
      } else if (!cat.parentId) {
        menuCategories.push(categoryMap[cat._id]);
      }
    });
    const { slug } = req.params;
    
    // دریافت اطلاعات مقاله با اسلاگ مشخص
    const post = await Weblog.findOne({ slug, isPublished: true })
      .populate('categories')
      .populate('author');
    
    if (!post) {
      return res.status(404).render('404', { message: 'مقاله مورد نظر یافت نشد' });
    }
    
    // افزایش بازدید
    post.viewCount = (post.viewCount || 0) + 1;
    await post.save();
    
    // دریافت مقالات مرتبط (دسته‌بندی مشابه)
    let relatedPosts = [];
    if (post.categories && post.categories.length > 0) {
      const categoryIds = post.categories.map(cat => cat._id);
      relatedPosts = await Weblog.find({
        _id: { $ne: post._id },
        categories: { $in: categoryIds },
        isPublished: true
      })
      .limit(5)
      .sort({ publishedAt: -1 });
    }
    
    // اگر مقاله مرتبط کم بود، با جدیدترین مقالات پر کن
    if (relatedPosts.length < 3) {
      const extraPosts = await Weblog.find({
        _id: { $ne: post._id },
        isPublished: true
      })
      .limit(5 - relatedPosts.length)
      .sort({ publishedAt: -1 });
      
      relatedPosts = [...relatedPosts, ...extraPosts];
    }
    
    res.render('WeblogDetails', {
      post,
      relatedPosts,
      title: post.title,
      description: post.description,
      menuCategories, 
      user,
      cartCount,
      toPersianDate
    });
    
  } catch (error) {
    console.error('Error in weblog details route:', error);
    res.status(500).render('error', { message: 'خطا در بارگذاری مقاله' });
  }
});




app.get("/sitemap.xml", async (req, res) => {
  try {
    // کش ساده (اختیاری ولی خیلی خوبه)
    if (global.sitemapCache && global.sitemapCacheTime > Date.now() - 3600000) {
      res.header("Content-Type", "application/xml");
      return res.send(global.sitemapCache);
    }

    const smStream = new SitemapStream({
      hostname: process.env.SITE_BASE_URL || process.env.SITE_URL || 'https://www.odour.ir',
    });

    const staticPages = [
      { url: '/', changefreq: 'daily', priority: 1.0 },
      { url: '/shop', changefreq: 'daily', priority: 0.9 },
      { url: '/weblog', changefreq: 'weekly', priority: 0.8 },
      { url: '/about-us', changefreq: 'monthly', priority: 0.5 },
      { url: '/connect-us', changefreq: 'monthly', priority: 0.5 },
      { url: '/contact-us', changefreq: 'monthly', priority: 0.5 },
      { url: '/terms-and-conditions', changefreq: 'yearly', priority: 0.3 },
      { url: '/privacy-policy', changefreq: 'yearly', priority: 0.3 },
    ];

    for (const page of staticPages) {
      // اگه userProfile هست و noindex داری، داخل سایتمپ نذار
      if (page.url !== '/userProfile') {
        smStream.write({
          url: page.url,
          changefreq: page.changefreq,
          priority: page.priority,
          lastmod: new Date().toISOString()
        });
      }
    }

    const products = await Product.find({
      isPublished: true  // فقط محصولات منتشر شده
    }).select('slug updatedAt colors sizes');

    for (const product of products) {
      const variants = getProductVariants(product.toObject ? product.toObject() : product);
      for (const variant of variants) {
        const variantPageUrl = new URL(buildPageUrl(product, variant));
        smStream.write({
          // برای محصول متغیر، هر رنگ/سایز URL مستقل خودش را در sitemap اصلی دارد.
          // این همان sitemapی است که در robots.txt معرفی شده و ترب آن را برای discovery می‌خواند.
          url: `${variantPageUrl.pathname}${variantPageUrl.search}`,
          changefreq: 'daily',
          priority: 0.8,
          lastmod: product.updatedAt ? product.updatedAt.toISOString() : new Date().toISOString()
        });
      }
    }

    const productCategories = await Category.find({ 
      categoryType: 'product',
      isActive: true 
    }).select('slug');
    
    for (const category of productCategories) {
      smStream.write({
        url: `/category/${category.slug}`,
        changefreq: 'weekly',
        priority: 0.7,
        lastmod: new Date().toISOString()
      });
    }

    const weblogs = await Weblog.find({ 
      isPublished: true 
    }).select('slug updatedAt');
    
    for (const weblog of weblogs) {
      smStream.write({
        url: `/weblog/${weblog.slug}`,
        changefreq: 'weekly',
        priority: 0.7,
        lastmod: weblog.updatedAt ? weblog.updatedAt.toISOString() : new Date().toISOString()
      });
    }
    smStream.end();
    
    const sitemap = await streamToPromise(smStream);
    
    // ذخیره در کش
    global.sitemapCache = sitemap;
    global.sitemapCacheTime = Date.now();
    
    res.header("Content-Type", "application/xml");
    res.send(sitemap);
    
  } catch (err) {
    console.error("Sitemap generation error:", err);
    res.status(500).send("Error generating sitemap");
  }
});


app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  const siteUrl = (process.env.SITE_BASE_URL || process.env.SITE_URL || "https://www.odour.ir").replace(/\/+$/, "");
  res.send(`
    User-agent: *
    Allow: /
    Disallow: /admin/
    Sitemap: ${siteUrl}/sitemap.xml
    Sitemap: ${siteUrl}/torob-sitemap.xml
  `);
});

app.use(async (req, res, next) => {
  res.status(404).render("404", {
    message: "صفحه پیدا نشد",
    user: req.session.userId ? await User.findById(req.session.userId) : null,
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Don't leak stack traces in production
  const message =
    process.env.NODE_ENV === "production"
      ? "مشکلی در سایت پیش آمده است لطفا بعدا تلاش کنید!"
      : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// DB
const connectWithRetry = async () => {
  try {
    await mongoose.connect(process.env.DB_URL || "mongodb://localhost:27017/odour", {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    });
    console.log("Connected To DB");

    app.listen(process.env.PORT || 8080, () => {
      console.log(`Server running on http://localhost:${process.env.PORT || 8080}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB - retrying in 5 sec", err);
    setTimeout(connectWithRetry, 5000);
  }
};

connectWithRetry();
