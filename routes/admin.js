const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const DiscountCode = require("../models/DiscountCode");
const Visit = require("../models/Visit");
const RecentAction = require("../models/RecentAction");
const AdminNotification = require("../models/AdminNotification");

const { getPersianDate } = require("../helper/getPersianDate");
const Weblog = require("../models/Weblog");

const { isAdminLoggedIn } = require("../middlewares/adminAuth");
const { logAfterAction } = require("../middlewares/recentAction");


// این middleware رو برای همه روت‌ها به جز لاگین اعمال کن
router.use((req, res, next) => {
  if (req.path === '/login' || 
      req.path === '/login-page' || 
      req.path.startsWith('/css/') || 
      req.path.startsWith('/js/') || 
      req.path.startsWith('/fonts/') ||
      req.path === '/favicon.ico') {
    return next();
  }
  return isAdminLoggedIn(req, res, next);
});

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "public/uploads/temp";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // اسم موقت با timestamp
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

async function moveImagesToProductFolder(productId, productName, images, captions) {
  const sanitizedProductName = productName
    .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  
  const productFolder = path.join("public/uploads/products", `${productId}_${sanitizedProductName}`);
  
  // ایجاد پوشه محصول اگر وجود نداره
  if (!fs.existsSync(productFolder)) {
    fs.mkdirSync(productFolder, { recursive: true });
  }
  
  const processedImages = [];
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const caption = captions[i] || `image_${i + 1}`;
    
    // اسم فایل از کپشن + timestamp
    const sanitizedCaption = caption
      .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 50); // حداکثر 50 کاراکتر
    
    const newFilename = `${sanitizedCaption || 'image'}_${Date.now()}_${i}.webp`;
    const tempPath = image.path || path.join("public/uploads", image.filename);
    const newPath = path.join(productFolder, newFilename);
    
    // انتقال فایل
    if (fs.existsSync(tempPath)) {
      fs.renameSync(tempPath, newPath);
      processedImages.push({
        url: `/uploads/products/${productId}_${sanitizedProductName}/${newFilename}`,
        filename: newFilename,
        caption: caption,
        alt: caption
      });
    }
  }
  
  return processedImages;
}


const upload = multer({ storage });

const retryUnlink = async (filePath, retries = 5, delay = 100) => {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.promises.unlink(filePath);
      return;
    } catch (err) {
      if (err.code === "EPERM" || err.code === "EBUSY") {
        // Try again after delay
        await new Promise((res) => setTimeout(res, delay));
      } else {
        throw err; // Unknown error, rethrow
      }
    }
  }

  throw new Error(
    `Failed to delete file after ${retries} attempts: ${filePath}`
  );
};

const processImages = async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  try {
    const processedImages = [];

    for (const file of req.files) {
      const outputPath = path.join(
        "public/uploads",
        path.basename(file.path, path.extname(file.path)) + ".webp"
      );

      try {
        // Process image
        await sharp(file.path)
          .webp({ quality: 80 })
          .resize(1200, 1200, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .toFile(outputPath);

        // Manually null the sharp instance (optional but may help)
        sharp.cache(false); // Disable caching globally (can help)

        processedImages.push({
          url: `/uploads/${path.basename(outputPath)}`,
          filename: path.basename(outputPath),
        });
      } finally {
        const tempFilePath = file.path;

        try {
          await retryUnlink(tempFilePath);
        } catch (err) {
          console.error(
            `Still could not delete temp file ${tempFilePath}:`,
            err
          );
        }
      }
    }

    req.processedImages = processedImages;
    next();
  } catch (err) {
    next(err);
  }
};


