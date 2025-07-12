const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const User = require("../models/User");
const DiscountCode = require("../models/DiscountCode");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const multer = require("multer");
const upload = multer();

// For access to req.body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post("/", upload.none(), isLoggedIn, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { postcode, address, delivery } = req.body;
    const user = await User.findById(userId).populate("cart.productId");

    if (!postcode || !address) {
      return res
        .status(400)
        .json({ success: false, message: "تمام فیلدهای لازم پر نشده است" });
    }

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "کاربر یافت نشد" });
    }

    if (!user.cart.length) {
      return res
        .status(400)
        .json({ success: false, message: "سبد خرید شما خالی است" });
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
        discount: req.session.discount
          ? {
              type: req.session.discount.type,
              amount: req.session.discount.amount,
              code: req.session.discount.code,
            }
          : null,
      };
    });

    let discountAmount = 0;
    let finalPrice = 0;
    let appliedDiscount = null;
    let subtotal = 0;

    if (req.session.discount?.code) {
      const discount = await DiscountCode.findOne({
        code: req.session.discount.code,
      });

      const now = new Date();
      const isExpired = discount?.expireDate && discount.expireDate < now;
      const isUsageLimitReached =
        discount?.usageLimit && discount.usedCount >= discount.usageLimit;

      if (!discount || !discount.isActive || isExpired || isUsageLimitReached) {
        // اگر کد تخفیف معتبر نبود، سشن پاک شود و بدون تخفیف ثبت شود
        req.session.discount = null;
        finalPrice = subtotal;
      } else {
        // تخفیف معتبر است، محاسبه شود
        discountAmount =
          discount.type === "percent"
            ? (subtotal * discount.amount) / 100
            : discount.amount;

        finalPrice = subtotal - discountAmount;

        appliedDiscount = {
          type: discount.type,
          amount: discount.amount,
          code: discount.code,
        };

        // افزایش تعداد استفاده
        await DiscountCode.updateOne(
          { code: discount.code },
          { $inc: { usedCount: 1 } }
        );

        // پاک کردن سشن بعد از استفاده
        req.session.discount = null;
      }
    } else {
      finalPrice = subtotal;
    }

    cartItems.forEach((item) => {
      const price = item.offerPrice || item.price;
      subtotal += price * item.quantity;
    });

    if (req.session.discount) {
      const { type, amount } = req.session.discount;
      discountAmount = type === "percent" ? (subtotal * amount) / 100 : amount;
    }

    const productIds = user.cart.map((item) => item.productId._id);

    const newOrder = new Order({
      OrderNum: req.session.OrderNum,
      postcode,
      address,
      user: userId,
      products: productIds,
      delivery: delivery || "",
      originalPrice: subtotal,
      totalPrice: finalPrice,
      discount: appliedDiscount,
      status: "در انتظار پرداخت",
    });

    await newOrder.save();

    user.cart = [];
    user.orders.push(newOrder._id);

    if (req.session.discount?.code) {
      await DiscountCode.findOneAndUpdate(
        { code: req.session.discount.code },
        { $inc: { usedCount: 1 } }
      );
      req.session.discount = null;
    }

    await user.save();

    res.json({
      success: true,
      message: "سفارش با موفقیت ثبت شد",
      orderId: newOrder._id,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res
      .status(500)
      .json({ success: false, message: "خطایی در ثبت سفارش رخ داد" });
  }
});

module.exports = router;
