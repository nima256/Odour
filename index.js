const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const flash = require("connect-flash");
const fs = require("fs");
const MongoStore = require("connect-mongo");
const { SitemapStream, streamToPromise } = require("sitemap");
const { createGzip } = require("zlib");

require("dotenv").config();

// Set view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Public folder for css js font and etc.
app.use(express.static("public/"));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// Middlewares

// Models
const Product = require("./models/Product");
const Category = require("./models/Category");
const Brand = require("./models/Brand");
const Weblog = require("./models/Weblog");
const User = require("./models/User");

// For production
// app.use(
//   session({
//     secret: process.env.SESSION_SECRET || 'fallback-secret-but-warn',
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production', // HTTPS only in production
//       sameSite: 'strict',
//       maxAge: 1000 * 60 * 60 * 2, // 2 hours
//     },
//     store: MongoStore.create({ // For production - stores sessions in DB
//       mongoUrl: process.env.DB_URL,
//       ttl: 14 * 24 * 60 * 60 // 14 days
//     })
//   })
// );

// // Warn if using default session secret
// if (!process.env.SESSION_SECRET) {
//   console.warn('WARNING: Using default session secret - set SESSION_SECRET in production!');
// }

// Basic Setup
app.use(
  session({
    secret: "randomShitguys",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 1,
    },
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.tailwindcss.com",
          "'unsafe-inline'", // Allow inline scripts (if needed)
        ],
        styleSrc: [
          "'self'",
          "https://cdn.tailwindcss.com",
          "https://cdnjs.cloudflare.com", // Font Awesome CSS
          "https://fonts.googleapis.com", // Google Fonts
          "'unsafe-inline'", // Allow inline styles
        ],
        fontSrc: [
          "'self'",
          "data:",
          "https://cdnjs.cloudflare.com", // Font Awesome fonts
          "https://fonts.gstatic.com", // Google Fonts
        ],
        imgSrc: ["'self'", "data:", "https:"], // Allow all images
        connectSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.tailwindcss.com",
          "'unsafe-inline'", // Allows inline scripts
        ],
        scriptSrcAttr: [
          "'self'",
          "'unsafe-inline'", // Allows inline event handlers
          "'unsafe-hashes'", // Needed for some cases
        ],
      },
    },
  })
);
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
      console.log(`Created directory: ${dir}`);
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
const { isLoggedIn } = require("./middlewares/isLoggedIn");

app.use("/api/", apiLimiter);
app.use("/api/authentication", authenticationRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/order", orderRoutes);
app.use("/admin", adminRoutes);

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

app.get("/", async (req, res) => {
  const categories = await Category.find({ categoryType: "product" });
  const products = await Product.find({ isPopular: true })
    .sort({ createdAt: -1 })
    .limit(4);
  const isFeaturedProducts = await Product.find({ isFeatured: true })
    .sort({ createdAt: -1 })
    .limit(6);
  const weblogs = await Weblog.find({}).sort({ createdAt: -1 }).limit(4);
  const user = await User.findById(req.session.userId);

  const cartCount = user?.cart?.length || 0;

  const categoriesWithCounts = await Promise.all(
    categories.map(async (cat) => {
      const count = await Product.countDocuments({ category: cat._id });
      return {
        ...cat._doc, // spread the original category fields
        productCount: count, // add a new property
      };
    })
  );

  res.render("Home", {
    categories: categoriesWithCounts,
    products,
    weblogs,
    user,
    cartCount,
    isFeaturedProducts,
  });
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get(
  "/shop",
  asyncHandler(async (req, res) => {
    const products = await Product.find({})
      .populate("category")
      .populate("brand");
    const categories = await Category.find({ categoryType: "product" });
    const brands = await Brand.find({});
    const user = await User.findById(req.session.userId);

    if (!products || !categories || !brands) {
      const error = new Error("خطا در بارگزاری فروشگاه");
      error.statusCode = 500;
      throw error;
    }

    const cartCount = user?.cart?.length || 0;

    // count products for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => {
        const count = await Product.countDocuments({ category: cat._id }); // Changed to "categories" array
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
      sortBy,
      page = 1,
      limit = 12,
    } = req.query;

    let query = {};

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

app.get("/productDetails/:slug", async (req, res) => {
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
      const error = new Error("محصول یافت نشد");
      error.statusCode = 404;
      throw error;
    }

    const cartCount = user?.cart?.length || 0;

    res.render("ProductDetails", { product, user, cartCount });
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
        };
      })
      .filter((item) => item !== null);

    const subtotal = cartItems.reduce(
      (sum, item) => sum + (item.offerPrice || item.price) * item.quantity,
      0
    );

    let discountAmount = 0;

    if (req.session.discount) {
      const { type, amount } = req.session.discount;
      discountAmount = type === "percent" ? (subtotal * amount) / 100 : amount;
    }

    const finalTotal = subtotal - discountAmount;

    if (!req.session.OrderNum) {
      req.session.OrderNum = generateOrderNumber();
    }

    res.render("Cart", {
      cartItems,
      user,
      OrderNum: req.session.OrderNum,
      subtotal,
      discountAmount,
      finalTotal,
      discountCode: req.session.discount?.code || null,
    });
  })
);

app.get("/weblog", async (req, res) => {
  try {
    const weblogs = await Weblog.find({})
      .populate("categories")
      .populate("author");
    res.render("Weblog", { weblogs }); // Render empty initially
  } catch (err) {
    res.status(500).render("error", { message: "خطا در بارگزاری وبلاگ" });
  }
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

  res.render("UserProfile", {
    user,
    currentOrders,
    completedOrders,
    canceledOrders,
  });
});

app.get("/sitemap.xml", async (req, res) => {
  try {
    const smStream = new SitemapStream({
      hostname: process.env.SITE_URL,
    });

    res.header("Content-Type", "application/xml");
    res.header("Content-Encoding", "gzip");

    const products = await Product.find({});
    products.forEach((product) => {
      smStream.write({
        url: `/productDetails/${product.slug}`,
        changefreq: "weekly",
        priority: 0.8,
      });
    });

    smStream.end();
    streamToPromise(smStream.pipe(createGzip())).then((sm) => res.send(sm));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`
    User-agent: *
    Allow: /
    Disallow: /admin/
    Sitemap: ${process.env.SITE_URL}/sitemap.xml
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
    await mongoose.connect(process.env.DB_URL, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    });
    console.log("Connected To DB");

    app.listen(process.env.PORT, () => {
      console.log(`Server running on http://localhost:${process.env.PORT}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB - retrying in 5 sec", err);
    setTimeout(connectWithRetry, 5000);
  }
};

connectWithRetry();
