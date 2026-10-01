// Shared storefront data helpers. Keeps the per-route code small and makes
// sure every page builds the navbar/category data the same way.
const Category = require("../models/Category");
const Product = require("../models/Product");

// Fields needed to render a product card anywhere on the storefront.
const CARD_FIELDS =
  "name englishName slug images price offerPrice brandName catName rating reviewsNum countInStock isOutOfStock isNewProduct colors sizes createdAt";

// Builds the nested product-category tree used by the navbar / mobile menu.
async function buildMenuCategories() {
  const allCategories = await Category.find({ categoryType: "product", isActive: true })
    .sort({ name: 1 })
    .lean();

  const byId = {};
  allCategories.forEach((cat) => {
    byId[String(cat._id)] = { ...cat, children: [] };
  });

  const roots = [];
  allCategories.forEach((cat) => {
    const node = byId[String(cat._id)];
    if (cat.parentId && byId[String(cat.parentId)]) {
      byId[String(cat.parentId)].children.push(node);
    } else if (!cat.parentId) {
      roots.push(node);
    }
  });

  return roots;
}

// Returns the id of a category plus all of its active descendants.
async function getCategoryTreeIds(rootId) {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await Category.find({ parentId: { $in: frontier }, isActive: true })
      .select("_id")
      .lean();
    frontier = children.map((c) => c._id);
    ids.push(...frontier);
  }
  return ids;
}

// Latest published products in a category (by exact name), including subcategories.
async function findProductsInCategoryNamed(name, limit = 8) {
  const category = await Category.findOne({ name, categoryType: "product", isActive: true })
    .select("_id")
    .lean();
  if (!category) return [];

  const ids = await getCategoryTreeIds(category._id);
  return Product.find({ category: { $in: ids }, isPublished: true })
    .select(CARD_FIELDS)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

// Data every storefront page needs for the header (light: no populates).
async function pageContext(req) {
  const User = require("../models/User");
  const [menuCategories, user] = await Promise.all([
    buildMenuCategories(),
    req.session && req.session.userId
      ? User.findById(req.session.userId).select("cart fullName mobile").lean()
      : null,
  ]);
  return { menuCategories, user, cartCount: user?.cart?.length || 0 };
}

module.exports = {
  pageContext,
  CARD_FIELDS,
  buildMenuCategories,
  getCategoryTreeIds,
  findProductsInCategoryNamed,
};