router.post(
  "/upload-image",
  upload.single("image"),  // Multer first to process the upload
  async (req, res, next) => {
    // Convert single file to array format that processImages expects
    if (req.file) {
      req.files = [req.file];
    }
    next();
  },
  processImages,  // Then process the image
  async (req, res) => {
    try {
      if (!req.processedImages || req.processedImages.length === 0) {
        return res.status(400).json({ error: "No image processed" });
      }

      const processedImage = req.processedImages[0];
      res.json({
        success: true,
        url: processedImage.url,
        filename: processedImage.filename
      });
    } catch (error) {
      console.error("Image upload error:", error);
      res.status(500).json({
        error: "Error processing image",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

router.post(
  "/upload-images",
  upload.array("images"),
  processImages,
  async (req, res) => {
    try {
      if (!req.processedImages || req.processedImages.length === 0) {
        return res.status(400).json({ error: "هیچ عکسی پردازش نشد" });
      }

      // Return relative URLs instead of absolute ones
      const processedImages = req.processedImages.map((img) => ({
        url: img.url.replace(/^https?:\/\/[^/]+/, ""), // Remove domain part
        filename: img.filename,
      }));

      res.status(200).json({
        success: true,
        images: processedImages,
      });
    } catch (error) {
      console.error("Image upload error:", error);

      // Additional cleanup if error occurs
      if (req.processedImages) {
        req.processedImages.forEach((img) => {
          const filePath = path.join("public/uploads", img.filename);
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (err) {
            console.error(`Error cleaning up ${filePath}:`, err);
          }
        });
      }

      res.status(500).json({
        error: "ارور در آپلود عکس",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

router.delete("/delete-image", async (req, res) => {
  try {
    const { filename, productId, productName } = req.body;

    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

    let fileDeleted = false;

    
    if (productId && productName) {
      const sanitizedProductName = productName
        .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '')
        .trim()
        .replace(/\s+/g, '_');
      
      const productFolder = path.join("public/uploads/products", `${productId}_${sanitizedProductName}`);
      const filePath = path.join(productFolder, filename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        fileDeleted = true;
        console.log(`تصویر از پوشه محصول حذف شد: ${filePath}`);
      }
    }

    // روش دوم: اگر فایل توی مسیر قدیمی (public/uploads) باشه
    if (!fileDeleted) {
      const oldFilePath = path.join("public/uploads", filename);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
        fileDeleted = true;
        console.log(`تصویر از پوشه قدیمی حذف شد: ${oldFilePath}`);
      }
    }

    // روش سوم: توی پوشه temp نگاه کن
    if (!fileDeleted) {
      const tempFilePath = path.join("public/uploads/temp", filename);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        fileDeleted = true;
        console.log(`تصویر از پوشه temp حذف شد: ${tempFilePath}`);
      }
    }

    if (!fileDeleted) {
      return res.status(404).json({ error: "فایل یافت نشد" });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Image deletion error:", error);
    res.status(500).json({
      error: "Failed to delete image",
      details: error.message,
    });
  }
});

router.get("/", async (req, res) => {
  const loggedInAdmin = req.admin;

  const users = await User.find({});
  const products = await Product.find({})
    .populate("category")
    .populate("brand");
  const categories = await Category.find({ categoryType: "product" });
  const orders = await Order.find({}).populate("user").populate("products");
  const brands = await Brand.find({});
  const discounts = await DiscountCode.find({});
  const weblogs = await Weblog.find({});

  // ========== آمار بازدیدها ==========
  
  // کل بازدیدهای کل سایت
  const totalVisits = await Visit.countDocuments();
  
  // بازدیدهای امروز
  const today = getPersianDate();
  const todayVisits = await Visit.countDocuments({ visitDate: today });
  
  // بازدیدهای دیروز
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getPersianDate(yesterday);
  const yesterdayVisits = await Visit.countDocuments({ visitDate: yesterdayStr });
  
  // درصد تغییر بازدید نسبت به دیروز
  let visitsChangePercent = 0;
  if (yesterdayVisits > 0) {
    visitsChangePercent = ((todayVisits - yesterdayVisits) / yesterdayVisits) * 100;
  }
  
  // پربازدیدترین صفحات (آخرین 30 روز)
  const topPages = await Visit.aggregate([
    {
      $match: {
        visitTimestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: "$path",
        count: { $sum: 1 },
        title: { $first: "$title" }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);
  
  // بازدیدهای 7 روز اخیر برای نمودار
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = getPersianDate(date);
    const count = await Visit.countDocuments({ visitDate: dateStr });
    last7Days.push({
      date: dateStr,
      count: count
    });
  }
  
  // بازدیدهای هر ماه (برای نمودار سالانه)
const allOrders = await Order.find({ status: { $ne: "لغو شده" } });

const monthlyStats = {};

allOrders.forEach(order => {
  if (order.createTarikh) {
    let tarikh = order.createTarikh;
    
    // تبدیل اعداد فارسی به انگلیسی در createTarikh
    tarikh = tarikh.replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)]);
    
    const parts = tarikh.split('-');
    if (parts.length >= 2) {
      const year = parts[0];
      let month = parts[1];
      
      // حذف کاراکترهای غیرعددی و اطمینان از دو رقمی بودن
      month = month.replace(/\D/g, '');
      if (month.length === 1) {
        month = `0${month}`;
      }
      
      const key = `${year}-${month}`;
      
      if (!monthlyStats[key]) {
        monthlyStats[key] = {
          month: key,
          orderCount: 0,
          totalSales: 0
        };
      }
      monthlyStats[key].orderCount++;
      monthlyStats[key].totalSales += (order.totalPrice || 0);
    }
  }
});

// تبدیل به آرایه و مرتب‌سازی
const formattedMonthlyStats = Object.values(monthlyStats)
  .sort((a, b) => a.month.localeCompare(b.month))
  .slice(-6);

  function formatPageInfo(path) {
    if (path === '/') {
      return { name: 'صفحه اصلی', link: '/' };
    }
    
    if (path.startsWith('/productDetails/')) {
      const slug = path.replace('/productDetails/', '');
      const name = decodeURIComponent(slug).replace(/-/g, ' ');
      return { name: name, link: path };
    }
    
    if (path.startsWith('/category/')) {
      const catName = decodeURIComponent(path.replace('/category/', '')).replace(/-/g, ' ');
      return { name: `دسته: ${catName}`, link: path };
    }
    
    if (path.startsWith('/weblog/')) {
      const blogTitle = decodeURIComponent(path.replace('/weblog/', '')).replace(/-/g, ' ');
      return { name: `مقاله: ${blogTitle}`, link: path };
    }
    
    // صفحات دیگر مثل /about-us, /contact-us و ...
    let name = path.replace(/^\//, '').replace(/-/g, ' ');
    name = name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    
    return { name: name || path, link: path };
  }

  // در جایی که topPages رو پردازش می‌کنی:
  const formattedTopPages = topPages.map(page => {
      const formatted = formatPageInfo(page._id);
      return {
          count: page.count,
          title: page.title,
          displayName: formatted.name,
          link: formatted.link
      };
  });

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
    statusCounts,
    discounts,
    weblogs,
    admin: loggedInAdmin,
    visitStats: {
      totalVisits,
      todayVisits,
      yesterdayVisits,
      visitsChangePercent,
      topPages: formattedTopPages,
      last7Days,
      monthlyOrders: formattedMonthlyStats.map(stat => ({
        month: stat.month,
        orderCount: stat.orderCount,
        totalSales: stat.totalSales  // اضافه کردن فروش
      }))
    },
  });
});

router.get("/login", async (req, res) => {
  if (req.session && req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user && (user.role === 'admin' || user.role === 'super_admin')) {
      return res.redirect('/admin');
    }
  }
  res.render("adminlogin");
});

router.get("/logout", async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
    }
    res.redirect('/admin/login');
  });
});

router.post("/products/add", async (req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (data && data.success && data.product) {
      const admin = req.admin;
      if (admin) {
        const recentAction = new RecentAction({
          action: 'create_product',
          targetType: 'product',
          targetId: data.product._id,
          targetName: data.product.name,
          adminId: admin._id,
          adminName: admin.fullName,
          ipAddress: req.ip
        });
        recentAction.save().catch(console.error);
      }
    }
    return originalJson.call(this, data);
  };
  next();
}, async (req, res) => {
  try {
    // Calculate discount percentage if offerPrice exists
    let discount = null;
    if (req.body.offerPrice && req.body.price) {
      discount = Math.round(
        ((req.body.price - req.body.offerPrice) / req.body.price) * 100
      );
    }

    const tempImages = req.body.images || [];
    delete req.body.images;


    const productData = {
      ...req.body,
      englishName: req.body.englishName || null,
      images: req.body.images || [],
      discount,
      createTarikh: getPersianDate(),
      updateTarikh: getPersianDate(),
      images: []
    };
    
    if (!productData.slug || !productData.slug.trim()) {
      delete productData.slug;
    }

    const product = new Product(productData);
    await product.save();

    const captions = tempImages.map(img => img.caption || img.alt || '');
    const processedImages = await moveImagesToProductFolder(
      product._id, 
      product.name, 
      tempImages,
      captions
    );

    product.images = processedImages;
    await product.save();

    if (product.countInStock <= 0) {
      product.isOutOfStock = true;
      await product.save();
    }

    const populatedProduct = await Product.findById(product._id)
      .populate("brand", "name") // Only populate the name field
      .populate("category", "name"); // Only populate the name field

    if (populatedProduct.category && populatedProduct.category.length > 0) {
      populatedProduct.catName = populatedProduct.category[0].name;
      await populatedProduct.save();
    }

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
  body("specifications.*.key")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("کلید مشخصه الزامی است"),
  body("englishName")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("نام انگلیسی نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد")
    .matches(/^[a-zA-Z0-9\s\-_]*$/)
    .withMessage("نام انگلیسی باید فقط شامل حروف انگلیسی، اعداد، فاصله، خط تیره و زیرخط باشد"),
body("slug")
  .optional({ nullable: true, checkFalsy: true })
  .trim()
  .matches(/^[a-zA-Z\u0600-\u06FF0-9\-]+$/)
  .withMessage("اسلاگ باید فقط شامل حروف انگلیسی، فارسی، اعداد و خط تیره (-) باشد"),
];

router.put("/products/edit/:id",async (req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (data && data.success && data.product) {
      const admin = req.admin;
      if (admin) {
        const recentAction = new RecentAction({
          action: 'update_product',
          targetType: 'product',
          targetId: data.product._id,
          targetName: data.product.name,
          adminId: admin._id,
          adminName: admin.fullName,
          details: `ویرایش محصول`,
          ipAddress: req.ip
        });
        recentAction.save().catch(console.error);
      }
    }
    return originalJson.call(this, data);
  };
  next();
}, validateProductUpdate, async (req, res) => {
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
    
      if (updateData.englishName === undefined) {
        updateData.englishName = null;
      }
      
    if (updateData.slug === undefined || updateData.slug === null || !updateData.slug.trim()) {
      delete updateData.slug;
    }

    updateData.updateTarikh = getPersianDate();

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
    if (updateData.images && Array.isArray(updateData.images)) {
      // You might want to merge with existing images or replace them
      // This example replaces all images with the new array
      updateData.images = updateData.images;
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
    
    Object.assign(product, updateData);
    await product.save();


    // محاسبه تخفیف اگر قیمت ویژه تغییر کرده
    if (updateData.offerPrice === null || updateData.offerPrice === undefined) {
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

    if (updatedProduct.countInStock <= 0) {
      updatedProduct.isOutOfStock = true;
      await updatedProduct.save();
    } else if (updatedProduct.isOutOfStock && updatedProduct.countInStock > 0) {
      updatedProduct.isOutOfStock = false;
      await updatedProduct.save();
    }

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
});

router.delete("/products/delete/:id",async (req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (data && data.success) {
      const admin = req.admin;
      if (admin) {
        const recentAction = new RecentAction({
          action: 'delete_product',
          targetType: 'product',
          targetId: req.params.id,
          targetName: data.deletedProductId || req.params.id,
          adminId: admin._id,
          adminName: admin.fullName,
          details: `حذف محصول`,
          ipAddress: req.ip
        });
        recentAction.save().catch(console.error);
      }
    }
    return originalJson.call(this, data);
  };
  next();
}, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "محصول یافت نشد",
      });
    }

    const sanitizedProductName = product.name
      .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    
    const productFolder = path.join("public/uploads/products", `${product._id}_${sanitizedProductName}`);
    
    if (fs.existsSync(productFolder)) {
      // حذف تمام فایل‌های داخل پوشه
      const files = fs.readdirSync(productFolder);
      for (const file of files) {
        fs.unlinkSync(path.join(productFolder, file));
      }
      // حذف خود پوشه
      fs.rmdirSync(productFolder);
      console.log(`پوشه محصول ${product._id} حذف شد`);
    }

    // همچنین تصاویر قدیمی که ممکن است در پوشه قدیمی باشند رو هم پاک کن
    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        const oldImagePath = path.join("public/uploads", img.filename);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
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
    invalidateMenuCache();

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
    invalidateMenuCache();

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
    invalidateMenuCache();

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

