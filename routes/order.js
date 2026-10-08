const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const Order = require("../models/Order");
const User = require("../models/User");
const Category = require("../models/Category");
const DiscountCode = require("../models/DiscountCode");
const Product = require("../models/Product");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const multer = require("multer");
const upload = multer();
const { body, validationResult } = require("express-validator");
const ZarinPal = require("zarinpal-checkout");
const snappPayService = require("../services/snappPayService");
const torobPayService = require("../services/torobPayService");
const { notifyRegisteredOrder } = require("../services/orderNotifications");
const {
  reconcilerConfig,
  resolveSnappPayAction,
  startSnappPayReconciler,
} = require("../services/snappPayReconciler");
const {
  findColorVariant,
  findSizeVariant,
  getAvailableQuantity,
  hasTrackedStock,
} = require("../services/variantStock");
const {
  buildSnappPayOrderPayload,
  buildTorobPayOrderPayload,
  calculateOrderAmountsToman,
  getCheckoutUnitPriceToman,
  getTorobPaySurchargeToman,
  normalizeIranMobile,
  stableNumericId,
  tomanToIrr,
} = require("../services/orderPricing");
const DELIVERY_METHODS = new Set([
  "تیپاکس",
  "چاپار",
  "ایران-پیام",
  "ارسال-سریع-به-کرج",
  "ارسال-سریع-به-تهران",
]);

const SNAPPPAY_RETURN_COOKIE = "snappPayReturn";
const SNAPPPAY_RETURN_SESSION_TTL_MS = 45 * 60 * 1000;
const TOROBPAY_RETURN_COOKIE = "torobPayReturn";
const TOROBPAY_RETURN_SESSION_TTL_MS = 45 * 60 * 1000;
const ZARINPAL_RETURN_COOKIE = "zarinpalReturn";
const ZARINPAL_RETURN_SESSION_TTL_MS = 45 * 60 * 1000;
const TOROBPAY_MIN_ORDER_TOMAN = 20000;
const TOROBPAY_MAX_ORDER_TOMAN = 100000000;
const ODOUR256_CODE = "ODOUR256";
const SNAPPPAY_ODOUR256_MIN_TOTAL_TOMAN = 3000000;
const TOROBPAY_ODOUR256_MIN_TOTAL_TOMAN = 3000000;

const notifyRegisteredOrderSafely = async (order) => {
  try {
    await notifyRegisteredOrder(order?._id || order);
  } catch (error) {
    console.error("Order registration SMS error:", error.message || error);
  }
};

const isOdour256Code = (code) =>
  String(code || "").trim().toUpperCase() === ODOUR256_CODE;


const hashReturnSessionToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

const getCookieValue = (req, name) => {
  const cookieHeader = String(req.headers.cookie || "");
  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    const rawValue = pair.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch (error) {
      return rawValue;
    }
  }
  return "";
};

const getSnappPayReturnCookieOptions = () => {
  const siteUrl = String(process.env.SITE_URL || "").trim().toLowerCase();
  const secure = siteUrl.startsWith("https://");
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/api/order/snapp-pay/callback",
  };
};

const getTorobPayReturnCookieOptions = () => {
  const siteUrl = String(process.env.SITE_URL || "").trim().toLowerCase();
  const secure = siteUrl.startsWith("https://");
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/api/order/torob-pay/callback",
  };
};

const getZarinpalReturnCookieOptions = () => {
  const siteUrl = String(process.env.SITE_URL || "").trim().toLowerCase();
  const secure = siteUrl.startsWith("https://");
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/api/order/verify",
  };
};

const regenerateSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });

const saveSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });

const restoreSnappPayReturnSession = async (req, res, order) => {
  try {
    const returnToken = getCookieValue(req, SNAPPPAY_RETURN_COOKIE);
    const expectedHash = String(order?.snappPay?.returnSessionTokenHash || "");
    const expiresAt = order?.snappPay?.returnSessionExpiresAt;

    if (!returnToken || !expectedHash || !expiresAt || new Date(expiresAt) < new Date()) {
      return false;
    }

    const actualHash = hashReturnSessionToken(returnToken);
    const expectedBuffer = Buffer.from(expectedHash, "hex");
    const actualBuffer = Buffer.from(actualHash, "hex");
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      return false;
    }

    await regenerateSession(req);
    req.session.userId = String(order.user);
    await saveSession(req);

    const cookieOptions = getSnappPayReturnCookieOptions();
    res.clearCookie(SNAPPPAY_RETURN_COOKIE, cookieOptions);
    order.snappPay.returnSessionTokenHash = undefined;
    order.snappPay.returnSessionExpiresAt = undefined;

    await Order.updateOne(
      { _id: order._id, "snappPay.returnSessionTokenHash": expectedHash },
      {
        $unset: {
          "snappPay.returnSessionTokenHash": 1,
          "snappPay.returnSessionExpiresAt": 1,
        },
      }
    );

    return true;
  } catch (error) {
    console.error("Failed to restore session after SnappPay return:", error.message);
    return false;
  }
};

const restoreTorobPayReturnSession = async (req, res, order) => {
  try {
    const returnToken = getCookieValue(req, TOROBPAY_RETURN_COOKIE);
    const expectedHash = String(order?.torobPay?.returnSessionTokenHash || "");
    const expiresAt = order?.torobPay?.returnSessionExpiresAt;

    if (!returnToken || !expectedHash || !expiresAt || new Date(expiresAt) < new Date()) {
      return false;
    }

    const actualHash = hashReturnSessionToken(returnToken);
    const expectedBuffer = Buffer.from(expectedHash, "hex");
    const actualBuffer = Buffer.from(actualHash, "hex");
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      return false;
    }

    await regenerateSession(req);
    req.session.userId = String(order.user);
    await saveSession(req);

    const cookieOptions = getTorobPayReturnCookieOptions();
    res.clearCookie(TOROBPAY_RETURN_COOKIE, cookieOptions);

    await Order.updateOne(
      { _id: order._id, "torobPay.returnSessionTokenHash": expectedHash },
      {
        $unset: {
          "torobPay.returnSessionTokenHash": 1,
          "torobPay.returnSessionExpiresAt": 1,
        },
      }
    );

    return true;
  } catch (error) {
    console.error("Failed to restore session after TorobPay return:", error.message);
    return false;
  }
};

const restoreZarinpalReturnSession = async (req, res, order) => {
  try {
    const returnToken = getCookieValue(req, ZARINPAL_RETURN_COOKIE);
    const expectedHash = String(order?.paymentInfo?.returnSessionTokenHash || "");
    const expiresAt = order?.paymentInfo?.returnSessionExpiresAt;

    if (!returnToken || !expectedHash || !expiresAt || new Date(expiresAt) < new Date()) {
      return false;
    }

    const actualHash = hashReturnSessionToken(returnToken);
    const expectedBuffer = Buffer.from(expectedHash, "hex");
    const actualBuffer = Buffer.from(actualHash, "hex");
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      return false;
    }

    await regenerateSession(req);
    req.session.userId = String(order.user);
    await saveSession(req);

    const cookieOptions = getZarinpalReturnCookieOptions();
    res.clearCookie(ZARINPAL_RETURN_COOKIE, cookieOptions);
    order.paymentInfo.returnSessionTokenHash = undefined;
    order.paymentInfo.returnSessionExpiresAt = undefined;

    await Order.updateOne(
      { _id: order._id, "paymentInfo.returnSessionTokenHash": expectedHash },
      {
        $unset: {
          "paymentInfo.returnSessionTokenHash": 1,
          "paymentInfo.returnSessionExpiresAt": 1,
        },
      }
    );

    return true;
  } catch (error) {
    console.error("Failed to restore session after ZarinPal return:", error.message);
    return false;
  }
};

const normalizeDeliveryMethod = (delivery) => {
  let normalized = String(delivery || "تیپاکس").trim();
  if (normalized === "ارسال-سریع-از-کرج-به-تهران") {
    normalized = "ارسال-سریع-به-تهران";
  }
  return DELIVERY_METHODS.has(normalized) ? normalized : "تیپاکس";
};

const MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID || "";
const SANDBOX = process.env.ZARINPAL_SANDBOX === "true";
const zarinpal = MERCHANT_ID ? ZarinPal.create(MERCHANT_ID, SANDBOX) : null;

