const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const User = require("../models/User");
const Category = require("../models/Category");
const DiscountCode = require("../models/DiscountCode");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const multer = require("multer");
const upload = multer();
const Product = require("../models/Product");
const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const ZarinPal = require("zarinpal-checkout");
const https = require("https");
const MERCHANT_ID = "4da16f0c-eb42-4064-bf75-22a4b53e2b74";
const SANDBOX = process.env.ZARINPAL_SANDBOX === 'true' ? true : false;

const zarinpal = ZarinPal.create(MERCHANT_ID, SANDBOX);

const ADMIN_MOBILE = "09014968828";

// For access to req.body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const validateOrderInput = [
  body("postcode").trim().notEmpty().withMessage("کد پستی الزامی است"),
  body("address").trim().notEmpty().withMessage("آدرس الزامی است"),
  body("delivery").optional().trim(),
];

const errorResponse = (res, status, message, details = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...details,
  });
};

const sendSms = (mobile, message) => {
  return new Promise((resolve, reject) => {
    // اگر شماره موبایل نامعتبر باشد
    if (!mobile || mobile.length !== 11) {
      return reject(new Error("شماره موبایل نامعتبر است"));
    }

    const data = JSON.stringify({
      bodyId: 347717,
      to: mobile,
      args: [message], // پیام به عنوان آرگومان ارسال می‌شود
    });

    const options = {
      hostname: "console.melipayamak.com",
      port: 443,
      path: "/api/send/shared/b38b715606c847b491c032790a75c7d8",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const reqSms = https.request(options, (smsRes) => {
      let responseData = "";
      smsRes.on("data", (d) => {
        responseData += d;
      });

      smsRes.on("end", () => {
        if (smsRes.statusCode === 200) {
          resolve({ success: true, data: responseData });
        } else {
          reject(new Error(`خطا در ارسال پیامک: ${smsRes.statusCode}`));
        }
      });
    });

    reqSms.on("error", (error) => {
      reject(error);
    });

    reqSms.write(data, "utf8");
    reqSms.end();
  });
};


router.post(
  "/",
  upload.none(),
  isLoggedIn,
  validateOrderInput,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return errorResponse(res, 400, "خطا در اعتبارسنجی", {
          errors: errors.array(),
        });
      }

      const userId = req.session.userId;
      const { postcode, address, delivery } = req.body;

      const user = await User.findById(userId).populate("cart.productId");
      if (!user) {
        return errorResponse(res, 404, "کاربر یافت نشد");
      }

      if (!user.cart || user.cart.length === 0) {
        return errorResponse(res, 400, "سبد خرید شما خالی است");
      }

      const unavailableProducts = [];
      let subtotal = 0;

      // ساخت آرایه محصولات با اطلاعات کامل
      const productsForOrder = await Promise.all(
        user.cart.map(async (item) => {
          const product = await Product.findById(item.productId);
          if (!product || product.countInStock < item.quantity) {
            unavailableProducts.push({
              productId: item.productId,
              name: product?.name || "نامعلوم",
              requested: item.quantity,
              available: product?.countInStock || 0,
            });
            return null;
          }

          const price = product.offerPrice || product.price;
          subtotal += price * item.quantity;

          return {
            product: product._id,
            quantity: item.quantity,
            priceAtPurchase: price,
            nameAtPurchase: product.name,
            selectedColor: item.selectedColor || null, 
            selectedSize: item.selectedSize || null, 
          };
        })
      );

      if (unavailableProducts.length > 0) {
        return errorResponse(res, 400, "برخی محصولات موجود نیستند", {
          unavailableProducts,
        });
      }

      // محاسبه تخفیف و قیمت نهایی
      let discountAmount = 0;
      let appliedDiscount = null;
      let finalPrice = subtotal;

      if (req.session.discount?.code) {
        const discount = await DiscountCode.findOne({
          code: req.session.discount.code,
        });

        const now = new Date();
        const isValidDiscount =
          discount &&
          discount.isActive &&
          (!discount.expireDate || discount.expireDate >= now) &&
          (!discount.usageLimit || discount.usedCount < discount.usageLimit) &&
          (!discount.minOrderAmount || subtotal >= discount.minOrderAmount);

        if (isValidDiscount) {
          discountAmount =
            discount.type === "percent"
              ? Math.min(
                  Math.floor((subtotal * discount.amount) / 100),
                  discount.maxDiscountAmount || Infinity
                )
              : discount.amount;

          finalPrice = subtotal - discountAmount;

          appliedDiscount = {
            type: discount.type,
            amount: discount.amount,
            calculatedAmount: discountAmount,
            code: discount.code,
            originalValue:
              discount.type === "percent"
                ? `${discount.amount}%`
                : `${discount.amount} تومان`,
          };

          await DiscountCode.updateOne(
            { _id: discount._id },
            { $inc: { usedCount: 1 } }
          );
        }

        req.session.discount = null;
      }

      // ایجاد سفارش با اطلاعات کامل محصولات
      const order = new Order({
        OrderNum: req.session.OrderNum || `ORD-${Date.now()}`,
        postcode,
        address,
        user: userId,
        products: productsForOrder.filter((p) => p !== null), // استفاده از آرایه کامل محصولات
        delivery: delivery || "",
        originalPrice: subtotal,
        totalPrice: finalPrice,
        discount: appliedDiscount,
        discountAmount,
        status: "در انتظار پرداخت",
      });

      try {
        await order.save();

        await Promise.all(
          user.cart.map((item) =>
            Product.updateOne(
              { _id: item.productId._id },
              { $inc: { countInStock: -item.quantity } }
            )
          )
        );

        user.cart = [];
        user.orders.push(order._id);
        await user.save();

        if (req.session.OrderNum) {
          delete req.session.OrderNum;
        }
        
        const fullName = user.fullName || 'کاربر مهمان';
        const phoneNumber = user.mobile || '';
        
        // محدودیت کاراکتر Description در زرین‌پال معمولاً 255 کاراکتر است
        let description = `سفارش ${order.OrderNum} - خریدار: ${fullName}`;
        if (phoneNumber) {
          description += ` - تلفن: ${phoneNumber}`;
        }
        
        // اگر description太长، کوتاه‌ترش کن
        if (description.length > 250) {
          description = `سفارش ${order.OrderNum} - ${fullName.substring(0, 50)}`;
        }


        const payment = await zarinpal.PaymentRequest({
          Amount: order.totalPrice,
          CallbackURL: `${process.env.SITE_URL || 'http://localhost:7000'}/api/order/verify`,
          Description: description,
          Email: user.email,
          Mobile: user.mobile,
        });

        // ذخیره اطلاعات پرداخت
        order.paymentInfo = {
          authority: payment.authority,
          paymentUrl: payment.url,
        };
        await order.save();

        // ریدایرکت به درگاه پرداخت
        return res.json({
          success: true,
          paymentUrl: payment.url,
        });

        // return res.json({
        //   success: true,
        //   message: "سفارش با موفقیت ثبت شد",
        //   orderId: order._id,
        //   orderNumber: order.OrderNum,
        //   total: finalPrice,
        //   discount: discountAmount,
        // });
      } catch (error) {
        console.error("Order processing error:", error);
        if (order._id) {
          await Order.deleteOne({ _id: order._id });
        }
        throw error;
      }
    } catch (error) {
      console.error("Order creation error:", error);

      if (error.name === "ValidationError") {
        return errorResponse(res, 400, "خطا در اعتبارسنجی داده‌های سفارش");
      }

      if (error.code === 11000) {
        return errorResponse(res, 409, "شماره سفارش تکراری است");
      }

      return errorResponse(res, 500, "خطای سرور در ثبت سفارش");
    }
  }
);