// Duplicate product route
router.post("/products/duplicate/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "شناسه محصول نامعتبر است",
      });
    }
    
    // پیدا کردن محصول اصلی
    const originalProduct = await Product.findById(productId)
      .populate("category")
      .populate("brand");
    
    if (!originalProduct) {
      return res.status(404).json({
        success: false,
        message: "محصول یافت نشد",
      });
    }
    
    // آماده‌سازی داده‌های محصول جدید
    const duplicateData = originalProduct.toObject();
    
    // حذف فیلدهایی که نباید کپی شوند
    delete duplicateData._id;
    delete duplicateData.__v;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    delete duplicateData.slug; // اسلاگ جدید در pre-hook ساخته می‌شود
    
    // تغییر نام محصول
    duplicateData.name = `${originalProduct.name} (کپی)`;
    
    // تنظیم تاریخ‌های جدید
    duplicateData.createTarikh = getPersianDate();
    duplicateData.updateTarikh = getPersianDate();
    
    // بازنشانی آمارها
    duplicateData.rating = 0;
    duplicateData.reviewsNum = 0;
    duplicateData.isNewProduct = true;
    duplicateData.isFeatured = false;
    duplicateData.isPopular = false;
    
    if (duplicateData.weight) {
      // اگر weight از نوع string بود و شامل "گرم" بود
      if (typeof duplicateData.weight === 'string') {
        const weightMatch = duplicateData.weight.match(/(\d+)/);
        if (weightMatch) {
          duplicateData.weight = parseInt(weightMatch[1]);
        } else {
          duplicateData.weight = null;
        }
      }
      // اگر عدد بود، همان را نگه می‌داریم
    }
    
    // کپی کردن تصاویر (اختیاری - می‌توانید مسیرهای جدیدی بسازید)
    // در اینجا تصاویر قبلی را reuse می‌کنیم
    if (originalProduct.images && originalProduct.images.length > 0) {
      duplicateData.images = originalProduct.images.map(img => ({
        url: img.url,
        filename: img.filename
      }));
    } else {
      duplicateData.images = [];
    }
        // اطمینان از اینکه price عدد است
    if (duplicateData.price && typeof duplicateData.price === 'string') {
      duplicateData.price = parseFloat(duplicateData.price);
    }
    
    // اطمینان از اینکه offerPrice عدد است (اگر وجود دارد)
    if (duplicateData.offerPrice) {
      if (typeof duplicateData.offerPrice === 'string') {
        duplicateData.offerPrice = parseFloat(duplicateData.offerPrice);
      }
    } else {
      duplicateData.offerPrice = undefined;
    }
    
    // اطمینان از اینکه countInStock عدد است
    if (duplicateData.countInStock && typeof duplicateData.countInStock === 'string') {
      duplicateData.countInStock = parseInt(duplicateData.countInStock);
    }
    
    // اطمینان از اینکه discount عدد است
    if (duplicateData.discount && typeof duplicateData.discount === 'string') {
      duplicateData.discount = parseInt(duplicateData.discount);
    }
    
    // محاسبه مجدد discount اگر offerPrice وجود دارد
    if (duplicateData.offerPrice && duplicateData.price) {
      duplicateData.discount = Math.round(
        ((duplicateData.price - duplicateData.offerPrice) / duplicateData.price) * 100
      );
    }
    
    // اطمینان از فرمت صحیح آرایه‌ها
    const arrayFields = ['colors', 'sizes', 'specifications', 'tags', 'category'];
    arrayFields.forEach(field => {
      if (!duplicateData[field] || !Array.isArray(duplicateData[field])) {
        duplicateData[field] = [];
      }
    });
    
    // حذف فیلدهای virtual که ممکن است مشکل ایجاد کنند
    delete duplicateData.discountPrice;
    delete duplicateData.categoryDetails;
    delete duplicateData.brandDetails;

    
    // ایجاد محصول جدید
    const newProduct = new Product(duplicateData);
    await newProduct.save();
    
    // populate کردن اطلاعات مورد نیاز
    const populatedProduct = await Product.findById(newProduct._id)
      .populate("brand", "name")
      .populate("category", "name");
    
    res.status(201).json({
      success: true,
      message: "محصول با موفقیت کپی شد",
      product: populatedProduct,
    });
    
  } catch (error) {
    console.error("Error duplicating product:", error);
    res.status(500).json({
      success: false,
      message: "خطای سرور در کپی کردن محصول",
      error: error.message,
    });
  }
});