const getZarinpal = () => {
  if (!zarinpal) {
    const error = new Error("ZARINPAL_MERCHANT_ID در متغیرهای محیطی تنظیم نشده است");
    error.statusCode = 503;
    throw error;
  }
  return zarinpal;
};

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const validateOrderInput = [
  body("postcode").trim().matches(/^\d{10}$/).withMessage("کد پستی باید ۱۰ رقم باشد"),
  body("address")
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage("آدرس باید بین ۱۰ تا ۵۰۰ کاراکتر باشد"),
  body("province").trim().isLength({ min: 2, max: 100 }).withMessage("استان الزامی است"),
  body("city").trim().isLength({ min: 2, max: 100 }).withMessage("شهر الزامی است"),
  body("delivery").optional().trim(),
  body("paymentMethod").optional().trim(),
  // Recipient details collected at checkout (phone + OTP accounts start without a name).
  body("fullName").optional({ values: "falsy" }).trim().isLength({ min: 3, max: 50 }).withMessage("نام و نام خانوادگی باید بین ۳ تا ۵۰ حرف باشد"),
  body("recipientMobile").optional({ values: "falsy" }).trim().matches(/^09\d{9}$/).withMessage("شماره موبایل گیرنده معتبر نیست"),
];

// Keeps the five most recent distinct delivery addresses for checkout prefill.
const rememberAddress = (user, entry) => {
  const same = (a) => a.postcode === entry.postcode && a.address === entry.address;
  const others = (user.addresses || []).filter((a) => !same(a));
  user.addresses = [{ ...entry, updatedAt: new Date() }, ...others.map((a) => (a.toObject ? a.toObject() : a))].slice(0, 5);
};

class CheckoutError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = "CheckoutError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const errorResponse = (res, status, message, details = {}) =>
  res.status(status).json({ success: false, message, ...details });

const normalizePaymentMethod = (value) => {
  const normalized = String(value || "zarinpal").trim().toLowerCase();
  if (["snappay", "snapp-pay", "اسنپ‌پی", "اسنپ پی"].includes(normalized)) {
    return "snappay";
  }
  if (["torobpay", "torob-pay", "ترب‌پی", "ترب پی"].includes(normalized)) {
    return "torobpay";
  }
  return "zarinpal";
};

const buildMenuData = async () => {
  const allCategories = await Category.find({
    categoryType: "product",
    isActive: true,
  });

  const categoryMap = {};
  allCategories.forEach((category) => {
    categoryMap[category._id] = { ...category.toObject(), children: [] };
  });

  const menuCategories = [];
  allCategories.forEach((category) => {
    if (category.parentId && categoryMap[category.parentId]) {
      categoryMap[category.parentId].children.push(categoryMap[category._id]);
    } else if (!category.parentId) {
      menuCategories.push(categoryMap[category._id]);
    }
  });

  const footerCategories = await Category.find({
    categoryType: "product",
    parentId: null,
    isActive: true,
  })
    .limit(5)
    .sort({ name: 1 });

  return { menuCategories, footerCategories };
};

const registerOrderDiscountUsage = async (order) => {
  if (!order.discount?.discountId) return;

  try {
    const discount = await DiscountCode.findById(order.discount.discountId);
    if (discount) {
      await discount.registerUserUsage(order.user, order._id);
    }
  } catch (error) {
    // پرداخت موفق است؛ خطای آمار تخفیف نباید نتیجه پرداخت را تغییر دهد.
    console.error("Failed to register discount usage:", {
      orderId: order._id,
      error: error.message,
    });
  }
};

const resolveDiscount = async ({
  session,
  subtotal,
  products = [],
  userId,
  clearInvalid = true,
}) => {
  const code = session?.discount?.code;
  if (!code) {
    return { discountAmount: 0, appliedDiscount: null, discountBaseSubtotal: subtotal };
  }

  const invalidate = (message) => {
    if (clearInvalid) delete session.discount;
    throw new CheckoutError(message);
  };

  const discount = await DiscountCode.findOne({ code: String(code).toUpperCase() });
  const now = new Date();

  if (!discount || !discount.isActive) invalidate("کد تخفیف نامعتبر است");
  if (discount.expireDate && discount.expireDate < now) invalidate("کد تخفیف منقضی شده است");
  if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
    invalidate("تعداد استفاده از این کد تخفیف به پایان رسیده است");
  }

  // odour256 must never discount products that already have an offerPrice.
  const discountBaseSubtotal = isOdour256Code(discount.code)
    ? products
        .filter((item) => !item.hadProductDiscount)
        .reduce(
          (sum, item) => sum + Number(item.priceAtPurchase || 0) * Number(item.quantity || 0),
          0
        )
    : subtotal;

  if (isOdour256Code(discount.code) && discountBaseSubtotal <= 0) {
    invalidate("کد تخفیف odour256 روی محصولات دارای قیمت ویژه قابل استفاده نیست");
  }
  if (discount.minOrderAmount && discountBaseSubtotal < discount.minOrderAmount) {
    invalidate(`حداقل مبلغ سفارش برای این کد تخفیف ${discount.minOrderAmount} تومان است`);
  }
  if (discount.oneTimePerUser && discount.hasUserUsed(userId)) {
    invalidate("شما قبلاً از این کد تخفیف استفاده کرده‌اید");
  }

  let discountAmount = 0;
  if (discount.type === "percent") {
    discountAmount = Math.floor((discountBaseSubtotal * discount.amount) / 100);
    if (discount.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, discount.maxDiscountAmount);
    }
  } else {
    discountAmount = Math.min(discount.amount, discountBaseSubtotal);
  }

  return {
    discountAmount,
    discountBaseSubtotal,
    appliedDiscount: {
      discountId: discount._id,
      type: discount.type,
      amount: discount.amount,
      calculatedAmount: discountAmount,
      code: discount.code,
      originalValue:
        discount.type === "percent"
          ? `${discount.amount}%`
          : `${discount.amount} تومان`,
    },
  };
};

const buildCheckoutQuote = async ({
  user,
  delivery,
  session,
  paymentProvider = "zarinpal",
  clearInvalidDiscount = true,
}) => {
  if (!user?.cart?.length) {
    throw new CheckoutError("سبد خرید شما خالی است");
  }

  const unavailableProducts = [];
  const products = [];

  for (const item of user.cart) {
    const productId = item.productId?._id || item.productId;
    const product = await Product.findById(productId);

    if (!product) {
      unavailableProducts.push({
        productId,
        name: "نامعلوم",
        requested: item.quantity,
        available: 0,
      });
      continue;
    }

    if (Array.isArray(product.colors) && product.colors.length > 0 && !item.selectedColor && !item.selectedVariantId) {
      unavailableProducts.push({
        productId,
        name: product.name,
        reason: "رنگ محصول انتخاب نشده است",
      });
      continue;
    }
    if (Array.isArray(product.sizes) && product.sizes.length > 0 && !item.selectedSize && !item.selectedSizeId) {
      unavailableProducts.push({
        productId,
        name: product.name,
        reason: "سایز محصول انتخاب نشده است",
      });
      continue;
    }

    const colorVariant = findColorVariant(product, {
      selectedColor: item.selectedColor,
      selectedVariantId: item.selectedVariantId,
    });
    if ((item.selectedColor || item.selectedVariantId) && !colorVariant) {
      unavailableProducts.push({
        productId,
        name: product.name,
        reason: "تنوع رنگی انتخاب‌شده دیگر وجود ندارد",
      });
      continue;
    }

    const sizeVariant = findSizeVariant(product, {
      selectedSize: item.selectedSize,
      selectedSizeId: item.selectedSizeId,
    });
    if (item.selectedSize && !sizeVariant) {
      unavailableProducts.push({
        productId,
        name: product.name,
        reason: "سایز انتخاب‌شده دیگر وجود ندارد",
      });
      continue;
    }

    const availableQuantity = getAvailableQuantity(product, colorVariant, sizeVariant);
    if (availableQuantity < Number(item.quantity)) {
      unavailableProducts.push({
        productId,
        name: product.name,
        requested: Number(item.quantity),
        available: availableQuantity,
        reason: availableQuantity <= 0 ? "تنوع انتخاب‌شده ناموجود است" : "موجودی تنوع کافی نیست",
      });
      continue;
    }

    const selectedColor = colorVariant?.name || item.selectedColor || null;
    const selectedVariantId = colorVariant?._id ? String(colorVariant._id) : null;
    const selectedSize = sizeVariant?.size || item.selectedSize || null;
    const selectedSizeId = sizeVariant?._id ? String(sizeVariant._id) : null;
    const hadProductDiscount =
      Number(product.offerPrice) > 0 && Number(product.offerPrice) < Number(product.price);
    const salePrice = getCheckoutUnitPriceToman({
      regularPrice: product.price,
      offerPrice: product.offerPrice,
      paymentProvider,
    });
    const variantKey = selectedVariantId || selectedColor || selectedSizeId || selectedSize || "base";
    const variantStockTracked = product.variantInventoryConfigured === true;

    products.push({
      product: product._id,
      quantity: Number(item.quantity),
      priceAtPurchase: Number(salePrice),
      originalUnitPrice: Number(product.price),
      hadProductDiscount,
      categoryAtPurchase: product.subCat || product.catName || "عمومی",
      commissionType: 100,
      snappItemId: stableNumericId(`${product._id}:${variantKey}`),
      nameAtPurchase: product.name,
      selectedColor,
      selectedVariantId,
      colorStockTracked: !variantStockTracked && hasTrackedStock(colorVariant),
      selectedSize,
      selectedSizeId,
      sizeStockTracked: !variantStockTracked && hasTrackedStock(sizeVariant),
      variantStockTracked,
    });
  }

  if (unavailableProducts.length) {
    throw new CheckoutError("برخی محصولات موجود نیستند", 400, { unavailableProducts });
  }

  const subtotal = products.reduce(
    (sum, item) => sum + item.priceAtPurchase * item.quantity,
    0
  );
  const { discountAmount, appliedDiscount } = await resolveDiscount({
    session,
    subtotal,
    products,
    userId: user._id,
    clearInvalid: clearInvalidDiscount,
  });

  const normalizedDelivery = normalizeDeliveryMethod(delivery);
  // TorobPay adds a 12% merchant surcharge to the payable amount after discounts.
  // We keep it in taxAmount because the TorobPay payload has a dedicated taxAmount field.
  const payableBeforeTorobSurcharge = Math.max(0, subtotal - discountAmount);
  const taxAmount =
    paymentProvider === "torobpay"
      ? getTorobPaySurchargeToman(payableBeforeTorobSurcharge)
      : 0;
  const externalSourceAmount = 0;
  const amounts = calculateOrderAmountsToman({
    products,
    taxAmount,
    discountAmount,
    externalSourceAmount,
  });

  return {
    products,
    subtotal,
    delivery: normalizedDelivery,
    taxAmount,
    externalSourceAmount,
    discountAmount,
    appliedDiscount,
    totalPrice: amounts.amount,
  };
};

