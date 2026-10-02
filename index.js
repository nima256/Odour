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

// Compress before static so CSS/JS/fonts/models are served compressed too.
app.use(compression({
  level: 6, 
  threshold: 1024,
  filter: (req, res) => {
    if (req.path.match(/\.(css|js|html|svg|json|xml|glb)$/)) {
      return true;
    }
    return compression.filter(req, res);
  }
}));

// Public folder for css js font and etc.
app.use(express.static(path.join(__dirname, 'public/'), {
  maxAge: '30d',
  immutable: true
}));

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
  maxAge: '7d',  // 7 روز برای آپلودها
  immutable: true
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
const Banner = require("./models/Banner");
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

// Trust only the reverse proxy in front of the app (default: one hop). `true` would let
// clients spoof X-Forwarded-For and bypass the OTP/login rate limits.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

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

const viewHelpers = require("./helper/viewHelpers");
Object.assign(app.locals, viewHelpers);
// Changes on every deploy/restart; appended to first-party assets because
// /public is served with a 30-day immutable cache.
app.locals.assetVersion = process.env.ASSET_VERSION || Date.now().toString(36);

// Safe defaults so shared partials work on every page (routes override these).
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.user = null;
  res.locals.cartCount = 0;
  res.locals.menuCategories = [];
  next();
});

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
const { CARD_FIELDS, buildMenuCategories, findProductsInCategoryNamed, pageContext } = require("./helper/storefront");
const { SORTS, parseFilters, listProducts, buildFacets, activeFilterChips } = require("./helper/catalog");
const { parseFragranceProfile } = require("./helper/fragranceProfile");

// app.use("/api/", apiLimiter);
app.use("/api/authentication", authenticationRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/order", orderRoutes);
app.use("/api", require("./routes/storefront"));
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
  .sort({ displayOrder: 1, name: 1 })
  .limit(5);
  
  res.locals.footerCategories = footerCategories;
  next();
});


