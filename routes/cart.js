const express = require("express");
const router = express.Router();
const User = require("../models/User");
const DiscountCode = require("../models/DiscountCode");
const { isLoggedIn } = require("../middlewares/isLoggedIn");

// For access to req.body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post("/add", isLoggedIn, async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const user = await User.findById(req.session.userId);

  const existingItem = user.cart.find(
    (item) => item.productId.toString() === productId
  );

  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    user.cart.push({ productId, quantity });
  }

  await user.save();
  res.json({
    success: true,
    message: "محصول مورد نظر به سبد خرید اضافه شد",
    cart: user.cart,
  });
});

router.delete("/remove/:productId", isLoggedIn, async (req, res) => {
  const { productId } = req.params;
  const user = await User.findById(req.session.userId);

  user.cart = user.cart.filter(
    (item) => item.productId.toString() !== productId
  );

  await user.save();
  res.json({ success: true, cart: user.cart });
});

router.put("/update", isLoggedIn, async (req, res) => {
  const { productId, quantity } = req.body;
  const user = await User.findById(req.session.userId);

  const item = user.cart.find(
    (item) => item.productId.toString() === productId
  );

  if (!item) {
    return res.status(404).json({ success: false, message: "محصول یافت نشد" });
  }

  item.quantity = quantity;
  await user.save();
  res.json({ success: true, cart: user.cart });
});

router.post("/apply-discount", async (req, res) => {
  try {
    const codeInput = req.body.discountCode?.trim();
    const subtotal = req.body.subtotal; // 👈 ساب‌توتال از کلاینت دریافت می‌کنیم

    if (!codeInput || typeof subtotal !== "number") {
      return res.status(400).json({
        success: false,
        message: "اطلاعات کافی برای بررسی کد تخفیف ارسال نشده است",
      });
    }

    const discount = await DiscountCode.findOne({ code: codeInput });

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
      return res
        .status(400)
        .json({
          success: false,
          message: "کد تخفیف نامعتبر یا غیرقابل استفاده است",
        });
    }

    // محاسبه تخفیف واقعی
    let discountAmount = 0;

    if (discount.type === "percent") {
      discountAmount = Math.floor((subtotal * discount.amount) / 100);

      if (
        typeof discount.maxDiscountAmount === "number" &&
        discountAmount > discount.maxDiscountAmount
      ) {
        discountAmount = discount.maxDiscountAmount;
      }
    } else {
      discountAmount = discount.amount;
    }

    // ذخیره سشن برای سفارش نهایی
    req.session.discount = {
      type: discount.type,
      amount: discount.amount,
      code: discount.code,
    };

    res.json({
      success: true,
      message: "کد تخفیف با موفقیت اعمال شد",
      discountType: discount.type,
      discountAmount: discountAmount, // 👈 مقدار نهایی تخفیف
      code: discount.code,
    });
  } catch (error) {
    console.error("Error applying discount:", error);
    res.status(500).json({
      success: false,
      message: "خطایی در پردازش کد تخفیف رخ داده است",
    });
  }
});

module.exports = router;