const releaseInventory = async (products) => {
  for (const item of products || []) {
    const quantity = Number(item.quantity);
    const update = { $inc: { countInStock: quantity } };
    const arrayFilters = [];

    if (item.variantStockTracked) {
      update.$inc["variantStocks.$[variant].countInStock"] = quantity;
      arrayFilters.push({
        "variant.colorId": String(item.selectedVariantId || ""),
        "variant.sizeId": String(item.selectedSizeId || ""),
      });
    } else {
      if (item.colorStockTracked && item.selectedVariantId) {
        update.$inc["colors.$[color].countInStock"] = quantity;
        arrayFilters.push({ "color._id": item.selectedVariantId });
      }
      if (item.sizeStockTracked && item.selectedSizeId) {
        update.$inc["sizes.$[size].countInStock"] = quantity;
        arrayFilters.push({ "size._id": item.selectedSizeId });
      }
    }

    const options = { new: true };
    if (arrayFilters.length) options.arrayFilters = arrayFilters;
    const product = await Product.findOneAndUpdate({ _id: item.product }, update, options);
    if (!product) continue;

    if (Number(product.countInStock) > 0) product.isOutOfStock = false;
    if (!item.variantStockTracked) {
      if (item.colorStockTracked && item.selectedVariantId) {
        const color = product.colors?.id?.(item.selectedVariantId);
        if (color && Number(color.countInStock) > 0) color.isOutOfStock = false;
      }
      if (item.sizeStockTracked && item.selectedSizeId) {
        const size = product.sizes?.id?.(item.selectedSizeId);
        if (size && Number(size.countInStock) > 0) size.isOutOfStock = false;
      }
    }
    await product.save();
  }
};

const reserveInventory = async (products) => {
  const reserved = [];
  try {
    for (const item of products) {
      const quantity = Number(item.quantity);
      const query = {
        _id: item.product,
        countInStock: { $gte: quantity },
        isOutOfStock: { $ne: true },
      };
      const update = { $inc: { countInStock: -quantity } };
      const arrayFilters = [];

      if (item.variantStockTracked) {
        query.variantInventoryConfigured = true;
        query.variantStocks = {
          $elemMatch: {
            colorId: String(item.selectedVariantId || ""),
            sizeId: String(item.selectedSizeId || ""),
            countInStock: { $gte: quantity },
            isOutOfStock: { $ne: true },
          },
        };
        update.$inc["variantStocks.$[variant].countInStock"] = -quantity;
        arrayFilters.push({
          "variant.colorId": String(item.selectedVariantId || ""),
          "variant.sizeId": String(item.selectedSizeId || ""),
          "variant.countInStock": { $gte: quantity },
          "variant.isOutOfStock": { $ne: true },
        });
      } else {
        if (item.selectedVariantId) {
          query.colors = item.colorStockTracked
            ? { $elemMatch: { _id: item.selectedVariantId, countInStock: { $gte: quantity }, isOutOfStock: { $ne: true } } }
            : { $elemMatch: { _id: item.selectedVariantId, isOutOfStock: { $ne: true } } };
          if (item.colorStockTracked) {
            update.$inc["colors.$[color].countInStock"] = -quantity;
            arrayFilters.push({
              "color._id": item.selectedVariantId,
              "color.countInStock": { $gte: quantity },
              "color.isOutOfStock": { $ne: true },
            });
          }
        }
        if (item.selectedSizeId) {
          query.sizes = item.sizeStockTracked
            ? { $elemMatch: { _id: item.selectedSizeId, countInStock: { $gte: quantity }, isOutOfStock: { $ne: true } } }
            : { $elemMatch: { _id: item.selectedSizeId, isOutOfStock: { $ne: true } } };
          if (item.sizeStockTracked) {
            update.$inc["sizes.$[size].countInStock"] = -quantity;
            arrayFilters.push({
              "size._id": item.selectedSizeId,
              "size.countInStock": { $gte: quantity },
              "size.isOutOfStock": { $ne: true },
            });
          }
        }
      }

      const options = { new: true };
      if (arrayFilters.length) options.arrayFilters = arrayFilters;
      const result = await Product.findOneAndUpdate(query, update, options);
      if (!result) throw new CheckoutError(`موجودی «${item.nameAtPurchase}» تغییر کرده است`);

      if (Number(result.countInStock) <= 0) result.isOutOfStock = true;
      if (!item.variantStockTracked) {
        if (item.colorStockTracked && item.selectedVariantId) {
          const color = result.colors?.id?.(item.selectedVariantId);
          if (color && Number(color.countInStock) <= 0) color.isOutOfStock = true;
        }
        if (item.sizeStockTracked && item.selectedSizeId) {
          const size = result.sizes?.id?.(item.selectedSizeId);
          if (size && Number(size.countInStock) <= 0) size.isOutOfStock = true;
        }
      }
      await result.save();
      reserved.push(item);
    }
    return reserved;
  } catch (error) {
    await releaseInventory(reserved);
    throw error;
  }
};

const rollbackOrderCreation = async ({ order, user, originalCart, reservedProducts }) => {
  try {
    await releaseInventory(reservedProducts || []);

    if (user) {
      user.cart = originalCart || [];
      if (order?._id) {
        user.orders = (user.orders || []).filter((id) => String(id) !== String(order._id));
      }
      await user.save();
    }

    if (order?._id) await Order.deleteOne({ _id: order._id });
  } catch (rollbackError) {
    console.error("Checkout rollback failed:", rollbackError);
  }
};

