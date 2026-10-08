// Real, query-backed numbers for the admin dashboard. No estimates, no
// placeholder trends: every figure here comes straight from the database.
const Product = require("../models/Product");
const Order = require("../models/Order");
const Banner = require("../models/Banner");

const PAID = "پرداخت شده";
const CANCELLED = "لغو شده";
const NEEDS_ACTION = ["در حال پردازش", "بسته بندی شده"];

const lowStockMatch = {
  countInStock: { $gt: 0 },
  $expr: { $lte: ["$countInStock", { $ifNull: ["$lowStockThreshold", 3] }] },
};
const outOfStockMatch = { $or: [{ countInStock: { $lte: 0 } }, { isOutOfStock: true }] };

async function sumRevenue(match) {
  const [row] = await Order.aggregate([
    { $match: { paymentStatus: PAID, status: { $ne: CANCELLED }, ...match } },
    { $group: { _id: null, total: { $sum: "$totalPrice" }, count: { $sum: 1 } } },
  ]);
  return { total: row ? row.total : 0, count: row ? row.count : 0 };
}

async function buildDashboard() {
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [
    statusRows,
    revenueAll,
    revenue30,
    lowStockCount,
    outOfStockCount,
    lowStock,
    recentOrders,
    recentProducts,
    productCount,
    publishedCount,
    activeBanners,
    totalBanners,
  ] = await Promise.all([
    Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    sumRevenue({}),
    sumRevenue({ createdAt: { $gte: since30 } }),
    Product.countDocuments(lowStockMatch),
    Product.countDocuments(outOfStockMatch),
    Product.find(lowStockMatch).select("name slug countInStock lowStockThreshold images sku").sort({ countInStock: 1 }).limit(6).lean(),
    Order.find({})
      .select("OrderNum recipientName totalPrice status paymentStatus paymentMethod createdAt user")
      .populate("user", "fullName mobile")
      .sort({ createdAt: -1 })
      .limit(7)
      .lean(),
    Product.find({}).select("name slug price offerPrice countInStock isPublished images createdAt brandName").sort({ createdAt: -1 }).limit(5).lean(),
    Product.countDocuments({}),
    Product.countDocuments({ isPublished: true }),
    Banner.countDocuments({
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    }),
    Banner.countDocuments({}),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.count]));
  const totalOrders = statusRows.reduce((sum, r) => sum + r.count, 0);

  return {
    orders: {
      total: totalOrders,
      awaitingPayment: byStatus["در انتظار پرداخت"] || 0,
      needsAction: NEEDS_ACTION.reduce((sum, s) => sum + (byStatus[s] || 0), 0),
      shipping: byStatus["در حال ارسال"] || 0,
      completed: byStatus["تحویل داده شد"] || 0,
      cancelled: byStatus[CANCELLED] || 0,
    },
    revenue: { total: revenueAll.total, paidOrders: revenueAll.count, last30: revenue30.total, last30Orders: revenue30.count },
    stock: { low: lowStockCount, out: outOfStockCount, lowList: lowStock },
    products: { total: productCount, published: publishedCount, recent: recentProducts },
    banners: { active: activeBanners, total: totalBanners },
    recentOrders,
  };
}

module.exports = { buildDashboard, lowStockMatch, outOfStockMatch };
