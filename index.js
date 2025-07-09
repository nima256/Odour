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
const isLoggedIn = require("./middlewares/isLoggedIn");

// Models
const Product = require("./models/Product");
const Category = require("./models/Category");
const Brand = require("./models/Brand");

// For Production
// app.use(
//   session({
//     secret: process.env.SESSION_SECRET, // Always keep this secret in environment variables
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//       httpOnly: true,
//       secure: true, // Requires HTTPS
//       sameSite: "lax", // Helps prevent CSRF
//       maxAge: 1000 * 60 * 60 * 2, // 2 hours
//     },
//   })
// );

// Basic Setup
app.use(
  session({
    secret: "randomShitguys", // Required: Used to sign the session ID cookie
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something is stored
    cookie: {
      httpOnly: true, // Prevent client-side JS from accessing the cookie
      secure: false, // Set to true if using HTTPS
      maxAge: 1000 * 60 * 60 * 1, // 1 hour
    },
  })
);

app.locals.toPersianDigits = function (input) {
  if (input === undefined || input === null) return "";
  return input.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
};

app.get("/", async (req, res) => {
  const categories = await Category.find({});
  const products = await Product.find({}).limit(4);

  const categoriesWithCounts = await Promise.all(
    categories.map(async (cat) => {
      const count = await Product.countDocuments({ category: cat._id });
      return {
        ...cat._doc, // spread the original category fields
        productCount: count, // add a new property
      };
    })
  );

  res.render("Home", { categories: categoriesWithCounts });
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

  console.log(product.sizes[0]);

  res.render("ProductDetails", { product });
});

app.get("/cart", async (req, res) => {
  res.render("Cart");
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
