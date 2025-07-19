const express = require("express");
const router = express.Router();
const User = require("../models/User");
const DiscountCode = require("../models/DiscountCode");
const Product = require("../models/Product");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const { body, param, validationResult } = require("express-validator");
const mongoose = require("mongoose");

// For access to req.body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const errorResponse = (res, status, message, details = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...details,
  });
};

const validateProductId = [
  body("productId")
    .notEmpty()
    .withMessage("شناسه محصول الزامی است")
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage("شناسه محصول نامعتبر است"),
];

const validateQuantity = [
  body("quantity")
    .isInt({ min: 1 })
    .withMessage("تعداد باید عددی مثبت باشد")
    .toInt(),
];

router.post(
  "/add",
  isLoggedIn,
  validateProductId,
  validateQuantity,
  async (req, res) => {
    try {
      console.log(req.body)
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return errorResponse(res, 400, "خطا در اعتبارسنجی", {
          errors: errors.array(),
        });
      }

      const { productId, quantity, selectedColor, selectedSize } = req.body;

      if (!selectedColor || !selectedSize) {
        return errorResponse(res, 400, "لطفا رنگ و سایز محصول را انتخاب کنید");
      }

      const user = await User.findById(req.session.userId);
      const product = await Product.findById(productId);

      if (!product) {
        return errorResponse(res, 404, "محصول یافت نشد");
      }

      if (product.countInStock < quantity) {
        return errorResponse(
          res,
          400,
          `موجودی محصول کافی نیست (موجودی: ${product.countInStock})`
        );
      }

      const normalizeString = (str) => {
        return str
          .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 0x0660) // تبدیل اعداد فارسی/عربی به انگلیسی
          .trim()
          .toLowerCase();
      };

      const isValidColor = product.colors.some(c => 
        normalizeString(c.name) === normalizeString(selectedColor)
      );

      const isValidSize = product.sizes.some(s => 
        normalizeString(s.size) === normalizeString(selectedSize)
      );

      if (!isValidColor || !isValidSize) {
        return errorResponse(res, 400, "رنگ یا سایز انتخاب شده معتبر نیست");
      }

      // جستجوی آیتم در سبد خرید با همان محصول، رنگ و سایز
      const existingItem = user.cart.find(
        (item) =>
          item.productId.toString() === productId &&
          item.selectedColor === selectedColor &&
          item.selectedSize === selectedSize
      );

      if (existingItem) {
        const newQuantity = existingItem.quantity + quantity;
        if (product.countInStock < newQuantity) {
          return errorResponse(
            res,
            400,
            `تعداد درخواستی بیشتر از موجودی است (موجودی: ${product.countInStock})`
          );
        }
        existingItem.quantity = newQuantity;
      } else {
        user.cart.push({
          productId,
          quantity,
          selectedColor,
          selectedSize,
        });
      }

      await user.save();

      return res.json({
        success: true,
        message: "محصول به سبد خرید اضافه شد",
        cart: user.cart,
        cartCount: user.cart.length,
      });
    } catch (error) {
      console.error("Add to cart error:", error);
      return errorResponse(res, 500, "خطا در اضافه کردن به سبد خرید");
    }
  }
);

router.delete(
  "/remove/:productId",
  isLoggedIn,
  [
    param("productId")
      .notEmpty()
      .withMessage("شناسه محصول الزامی است")
      .custom((value) => mongoose.Types.ObjectId.isValid(value))
      .withMessage("شناسه محصول نامعتبر است"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return errorResponse(res, 400, "خطا در اعتبارسنجی", {
          errors: errors.array(),
        });
      }

      const { productId } = req.params;
      const user = await User.findById(req.session.userId);

      const initialCount = user.cart.length;
      user.cart = user.cart.filter(
        (item) => item.productId.toString() !== productId
      );

      if (user.cart.length === initialCount) {
        return errorResponse(res, 404, "محصول در سبد خرید یافت نشد");
      }

      await user.save();

      return res.json({
        success: true,
        message: "محصول از سبد خرید حذف شد",
        cart: user.cart,
        cartCount: user.cart.length,
      });
    } catch (error) {
      console.error("Remove from cart error:", error);
      return errorResponse(res, 500, "خطا در حذف از سبد خرید");
    }
  }
);