app.get("/", async (req, res) => {
  try {
    const published = { isPublished: true };
    const offerQuery = {
      ...published,
      offerPrice: { $gt: 0 },
      $expr: { $lt: ["$offerPrice", "$price"] },
    };

    // SPECIAL OFFER: six slots chosen manually in the admin panel. For older data,
    // fall back to discounted products flagged isFeatured.
    let isFeaturedProducts = await Product.find({ ...offerQuery, specialOfferPosition: { $gte: 1, $lte: 6 } })
      .select(CARD_FIELDS)
      .sort({ specialOfferPosition: 1 })
      .limit(6)
      .lean();
    if (isFeaturedProducts.length === 0) {
      isFeaturedProducts = await Product.find({ ...offerQuery, isFeatured: true })
        .select(CARD_FIELDS)
        .sort({ createdAt: -1 })
        .limit(8)
        .lean();
    }

    const [menuCategories, isNewProduct, perfumeProducts, skincareProducts, haircareProducts, beautycareProducts, weblogs, user, banners] =
      await Promise.all([
        buildMenuCategories(),
        Product.find({ ...published, isNewProduct: true }).select(CARD_FIELDS).sort({ createdAt: -1 }).limit(8).lean(),
        findProductsInCategoryNamed("ادکلن", 8),
        findProductsInCategoryNamed("مراقبت پوستی", 4),
        findProductsInCategoryNamed("مراقبت مو", 4),
        findProductsInCategoryNamed("آرایشی", 4),
        Weblog.find({ isPublished: true }).select("title slug description images readingTime createdAt").sort({ createdAt: -1 }).limit(3).lean(),
        req.session.userId ? User.findById(req.session.userId).select("cart fullName mobile") : null,
        Banner.activeByPlacement(["home_hero", "home_promo", "home_collection", "home_category", "home_editorial", "home_strip"]),
      ]);

    res.render("Home", {
      banners,
      menuCategories,
      user,
      cartCount: user?.cart?.length || 0,
      isFeaturedProducts,
      isNewProduct,
      perfumeProducts,
      skincareProducts,
      haircareProducts,
      beautycareProducts,
      weblogs,
    });
  } catch (error) {
    console.error("Home page error:", error);
    res.status(500).render("500");
  }
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Shop & category listing share one renderer (helper/catalog.js does the querying).
async function renderCatalog(req, res, { category = null } = {}) {
  const filters = parseFilters(req.query);
  const [result, menuCategories, user] = await Promise.all([
    listProducts(filters, { scopeCategoryId: category ? category._id : null }),
    buildMenuCategories(),
    req.session.userId ? User.findById(req.session.userId).select("cart fullName mobile") : null,
  ]);
  const facets = await buildFacets(result.context);

  // Subcategories of the current scope (or top-level categories on /shop) as quick filters.
  const subcategories = await Category.find({
    categoryType: "product",
    isActive: true,
    parentId: category ? category._id : null,
  })
    .select("name slug icon")
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  const breadcrumb = [];
  for (let node = category; node; node = node.parentId && node.parentId.name ? node.parentId : null) {
    breadcrumb.unshift({ name: node.name, slug: node.slug });
  }

  // Header banner: one made for this category wins over a general shop banner.
  const shopBanners = (await Banner.activeByPlacement(["shop_top"])).shop_top;
  const banner =
    (category && shopBanners.find((b) => b.categorySlug === category.slug)) ||
    shopBanners.find((b) => !b.categorySlug) ||
    null;

  const categoryNames = Object.fromEntries(subcategories.map((c) => [c.slug, c.name]));
  res.render("Shop", {
    menuCategories,
    user,
    cartCount: user?.cart?.length || 0,
    category,
    subcategories,
    breadcrumb,
    filters,
    facets,
    activeChips: activeFilterChips(filters, categoryNames),
    sorts: SORTS,
    products: result.products,
    total: result.total,
    page: result.page,
    pages: result.pages,
    basePath: category ? `/category/${category.slug}` : "/shop",
    banner,
  });
}

app.get(
  "/shop",
  asyncHandler(async (req, res) => {
    await renderCatalog(req, res);
  })
);

app.get("/productDetails/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const product = await Product.findOne({ slug });
    if (!product) {
      // Maybe an old slug of a renamed product.
      const redirectedProduct = await Product.findOne({ oldSlugs: slug }).select("slug").lean();
      if (redirectedProduct) {
        const queryString = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
        return res.redirect(301, `/productDetails/${encodeURIComponent(redirectedProduct.slug)}${queryString}`);
      }
      return res.status(404).render("404");
    }

    const categoryIds = (product.category || []).map((id) => id);
    const [menuCategories, user, relatedProducts, categoryDocs] = await Promise.all([
      buildMenuCategories(),
      req.session.userId ? User.findById(req.session.userId).select("cart fullName mobile") : null,
      Product.find({ _id: { $ne: product._id }, isPublished: true, category: { $in: categoryIds } })
        .select(CARD_FIELDS)
        .sort({ sortPriority: -1, createdAt: -1 })
        .limit(8)
        .lean(),
      Category.find({ _id: { $in: categoryIds }, isActive: true }).select("name slug parentId").lean(),
    ]);

    // Deepest category first for the breadcrumb.
    const leaf = categoryDocs.find((c) => !categoryDocs.some((other) => String(other.parentId) === String(c._id))) || categoryDocs[0];
    const parent = leaf && leaf.parentId ? categoryDocs.find((c) => String(c._id) === String(leaf.parentId)) : null;

    res.render("ProductDetails", {
      product,
      user,
      cartCount: user?.cart?.length || 0,
      menuCategories,
      priceInIRR: (product.offerPrice || product.price) * 10,
      torobMetaHelper: require("./helper/torobProductMeta"),
      requestedTorobVariantId: String(req.query.variant || ""),
      requestedTorobSizeId: String(req.query.size || ""),
      fragrance: parseFragranceProfile(product.specifications, product.fragrance),
      relatedProducts,
      breadcrumb: [parent, leaf].filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
});

app.get(
  "/cart",
  asyncHandler(async (req, res) => {
    const menuCategories = await buildMenuCategories();
    if (!req.session.userId) {
      // Carts live on the account; guests get a sign-in prompt on the page itself.
      return res.render("Cart", { guest: true, menuCategories, cartItems: [], user: null, cartCount: 0 });
    }

    const user = await User.findById(req.session.userId).populate("cart.productId");
    if (!user) {
      const error = new Error("کاربر پیدا نشد");
      error.statusCode = 404;
      throw error;
    }

    const cartItems = user.cart
      .filter((item) => item.productId)
      .map((item) => {
        const prod = item.productId;
        const color = item.selectedVariantId ? prod.colors?.id?.(item.selectedVariantId) : null;
        const size = item.selectedSizeId ? prod.sizes?.id?.(item.selectedSizeId) : null;
        return {
          _id: prod._id,
          lineId: String(item._id),
          name: prod.name,
          slug: prod.slug,
          brandName: prod.brandName || "",
          price: prod.price,
          offerPrice: prod.offerPrice,
          weight: prod.weight,
          image: (color && color.image && color.image.url ? { url: color.image.url } : prod.images?.[0]) || { url: "/logo.webp" },
          quantity: item.quantity,
          stock: Number(prod.countInStock || 0),
          selectedColor: item.selectedColor || "",
          selectedVariantId: item.selectedVariantId || "",
          selectedSize: item.selectedSize || "",
          selectedSizeId: item.selectedSizeId || "",
          colorRgb: color ? color.rgb : "",
          available: Number(prod.countInStock || 0) > 0 && !(size && size.isOutOfStock) && !(color && color.isOutOfStock),
        };
      });

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

    res.render("Cart", {
      guest: false,
      cartItems,
      user,
      savedAddress: (user.addresses && user.addresses[0]) || null,
      OrderNum: req.session.OrderNum,
      subtotal,
      discountAmount,
      finalTotal,
      discountCode: req.session.discount?.code || null,
      activeDiscount: req.session.discount || null,
      cartCount: user.cart.length,
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
    res.status(500).render("500", { message: "خطا در بارگذاری مجله" });
  }
});

app.get(
  "/about-us",
  asyncHandler(async (req, res) => {
    res.render("aboutus", await pageContext(req));
  })
);


app.get(
  "/connect-us",
  asyncHandler(async (req, res) => {
    res.render("connect", await pageContext(req));
  })
);


app.get(
  "/contact-us",
  asyncHandler(async (req, res) => {
    res.render("contact", await pageContext(req));
  })
);


app.get(
  "/terms-and-conditions",
  asyncHandler(async (req, res) => {
    res.render("terms", await pageContext(req));
  })
);


app.get(
  "/privacy-policy",
  asyncHandler(async (req, res) => {
    res.render("privacy", await pageContext(req));
  })
);


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

app.get(
  "/userProfile",
  asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      return res.redirect("/?login=1&next=%2FuserProfile");
    }
    const [user, menuCategories] = await Promise.all([
      User.findById(req.session.userId)
        .populate({ path: "orders", options: { sort: { createdAt: -1 } }, populate: { path: "products.product", model: "Product", select: "name slug images" } })
        .populate({ path: "wishlist", match: { isPublished: true }, select: CARD_FIELDS }),
      buildMenuCategories(),
    ]);
    if (!user) {
      req.session.destroy(() => res.redirect("/"));
      return;
    }

    res.render("UserProfile", {
      user,
      orders: user.orders || [],
      wishlist: (user.wishlist || []).filter(Boolean),
      cartCount: user.cart?.length || 0,
      menuCategories,
    });
  })
);

app.get(
  "/category/:slug",
  asyncHandler(async (req, res) => {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true, categoryType: "product" })
      .populate({ path: "parentId", populate: { path: "parentId" } })
      .lean();
    if (!category) return res.status(404).render("404");
    await renderCatalog(req, res, { category });
  })
);

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
    // Atomic increment: no full-document re-validation just for a page view.
    await Weblog.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } });
    
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
    res.status(500).render('500', { message: 'خطا در بارگذاری مقاله' });
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
      // Idempotent data/index migrations run in the background; they never block startup.
      require("./helper/migrations").runStartupMigrations();
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB - retrying in 5 sec", err);
    setTimeout(connectWithRetry, 5000);
  }
};

connectWithRetry();