router.get("/verify", async (req, res) => {
  try {
    const { Authority, Status } = req.query;

    if (!Authority) {
      return res
        .status(400)
        .json({ success: false, message: "Authority is required" });
    }

    // Log the incoming request for debugging
    console.log("Verification request received:", { Authority, Status });

    // Find the order
    const order = await Order.findOne({ "paymentInfo.authority": Authority });

    if (!order) {
      console.error("Order not found for authority:", Authority);
      return res
        .status(404)
        .json({ success: false, message: "سفارش یافت نشد" });
    }

    if (Status !== "OK") {
      // Payment failed
      order.status = "لغو شده";
      await order.save();
      console.log("Payment failed - Status not OK");
      return res.redirect("/api/order/payment-failed");
    }

    // Verify payment
    console.log(
      "Verifying payment for order:",
      order._id,
      "Amount:",
      order.totalPrice
    );
    const verification = await zarinpal.PaymentVerification({
      Amount: order.totalPrice, // Convert to Rials if needed
      Authority,
    });

    console.log("Verification response:", verification);

    if (verification.status === 100) {
      // Successful payment
      order.paymentStatus = "پرداخت شده";
      order.status = "در حال پردازش";
      order.paymentInfo.refId = verification.refId;
      order.paymentInfo.cardPan = verification.cardPan;
      order.paymentInfo.paymentDate = new Date();
      await order.save();

      console.log("Payment successful for order:", order._id);
      return res.redirect("/api/order/payment-success");
    } else {
      // Payment verification failed
      console.error("Payment verification failed:", verification.status);
      order.status = "لغو شده";
      await order.save();
      return res.redirect("/api/order/payment-failed");
    }
  } catch (error) {
    console.error("Error in verify endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "خطای سرور",
      error: error.message,
    });
  }
});

router.get("/payment-success", async (req, res) => {
    const user = await User.findById(req.session.userId)
      .populate("cart.productId")
      .populate("orders");

    const cartCount = user?.cart?.length || 0;
    const orderNum = req.query.orderNum || req.session.OrderNum;

    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
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
 res.render("PaymentSuccess", { OrderNum: orderNum , menuCategories, user, cartCount});
});

router.get("/payment-failed", async (req, res) => {
    const user = await User.findById(req.session.userId)
      .populate("cart.productId")
      .populate("orders");

    const cartCount = user?.cart?.length || 0;
    
    const allCategories = await Category.find({ 
      categoryType: "product",
      isActive: true 
    });
    
    // ساخت ساختار درختی برای منو
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
  res.render("PaymentFailed", { OrderNum: req.session.OrderNum, menuCategories, user ,cartCount });
});

module.exports = router;