const restoreFailedOrderInventory = async (order) => {
  if (!order?.inventoryReserved || order.inventoryRestored) return;

  await releaseInventory(order.products);

  const user = await User.findById(order.user);
  if (user) {
    for (const item of order.products) {
      const existing = user.cart.find(
        (cartItem) =>
          String(cartItem.productId) === String(item.product) &&
          String(cartItem.selectedColor || "") === String(item.selectedColor || "") &&
          String(cartItem.selectedSize || "") === String(item.selectedSize || "")
      );
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        user.cart.push({
          productId: item.product,
          quantity: item.quantity,
          selectedColor: item.selectedColor || undefined,
          selectedVariantId: item.selectedVariantId || undefined,
          selectedSize: item.selectedSize || undefined,
          selectedSizeId: item.selectedSizeId || undefined,
        });
      }
    }
    await user.save();
  }

  order.inventoryRestored = true;
  order.inventoryReserved = false;
};

const snappStatus = (result) => String(result?.status || "").trim().toUpperCase();
const torobStatus = (result) => String(result?.status || "").trim().toUpperCase();

// PDP intentionally does not call SnappPay eligible; eligibility is checked only at checkout.

router.post("/snapp-pay/eligible", isLoggedIn, async (req, res) => {
  try {
    const configured = snappPayService.isConfigured();
    console.log("[SnappPay][eligible][route-start]", {
      configured,
      delivery: req.body.delivery || "",
      hasSessionUser: Boolean(req.session?.userId),
    });

    if (!configured) {
      console.warn("[SnappPay][eligible][hidden] SnappPay is not configured", {
        baseUrlConfigured: Boolean(snappPayService.config?.baseUrl),
        clientIdConfigured: Boolean(snappPayService.config?.clientId),
        clientSecretConfigured: Boolean(snappPayService.config?.clientSecret),
        usernameConfigured: Boolean(snappPayService.config?.username),
        passwordConfigured: Boolean(snappPayService.config?.password),
      });
      return res.json({ success: true, enabled: false, eligible: false, reason: "not_configured" });
    }

    const user = await User.findById(req.session.userId).populate("cart.productId");
    if (!user) {
      console.warn("[SnappPay][eligible][hidden] user_not_found");
      return errorResponse(res, 404, "کاربر یافت نشد");
    }

    const quote = await buildCheckoutQuote({
      user,
      delivery: req.body.delivery,
      session: req.session,
      paymentProvider: "snappay",
    });

    const amountIrr = tomanToIrr(quote.totalPrice);
    console.log("[SnappPay][eligible][quote]", {
      amountToman: quote.totalPrice,
      amountIrr,
      delivery: quote.delivery,
      discountCode: quote.appliedDiscount?.code || null,
      cartItemsCount: quote.products?.length || 0,
    });

    if (isOdour256Code(quote.appliedDiscount?.code) && quote.totalPrice <= SNAPPPAY_ODOUR256_MIN_TOTAL_TOMAN) {
      const blockedResponse = {
        success: true,
        enabled: false,
        eligible: false,
        reason: "odour256_min_amount",
        amountToman: quote.totalPrice,
        minAmountToman: SNAPPPAY_ODOUR256_MIN_TOTAL_TOMAN,
        message: `برای پرداخت با اسنپ‌پی همراه کد odour256، مبلغ نهایی سبد باید بیشتر از ${SNAPPPAY_ODOUR256_MIN_TOTAL_TOMAN.toLocaleString("fa-IR")} تومان باشد`,
      };
      console.warn("[SnappPay][eligible][hidden] odour256_min_amount", blockedResponse);
      return res.json(blockedResponse);
    }

    // طبق گایدلاین اسنپ‌پی، به‌جز قانون تجاری اختصاصی odour256، محدودیت مبلغ
    // عمومی اسنپ‌پی را سمت مرچنت hard-code نمی‌کنیم.
    // مبلغ نهایی فعلی عیناً به سرویس eligible فرستاده می‌شود و فقط همان پاسخ
    // تعیین می‌کند روش پرداخت نمایش داده شود یا خیر (حدود تست/پروداکشن ممکن است متفاوت باشند).
    const result = await snappPayService.eligible(amountIrr);
    console.log("[SnappPay][eligible][provider-result]", result);

    const isEligible = result?.eligible === true;
    const responsePayload = {
      success: true,
      enabled: isEligible,
      eligible: isEligible,
      amountToman: quote.totalPrice,
      // title_message و description باید دقیقاً و بدون متن جایگزین از پاسخ eligible نمایش داده شوند.
      title_message: result?.title_message ?? "",
      description: result?.description ?? "",
    };

    console.log(
      isEligible ? "[SnappPay][eligible][visible]" : "[SnappPay][eligible][hidden] provider_returned_not_eligible",
      responsePayload
    );

    return res.json(responsePayload);
  } catch (error) {
    console.error("[SnappPay][eligible][route-error]", {
      message: error.message,
      statusCode: error.statusCode,
      httpStatus: error.httpStatus,
      errorCode: error.errorCode,
      systemError: error.systemError,
      responseBody: error.responseBody,
      details: error.details,
      stack: error.stack,
    });
    return errorResponse(res, error.statusCode || error.httpStatus || 500, error.message, error.details);
  }
});

router.post("/torob-pay/eligible", isLoggedIn, async (req, res) => {
  try {
    if (!torobPayService.isConfigured()) {
      return res.json({ success: true, enabled: false, reason: "not_configured" });
    }

    const user = await User.findById(req.session.userId).populate("cart.productId");
    if (!user) return errorResponse(res, 404, "کاربر یافت نشد");

    const quote = await buildCheckoutQuote({
      user,
      delivery: req.body.delivery,
      session: req.session,
      paymentProvider: "torobpay",
    });

    if (isOdour256Code(quote.appliedDiscount?.code) && quote.totalPrice <= TOROBPAY_ODOUR256_MIN_TOTAL_TOMAN) {
      return res.json({
        success: true,
        enabled: false,
        eligible: false,
        reason: "odour256_min_amount",
        amountToman: quote.totalPrice,
        minAmountToman: TOROBPAY_ODOUR256_MIN_TOTAL_TOMAN,
        message: `برای پرداخت با ترب‌پی همراه کد odour256، مبلغ نهایی سبد باید بیشتر از ${TOROBPAY_ODOUR256_MIN_TOTAL_TOMAN.toLocaleString("fa-IR")} تومان باشد`,
      });
    }

    if (quote.totalPrice < TOROBPAY_MIN_ORDER_TOMAN || quote.totalPrice > TOROBPAY_MAX_ORDER_TOMAN) {
      return res.json({
        success: true,
        enabled: false,
        eligible: false,
        reason: "amount_range",
        amountToman: quote.totalPrice,
        minAmountToman: TOROBPAY_MIN_ORDER_TOMAN,
        maxAmountToman: TOROBPAY_MAX_ORDER_TOMAN,
      });
    }

    const result = await torobPayService.eligible(tomanToIrr(quote.totalPrice));
    return res.json({
      success: true,
      enabled: Boolean(result?.eligible),
      eligible: Boolean(result?.eligible),
      amountToman: quote.totalPrice,
      title: result?.message_title || "پرداخت اقساطی با ترب‌پی",
      description: result?.description || "",
    });
  } catch (error) {
    console.error("TorobPay eligibility error:", error.message);
    // اختلال ترب‌پی نباید امکان پرداخت با سایر درگاه‌ها را از کار بیندازد.
    return res.json({
      success: true,
      enabled: false,
      eligible: false,
      reason: "service_error",
    });
  }
});

