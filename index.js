const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");

require("dotenv").config();

// Set view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Public folder for css js font and etc.
app.use(express.static("public/"));

// Middlewares

// Models
const Product = require("./models/Product");
const Category = require("./models/Category");
const Brand = require("./models/Brand");
const Weblog = require("./models/Weblog");
const User = require("./models/User");

// For Production
// app.use(
//   session({
//     secret: process.env.SESSION_SECRET,
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//       httpOnly: true,
//       secure: true,
//       sameSite: "lax",
//       maxAge: 1000 * 60 * 60 * 2,
//     },
//   })
// );

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

// Routes
const authenticationRoutes = require("./routes/authentication");
const mobileRoutes = require("./routes/mobile");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/order");
const { isLoggedIn } = require("./middlewares/isLoggedIn");

app.use("/api/authentication", authenticationRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/order", orderRoutes);

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

function generateOrderNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000); // random 6-digit number from 100000 to 999999
  return `ORD-${randomNum}`;
}

app.get("/", async (req, res) => {
  const categories = await Category.find({});
  const products = await Product.find({ isPopular: true });
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
  });
});

app.get("/shop", async (req, res) => {
  const products = await Product.find({});
  const categories = await Category.find({});
  const brands = await Brand.find({});
  const user = await User.findById(req.session.userId);

  const cartCount = user?.cart?.length || 0;

  // count products for each category
  const categoriesWithCounts = await Promise.all(
    categories.map(async (cat) => {
      const count = await Product.countDocuments({ category: cat._id });
      return {
        ...cat._doc, // spread the original category fields
        productCount: count, // add a new property
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
});

app.get("/productDetails/:slug", async (req, res) => {
  const slug = req?.params?.slug;
  const product = await Product.findOne({ slug });

  res.render("ProductDetails", { product });
});

app.get("/cart", isLoggedIn, async (req, res) => {
  const user = await User.findById(req.session.userId)
    .populate("cart.productId")
    .populate("orders");

  if (!user || !user.cart) {
    return res.redirect("/");
  }

  const cartItems = user.cart.map((item) => {
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
  });

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
});

app.get("/weblog", async (req, res) => {
  res.render("Weblog");
});

app.get("/weblogDetails/:slug", async (req, res) => {
  res.render("WeblogDetails");
});

app.get("/userProfile", isLoggedIn, async (req, res) => {
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

// admin
app.get("/admin", async (req, res) => {
  res.render("AdminPanel");
});

// DB
mongoose
  .connect(process.env.DB_URL)
  .then(() => {
    console.log("Connected To DB");

    // Start server after DB is connected
    app.listen(process.env.PORT, () => {
      console.log(`Server Is Running On http://localhost:${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to DB:", err);
  });
