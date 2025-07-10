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

// For access to req.body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middlewares


// Models
const Product = require("./models/Product");
const Category = require("./models/Category");
const Brand = require("./models/Brand");
const Weblog = require("./models/Weblog");

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

app.get("/", async (req, res) => {
  const categories = await Category.find({});
  const products = await Product.find({ isPopular: true });
  const weblogs = await Weblog.find({}).sort({ createdAt: -1 }).limit(4);

  const categoriesWithCounts = await Promise.all(
    categories.map(async (cat) => {
      const count = await Product.countDocuments({ category: cat._id });
      return {
        ...cat._doc, // spread the original category fields
        productCount: count, // add a new property
      };
    })
  );

  res.render("Home", { categories: categoriesWithCounts, products, weblogs });
});

app.get("/shop", async (req, res) => {
  const products = await Product.find({});
  const categories = await Category.find({});
  const brands = await Brand.find({});

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

  res.render("Shop", { products, categories: categoriesWithCounts, brands });
});

app.get("/productDetails/:slug", async (req, res) => {
  const slug = req.params.slug;
  const product = await Product.findOne({ slug });

  res.render("ProductDetails", { product });
});

app.get("/cart", async (req, res) => {
  res.render("Cart");
});

app.get("/weblog", async (req, res) => {
  res.render("Weblog");
});

app.get("/weblogDetails/:slug", async (req, res) => {
  res.render("WeblogDetails");
});

app.get("/userProfile", async (req, res) => {
  res.render("UserProfile");
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