router.post("/", upload.none(), isLoggedIn, validateOrderInput, async (req, res) => {
  let order = null;
  let user = null;
  let originalCart = [];
  let reservedProducts = [];

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, "خطا در اعتبارسنجی", { errors: errors.array() });
    }

    const paymentProvider = normalizePaymentMethod(req.body.paymentMethod);
    if (paymentProvider === "snappay" && !snappPayService.isConfigured()) {
      throw new CheckoutError("درگاه اسنپ‌پی هنوز روی سرور تنظیم نشده است", 503);
    }
    if (paymentProvider === "torobpay" && !torobPayService.isConfigured()) {
      throw new CheckoutError("درگاه ترب‌پی هنوز روی سرور تنظیم نشده است", 503);
    }

    user = await User.findById(req.session.userId).populate("cart.productId");
    if (!user) throw new CheckoutError("کاربر یافت نشد", 404);

    const recipientName = String(req.body.fullName || user.fullName || "").trim();
    if (recipientName.length < 3) {
      throw new CheckoutError("لطفاً نام و نام خانوادگی تحویل‌گیرنده را وارد کنید", 400, {
        errors: [{ path: "fullName", msg: "نام و نام خانوادگی الزامی است" }],
      });
    }
    if (!user.fullName) user.fullName = recipientName;
    const recipientMobile = String(req.body.recipientMobile || user.mobile || "").trim();

    originalCart = user.cart.map((item) => ({
      productId: item.productId?._id || item.productId,
      quantity: item.quantity,
      selectedColor: item.selectedColor || undefined,
      selectedVariantId: item.selectedVariantId || undefined,
      selectedSize: item.selectedSize || undefined,
      selectedSizeId: item.selectedSizeId || undefined,
    }));
    const quote = await buildCheckoutQuote({
      user,
      delivery: req.body.delivery,
      session: req.session,
      paymentProvider,
    });

    if (
      paymentProvider === "snappay" &&
      isOdour256Code(quote.appliedDiscount?.code) &&
      quote.totalPrice <= SNAPPPAY_ODOUR256_MIN_TOTAL_TOMAN
    ) {
      throw new CheckoutError(
        `برای پرداخت با اسنپ‌پی همراه کد odour256، مبلغ نهایی سبد باید بیشتر از ${SNAPPPAY_ODOUR256_MIN_TOTAL_TOMAN.toLocaleString("fa-IR")} تومان باشد`,
        400
      );
    }

    if (
      paymentProvider === "torobpay" &&
      isOdour256Code(quote.appliedDiscount?.code) &&
      quote.totalPrice <= TOROBPAY_ODOUR256_MIN_TOTAL_TOMAN
    ) {
      throw new CheckoutError(
        `برای پرداخت با ترب‌پی همراه کد odour256، مبلغ نهایی سبد باید بیشتر از ${TOROBPAY_ODOUR256_MIN_TOTAL_TOMAN.toLocaleString("fa-IR")} تومان باشد`,
        400
      );
    }

    if (
      paymentProvider === "torobpay" &&
      (quote.totalPrice < TOROBPAY_MIN_ORDER_TOMAN || quote.totalPrice > TOROBPAY_MAX_ORDER_TOMAN)
    ) {
      throw new CheckoutError(
        `مبلغ سفارش برای ترب‌پی باید بین ${TOROBPAY_MIN_ORDER_TOMAN.toLocaleString("fa-IR")} تا ${TOROBPAY_MAX_ORDER_TOMAN.toLocaleString("fa-IR")} تومان باشد`,
        400
      );
    }

    order = new Order({
      OrderNum: req.session.OrderNum || `ORD-${Date.now()}`,
      postcode: req.body.postcode,
      address: req.body.address,
      province: req.body.province,
      city: req.body.city,
      user: user._id,
      recipientName,
      recipientMobile,
      products: quote.products,
      delivery: quote.delivery,
      originalPrice: quote.subtotal,
      taxAmount: quote.taxAmount,
      externalSourceAmount: quote.externalSourceAmount,
      totalPrice: quote.totalPrice,
      discount: quote.appliedDiscount,
      discountAmount: quote.discountAmount,
      status: "در انتظار پرداخت",
      paymentMethod:
        paymentProvider === "snappay"
          ? "اسنپ‌پی"
          : paymentProvider === "torobpay"
            ? "ترب‌پی"
            : "زرین‌پال",
      paymentStatus: "پرداخت نشده",
      inventoryReserved: false,
      inventoryRestored: false,
    });
    await order.save();

    reservedProducts = await reserveInventory(order.products);
    order.inventoryReserved = true;
    await order.save();

    user.cart = [];
    user.orders.push(order._id);
    rememberAddress(user, {
      fullName: recipientName,
      mobile: recipientMobile,
      province: req.body.province,
      city: req.body.city,
      address: req.body.address,
      postcode: req.body.postcode,
    });
    await user.save();

    let paymentUrl;
    if (paymentProvider === "snappay") {
      const eligibleResult = await snappPayService.eligible(tomanToIrr(order.totalPrice));
      if (eligibleResult?.eligible !== true) {
        throw new CheckoutError(
          eligibleResult?.description || "این سفارش در حال حاضر واجد شرایط پرداخت با اسنپ‌پی نیست"
        );
      }

      const siteUrl = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
      if (!siteUrl) {
        throw new CheckoutError("SITE_URL برای کال‌بک اسنپ‌پی تنظیم نشده است", 503);
      }
      if (process.env.NODE_ENV === "production" && !siteUrl.startsWith("https://")) {
        throw new CheckoutError("SITE_URL محیط پروداکشن اسنپ‌پی باید HTTPS باشد", 503);
      }

      const returnSessionToken = crypto.randomBytes(32).toString("base64url");
      const returnSessionExpiresAt = new Date(
        Date.now() + SNAPPPAY_RETURN_SESSION_TTL_MS
      );

      const payload = {
        ...buildSnappPayOrderPayload(order),
        mobile: normalizeIranMobile(user.mobile),
        returnURL: `${siteUrl}/api/order/snapp-pay/callback`,
        transactionId: order.OrderNum,
      };
      // Do not constrain the payment method in payment/v1/token; SnappPay chooses it from eligibility/account config.
      const tokenResult = await snappPayService.createPaymentToken(payload);
      console.log("[SnappPay][token]", { orderNum: order.OrderNum, paymentToken: tokenResult?.paymentToken });
      if (!tokenResult?.paymentToken || !tokenResult?.paymentPageUrl) {
        throw new CheckoutError("پاسخ ایجاد پرداخت اسنپ‌پی کامل نیست", 502);
      }

      order.snappPay = {
        ...order.snappPay?.toObject?.(),
        paymentToken: tokenResult.paymentToken,
        transactionId: order.OrderNum,
        cartId: payload.cartList[0].cartId,
        status: "PENDING",
        eligibleTitle: eligibleResult.title_message,
        eligibleDescription: eligibleResult.description,
        returnSessionTokenHash: hashReturnSessionToken(returnSessionToken),
        returnSessionExpiresAt,
      };
      res.cookie(SNAPPPAY_RETURN_COOKIE, returnSessionToken, {
        ...getSnappPayReturnCookieOptions(),
        maxAge: SNAPPPAY_RETURN_SESSION_TTL_MS,
      });
      paymentUrl = tokenResult.paymentPageUrl;
      order.paymentInfo.paymentUrl = paymentUrl;
    } else if (paymentProvider === "torobpay") {
      const eligibleResult = await torobPayService.eligible(tomanToIrr(order.totalPrice));
      if (!eligibleResult?.eligible) {
        throw new CheckoutError(
          eligibleResult?.description || "این سفارش در حال حاضر واجد شرایط پرداخت با ترب‌پی نیست"
        );
      }

      const siteUrl = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
      if (!siteUrl) {
        throw new CheckoutError("SITE_URL برای کال‌بک ترب‌پی تنظیم نشده است", 503);
      }
      if (process.env.NODE_ENV === "production" && !siteUrl.startsWith("https://")) {
        throw new CheckoutError("SITE_URL محیط پروداکشن ترب‌پی باید HTTPS باشد", 503);
      }

      const returnSessionToken = crypto.randomBytes(32).toString("base64url");
      const returnSessionExpiresAt = new Date(
        Date.now() + TOROBPAY_RETURN_SESSION_TTL_MS
      );
      const returnURL = `${siteUrl}/api/order/torob-pay/callback`;
      const payload = buildTorobPayOrderPayload(order, {
        user,
        returnURL,
      });

      const tokenResult = await torobPayService.createPaymentToken(payload);
      if (!tokenResult?.paymentToken || !tokenResult?.paymentPageUrl) {
        throw new CheckoutError("پاسخ ایجاد پرداخت ترب‌پی کامل نیست", 502);
      }

      order.torobPay = {
        ...order.torobPay?.toObject?.(),
        paymentToken: tokenResult.paymentToken,
        transactionId: order.OrderNum,
        status: "PENDING",
        eligibleTitle: eligibleResult.message_title || "پرداخت اقساطی با ترب‌پی",
        eligibleDescription: eligibleResult.description || "",
        returnSessionTokenHash: hashReturnSessionToken(returnSessionToken),
        returnSessionExpiresAt,
      };
      res.cookie(TOROBPAY_RETURN_COOKIE, returnSessionToken, {
        ...getTorobPayReturnCookieOptions(),
        maxAge: TOROBPAY_RETURN_SESSION_TTL_MS,
      });
      paymentUrl = tokenResult.paymentPageUrl;
      order.paymentInfo.paymentUrl = paymentUrl;
    } else {
      const fullName = user.fullName || "کاربر";
      const description = `سفارش ${order.OrderNum} - ${fullName}`.slice(0, 250);
      const returnSessionToken = crypto.randomBytes(32).toString("base64url");
      const returnSessionExpiresAt = new Date(
        Date.now() + ZARINPAL_RETURN_SESSION_TTL_MS
      );
      const payment = await getZarinpal().PaymentRequest({
        Amount: order.totalPrice,
        CallbackURL: `${String(process.env.SITE_URL || "http://localhost:7000").replace(/\/$/, "")}/api/order/verify`,
        Description: description,
        Email: user.email,
        Mobile: user.mobile,
      });
      paymentUrl = payment.url;
      order.paymentInfo.authority = payment.authority;
      order.paymentInfo.paymentUrl = payment.url;
      order.paymentInfo.returnSessionTokenHash = hashReturnSessionToken(returnSessionToken);
      order.paymentInfo.returnSessionExpiresAt = returnSessionExpiresAt;
      res.cookie(ZARINPAL_RETURN_COOKIE, returnSessionToken, {
        ...getZarinpalReturnCookieOptions(),
        maxAge: ZARINPAL_RETURN_SESSION_TTL_MS,
      });
    }

    await order.save();
    delete req.session.OrderNum;
    delete req.session.discount;

    return res.json({
      success: true,
      paymentUrl,
      provider: paymentProvider,
      orderNumber: order.OrderNum,
    });
  } catch (error) {
    console.error("Order creation error:", error.message);
    if (order?._id) {
      await rollbackOrderCreation({ order, user, originalCart, reservedProducts });
    }

    if (error.code === 11000) {
      return errorResponse(res, 409, "شماره سفارش تکراری است");
    }
    return errorResponse(
      res,
      error.statusCode || (error.name === "ValidationError" ? 400 : 500),
      error.message || "خطای سرور در ثبت سفارش",
      error.details
    );
  }
});

