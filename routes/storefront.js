// JSON endpoints used by the storefront UI (search, filters, wishlist, cards).
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const User = require("../models/User");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const { CARD_FIELDS } = require("../helper/storefront");
const { parseFilters, listProducts, buildFacets, toCard, escapeRegex } = require("../helper/catalog");

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// GET /api/search/suggest?q=  — live search: products, brands, categories.
router.get("/search/suggest", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    if (q.length < 2) return res.json({ success: true, products: [], brands: [], categories: [], total: 0 });

    const filters = parseFilters({ search: q, limit: 8, sort: "popular" });
    const pattern = new RegExp(escapeRegex(q).replace(/[یي]/g, "[یي]").replace(/[کك]/g, "[کك]"), "i");
    const [result, brands, categories] = await Promise.all([
      listProducts(filters),
      Brand.find({ $or: [{ name: pattern }, { englishName: pattern }] }).select("name englishName slug").limit(4).lean(),
      Category.find({ categoryType: "product", isActive: true, name: pattern }).select("name slug").limit(4).lean(),
    ]);

    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      success: true,
      total: result.total,
      products: result.products.map(toCard),
      brands: brands.map((b) => ({ name: b.name, slug: b.slug })),
      categories: categories.map((c) => ({ name: c.name, slug: c.slug })),
    });
  } catch (error) {
    console.error("Search suggest error:", error);
    return fail(res, 500, "خطا در جستجو");
  }
});

// GET /api/products/cards?ids=a,b,c — card data in the requested order (recently viewed).
router.get("/products/cards", async (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .slice(0, 12);
    if (!ids.length) return res.json({ success: true, products: [], html: "" });
    const products = await Product.find({ _id: { $in: ids }, isPublished: true }).select(CARD_FIELDS).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    if (req.query.format === "html") {
      const html = ordered.length
        ? await new Promise((resolve, reject) =>
            req.app.render("partials/product-cards", { products: ordered }, (err, out) => (err ? reject(err) : resolve(out)))
          )
        : "";
      return res.json({ success: true, html });
    }
    return res.json({ success: true, products: ordered.map(toCard) });
  } catch (error) {
    console.error("Product cards error:", error);
    return fail(res, 500, "خطا در دریافت محصولات");
  }
});

// GET /api/products/filtered — catalogue listing with filters, sorting and paging.
// Accepts the new parameter names and the legacy ones (categories, brands, searchQuery,
// discountOnly, sortBy). Add `facets=1` to also receive filter options with counts.
router.get("/products/filtered", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    let scopeCategoryId = null;
    if (req.query.scope && mongoose.Types.ObjectId.isValid(req.query.scope)) {
      scopeCategoryId = new mongoose.Types.ObjectId(String(req.query.scope));
    }
    const result = await listProducts(filters, { scopeCategoryId });
    const payload = { success: true, total: result.total, page: result.page, pages: result.pages };
    if (req.query.format === "html") {
      // Same server template as the first page, so filtered cards are identical.
      payload.html = await new Promise((resolve, reject) =>
        req.app.render("partials/product-cards", { products: result.products }, (err, html) => (err ? reject(err) : resolve(html)))
      );
    } else {
      payload.products = result.products.map(toCard);
    }
    if (req.query.facets === "1") payload.facets = await buildFacets(result.context);
    return res.json(payload);
  } catch (error) {
    console.error("Filtered products error:", error);
    return fail(res, 500, "خطا در دریافت محصولات");
  }
});

// GET /api/wishlist — ids of the signed-in customer's saved products.
router.get("/wishlist", isLoggedIn, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("wishlist").lean();
    if (!user) return fail(res, 401, "لطفا ابتدا وارد حساب کاربری خود شوید");
    return res.json({ success: true, ids: (user.wishlist || []).map(String) });
  } catch (error) {
    console.error("Wishlist error:", error);
    return fail(res, 500, "خطا در دریافت علاقه‌مندی‌ها");
  }
});

// POST /api/wishlist/toggle { productId }
router.post("/wishlist/toggle", isLoggedIn, async (req, res) => {
  try {
    const { productId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(productId)) return fail(res, 400, "شناسه محصول نامعتبر است");
    const exists = await Product.exists({ _id: productId, isPublished: true });
    if (!exists) return fail(res, 404, "محصول یافت نشد");

    const user = await User.findById(req.session.userId).select("wishlist");
    if (!user) return fail(res, 401, "لطفا ابتدا وارد حساب کاربری خود شوید");

    const index = user.wishlist.findIndex((id) => String(id) === String(productId));
    const added = index === -1;
    if (added) user.wishlist.unshift(productId);
    else user.wishlist.splice(index, 1);
    user.wishlist = user.wishlist.slice(0, 200);
    await user.save({ validateModifiedOnly: true });

    return res.json({ success: true, added, ids: user.wishlist.map(String) });
  } catch (error) {
    console.error("Wishlist toggle error:", error);
    return fail(res, 500, "خطا در به‌روزرسانی علاقه‌مندی‌ها");
  }
});

// PATCH /api/account/profile { fullName, email } — customer-editable account details.
router.patch("/account/profile", isLoggedIn, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (fullName && (fullName.length < 3 || fullName.length > 50)) return fail(res, 400, "نام باید بین ۳ تا ۵۰ حرف باشد");
    const user = await User.findById(req.session.userId);
    if (!user) return fail(res, 401, "لطفا ابتدا وارد حساب کاربری خود شوید");
    user.fullName = fullName || undefined;
    user.email = email || undefined;
    await user.save({ validateModifiedOnly: true });
    return res.json({ success: true, message: "اطلاعات حساب ذخیره شد" });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, "این ایمیل قبلاً برای حساب دیگری ثبت شده است");
    if (error.name === "ValidationError") return fail(res, 400, Object.values(error.errors)[0]?.message || "اطلاعات نامعتبر است");
    console.error("Profile update error:", error);
    return fail(res, 500, "خطا در ذخیره اطلاعات");
  }
});

// DELETE /api/account/addresses/:id — remove a saved delivery address.
router.delete("/account/addresses/:id", isLoggedIn, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("addresses");
    if (!user) return fail(res, 401, "لطفا ابتدا وارد حساب کاربری خود شوید");
    user.addresses = user.addresses.filter((a) => String(a._id) !== String(req.params.id));
    await user.save({ validateModifiedOnly: true });
    return res.json({ success: true, message: "آدرس حذف شد" });
  } catch (error) {
    console.error("Address delete error:", error);
    return fail(res, 500, "خطا در حذف آدرس");
  }
});

module.exports = router;
