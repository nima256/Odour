const express = require("express");
const router = express.Router();
const User = require("../models/User");
const DiscountCode = require("../models/DiscountCode");
const Product = require("../models/Product");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const { body, param, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const {
  normalizeVariantValue,
  findColorVariant,
  findSizeVariant,
  getAvailableQuantity,
} = require("../services/variantStock");

const Order = require("../models/Order");
const { getCheckoutUnitPriceToman, hasSpecialPrice } = require("../services/orderPricing");

const ODOUR256_CODE = "ODOUR256";

const normalizePaymentProvider = (value) => {
  const normalized = String(value || "zarinpal").trim().toLowerCase();
  if (["snappay", "snapp-pay", "اسنپ‌پی", "اسنپ پی"].includes(normalized)) return "snappay";
  if (["torobpay", "torob-pay", "ترب‌پی", "ترب پی"].includes(normalized)) return "torobpay";
  return "zarinpal";
};

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
    const { productId, quantity, selectedColor, selectedVariantId, selectedSize, selectedSizeId } = req.body;

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

    if (Array.isArray(product.colors) && product.colors.length > 0 && !selectedColor && !selectedVariantId) {
      return errorResponse(res, 400, "لطفاً رنگ محصول را انتخاب کنید");
    }
    if (Array.isArray(product.sizes) && product.sizes.length > 0 && !selectedSize && !selectedSizeId) {
      return errorResponse(res, 400, "لطفاً سایز محصول را انتخاب کنید");
    }

    const colorVariant = findColorVariant(product, { selectedColor, selectedVariantId });
    if ((selectedColor || selectedVariantId) && !colorVariant) {
      return errorResponse(res, 400, "رنگ انتخاب شده معتبر نیست");
    }

    const sizeVariant = findSizeVariant(product, { selectedSize, selectedSizeId });
    if (selectedSize && product.sizes && product.sizes.length > 0 && !sizeVariant) {
      return errorResponse(res, 400, "سایز انتخاب شده معتبر نیست");
    } else if (selectedSize && (!product.sizes || product.sizes.length === 0)) {
      // اگر محصول سایز ندارد ولی کاربر سایز ارسال کرده
      return errorResponse(res, 400, "این محصول سایز ندارد");
    }

    const normalizedSelectedColor = colorVariant?.name || selectedColor || null;
    const normalizedSelectedSize = sizeVariant?.size || selectedSize || null;
    const availableQuantity = getAvailableQuantity(product, colorVariant, sizeVariant);
    if (availableQuantity < quantity) {
      return errorResponse(
        res,
        400,
        availableQuantity <= 0
          ? "رنگ یا سایز انتخاب‌شده ناموجود است"
          : `موجودی تنوع انتخاب‌شده کافی نیست (موجودی: ${availableQuantity})`
      );
    }

    // جستجوی آیتم تکراری در سبد خرید
    const existingItem = user.cart.find((item) => {
      const isSameProduct = item.productId.toString() === productId;
      
      // مقایسه سایز (اگر وجود داشته باشد)
      let isSameSize = true;
      if (normalizedSelectedSize && item.selectedSize) {
        isSameSize = normalizeVariantValue(item.selectedSize) === normalizeVariantValue(normalizedSelectedSize);
      } else if (!normalizedSelectedSize && !item.selectedSize) {
        isSameSize = true;
      } else {
        isSameSize = false;
      }
      
      // مقایسه رنگ (اگر وجود داشته باشد)
      let isSameColor = true;
      if (normalizedSelectedColor && item.selectedColor) {
        isSameColor = normalizeVariantValue(item.selectedColor) === normalizeVariantValue(normalizedSelectedColor);
      } else if (!normalizedSelectedColor && !item.selectedColor) {
        isSameColor = true;
      } else {
        isSameColor = false;
      }
      
      return isSameProduct && isSameSize && isSameColor;
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      if (availableQuantity < newQuantity) {
        return errorResponse(res, 400, `تعداد درخواستی بیشتر از موجودی تنوع انتخاب‌شده است (موجودی: ${availableQuantity})`);
      }
      existingItem.quantity = newQuantity;
    } else {
      const newCartItem = {
        productId,
        quantity,
      };
      
      // فقط اگر رنگ وجود داشت اضافه کن
      if (normalizedSelectedColor) {
        newCartItem.selectedColor = normalizedSelectedColor;
      }
      if (colorVariant?._id) {
        newCartItem.selectedVariantId = String(colorVariant._id);
      }
      
      // فقط اگر سایز وجود داشت اضافه کن
      if (normalizedSelectedSize) {
        newCartItem.selectedSize = normalizedSelectedSize;
      }
      if (sizeVariant?._id) {
        newCartItem.selectedSizeId = String(sizeVariant._id);
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

      const { productId, quantity, selectedColor, selectedVariantId, selectedSize, selectedSizeId } = req.body;
      const user = await User.findById(req.session.userId);

      const product = await Product.findById(productId);
      if (!product) {
        return errorResponse(res, 404, "محصول یافت نشد");
      }

      if (Array.isArray(product.colors) && product.colors.length > 0 && !selectedColor && !selectedVariantId) {
        return errorResponse(res, 400, "رنگ انتخاب‌شده مشخص نیست");
      }
      if (Array.isArray(product.sizes) && product.sizes.length > 0 && !selectedSize && !selectedSizeId) {
        return errorResponse(res, 400, "سایز انتخاب‌شده مشخص نیست");
      }

      const colorVariant = findColorVariant(product, { selectedColor, selectedVariantId });
      const sizeVariant = findSizeVariant(product, { selectedSize, selectedSizeId });
      if ((selectedColor || selectedVariantId) && !colorVariant) {
        return errorResponse(res, 400, "رنگ انتخاب شده معتبر نیست");
      }
      if (selectedSize && !sizeVariant) {
        return errorResponse(res, 400, "سایز انتخاب شده معتبر نیست");
      }

      const availableQuantity = getAvailableQuantity(product, colorVariant, sizeVariant);
      if (availableQuantity < quantity) {
        return errorResponse(
          res,
          400,
          availableQuantity <= 0
            ? "رنگ یا سایز انتخاب‌شده ناموجود است"
            : `موجودی تنوع انتخاب‌شده کافی نیست (موجودی: ${availableQuantity})`
        );
      }

      // جستجوی آیتم با در نظر گرفتن رنگ (اختیاری)
      const item = user.cart.find((item) => {
        const isSameProduct = item.productId.toString() === productId;
        
        if (selectedColor && item.selectedColor) {
          return isSameProduct && 
                 normalizeVariantValue(item.selectedSize) === normalizeVariantValue(selectedSize) &&
                 normalizeVariantValue(item.selectedColor) === normalizeVariantValue(selectedColor);
        } else if (!selectedColor && !item.selectedColor) {
          return isSameProduct && normalizeVariantValue(item.selectedSize) === normalizeVariantValue(selectedSize);
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


const removeDiscountHandler = async (req, res) => {
  try {
    delete req.session.discount;

    // ذخیره صریح سشن تا حذف تخفیف قبل از پاسخ قطعی شود.
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return res.json({
      success: true,
      message: "کد تخفیف با موفقیت حذف شد",
    });
  } catch (error) {
    console.error("Discount removal error:", error);
    return errorResponse(res, 500, "خطا در حذف کد تخفیف");
  }
};

// مسیر جدید با POST برای سازگاری بیشتر با سرور/پروکسی.
router.post("/remove-discount", isLoggedIn, removeDiscountHandler);

// مسیر قبلی را هم نگه می‌داریم تا سازگاری عقب‌رو حفظ شود.
router.delete("/discount", isLoggedIn, removeDiscountHandler);

router.post(
  "/apply-discount",
  [
    body("discountCode").trim().notEmpty().withMessage("کد تخفیف الزامی است"),
    body("subtotal")
      .isFloat({ min: 0 })
      .withMessage("مبلغ سبد خرید نامعتبر است")
      .toFloat(),
    body("paymentMethod").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return errorResponse(res, 400, "خطا در اعتبارسنجی", {
          errors: errors.array(),
        });
      }

      const { discountCode } = req.body;
      const normalizedDiscountCode = String(discountCode || "").trim().toUpperCase();
      const paymentProvider = normalizePaymentProvider(req.body.paymentMethod);
      const userId = req.session.userId;
      
      if (!userId) {
        return errorResponse(res, 401, "لطفاً ابتدا وارد حساب کاربری خود شوید");
      }

      const user = await User.findById(req.session.userId).populate("cart.productId");
      
     if (!user) {
        return errorResponse(res, 404, "کاربر یافت نشد");
      }
      
      if (!user.cart.length) {
        return errorResponse(res, 400, "سبد خرید شما خالی است");
      }

      const discount = await DiscountCode.findOne({ code: normalizedDiscountCode });

      const cartPricing = user.cart.reduce(
        (result, item) => {
          const product = item.productId;
          if (!product) return result;

          const quantity = Number(item.quantity || 0);
          const special = hasSpecialPrice(product.price, product.offerPrice);
          const unitPrice = getCheckoutUnitPriceToman({
            regularPrice: product.price,
            offerPrice: product.offerPrice,
            paymentProvider,
          });
          const lineTotal = unitPrice * quantity;

          result.subtotal += lineTotal;
          if (!special) result.odour256EligibleSubtotal += lineTotal;
          return result;
        },
        { subtotal: 0, odour256EligibleSubtotal: 0 }
      );

      const subtotal = cartPricing.subtotal;
      const discountBaseSubtotal = normalizedDiscountCode === ODOUR256_CODE
        ? cartPricing.odour256EligibleSubtotal
        : subtotal;

      const now = new Date();

      if (!discount || !discount.isActive) {
        return errorResponse(res, 400, "کد تخفیف نامعتبر است");
      }

      if (discount.expireDate && discount.expireDate < now) {
        return errorResponse(res, 400, "کد تخفیف منقضی شده است");
      }
      
     if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
        return errorResponse(res, 400, "تعداد استفاده از این کد تخفیف به پایان رسیده است");
      }


      if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
        return errorResponse(res, 400, "محدودیت استفاده از کد تخفیف");
      }

      if (normalizedDiscountCode === ODOUR256_CODE && discountBaseSubtotal <= 0) {
        return errorResponse(
          res,
          400,
          "کد تخفیف odour256 روی محصولات دارای قیمت ویژه قابل استفاده نیست"
        );
      }

      if (discount.minOrderAmount && discountBaseSubtotal < discount.minOrderAmount) {
        return errorResponse(
          res,
          400,
          `حداقل مبلغ سفارش برای این کد تخفیف ${discount.minOrderAmount} تومان است`
        );
      }
          
      if (discount.oneTimePerUser) {
        // بررسی در سفارشات پرداخت شده
        const alreadyUsed = await Order.findOne({
          user: userId,
          "discount.code": { $regex: new RegExp('^' + discount.code + '$', 'i') },
          paymentStatus: "پرداخت شده"
        });

        if (alreadyUsed) {
          return errorResponse(
            res, 
            400, 
            "شما قبلاً از این کد تخفیف استفاده کرده‌اید و هر کاربر فقط یک بار می‌تواند از آن استفاده کند"
          );
        }
        
        // همچنین بررسی کنید که آیا کاربر در سشن قبلاً این کد رو اعمال کرده (برای جلوگیری از اعمال مجدد در یک جلسه)
        if (
          req.session.discount &&
          String(req.session.discount.code || "").toUpperCase() === String(discount.code || "").toUpperCase()
        ) {
          return errorResponse(
            res,
            400,
            "شما قبلاً از این کد تخفیف استفاده کرده اید"
        );
        }
      }
      
      let discountAmount = 0;
      if (discount.type === "percent") {
        discountAmount = Math.floor((discountBaseSubtotal * discount.amount) / 100);
        // اعمال سقف تخفیف (اگر وجود داشته باشد)
        if (discount.maxDiscountAmount) {
          discountAmount = Math.min(discountAmount, discount.maxDiscountAmount);
        }
      } else {
        // تخفیف مبلغ ثابت
        discountAmount = Math.min(discount.amount, discountBaseSubtotal);
      }

      req.session.discount = {
        type: discount.type,
        amount: discount.amount,
        code: discount.code,
        calculatedAmount: discountAmount,
        discountId: discount._id,
        oneTimePerUser: discount.oneTimePerUser,
        minOrderAmount: discount.minOrderAmount || 0,
        maxDiscountAmount: discount.maxDiscountAmount || null,
      };

      res.json({
        success: true,
        message: "کد تخفیف با موفقیت اعمال شد",
        discount: {
          type: discount.type,
          originalValue: discount.type === "percent" 
            ? `${discount.amount}%` 
            : `${discount.amount.toLocaleString()} تومان`,
          amount: discount.amount,
          calculatedAmount: discountAmount,
          code: discount.code,
          minOrderAmount: discount.minOrderAmount,
          maxDiscountAmount: discount.maxDiscountAmount,
          oneTimePerUser: discount.oneTimePerUser, // ✅ اضافه شد
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