router.get("/verify", async (req, res) => {
  try {
    const { Authority, Status } = req.query;
    if (!Authority) return errorResponse(res, 400, "Authority is required");

    const order = await Order.findOne({ "paymentInfo.authority": Authority });
    if (!order) return errorResponse(res, 404, "سفارش یافت نشد");

    // ZarinPal may return without the normal SameSite=Lax session cookie in
    // some browser/payment flows. Restore the authenticated customer session
    // using a short-lived, callback-only token created before redirecting.
    await restoreZarinpalReturnSession(req, res, order);

    if (order.paymentStatus === "پرداخت شده") {
      await registerOrderDiscountUsage(order);
      await notifyRegisteredOrderSafely(order);
      return res.redirect(`/api/order/payment-success?orderNum=${encodeURIComponent(order.OrderNum)}`);
    }

    if (Status !== "OK") {
      order.status = "لغو شده";
      order.paymentStatus = "لغو شده";
      await restoreFailedOrderInventory(order);
      await order.save();
      return res.redirect("/api/order/payment-failed");
    }

    const verification = await getZarinpal().PaymentVerification({
      Amount: order.totalPrice,
      Authority,
    });

    if (verification.status === 100 || verification.status === 101) {
      order.paymentStatus = "پرداخت شده";
      order.status = "در حال پردازش";
      order.paymentInfo.refId = verification.refId || order.paymentInfo.refId;
      order.paymentInfo.cardPan = verification.cardPan || order.paymentInfo.cardPan;
      order.paymentInfo.paymentDate = order.paymentInfo.paymentDate || new Date();
      await order.save();
      await registerOrderDiscountUsage(order);
      await notifyRegisteredOrderSafely(order);
      return res.redirect(`/api/order/payment-success?orderNum=${encodeURIComponent(order.OrderNum)}`);
    }

    order.status = "لغو شده";
    order.paymentStatus = "لغو شده";
    await restoreFailedOrderInventory(order);
    await order.save();
    return res.redirect("/api/order/payment-failed");
  } catch (error) {
    console.error("Error in Zarinpal verify endpoint:", error);
    return res.status(500).json({ success: false, message: "خطای سرور", error: error.message });
  }
});

const markTorobPayOrderPaid = async (order, result = {}) => {
  order.torobPay.status = "SETTLE";
  order.torobPay.transactionId = result?.transactionId || order.torobPay.transactionId || order.OrderNum;
  order.torobPay.settledAt = order.torobPay.settledAt || new Date();
  order.torobPay.lastStatusCheckAt = new Date();
  order.torobPay.lastError = undefined;
  order.torobPay.processing = false;
  order.paymentStatus = "پرداخت شده";
  order.paymentInfo.paymentDate = order.paymentInfo.paymentDate || new Date();
  order.paymentInfo.refId = order.torobPay.transactionId;
  order.status = "در حال پردازش";
  await order.save();
  await registerOrderDiscountUsage(order);
  await notifyRegisteredOrderSafely(order);
};

const markTorobPayOrderReverted = async (order, result = {}) => {
  order.torobPay.status = "REVERT";
  order.torobPay.transactionId = result?.transactionId || order.torobPay.transactionId || order.OrderNum;
  order.torobPay.cancelledAt = order.torobPay.cancelledAt || new Date();
  order.torobPay.lastStatusCheckAt = new Date();
  order.torobPay.lastError = undefined;
  order.torobPay.processing = false;
  order.paymentStatus = "لغو شده";
  order.status = "لغو شده";
  await restoreFailedOrderInventory(order);
  await order.save();
};