router.post("/discounts/add", async (req, res) => {
    try {
        const { 
            code, 
            type, 
            amount, 
            minOrderAmount, 
            usageLimit, 
            expireDate, 
            isActive, 
            description,
            maxDiscountAmount 
        } = req.body;
        
        // بررسی وجود کد تکراری
        const existingDiscount = await DiscountCode.findOne({ code: code.toUpperCase() });
        if (existingDiscount) {
            return res.status(400).json({ message: "این کد تخفیف قبلاً وجود دارد" });
        }
        
        const newDiscountData = {
            code: code.toUpperCase(),
            type,
            amount,
            minOrderAmount: minOrderAmount || null,
            usageLimit: usageLimit || null,
            expireDate: expireDate || null,
            isActive: isActive !== undefined ? isActive : true,
            description: description || null,
            usedCount: 0
        };
        
        // اضافه کردن maxDiscountAmount برای تخفیف درصدی
        if (type === 'percent' && maxDiscountAmount) {
            newDiscountData.maxDiscountAmount = maxDiscountAmount;
        }
        
        const newDiscount = new DiscountCode(newDiscountData);
        
        await newDiscount.save();
        
        res.status(201).json({ 
            success: true, 
            message: "کد تخفیف با موفقیت اضافه شد",
            discount: newDiscount 
        });
        
    } catch (error) {
        console.error("Error adding discount:", error);
        
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        
        res.status(500).json({ message: "خطا در افزودن کد تخفیف", error: error.message });
    }
});

