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

router.post("/add", isLoggedIn, validateProductId, validateQuantity, async (req, res) => {
  try {
    const { productId, quantity, selectedColor, selectedSize } = req.body;

    // تغییر: فقط بررسی کن اگر سایز ارسال شده باشد
    if (selectedSize === undefined || selectedSize === null) {
      // سایز اختیاری است، فقط اگر محصول سایز داشته باشد نیاز است
      // می‌تونیم این چک رو حذف کنیم یا بستگی به منطق business داره
    }

    const user = await User.findById(req.session.userId);
    const product = await Product.findById(productId);

    if (!product) {
      return errorResponse(res, 404, "محصول یافت نشد");
    }

    if (product.countInStock < quantity) {
      return errorResponse(res, 400, `موجودی محصول کافی نیست (موجودی: ${product.countInStock})`);
    }

    const normalizeString = (str) => {
      if (!str) return '';
      return str
        .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660))
        .trim()
        .toLowerCase();
    };

    // بررسی رنگ (اختیاری)
    let isValidColor = true;
    if (selectedColor) {
      isValidColor = product.colors && product.colors.some(c => 
        normalizeString(c.name) === normalizeString(selectedColor)
      );
      
      if (!isValidColor) {
        return errorResponse(res, 400, "رنگ انتخاب شده معتبر نیست");
      }
    }

    // بررسی سایز (اختیاری)
    let isValidSize = true;
    if (selectedSize && product.sizes && product.sizes.length > 0) {
      isValidSize = product.sizes.some(s => 
        normalizeString(s.size) === normalizeString(selectedSize)
      );
      
      if (!isValidSize) {
        return errorResponse(res, 400, "سایز انتخاب شده معتبر نیست");
      }
    } else if (selectedSize && (!product.sizes || product.sizes.length === 0)) {
      // اگر محصول سایز ندارد ولی کاربر سایز ارسال کرده
      return errorResponse(res, 400, "این محصول سایز ندارد");
    }

    // جستجوی آیتم تکراری در سبد خرید
    const existingItem = user.cart.find((item) => {
      const isSameProduct = item.productId.toString() === productId;
      
      // مقایسه سایز (اگر وجود داشته باشد)
      let isSameSize = true;
      if (selectedSize && item.selectedSize) {
        isSameSize = item.selectedSize === selectedSize;
      } else if (!selectedSize && !item.selectedSize) {
        isSameSize = true;
      } else {
        isSameSize = false;
      }
      
      // مقایسه رنگ (اگر وجود داشته باشد)
      let isSameColor = true;
      if (selectedColor && item.selectedColor) {
        isSameColor = item.selectedColor === selectedColor;
      } else if (!selectedColor && !item.selectedColor) {
        isSameColor = true;
      } else {
        isSameColor = false;
      }
      
      return isSameProduct && isSameSize && isSameColor;
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      if (product.countInStock < newQuantity) {
        return errorResponse(res, 400, `تعداد درخواستی بیشتر از موجودی است (موجودی: ${product.countInStock})`);
      }
      existingItem.quantity = newQuantity;
    } else {
      const newCartItem = {
        productId,
        quantity,
      };
      
      // فقط اگر رنگ وجود داشت اضافه کن
      if (selectedColor) {
        newCartItem.selectedColor = selectedColor;
      }
      
      // فقط اگر سایز وجود داشت اضافه کن
      if (selectedSize) {
        newCartItem.selectedSize = selectedSize;
      }
      
      user.cart.push(newCartItem);
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
});

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

      const { productId, quantity, selectedColor, selectedSize } = req.body;
      const user = await User.findById(req.session.userId);

      const product = await Product.findById(productId);
      if (!product) {
        return errorResponse(res, 404, "محصول یافت نشد");
      }

      if (product.countInStock < quantity) { //注意: 使用 countInStock 而不是 stock
        return errorResponse(
          res,
          400,
          `موجودی محصول کافی نیست (موجودی: ${product.countInStock})`
        );
      }

      // جستجوی آیتم با در نظر گرفتن رنگ (اختیاری)
      const item = user.cart.find((item) => {
        const isSameProduct = item.productId.toString() === productId;
        
        if (selectedColor && item.selectedColor) {
          return isSameProduct && 
                 item.selectedSize === selectedSize && 
                 item.selectedColor === selectedColor;
        } else if (!selectedColor && !item.selectedColor) {
          return isSameProduct && item.selectedSize === selectedSize;
        }
        return false;
      });

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