router.post("/torob-pay/callback", async (req, res) => {
  const transactionId = String(req.body.transactionId || "").trim();
  const callbackState = String(req.body.state || "").trim().toUpperCase();
  const callbackAmountIrr = Number(req.body.amount);
  let order;

  const successRedirect = (targetOrder) =>
    res.redirect(
      303,
      `/api/order/payment-success?orderNum=${encodeURIComponent(targetOrder.OrderNum)}`
    );

  const failedRedirect = () => res.redirect(303, "/api/order/payment-failed");

  try {
    if (!transactionId) throw new CheckoutError("شناسه تراکنش ترب‌پی ارسال نشده است");

    order = await Order.findOne({
      $or: [{ OrderNum: transactionId }, { "torobPay.transactionId": transactionId }],
      paymentMethod: "ترب‌پی",
    });
    if (!order) throw new CheckoutError("سفارش ترب‌پی یافت نشد", 404);

    await restoreTorobPayReturnSession(req, res, order);

    order.torobPay.callbackState = callbackState;
    order.torobPay.callbackAmountIrr = Number.isFinite(callbackAmountIrr)
      ? callbackAmountIrr
      : undefined;

    if (order.torobPay.status === "SETTLE" && order.paymentStatus === "پرداخت شده") {
      await notifyRegisteredOrderSafely(order);
      return successRedirect(order);
    }

    const expectedAmountIrr = tomanToIrr(order.totalPrice);
    const callbackAmountMatches =
      Number.isFinite(callbackAmountIrr) && callbackAmountIrr === expectedAmountIrr;

    // اگر callback ناموفق باشد یا مبلغ آن با سفارش نخورد، طبق مستندات ابتدا
    // تلاش می‌کنیم عملیات revert را به خود ترب‌پی بسپاریم؛ فروشگاه وجه را دستی برنمی‌گرداند.
    if (callbackState !== "OK" || !callbackAmountMatches) {
      order.paymentStatus = "در حال بررسی";
      order.torobPay.lastError = callbackState !== "OK"
        ? `callback ترب‌پی با وضعیت ${callbackState || "نامشخص"} برگشت`
        : "مبلغ callback ترب‌پی با مبلغ سفارش یکسان نیست";
      await order.save();

      try {
        const reverted = await torobPayService.revert(order.torobPay.paymentToken);
        await markTorobPayOrderReverted(order, reverted);
        return failedRedirect();
      } catch (revertError) {
        try {
          const statusResult = await torobPayService.getPaymentStatus(order.torobPay.paymentToken);
          const status = torobStatus(statusResult);
          order.torobPay.lastStatusCheckAt = new Date();
          if (statusResult?.transactionId) {
            order.torobPay.transactionId = statusResult.transactionId;
          }

          if (status === "SETTLE") {
            await markTorobPayOrderPaid(order, statusResult);
            return successRedirect(order);
          }
          if (status === "REVERT") {
            await markTorobPayOrderReverted(order, statusResult);
            return failedRedirect();
          }

          order.torobPay.status = ["PENDING", "VERIFY"].includes(status) ? status : "UNKNOWN";
          order.torobPay.processing = false;
          order.paymentStatus = ["PENDING", "VERIFY"].includes(status)
            ? "در حال بررسی"
            : "نامشخص";
          order.torobPay.lastError = `${order.torobPay.lastError}; revert: ${revertError.message}`;
          await order.save();
          return failedRedirect();
        } catch (statusError) {
          order.torobPay.status = "UNKNOWN";
          order.torobPay.processing = false;
          order.paymentStatus = "نامشخص";
          order.torobPay.lastError = `${order.torobPay.lastError}; revert: ${revertError.message}; status: ${statusError.message}`;
          await order.save();
          return failedRedirect();
        }
      }
    }

    const lockedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        "torobPay.processing": { $ne: true },
        "torobPay.status": { $ne: "SETTLE" },
      },
      {
        $set: {
          "torobPay.processing": true,
          "torobPay.callbackState": callbackState,
          "torobPay.callbackAmountIrr": callbackAmountIrr,
          paymentStatus: "در حال بررسی",
        },
      },
      { new: true }
    );

    if (!lockedOrder) {
      const latestOrder = await Order.findById(order._id);
      if (
        latestOrder?.torobPay?.status === "SETTLE" &&
        latestOrder.paymentStatus === "پرداخت شده"
      ) {
        await notifyRegisteredOrderSafely(latestOrder);
        return successRedirect(latestOrder);
      }
      return res.status(409).send(
        "پرداخت ترب‌پی این سفارش هم‌اکنون در حال بررسی است. لطفاً چند لحظه بعد وضعیت سفارش را بررسی کنید."
      );
    }

    order = lockedOrder;
    const result = await torobPayService.verifyAndSettle(order.torobPay.paymentToken);
    await markTorobPayOrderPaid(order, result);
    return successRedirect(order);
  } catch (error) {
    console.error("TorobPay callback error:", error.message);

    if (order?.torobPay?.paymentToken) {
      try {
        const statusResult = await torobPayService.getPaymentStatus(order.torobPay.paymentToken);
        const status = torobStatus(statusResult);
        order.torobPay.lastStatusCheckAt = new Date();
        if (statusResult?.transactionId) {
          order.torobPay.transactionId = statusResult.transactionId;
        }

        if (status === "SETTLE") {
          await markTorobPayOrderPaid(order, statusResult);
          return successRedirect(order);
        }
        if (status === "REVERT") {
          await markTorobPayOrderReverted(order, statusResult);
          return failedRedirect();
        }

        order.torobPay.status = ["PENDING", "VERIFY"].includes(status) ? status : "UNKNOWN";
        order.torobPay.processing = false;
        order.paymentStatus = ["PENDING", "VERIFY"].includes(status)
          ? "در حال بررسی"
          : "نامشخص";
        order.torobPay.lastError = error.message;
        await order.save();
      } catch (statusError) {
        try {
          order.torobPay.status = "UNKNOWN";
          order.torobPay.processing = false;
          order.paymentStatus = "نامشخص";
          order.torobPay.lastError = `${error.message}; status: ${statusError.message}`;
          await order.save();
        } catch (_) {}
      }
    }

    return failedRedirect();
  }
});

const SNAPPPAY_OPEN_PAYMENT_STATUSES = ["پرداخت نشده", "در حال بررسی", "نامشخص"];

const isSnappPaySettled = (order) =>
  order?.snappPay?.status === "SETTLE" && order.paymentStatus === "پرداخت شده";

// Atomically takes the per-order processing lock (callback, reconciler and admin
// actions never run verify/settle/update/cancel concurrently). An abandoned lock
// (crash mid-request) expires after reconcilerConfig.staleLockMs.
const lockSnappPayOrder = (orderId, extraSet = {}) =>
  Order.findOneAndUpdate(
    {
      _id: orderId,
      "snappPay.status": { $ne: "SETTLE" },
      $or: [
        { "snappPay.processing": { $ne: true } },
        { "snappPay.processingStartedAt": { $lt: new Date(Date.now() - reconcilerConfig.staleLockMs) } },
      ],
    },
    {
      $set: {
        "snappPay.processing": true,
        "snappPay.processingStartedAt": new Date(),
        ...extraSet,
      },
    },
    { new: true }
  );

const finalizeSnappPaySettled = async (order, result = {}) => {
  order.snappPay.status = "SETTLE";
  if (result?.transactionId) order.snappPay.transactionId = String(result.transactionId);
  order.snappPay.transactionId = order.snappPay.transactionId || order.OrderNum;
  order.snappPay.settledAt = order.snappPay.settledAt || new Date();
  order.snappPay.lastStatusCheckAt = new Date();
  order.snappPay.lastError = undefined;
  order.snappPay.processing = false;
  order.snappPay.processingStartedAt = undefined;
  order.paymentStatus = "پرداخت شده";
  order.paymentInfo.paymentDate = order.paymentInfo.paymentDate || new Date();
  if (order.status === "در انتظار پرداخت") order.status = "در حال پردازش";
  await order.save();
  await registerOrderDiscountUsage(order);
  await notifyRegisteredOrderSafely(order);
};

const finalizeSnappPayFailed = async (order, { snappStatus: gatewayStatus = "FAILED", error } = {}) => {
  order.snappPay.status = gatewayStatus;
  order.snappPay.processing = false;
  order.snappPay.processingStartedAt = undefined;
  if (error) order.snappPay.lastError = String(error).slice(0, 500);
  order.paymentStatus = "لغو شده";
  order.status = "لغو شده";
  await restoreFailedOrderInventory(order);
  await order.save();
};

const releaseSnappPayLock = async (order, { error, paymentStatus } = {}) => {
  order.snappPay.processing = false;
  order.snappPay.processingStartedAt = undefined;
  if (error) order.snappPay.lastError = String(error).slice(0, 500);
  if (paymentStatus) order.paymentStatus = paymentStatus;
  await order.save();
};

// A payment completed after the order was already closed locally (expired and
// its stock released) must not be settled: verify it, then revert it so the
// customer's credit is returned.
const revertLatePayment = async (order) => {
  try {
    await snappPayService.verify(order.snappPay.paymentToken);
    await snappPayService.revert(order.snappPay.paymentToken);
    order.snappPay.status = "REVERT";
    order.snappPay.revertedAt = new Date();
  } catch (error) {
    order.snappPay.lastError = `revert: ${error.message}`.slice(0, 500);
  }
};

