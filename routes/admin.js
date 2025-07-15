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
const { getPersianDate } = require("../helper/getPersianDate");

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.get("/", async (req, res) => {
  const users = await User.find({});
  const products = await Product.find({})
    .populate("category")
    .populate("brand");
  const categories = await Category.find({ categoryType: "product" });
  const orders = await Order.find({}).populate("user").populate("products");
  const brands = await Brand.find({});

  const statusCounts = {
    pendingProcessing: await Order.countDocuments({ status: "در حال پردازش" }),
    inShipping: await Order.countDocuments({ status: "در حال ارسال" }),
    delivered: await Order.countDocuments({ status: "تحویل داده شد" }),
    cancelled: await Order.countDocuments({ status: "لغو شده" }),
    totalOrders: orders.length,
  };

  res.render("AdminPanel", {
    users,
    products,
    categories,
    orders,
    brands,
    statusCounts
  });
});

router.post("/products/add", async (req, res) => {
  try {
    // Calculate discount percentage if offerPrice exists
    let discount = null;
    if (req.body.offerPrice && req.body.price) {
      discount = Math.round(
        ((req.body.price - req.body.offerPrice) / req.body.price) * 100
      );
    }

    const productData = {
      ...req.body,
      discount,
      createTarikh: getPersianDate(),
      updateTarikh: getPersianDate(),
    };

    const product = new Product(productData);
    await product.save();

    const populatedProduct = await Product.findById(product._id)
      .populate("brand", "name") // Only populate the name field
      .populate("category", "name"); // Only populate the name field

    res.status(201).json({
      success: true,
      message: "محصول با موفقیت ایجاد شد",
      product: populatedProduct,
    });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({
      success: false,
      message: "خطای سرور در ایجاد محصول",
      error: error.message,
    });
  }
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
    .optional({ nullable: true, checkFalsy: true })
    .custom((value, { req }) => {
      if (value !== null && value !== undefined) {
        if (value >= req.body.price) {
          throw new Error("قیمت ویژه باید کمتر از قیمت اصلی باشد");
        }
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
  "/products/edit/:id",
  upload.array("images", 10), // حداکثر 10 تصویر
  validateProductUpdate,
  async (req, res) => {
    try {
      console.log(req.body);
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

      updateData.updateTarikh = getPersianDate();

      // مدیریت قیمت ویژه و تخفیف
      if (
        updateData.offerPrice === null ||
        updateData.offerPrice === undefined
      ) {
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
      const arrayFields = [
        "colors",
        "sizes",
        "specifications",
        "tags",
        "category",
      ];
      arrayFields.forEach((field) => {
        if (req.body[field] && Array.isArray(req.body[field])) {
          updateData[field] = req.body[field];
        } else {
          updateData[field] = [];
        }
      });

      // محاسبه تخفیف اگر قیمت ویژه تغییر کرده
      if (
        updateData.offerPrice === null ||
        updateData.offerPrice === undefined
      ) {
        updateData.offerPrice = undefined;
        updateData.discount = 0;
      } else if (updateData.offerPrice) {
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

router.delete("/products/delete/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "محصول یافت نشد",
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "محصول با موفقیت حذف شد",
      deletedProductId: req.params.id,
    });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({
      success: false,
      message: "خطای سرور در حذف محصول",
      error: error.message,
    });
  }
});

router.post("/categories/add", async (req, res) => {
  try {
    const { name, categoryType = "product", parentId = null } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "نام دسته‌بندی الزامی است",
      });
    }

    const category = new Category({
      name,
      categoryType,
      parentId: parentId || null,
    });

    await category.save();

    res.status(201).json({
      success: true,
      message: "دسته‌بندی با موفقیت ایجاد شد",
      category,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({
      success: false,
      message: "خطا در ایجاد دسته‌بندی",
      error: error.message,
    });
  }
});

router.put("/categories/edit/:id", async (req, res) => {
  try {
    const { name, categoryType, parentId } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "نام دسته‌بندی الزامی است",
      });
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      {
        name,
        categoryType: categoryType || "product",
        parentId: parentId || null,
        updateTarikh: getPersianDate(),
      },
      { new: true, runValidators: true }
    );

    if (!updatedCategory) {
      return res.status(404).json({
        success: false,
        message: "دسته‌بندی یافت نشد",
      });
    }

    res.json({
      success: true,
      message: "دسته‌بندی با موفقیت ویرایش شد",
      category: updatedCategory,
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      message: "خطا در ویرایش دسته‌بندی",
      error: error.message,
    });
  }
});

router.delete("/categories/delete/:id", async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "دسته‌بندی یافت نشد",
      });
    }

    res.json({
      success: true,
      message: "دسته‌بندی با موفقیت حذف شد",
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({
      success: false,
      message: "خطا در حذف دسته‌بندی",
      error: error.message,
    });
  }
});

// Brand Routes
router.post("/brands/add", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "نام برند الزامی است",
      });
    }

    const brand = new Brand({ name });
    await brand.save();

    res.status(201).json({
      success: true,
      message: "برند با موفقیت ایجاد شد",
      brand,
    });
  } catch (error) {
    console.error("Error creating brand:", error);
    res.status(500).json({
      success: false,
      message: "خطا در ایجاد برند",
      error: error.message,
    });
  }
});

router.put("/brands/edit/:id", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "نام برند الزامی است",
      });
    }

    const updatedBrand = await Brand.findByIdAndUpdate(
      req.params.id,
      {
        name,
        updateTarikh: getPersianDate(),
      },
      { new: true, runValidators: true }
    );

    if (!updatedBrand) {
      return res.status(404).json({
        success: false,
        message: "برند یافت نشد",
      });
    }

    res.json({
      success: true,
      message: "برند با موفقیت ویرایش شد",
      brand: updatedBrand,
    });
  } catch (error) {
    console.error("Error updating brand:", error);
    res.status(500).json({
      success: false,
      message: "خطا در ویرایش برند",
      error: error.message,
    });
  }
});

router.delete("/brands/delete/:id", async (req, res) => {
  try {
    const brand = await Brand.findByIdAndDelete(req.params.id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "برند یافت نشد",
      });
    }

    res.json({
      success: true,
      message: "برند با موفقیت حذف شد",
    });
  } catch (error) {
    console.error("Error deleting brand:", error);
    res.status(500).json({
      success: false,
      message: "خطا در حذف برند",
      error: error.message,
    });
  }
});

router.put("/orders/edit/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!status) {
      return res
        .status(400)
        .json({ success: false, message: "وضعیت جدید الزامی است" });
    }

    const validStatuses = [
      "در انتظار پرداخت",
      "در حال پردازش",
      "بسته بندی شده",
      "در حال ارسال",
      "تحویل داده شد",
      "لغو شده",
    ];

    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "وضعیت نامعتبر است" });
    }

    const order = await Order.findByIdAndUpdate(
      id,
      {
        status,
        $push: {
          statusHistory: {
            status,
            note: req.body.note || "تغییر وضعیت توسط مدیر",
          },
        },
      },
      { new: true }
    ).populate("user", "fullName email phone");

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "سفارش یافت نشد" });
    }

    res.json({
      success: true,
      message: "وضعیت سفارش با موفقیت به‌روزرسانی شد",
      data: order,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({
      success: false,
      message: "خطا در به‌روزرسانی وضعیت سفارش",
      error: error.message,
    });
  }
});

module.exports = router;
