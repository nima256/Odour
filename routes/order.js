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

    if (!user || !user.cart.length) {
      return res
        .status(400)
        .json({ success: false, message: "سبد خرید شما خالی است" });
    }

    // Calculate subtotal
    let subtotal = 0;
    const cartItems = user.cart.map((item) => {
      const prod = item.productId;
      const price = prod.offerPrice || prod.price;
      subtotal += price * item.quantity;
      return {
        _id: prod._id,
        name: prod.name,
        slug: prod.slug,
        price: prod.price,
        offerPrice: prod.offerPrice,
        weight: prod.weight,
        image: prod.images?.[0] || "",
        quantity: item.quantity,
      };
    });

    // Discount calculation
    let discountAmount = 0;
    let finalPrice = subtotal;
    let appliedDiscount = null;

    if (req.session.discount?.code) {
      const discount = await DiscountCode.findOne({
        code: req.session.discount.code,
      });

      const now = new Date();
      const isExpired = discount?.expireDate && discount.expireDate < now;
      const isUsageLimitReached =
        discount?.usageLimit && discount.usedCount >= discount.usageLimit;

      if (
        !discount ||
        !discount.isActive ||
        isExpired ||
        isUsageLimitReached ||
        (discount.minOrderAmount && subtotal < discount.minOrderAmount)
      ) {
        req.session.discount = null;
      } else {
        // Calculate discount based on type
        if (discount.type === "percent") {
          discountAmount = Math.floor((subtotal * discount.amount) / 100);

          // Apply maximum discount cap if exists
          if (
            discount.maxDiscountAmount &&
            discountAmount > discount.maxDiscountAmount
          ) {
            discountAmount = discount.maxDiscountAmount;
          }
        } else {
          discountAmount = discount.amount;
        }

        finalPrice = subtotal - discountAmount;

        // Prepare discount object for storage
        appliedDiscount = {
          type: discount.type,
          amount: discount.amount,
          calculatedAmount: discountAmount, // Store the actual discount amount applied
          code: discount.code,
          originalValue:
            discount.type === "percent"
              ? `${discount.amount}%`
              : `${discount.amount} تومان`,
        };

        // Update discount code usage
        await DiscountCode.updateOne(
          { code: discount.code },
          { $inc: { usedCount: 1 } }
        );

        req.session.discount = null;
      }
    }

    const productsWithQuantity = user.cart.map((item) => ({
      product: item.productId._id,
      quantity: item.quantity,
    }));

    const newOrder = new Order({
      OrderNum: req.session.OrderNum,
      postcode,
      address,
      user: userId,
      products: productsWithQuantity,
      delivery: delivery || "",
      originalPrice: subtotal,
      totalPrice: finalPrice,
      discount: appliedDiscount,
      discountAmount: discountAmount, // Explicitly store the discount amount
      status: "در انتظار پرداخت",
    });

    await newOrder.save();
    delete req.session.OrderNum;

    // Clear user's cart and add order
    user.cart = [];
    user.orders.push(newOrder._id);
    await user.save();

    res.json({
      success: true,
      message: "سفارش با موفقیت ثبت شد",
      orderId: newOrder._id,
      discountApplied: discountAmount > 0,
      discountAmount: discountAmount,
      finalPrice: finalPrice,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res
      .status(500)
      .json({ success: false, message: "خطایی در ثبت سفارش رخ داد" });
  }
});

module.exports = router;