router.put(
  "/update",
  isLoggedIn,
  validateProductId,
  validateQuantity,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return errorResponse(res, 400, "خطا در اعتبارسنجی", {
          errors: errors.array(),
        });
      }

      const { productId, quantity } = req.body;
      const user = await User.findById(req.session.userId);

      const product = await Product.findById(productId);
      if (!product) {
        return errorResponse(res, 404, "محصول یافت نشد");
      }

      if (product.stock < quantity) {
        return errorResponse(
          res,
          400,
          `موجودی محصول کافی نیست (موجودی: ${product.stock})`
        );
      }

      const item = user.cart.find(
        (item) => item.productId.toString() === productId
      );

      if (!item) {
        return errorResponse(res, 404, "محصول در سبد خرید یافت نشد");
      }

      item.quantity = quantity;
      await user.save();

      return res.json({
        success: true,
        message: "تعداد محصول به‌روزرسانی شد",
        cart: user.cart,
      });
    } catch (error) {
      console.error("Update cart error:", error);
      return errorResponse(res, 500, "خطا در به‌روزرسانی سبد خرید");
    }
  }
);

router.post(
  "/apply-discount",
  [
    body("discountCode").trim().notEmpty().withMessage("کد تخفیف الزامی است"),
    body("subtotal")
      .isFloat({ min: 0 })
      .withMessage("مبلغ سبد خرید نامعتبر است")
      .toFloat(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return errorResponse(res, 400, "خطا در اعتبارسنجی", {
          errors: errors.array(),
        });
      }

      const { discountCode, subtotal } = req.body;
      const user = await User.findById(req.session.userId);

      if (!user.cart.length) {
        return errorResponse(res, 400, "سبد خرید شما خالی است");
      }

      const discount = await DiscountCode.findOne({ code: discountCode });
      const now = new Date();

      if (!discount || !discount.isActive) {
        return errorResponse(res, 400, "کد تخفیف نامعتبر است");
      }

      if (discount.expireDate && discount.expireDate < now) {
        return errorResponse(res, 400, "کد تخفیف منقضی شده است");
      }

      if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
        return errorResponse(res, 400, "محدودیت استفاده از کد تخفیف");
      }

      if (discount.minOrderAmount && subtotal < discount.minOrderAmount) {
        return errorResponse(
          res,
          400,
          `حداقل مبلغ سفارش برای این کد تخفیف ${discount.minOrderAmount} تومان است`
        );
      }

      let discountAmount =
        discount.type === "percent"
          ? Math.min(
              Math.floor((subtotal * discount.amount) / 100),
              discount.maxDiscountAmount || Infinity
            )
          : discount.amount;

      req.session.discount = {
        type: discount.type,
        amount: discount.amount,
        code: discount.code,
        calculatedAmount: discountAmount,
      };

      res.json({
        success: true,
        message: "کد تخفیف اعمال شد",
        discount: {
          type: discount.type,
          originalValue:
            discount.type === "percent"
              ? `${discount.amount}%`
              : `${discount.amount} تومان`,
          amount: discount.amount,
          calculatedAmount: discountAmount, // این مقدار محاسبه شده
          code: discount.code,
          minOrderAmount: discount.minOrderAmount,
          maxDiscountAmount: discount.maxDiscountAmount,
        },
        finalTotal: subtotal - discountAmount,
      });
    } catch (error) {
      console.error("Discount application error:", error);
      return errorResponse(res, 500, "خطا در اعمال کد تخفیف");
    }
  }
);

module.exports = router;