// ویرایش کد تخفیف
router.put("/discounts/edit/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // بررسی معتبر بودن ID
        if (!id || id === 'undefined') {
            return res.status(400).json({ message: "شناسه تخفیف معتبر نیست" });
        }
        
        const { 
            code, 
            type, 
            amount, 
            minOrderAmount, 
            usageLimit, 
            expireDate, 
            isActive, 
            description,
            maxDiscountAmount 
        } = req.body;
        
        // بررسی وجود کد تکراری (به غیر از خودش)
        const existingDiscount = await DiscountCode.findOne({ 
            code: code.toUpperCase(),
            _id: { $ne: id }
        });
        
        if (existingDiscount) {
            return res.status(400).json({ message: "این کد تخفیف قبلاً وجود دارد" });
        }
        
        const updateData = {
            code: code.toUpperCase(),
            type,
            amount,
            minOrderAmount: minOrderAmount || null,
            usageLimit: usageLimit || null,
            expireDate: expireDate || null,
            isActive: isActive !== undefined ? isActive : true,
            description: description || null
        };
        
        // اضافه کردن maxDiscountAmount برای تخفیف درصدی
        if (type === 'percent' && maxDiscountAmount) {
            updateData.maxDiscountAmount = maxDiscountAmount;
        } else if (type === 'amount') {
            updateData.maxDiscountAmount = null;
        }
        
        const updatedDiscount = await DiscountCode.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );
        
        if (!updatedDiscount) {
            return res.status(404).json({ message: "کد تخفیف یافت نشد" });
        }
        
        res.json({ 
            success: true, 
            message: "کد تخفیف با موفقیت ویرایش شد",
            discount: updatedDiscount 
        });
        
    } catch (error) {
        console.error("Error editing discount:", error);
        
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        
        res.status(500).json({ message: "خطا در ویرایش کد تخفیف", error: error.message });
    }
});

// حذف کد تخفیف
router.delete("/discounts/delete/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // بررسی معتبر بودن ID
        if (!id || id === 'undefined') {
            return res.status(400).json({ message: "شناسه تخفیف معتبر نیست" });
        }
        
        const deletedDiscount = await DiscountCode.findByIdAndDelete(id);
        
        if (!deletedDiscount) {
            return res.status(404).json({ message: "کد تخفیف یافت نشد" });
        }
        
        res.json({ 
            success: true, 
            message: "کد تخفیف با موفقیت حذف شد" 
        });
        
    } catch (error) {
        console.error("Error deleting discount:", error);
        res.status(500).json({ message: "خطا در حذف کد تخفیف", error: error.message });
    }
});


