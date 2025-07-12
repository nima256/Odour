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
  const codeInput = req.body.discountCode.trim();
  const discount = await DiscountCode.findOne({ code: codeInput });

  // بررسی‌های امنیتی و اعتبارسنجی
  if (
    !discount ||
    !discount.isActive ||
    (discount.expireDate && discount.expireDate < new Date()) ||
    (discount.usageLimit && discount.usedCount >= discount.usageLimit)
  ) {
    return res
      .status(400)
      .json({ success: false, message: "کد تخفیف نامعتبر است" });
  }

  // ذخیره‌سازی در سشن
  req.session.discount = {
    type: discount.type,
    amount: discount.amount,
    code: discount.code,
  };

  res.json({
    success: true,
    message: "کد تخفیف با موفقیت اعمال شد",
    discountAmount:
      discount.type === "percent"
        ? Math.floor((subtotal * discount.amount) / 100)
        : discount.amount,
  });
});

module.exports = router;
