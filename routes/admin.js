const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const upload = require("../middlewares/uploadMiddleware");

const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Category = require("../models/Category");
const Brand = require("../models/Brand");

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.get("/", async (req, res) => {
  const users = await User.find({});
  const products = await Product.find({})
    .populate("category")
    .populate("brand");
  const categories = await Category.find({ categoryType: "product" });
  const orders = await Order.find({});
  const brands = await Brand.find({});

  res.render("AdminPanel", {
    users,
    products,
    categories,
    orders,
    brands,
  });
});

const validateProductUpdate = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage("نام محصول باید بین ۳ تا ۱۰۰ کاراکتر باشد"),
  body("lilDescription")
    .optional()
    .trim()
    .isLength({ max: 160 })
    .withMessage("توضیح کوتاه نمی‌تواند بیشتر از ۱۶۰ کاراکتر باشد"),
  body("description")
    .optional()
    .trim()
    .isLength({ min: 20 })
    .withMessage("توضیحات محصول نمی‌تواند کمتر از ۲۰ کاراکتر باشد"),
  body("price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("قیمت محصول نمی‌تواند منفی باشد"),
  body("offerPrice")
    .optional()
    .custom((value, { req }) => {
      if (
        value !== null &&
        value !== undefined &&
        req.body.price &&
        value >= req.body.price
      ) {
        throw new Error("قیمت ویژه باید کمتر از قیمت اصلی باشد");
      }
      return true;
    }),
  body("countInStock")
    .optional()
    .isInt({ min: 0 })
    .withMessage("موجودی نمی‌تواند منفی باشد"),
  body("rating")
    .optional()
    .isFloat({ min: 0, max: 5 })
    .withMessage("امتیاز باید بین ۰ تا ۵ باشد"),
  body("weight")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("وزن نمی‌تواند منفی باشد"),
  body("discount")
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage("تخفیف باید بین ۰ تا ۱۰۰ باشد"),
  body("category")
    .optional()
    .isArray()
    .withMessage("دسته‌بندی باید آرایه باشد"),
  body("category.*")
    .optional()
    .isMongoId()
    .withMessage("شناسه دسته‌بندی نامعتبر است"),
  body("brand").optional().isMongoId().withMessage("شناسه برند نامعتبر است"),
  body("colors.*.name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("نام رنگ الزامی است"),
  body("colors.*.rgb")
    .optional()
    .trim()
    .isHexColor()
    .withMessage("کد رنگ باید به صورت HEX باشد"),
  body("sizes.*.size")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("سایز الزامی است"),
  body("sizes.*.usage")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("کاربرد سایز الزامی است"),
  body("specifications.*.key")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("کلید مشخصه الزامی است"),
  body("specifications.*.value")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("مقدار مشخصه الزامی است"),
  body("tags.*")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("برچسب نمی‌تواند خالی باشد"),
];

router.put(
  "/products/:id",
  upload.array("images", 10), // حداکثر 10 تصویر
  validateProductUpdate,
  async (req, res) => {
    try {
      // بررسی خطاهای اعتبارسنجی
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "خطا در اعتبارسنجی",
          errors: errors.array(),
        });
      }

      const productId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: "شناسه محصول نامعتبر است",
        });
      }

      // یافتن محصول
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "محصول یافت نشد",
        });
      }

      // آماده‌سازی داده‌های به‌روزرسانی
      const updateData = { ...req.body };

        // مدیریت قیمت ویژه و تخفیف
        if (updateData.offerPrice === null || updateData.offerPrice === undefined) {
        // اگر قیمت ویژه حذف شده
        updateData.offerPrice = undefined;
        updateData.discount = 0;
        } else if (updateData.offerPrice) {
        // اگر قیمت ویژه وجود دارد
        const price = updateData.price || product.price;
        updateData.discount = Math.round(
            ((price - updateData.offerPrice) / price) * 100
        );
        }

        // حذف فیلد offerPrice اگر null است
        if (updateData.offerPrice === null) {
        delete updateData.offerPrice;
        }

      // مدیریت تصاویر
      if (req.files && req.files.length > 0) {
        updateData.images = req.files.map(
          (file) =>
            `${req.protocol}://${req.get("host")}/uploads/${file.filename}`
        );
      }

      // مدیریت آرایه‌ها
      // مدیریت آرایه‌ها - اصلاح شده
      const arrayFields = [
        "colors",
        "sizes",
        "specifications",
        "tags",
        "category",
      ];

      arrayFields.forEach((field) => {
        if (req.body[field]) {
          try {
            // اگر مقدار رشته JSON است، آن را parse کنید
            if (typeof req.body[field] === "string") {
              updateData[field] = JSON.parse(req.body[field]);
            } else if (Array.isArray(req.body[field])) {
              // اگر قبلاً آرایه است، همان را استفاده کنید
              updateData[field] = req.body[field];
            }
          } catch (err) {
            console.error(`Error parsing ${field}:`, err);
            updateData[field] = [];
          }
        } else {
          updateData[field] = [];
        }
      });

      // محاسبه تخفیف اگر قیمت ویژه تغییر کرده
      if (updateData.offerPrice && !updateData.discount) {
        const price = updateData.price || product.price;
        updateData.discount = Math.round(
          ((price - updateData.offerPrice) / price) * 100
        );
      }

      // به‌روزرسانی محصول
      const updatedProduct = await Product.findByIdAndUpdate(
        productId,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      )
        .populate("category")
        .populate("brand");

      res.json({
        success: true,
        message: "محصول با موفقیت به‌روزرسانی شد",
        product: updatedProduct,
      });
    } catch (error) {
      console.error("خطا در ویرایش محصول:", error);
      res.status(500).json({
        success: false,
        message: "خطای سرور در ویرایش محصول",
        error: error.message,
      });
    }
  }
);

module.exports = router;