const validateWeblog = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("عنوان مقاله الزامی است")
    .isLength({ min: 5, max: 100 })
    .withMessage("عنوان باید بین 5 تا 100 کاراکتر باشد"),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("توضیحات کوتاه الزامی است")
    .isLength({ max: 160 })
    .withMessage("توضیحات کوتاه نمی‌تواند بیشتر از 160 کاراکتر باشد"),
  body("content")
    .trim()
    .notEmpty()
    .withMessage("محتوا الزامی است")
    .isLength({ min: 100 })
    .withMessage("محتوا نمی‌تواند کمتر از 100 کاراکتر باشد"),
  body("readingTime")
    .optional()
    .isInt({ min: 1 })
    .withMessage("زمان مطالعه باید حداقل 1 دقیقه باشد"),
  body("metaTitle")
    .optional()
    .isLength({ max: 60 })
    .withMessage("عنوان متا نمی‌تواند بیشتر از 60 کاراکتر باشد"),
  body("metaDescription")
    .optional()
    .isLength({ max: 160 })
    .withMessage("توضیحات متا نمی‌تواند بیشتر از 160 کاراکتر باشد"),
];

// دریافت لیست مقالات
router.get("/weblogs", async (req, res) => {
  try {
    const weblogs = await Weblog.find({})
      .populate("author", "fullName email")
      .populate("categories", "name")
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      weblogs,
    });
  } catch (error) {
    console.error("Error fetching weblogs:", error);
    res.status(500).json({
      success: false,
      message: "خطا در دریافت مقالات",
      error: error.message,
    });
  }
});

// افزودن مقاله جدید
router.post("/weblogs/add", async (req, res) => {
    try {
        const {
            title,
            description,
            content,
            images,
            categories,
            tags,
            readingTime,
            isFeatured,
            isPublished,
            metaTitle,
            metaDescription
        } = req.body;

        // اعتبارسنجی
        if (!title || !description || !content) {
            return res.status(400).json({ success: false, message: 'عنوان، توضیحات و محتوا الزامی هستند' });
        }

        // پردازش صحیح تصاویر با حفظ caption و alt
        let processedImages = [];
        if (images && Array.isArray(images)) {
            processedImages = images.map(img => {
                // اگر img رشته است (URL) به آبجکت تبدیل کن
                if (typeof img === 'string') {
                    return {
                        url: img,
                        filename: img.split('/').pop() || 'unknown',
                        caption: '',
                        alt: ''
                    };
                }
                // اگر img آبجکت است و url دارد
                if (img && typeof img === 'object' && img.url) {
                    return {
                        url: img.url,
                        filename: img.filename || img.url.split('/').pop() || 'unknown',
                        caption: img.caption || img.alt || '',
                        alt: img.alt || img.caption || ''
                    };
                }
                return null;
            }).filter(img => img !== null);
        }

        // تولید slug
        const slug = title
            .toString()
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\uFB8A\u067E\u0686\u06AF\u200C\u0629\u0640a-z0-9\-]/g, '')
            .replace(/\-{2,}/g, '-')
            .replace(/^\-+|\-+$/g, '');

        const weblog = new Weblog({
            title,
            slug,
            description,
            content,
            images: processedImages,
            categories: categories || [],
            tags: tags || [],
            readingTime: readingTime || 5,
            isFeatured: isFeatured || false,
            isPublished: isPublished || false,
            metaTitle: metaTitle || title,
            metaDescription: metaDescription || description,
            author: req.admin._id,
            createTarikh: getPersianDate(),
            updateTarikh: getPersianDate()
        });

        await weblog.save();
        
        // populate نویسنده
        await weblog.populate('author', 'fullName');
        await weblog.populate('categories', 'name');
        
        res.status(201).json({ 
            success: true, 
            message: 'مقاله با موفقیت ایجاد شد',
            weblog
        });
        
    } catch (error) {
        console.error('Error creating weblog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});




// ویرایش مقاله
router.put("/weblogs/edit/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "شناسه مقاله نامعتبر است" });
        }
        
      const {
            title,
            description,
            content,
            images,
            categories,
            tags,
            readingTime,
            isFeatured,
            isPublished,
            metaTitle,
            metaDescription
        } = req.body;

        // پردازش صحیح تصاویر با حفظ caption و alt
        let processedImages = [];
        if (images && Array.isArray(images)) {
            processedImages = images.map(img => {
                if (typeof img === 'string') {
                    return {
                        url: img,
                        filename: img.split('/').pop() || 'unknown',
                        caption: '',
                        alt: ''
                    };
                }
                if (img && typeof img === 'object' && img.url) {
                    return {
                        url: img.url,
                        filename: img.filename || img.url.split('/').pop() || 'unknown',
                        caption: img.caption || img.alt || '',
                        alt: img.alt || img.caption || ''
                    };
                }
                return null;
            }).filter(img => img !== null);
        }

        // تولید slug جدید
        const slug = title
            .toString()
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\uFB8A\u067E\u0686\u06AF\u200C\u0629\u0640a-z0-9\-]/g, '')
            .replace(/\-{2,}/g, '-')
            .replace(/^\-+|\-+$/g, '');

        const updateData = {
            title,
            slug,
            description,
            content,
            images: processedImages,
            categories: categories || [],
            tags: tags || [],
            readingTime: readingTime || 5,
            isFeatured: isFeatured || false,
            isPublished: isPublished || false,
            metaTitle: metaTitle || title,
            metaDescription: metaDescription || description,
            updateTarikh: getPersianDate(),
            updatedAt: Date.now()
        };

        const weblog = await Weblog.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        ).populate('author', 'fullName').populate('categories', 'name');

        if (!weblog) {
            return res.status(404).json({ success: false, message: 'مقاله یافت نشد' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'مقاله با موفقیت ویرایش شد',
            weblog
        });
        
    } catch (error) {
        console.error('Error editing weblog:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// حذف مقاله
router.delete("/weblogs/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "شناسه مقاله نامعتبر است",
      });
    }

    const deletedWeblog = await Weblog.findByIdAndDelete(id);

    if (!deletedWeblog) {
      return res.status(404).json({
        success: false,
        message: "مقاله یافت نشد",
      });
    }

    res.json({
      success: true,
      message: "مقاله با موفقیت حذف شد",
    });
  } catch (error) {
    console.error("Error deleting weblog:", error);
    res.status(500).json({
      success: false,
      message: "خطا در حذف مقاله",
      error: error.message,
    });
  }
});