router.post("/snapp-pay/callback", async (req, res) => {
  const transactionId = String(req.body.transactionId || "").trim();
  const callbackState = String(req.body.state || "").trim().toUpperCase();
  const rawAmount = req.body.amount;
  const hasCallbackAmount = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== "";
  const callbackAmountIrr = hasCallbackAmount ? Number(rawAmount) : undefined;
  const successRedirect = (target) =>
    res.redirect(303, `/api/order/payment-success?orderNum=${encodeURIComponent(target.OrderNum)}`);
  const failedRedirect = () => res.redirect(303, "/api/order/payment-failed");
  let order;

  try {
    if (!transactionId) throw new CheckoutError("شناسه تراکنش اسنپ‌پی ارسال نشده است");

    const found = await Order.findOne({
      $or: [{ OrderNum: transactionId }, { "snappPay.transactionId": transactionId }],
      paymentMethod: "اسنپ‌پی",
    });
    if (!found) throw new CheckoutError("سفارش اسنپ‌پی یافت نشد", 404);

    // The normal login cookie is SameSite=Lax and may be omitted on SnappPay's
    // cross-site POST. A short-lived, callback-only cookie restores the user's
    // authenticated session without weakening the main session cookie.
    await restoreSnappPayReturnSession(req, res, found);

    // Duplicate callback / browser refresh after a successful payment.
    if (isSnappPaySettled(found)) {
      await notifyRegisteredOrderSafely(found);
      return successRedirect(found);
    }

    order = await lockSnappPayOrder(found._id, {
      "snappPay.callbackState": callbackState,
      "snappPay.callbackAmountIrr": Number.isFinite(callbackAmountIrr) ? callbackAmountIrr : null,
      ...(found.status !== "لغو شده" ? { paymentStatus: "در حال بررسی" } : {}),
    });

    if (!order) {
      const latestOrder = await Order.findById(found._id);
      if (isSnappPaySettled(latestOrder)) {
        await notifyRegisteredOrderSafely(latestOrder);
        return successRedirect(latestOrder);
      }
      return res.status(409).send(
        "پرداخت این سفارش هم‌اکنون در حال بررسی است. لطفاً چند لحظه بعد وضعیت سفارش را در حساب کاربری بررسی کنید."
      );
    }

    // Order was already closed locally (payment window expired, stock released).
    if (order.status === "لغو شده") {
      if (callbackState === "OK") await revertLatePayment(order);
      await releaseSnappPayLock(order);
      return failedRedirect();
    }

    // Callback fields come from the customer's browser and decide nothing on
    // their own; the amount we created the token with is authoritative.
    if (hasCallbackAmount && callbackAmountIrr !== tomanToIrr(order.totalPrice)) {
      order.snappPay.status = "UNKNOWN";
      await releaseSnappPayLock(order, {
        error: `مبلغ callback (${Number.isFinite(callbackAmountIrr) ? callbackAmountIrr : "نامعتبر"}) با مبلغ سفارش (${tomanToIrr(order.totalPrice)}) یکسان نیست`,
        paymentStatus: "نامشخص",
      });
      // The reconciler re-checks this payment with SnappPay's status service.
      return failedRedirect();
    }

    if (callbackState !== "OK") {
      // Confirm with SnappPay before cancelling, so a stray/forged FAILED
      // callback can never cancel a payment that actually went through.
      let gatewayStatus = "";
      try {
        const statusResult = await snappPayService.getPaymentStatus(order.snappPay.paymentToken);
        gatewayStatus = snappStatus(statusResult);
        order.snappPay.lastStatusCheckAt = new Date();
      } catch (statusError) {
        order.snappPay.lastError = `status: ${statusError.message}`.slice(0, 500);
      }

      if (gatewayStatus !== "SETTLE" && gatewayStatus !== "VERIFY") {
        await finalizeSnappPayFailed(order, {
          snappStatus: ["CANCEL", "REVERT"].includes(gatewayStatus) ? gatewayStatus : "FAILED",
        });
        return failedRedirect();
      }
    }

    // verify → settle, with the documented Get Payment Status recovery when a
    // response is lost (status VERIFY ⇒ settle, PENDING ⇒ verify again, SETTLE ⇒ done).
    const result = await snappPayService.verifyAndSettle(order.snappPay.paymentToken);
    await finalizeSnappPaySettled(order, result);
    return successRedirect(order);
  } catch (error) {
    console.error("SnappPay callback error:", error.message);
    if (order?.snappPay?.processing) {
      try {
        let recoveredStatus = "";
        try {
          const statusResult = await snappPayService.getPaymentStatus(order.snappPay.paymentToken);
          recoveredStatus = snappStatus(statusResult);
          order.snappPay.lastStatusCheckAt = new Date();
        } catch (statusError) {
          order.snappPay.lastError = `${error.message}; status: ${statusError.message}`.slice(0, 500);
        }

        if (recoveredStatus === "SETTLE") {
          await finalizeSnappPaySettled(order);
          return successRedirect(order);
        }
        if (["CANCEL", "REVERT"].includes(recoveredStatus)) {
          await finalizeSnappPayFailed(order, { snappStatus: recoveredStatus, error: error.message });
          return failedRedirect();
        }

        // Still unresolved: keep the order and its stock; the automatic
        // reconciler retries verify/settle via the status service.
        order.snappPay.status = "UNKNOWN";
        await releaseSnappPayLock(order, {
          error: order.snappPay.lastError || error.message,
          paymentStatus: "نامشخص",
        });
      } catch (saveError) {
        console.error("Failed to persist SnappPay callback error:", saveError);
      }
    }
    return failedRedirect();
  }
});

// Automatic Get Payment Status reconciliation for SnappPay orders that are
// still open (customer never returned, lost verify/settle response, restart).
const reconcileSnappPayOrder = async (orderId) => {
  const order = await lockSnappPayOrder(orderId);
  if (!order) return "locked";

  try {
    const ageMs = Date.now() - new Date(order.createdAt).getTime();
    let gatewayStatus = "";
    try {
      const statusResult = await snappPayService.getPaymentStatus(order.snappPay.paymentToken);
      gatewayStatus = snappStatus(statusResult);
      order.snappPay.lastStatusCheckAt = new Date();
    } catch (statusError) {
      order.snappPay.lastError = `status: ${statusError.message}`.slice(0, 500);
    }

    const action = resolveSnappPayAction({ status: gatewayStatus, ageMs });

    if (action === "settled") {
      await finalizeSnappPaySettled(order);
    } else if (action === "settle") {
      const result = await snappPayService.settleWithStatusRecovery(order.snappPay.paymentToken);
      await finalizeSnappPaySettled(order, result);
    } else if (action === "verify") {
      try {
        // Succeeds only if the customer completed the payment but never came back.
        const result = await snappPayService.verifyAndSettle(order.snappPay.paymentToken);
        await finalizeSnappPaySettled(order, result);
      } catch (verifyError) {
        await releaseSnappPayLock(order);
        return "pending";
      }
    } else if (action === "cancelled") {
      await finalizeSnappPayFailed(order, { snappStatus: gatewayStatus });
    } else if (action === "expire") {
      await finalizeSnappPayFailed(order, {
        snappStatus: "FAILED",
        error: `مهلت پرداخت به پایان رسید (وضعیت اسنپ‌پی: ${gatewayStatus || "نامشخص"})`,
      });
    } else {
      await releaseSnappPayLock(order);
    }
    return action;
  } catch (error) {
    console.error("[SnappPay][reconcile] order error:", order.OrderNum, error.message);
    await releaseSnappPayLock(order, { error: error.message });
    return "error";
  }
};

const reconcileOpenSnappPayOrders = async () => {
  const candidates = await Order.find({
    paymentMethod: "اسنپ‌پی",
    "snappPay.paymentToken": { $exists: true, $ne: null },
    status: "در انتظار پرداخت",
    paymentStatus: { $in: SNAPPPAY_OPEN_PAYMENT_STATUSES },
    createdAt: { $lte: new Date(Date.now() - reconcilerConfig.minAgeMs) },
  })
    .select("_id")
    .sort({ createdAt: 1 })
    .limit(reconcilerConfig.batchSize)
    .lean();

  const results = {};
  for (const { _id } of candidates) {
    const action = await reconcileSnappPayOrder(_id);
    results[action] = (results[action] || 0) + 1;
  }
  if (candidates.length) console.log("[SnappPay][reconcile]", results);
  return results;
};

router.reconcileOpenSnappPayOrders = reconcileOpenSnappPayOrders;
router.startSnappPayReconciler = () => {
  if (!snappPayService.isConfigured()) return () => {};
  return startSnappPayReconciler({ runOnce: reconcileOpenSnappPayOrders });
};

router.get("/payment-success", async (req, res, next) => {
  try {
    const user = req.session.userId
      ? await User.findById(req.session.userId).populate("cart.productId").populate("orders")
      : null;
    const orderNum = req.query.orderNum || req.session.OrderNum;
    const order = orderNum ? await Order.findOne({ OrderNum: orderNum }) : null;
    const canShowOrder = order && user && String(order.user) === String(user._id);
    const { menuCategories, footerCategories } = await buildMenuData();
    // SnappPay requires its transaction ID (shared, unique merchant ↔ SnappPay id)
    // to be shown after a successful payment. It equals the order number already
    // present in the URL, so it is safe to show even if the session was not restored.
    const snappPayTransactionId =
      order?.paymentMethod === "اسنپ‌پی" && isSnappPaySettled(order)
        ? order.snappPay.transactionId || order.OrderNum
        : null;

    return res.render("PaymentSuccess", {
      OrderNum: orderNum,
      snappPayTransactionId,
      transactionId: canShowOrder
        ? order.torobPay?.transactionId || order.snappPay?.transactionId || order.paymentInfo?.refId
        : null,
      paymentMethod: canShowOrder || snappPayTransactionId ? order.paymentMethod : null,
      menuCategories,
      user,
      cartCount: user?.cart?.length || 0,
      footerCategories,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payment-failed", async (req, res, next) => {
  try {
    const user = req.session.userId
      ? await User.findById(req.session.userId).populate("cart.productId").populate("orders")
      : null;
    const { menuCategories, footerCategories } = await buildMenuData();
    return res.render("PaymentFailed", {
      OrderNum: req.session.OrderNum,
      menuCategories,
      user,
      cartCount: user?.cart?.length || 0,
      footerCategories,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
