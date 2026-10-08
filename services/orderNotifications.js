const Order = require("../models/Order");
const User = require("../models/User");
const { sendSharedSms } = require("./sms");

const CUSTOMER_BODY_ID = Number(process.env.SMS_ORDER_CUSTOMER_BODY_ID || 551097);
const ADMIN_BODY_ID = Number(process.env.SMS_ORDER_ADMIN_BODY_ID || 551099);
const ADMIN_MOBILES = String(
  process.env.SMS_ORDER_ADMIN_MOBILES || "09014968828,09054243464"
)
  .split(",")
  .map((mobile) => mobile.trim())
  .filter(Boolean);

const normalizeMobile = (value) => {
  const mobile = String(value || "").trim();
  if (!/^09\d{9}$/.test(mobile)) throw new Error(`Invalid order SMS mobile: ${mobile}`);
  return mobile;
};

const trackingCodeFor = (order) =>
  String(order?.trackingNumber || order?.OrderNum || "").trim();

async function notifyRegisteredOrder(orderId) {
  const staleLock = new Date(Date.now() - 5 * 60 * 1000);
  const claimedAt = new Date();
  const lock = await Order.updateOne(
    {
      _id: orderId,
      paymentStatus: "پرداخت شده",
      orderRegisteredSmsSentAt: { $exists: false },
      $or: [
        { orderRegisteredSmsLockAt: { $exists: false } },
        { orderRegisteredSmsLockAt: { $lt: staleLock } },
      ],
    },
    { $set: { orderRegisteredSmsLockAt: claimedAt } }
  );
  if (!lock.modifiedCount) return { skipped: true };

  try {
    const order = await Order.findById(orderId).lean();
    if (!order) throw new Error("Order not found for SMS notification");

    // Per requirement, customer name/mobile come from the account profile in DB.
    const user = await User.findById(order.user).select("mobile fullName").lean();
    if (!user) throw new Error(`User not found for order ${order.OrderNum}`);

    const customerMobile = normalizeMobile(user.mobile);
    const fullName = String(user.fullName || order.recipientName || "مشتری").trim();
    const trackingCode = trackingCodeFor(order);
    if (!trackingCode) throw new Error(`Tracking code is missing for order ${order.OrderNum}`);

    const messages = [
      {
        key: `customer:${customerMobile}`,
        to: customerMobile,
        bodyId: CUSTOMER_BODY_ID,
        args: [fullName, trackingCode],
      },
      ...[...new Set(ADMIN_MOBILES.map(normalizeMobile))].map((to) => ({
        key: `admin:${to}`,
        to,
        bodyId: ADMIN_BODY_ID,
        args: [trackingCode],
      })),
    ];

    const alreadySent = new Set(Array.isArray(order.orderRegisteredSmsKeys) ? order.orderRegisteredSmsKeys : []);
    const pending = messages.filter((message) => !alreadySent.has(message.key));
    const results = await Promise.allSettled(
      pending.map((message) => sendSharedSms(message.to, message.bodyId, message.args))
    );

    const successfulKeys = [];
    results.forEach((result, index) => {
      const message = pending[index];
      if (result.status === "fulfilled") {
        successfulKeys.push(message.key);
      } else {
        console.error(
          `[ORDER SMS] order=${order.OrderNum} to=${message.to} bodyId=${message.bodyId}`,
          result.reason?.message || result.reason
        );
      }
    });

    const nextKeys = [...new Set([...alreadySent, ...successfulKeys])];
    const requiredKeys = messages.map((message) => message.key);
    const allSent = requiredKeys.every((key) => nextKeys.includes(key));
    const update = {
      $set: { orderRegisteredSmsKeys: nextKeys },
      $unset: { orderRegisteredSmsLockAt: 1 },
    };
    if (allSent) update.$set.orderRegisteredSmsSentAt = new Date();

    await Order.updateOne(
      { _id: orderId, orderRegisteredSmsLockAt: claimedAt },
      update
    );

    return { allSent, successfulKeys, pending: pending.length };
  } catch (error) {
    await Order.updateOne(
      { _id: orderId, orderRegisteredSmsLockAt: claimedAt },
      { $unset: { orderRegisteredSmsLockAt: 1 } }
    ).catch(() => {});
    throw error;
  }
}

module.exports = {
  notifyRegisteredOrder,
  trackingCodeFor,
  CUSTOMER_BODY_ID,
  ADMIN_BODY_ID,
  ADMIN_MOBILES,
};