// دریافت یک مقاله
router.get("/weblogs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "شناسه مقاله نامعتبر است",
      });
    }

    const weblog = await Weblog.findById(id)
      .populate("author", "fullName email")
      .populate("categories", "name");

    if (!weblog) {
      return res.status(404).json({
        success: false,
        message: "مقاله یافت نشد",
      });
    }

    res.json({
      success: true,
      weblog,
    });
  } catch (error) {
    console.error("Error fetching weblog:", error);
    res.status(500).json({
      success: false,
      message: "خطا در دریافت مقاله",
      error: error.message,
    });
  }
});

router.get("/categories", async (req, res) => {
    try {
        const { type } = req.query;
        const filter = {};
        if (type) {
            filter.categoryType = type;
        }
        const categories = await Category.find(filter);
        res.json({
            success: true,
            categories
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get("/recent-actions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const actions = await RecentAction.find({})
      .sort({ createdAtTimestamp: -1 })
      .limit(limit)
      .populate('adminId', 'fullName email');
    
    // ترجمه اکشن‌ها به فارسی
    const actionMap = {
      'create_product': '➕ افزودن محصول جدید',
      'update_product': '✏️ ویرایش محصول',
      'delete_product': '🗑️ حذف محصول',
      'create_category': '📁 افزودن دسته‌بندی جدید',
      'update_category': '✏️ ویرایش دسته‌بندی',
      'delete_category': '🗑️ حذف دسته‌بندی',
      'create_brand': '🏷️ افزودن برند جدید',
      'update_brand': '✏️ ویرایش برند',
      'delete_brand': '🗑️ حذف برند',
      'create_discount': '🎫 افزودن کد تخفیف جدید',
      'update_discount': '✏️ ویرایش کد تخفیف',
      'delete_discount': '🗑️ حذف کد تخفیف',
      'update_order_status': '📦 تغییر وضعیت سفارش',
      'create_weblog': '📝 افزودن مقاله جدید',
      'update_weblog': '✏️ ویرایش مقاله',
      'delete_weblog': '🗑️ حذف مقاله',
      'admin_login': '🔐 ورود به پنل',
      'admin_logout': '🚪 خروج از پنل'
    };
    
    const formattedActions = actions.map(action => ({
      ...action.toObject(),
      actionPersian: actionMap[action.action] || action.action,
      timeAgo: getTimeAgo(action.createdAtTimestamp)
    }));
    
    res.json({
      success: true,
      actions: formattedActions
    });
  } catch (error) {
    console.error("Error fetching recent actions:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

function getTimeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - new Date(date)) / 1000);
  
  if (diff < 60) return `${diff} ثانیه پیش`;
  if (diff < 3600) return `${Math.floor(diff / 60)} دقیقه پیش`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ساعت پیش`;
  return `${Math.floor(diff / 86400)} روز پیش`;
}

router.get("/api/orders-stats", async (req, res) => {
  try {
    // همه سفارشات رو بگیر
    const allOrders = await Order.find({
      status: { $ne: "لغو شده" }
    });
    
    // گروه‌بندی دستی در جاوااسکریپت
    const monthlyStats = {};
    
    allOrders.forEach(order => {
      if (order.createTarikh) {
        // استخراج سال و ماه از createTarikh (مثال: "۱۴۰۵-۳-۲")
        const parts = order.createTarikh.split('-');
        if (parts.length >= 2) {
          const year = parts[0];
          let month = parts[1];
          // اطمینان از فرمت دو رقمی ماه
          if (month.length === 1) {
            month = `0${month}`;
          }
          const key = `${year}-${month}`;
          
          if (!monthlyStats[key]) {
            monthlyStats[key] = {
              year: year,
              month: month,
              orderCount: 0,
              totalSales: 0
            };
          }
          monthlyStats[key].orderCount++;
          monthlyStats[key].totalSales += order.totalPrice || 0;
        }
      }
    });
    
    // تبدیل به آرایه و مرتب‌سازی
    const result = Object.values(monthlyStats).sort((a, b) => {
      if (a.year !== b.year) return a.year.localeCompare(b.year);
      return a.month.localeCompare(b.month);
    });
    
    res.json({
      success: true,
      data: result,
      currentMonth: new Date().getMonth() + 1,
      currentYear: new Date().getFullYear()
    });
  } catch (error) {
    console.error("Error:", error);
    res.json({ success: false, error: error.message });
  }
});

router.get("/api/new-orders-count", async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "ادمین یافت نشد" });
    }
    
    // دریافت آخرین سفارش دیده شده
    let notification = await AdminNotification.findOne({ adminId });
    
    let query = { 
      status: { $nin: ["لغو شده", "در انتظار پرداخت"] }
    };
    
    if (notification && notification.lastSeenOrderId) {
      const lastSeenOrder = await Order.findById(notification.lastSeenOrderId);
      if (lastSeenOrder && lastSeenOrder.createdAt) {
        query.createdAt = { $gt: lastSeenOrder.createdAt };
      }
    }
    
    const newOrdersCount = await Order.countDocuments(query);
    
    res.json({
      success: true,
      count: newOrdersCount,
      hasNew: newOrdersCount > 0
    });
  } catch (error) {
    console.error("Error getting new orders count:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// مارک کردن سفارشات به عنوان دیده شده
router.post("/api/mark-orders-seen", async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) {
      return res.status(401).json({ success: false });
    }
    
    const latestOrder = await Order.findOne({ 
      status: { $nin: ["لغو شده", "در انتظار پرداخت"] }
    }).sort({ createdAt: -1 });
    
    if (latestOrder) {
      await AdminNotification.findOneAndUpdate(
        { adminId },
        { 
          lastSeenOrderId: latestOrder._id,
          lastSeenAt: new Date()
        },
        { upsert: true, new: true }
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error marking orders as seen:", error);
    res.status(500).json({ success: false });
  }
});

router.get("/api/orders", async (req, res) => {
    try {
        const orders = await Order.find({})
            .populate("user", "fullName email phone")
            .populate("products.product")
            .sort({ createdAt: -1 });
            
        // تبدیل زمان‌ها به وقت ایران
        const formattedOrders = orders.map(order => {
            const orderObj = order.toObject();
            
            // تبدیل createdAt به وقت ایران
            if (orderObj.createdAt) {
                const date = new Date(orderObj.createdAt);
                // فرمت: ۱۴۰۴/۰۳/۰۱ ۱۵:۳۰:۰۰
                orderObj.formattedDateTime = date.toLocaleString('fa-IR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
            }
            
            return orderObj;
        });
        
        res.json({
            success: true,
            orders: formattedOrders
        });
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get("/api/category-description/:id", async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "دسته‌بندی یافت نشد"
      });
    }

    res.json({
      success: true,
      description: category.description || "",
      metaDescription: category.metaDescription || "",
      name: category.name
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// به‌روزرسانی توضیحات دسته‌بندی
router.put("/api/category-description/:id", async (req, res) => {
  try {
    const { description, metaDescription  } = req.body;
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { description, updateTarikh: getPersianDate() , metaDescription },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({ success: false, message: "دسته‌بندی یافت نشد" });
    }
    res.json({
      success: true,
      message: "توضیحات با موفقیت به‌روزرسانی شد",
      category
    });
  } catch (error) {
    console.error("Error updating category description:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/api/weblogs", async (req, res) => {
  try {
    const weblogs = await Weblog.find({})
      .populate("author", "fullName email")
      .populate("categories", "name")
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      weblogs,
    });
  } catch (error) {
    console.error("Error fetching weblogs:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


// دریافت یک مقاله
router.get("/api/weblogs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "شناسه مقاله نامعتبر است",
      });
    }

    const weblog = await Weblog.findById(id)
      .populate("author", "fullName email")
      .populate("categories", "name");

    if (!weblog) {
      return res.status(404).json({
        success: false,
        message: "مقاله یافت نشد",
      });
    }

    res.json({
      success: true,
      weblog,
    });
  } catch (error) {
    console.error("Error fetching weblog:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// حذف مقاله
router.delete("/api/weblogs/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "شناسه مقاله نامعتبر است",
      });
    }

    const weblog = await Weblog.findByIdAndDelete(id);
    
    if (!weblog) {
      return res.status(404).json({
        success: false,
        message: "مقاله یافت نشد",
      });
    }

    res.json({
      success: true,
      message: "مقاله با موفقیت حذف شد",
    });
  } catch (error) {
    console.error("Error deleting weblog:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

function generateSlug(text) {
    return text
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')           // فاصله را به خط تیره تبدیل کن
        .replace(/[^\u0600-\u06FF\uFB8A\u067E\u0686\u06AF\u200C\u0629\u0640a-z0-9\-]/g, '') // فقط فارسی و انگلیسی و اعداد
        .replace(/\-{2,}/g, '-')        // خط تیره های تکراری را حذف کن
        .replace(/^\-+|\-+$/g, '');     // خط تیره اول و آخر را حذف کن
}

router.post("/upload-temp-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "فایلی ارسال نشده" });
    }
    
    // فقط ذخیره موقت، بدون پردازش نهایی
    const tempFile = {
      url: `/uploads/temp/${req.file.filename}`,
      filename: req.file.filename,
      tempPath: req.file.path
    };
    
    res.json({
      success: true,
      ...tempFile
    });
  } catch (error) {
    console.error("Temp upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
