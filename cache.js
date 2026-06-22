const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5 دقیقه
const Category = require('./models/Category');

async function getMenuCategories() {
  const cached = cache.get('menuCategories');
  if (cached) return cached;

  const allCategories = await Category.find({ categoryType: "product", isActive: true });

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

  cache.set('menuCategories', menuCategories);
  return menuCategories;
}

function invalidateMenuCache() {
  cache.del('menuCategories');
}

module.exports = { getMenuCategories, invalidateMenuCache };