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
const snappPayService = require("../services/snappPayService");
const torobPayService = require("../services/torobPayService");
const {
  buildSnappPayOrderPayload,
  buildTorobPayOrderPayload,
  calculateOrderAmountsToman,
  tomanToIrr,
} = require("../services/orderPricing");

const { getPersianDate } = require("../helper/getPersianDate");
const Weblog = require("../models/Weblog");
const Banner = require("../models/Banner");
const { buildDashboard } = require("../helper/adminDashboard");
const { normalizeProductExtras } = require("../helper/productExtras");
const variantMatrix = require("../services/variantMatrix");

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
  
  if (!fs.existsSync(productFolder)) {
    fs.mkdirSync(productFolder, { recursive: true });
  }
  
  const processedImages = [];
  const urlMap = {}; // آدرس قدیمی -> آبجکت عکس جدید

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const caption = captions[i] || `image_${i + 1}`;
    
    // اگر تصویر از نوع آبجکت با url و filename است
    let tempPath;
    let originalUrl = image.url;
    let originalFilename = image.filename || path.basename(image.url);
    
    // پیدا کردن مسیر فایل موقت
    if (image.tempPath) {
      tempPath = image.tempPath;
    } else if (image.filename) {
      tempPath = path.join("public/uploads", image.filename);
    } else if (image.url) {
      // اگر فقط url داریم، از آن استفاده کنیم
      const urlParts = image.url.split('/');
      const fileName = urlParts[urlParts.length - 1];
      tempPath = path.join("public/uploads", fileName);
    }
    
    // اگر فایل وجود ندارد، از temp پوشه هم بررسی کن
    if (!fs.existsSync(tempPath)) {
      const tempPath2 = path.join("public/uploads/temp", originalFilename);
      if (fs.existsSync(tempPath2)) {
        tempPath = tempPath2;
      }
    }
    
    // اگر فایل وجود ندارد، از آدرس قدیمی استفاده کن
    if (!fs.existsSync(tempPath) && image.url) {
      // احتمالاً تصویر قبلاً در پوشه نهایی است
      const urlParts = image.url.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const possiblePath = path.join("public/uploads/products", `${productId}_${sanitizedProductName}`, fileName);
      if (fs.existsSync(possiblePath)) {
        // تصویر قبلاً جابجا شده
        processedImages.push({
          url: `/uploads/products/${productId}_${sanitizedProductName}/${fileName}`,
          filename: fileName,
          caption: caption,
          alt: caption
        });
        urlMap[image.url] = {
          url: `/uploads/products/${productId}_${sanitizedProductName}/${fileName}`,
          filename: fileName
        };
        continue;
      }
      continue;
    }
    
    if (fs.existsSync(tempPath)) {
      const sanitizedCaption = caption
        .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .substring(0, 50);
      
      const newFilename = `${sanitizedCaption || 'image'}_${Date.now()}_${i}.webp`;
      const newPath = path.join(productFolder, newFilename);
      
      try {
        // استفاده از fs.renameSync با fallback به copy + delete
        try {
          fs.renameSync(tempPath, newPath);
        } catch (renameErr) {
          // اگر rename کار نکرد، کپی و حذف کن
          fs.copyFileSync(tempPath, newPath);
          fs.unlinkSync(tempPath);
        }
        
        const newImageObj = {
          url: `/uploads/products/${productId}_${sanitizedProductName}/${newFilename}`,
          filename: newFilename,
          caption: caption,
          alt: caption
        };
        processedImages.push(newImageObj);

        if (image.url) {
          urlMap[image.url] = newImageObj;
          // همچنین با نام فایل
          const baseName = path.basename(image.url);
          urlMap[baseName] = newImageObj;
        }
        if (image.filename) {
          urlMap[image.filename] = newImageObj;
          urlMap[path.basename(image.filename)] = newImageObj;
        }
        // با نام فایل جدید هم ذخیره کن
        urlMap[newFilename] = newImageObj;
      } catch (err) {
        console.error(`Error moving file ${tempPath} to ${newPath}:`, err);
      }
    }
  }
  
  return { processedImages, urlMap };
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

  const [dashboard, banners] = await Promise.all([
    buildDashboard(),
    Banner.find({}).sort({ placement: 1, order: 1, createdAt: 1 }).lean(),
  ]);

  res.render("AdminPanel", {
    dashboard,
    banners,
    bannerPlacements: Banner.PLACEMENTS,
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
    
    normalizeProductExtras(req.body);
    const tempImages = req.body.images || [];
    const colorsData = req.body.colors || [];
    const sizesData = req.body.sizes || [];

    delete req.body.images;
    delete req.body.colors;
    delete req.body.sizes;

    const productData = {
      ...req.body,
      englishName: req.body.englishName || null,
      images: [],
      colors: [],
      sizes: [],
      discount,
      // انتخاب SPECIAL OFFER فقط از ویرایش محصول و تعیین جایگاه ۱ تا ۶ انجام می‌شود.
      specialOfferPosition: null,
      isFeatured: false,
      createTarikh: getPersianDate(),
      updateTarikh: getPersianDate(),
    };
    
    
    if (!productData.slug || !productData.slug.trim()) {
      delete productData.slug;
    }

    const product = new Product(productData);
    await product.save();

    const captions = tempImages.map(img => img.caption || img.alt || '');
    const { processedImages, urlMap } = await moveImagesToProductFolder(
      product._id, 
      product.name, 
      tempImages,
      captions
    );
    
    product.images = processedImages;
    
    // پردازش رنگ‌ها با تصاویر اختصاصی
    const processedColors = [];
    for (const color of colorsData) {
      const colorData = {
        name: color.name || '',
        rgb: color.rgb || '#ffffff',
        isOutOfStock: color.isOutOfStock === true || color.isOutOfStock === 'true'
      };

      if (color.countInStock !== '' && color.countInStock !== null && color.countInStock !== undefined) {
        colorData.countInStock = Math.max(0, Number(color.countInStock) || 0);
      }
      
      // اگر رنگ دارای تصویر اختصاصی است
      if (color.image && color.image.url) {
        // پیدا کردن تصویر متناظر در urlMap با استفاده از filename یا url
        let foundImage = null;
        
        // روش 1: بررسی با url کامل
        if (urlMap[color.image.url]) {
          foundImage = urlMap[color.image.url];
        } 
        // روش 2: بررسی با filename (اگر url نداشت)
        else if (color.image.filename && urlMap[color.image.filename]) {
          foundImage = urlMap[color.image.filename];
        }
        // روش 3: جستجو در processedImages با filename
        else if (color.image.filename) {
          foundImage = processedImages.find(img => 
            img.filename === color.image.filename || 
            img.filename === path.basename(color.image.url)
          );
        }
        
        if (foundImage) {
          colorData.image = {
            url: foundImage.url,
            filename: foundImage.filename
          };
        } else {
          // اگر پیدا نشد، از همان آدرس قبلی استفاده کن (ممکن است تصویر قبلاً در پوشه نهایی باشد)
          colorData.image = {
            url: color.image.url,
            filename: color.image.filename || path.basename(color.image.url)
          };
        }
      }
      
      processedColors.push(colorData);
    }

    product.colors = processedColors;
    product.sizes = (Array.isArray(sizesData) ? sizesData : [])
      .filter((size) => size && String(size.size || '').trim())
      .map((size) => {
        const normalized = {
          size: String(size.size).trim(),
          usage: String(size.usage || '').trim(),
          isOutOfStock: size.isOutOfStock === true || size.isOutOfStock === 'true',
        };
        if (size.countInStock !== '' && size.countInStock !== null && size.countInStock !== undefined) {
          normalized.countInStock = Math.max(0, Number(size.countInStock) || 0);
        }
        return normalized;
      });
    
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
  body("weight")
    // وزن در ویرایش اختیاری است؛ null یا فیلد ارسال‌نشده نباید خطای اعتبارسنجی بدهد.
    .optional({ nullable: true, checkFalsy: true })
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

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "محصول یافت نشد",
      });
    }

    const updateData = normalizeProductExtras({ ...req.body });
    updateData.englishName = updateData.englishName || null;

    if (!updateData.slug || !String(updateData.slug).trim()) {
      delete updateData.slug;
    }

    const numericFields = ["price", "countInStock"];
    numericFields.forEach((field) => {
      if (updateData[field] !== undefined && updateData[field] !== "") {
        updateData[field] = Number(updateData[field]);
      }
    });

    // اگر وزن خالی یا null ارسال شد، آن را از updateData حذف می‌کنیم
    // تا مقدار قبلی محصول در دیتابیس حفظ شود.
    if (Object.prototype.hasOwnProperty.call(updateData, "weight")) {
      if (updateData.weight === "" || updateData.weight === null || updateData.weight === undefined) {
        delete updateData.weight;
      } else {
        updateData.weight = Number(updateData.weight);
      }
    }

    // null یا رشته خالی برای قیمت ویژه یعنی حذف تخفیف.
    if (updateData.offerPrice === "" || updateData.offerPrice === null) {
      updateData.offerPrice = undefined;
    } else if (updateData.offerPrice !== undefined) {
      updateData.offerPrice = Number(updateData.offerPrice);
    }

    const price = updateData.price ?? product.price;
    if (Number(updateData.offerPrice) > 0 && Number(price) > Number(updateData.offerPrice)) {
      updateData.discount = Math.round(
        ((Number(price) - Number(updateData.offerPrice)) / Number(price)) * 100
      );
    } else {
      updateData.offerPrice = undefined;
      updateData.discount = 0;
    }

    // مدیریت دستی ۶ جایگاه SPECIAL OFFER
    const requestedSpecialOfferPosition = Number(req.body.specialOfferPosition);
    const hasValidSpecialOfferPosition = Number.isInteger(requestedSpecialOfferPosition) &&
      requestedSpecialOfferPosition >= 1 && requestedSpecialOfferPosition <= 6;

    if (hasValidSpecialOfferPosition) {
      if (!(Number(updateData.offerPrice) > 0 && Number(updateData.offerPrice) < Number(price))) {
        return res.status(400).json({
          success: false,
          message: "برای قرار گرفتن در SPECIAL OFFER، محصول باید قیمت ویژه معتبر داشته باشد.",
        });
      }
      updateData.specialOfferPosition = requestedSpecialOfferPosition;
      // isFeatured برای سازگاری با داده‌ها/کدهای قدیمی همگام نگه داشته می‌شود.
      updateData.isFeatured = true;
    } else {
      updateData.specialOfferPosition = null;
      updateData.isFeatured = false;
    }

    const arrayFields = ["colors", "sizes", "specifications", "tags", "category", "images"];
    arrayFields.forEach((field) => {
      updateData[field] = Array.isArray(req.body[field]) ? req.body[field] : [];
    });

    // حفظ _id رنگ‌ها باعث می‌شود page_unique و URL ثبت‌شده در ترب ثابت بماند.
    updateData.colors = updateData.colors
      .filter((color) => color && String(color.name || "").trim())
      .map((color) => {
        const normalized = {
          name: String(color.name).trim(),
          rgb: color.rgb || "#ffffff",
          isOutOfStock: color.isOutOfStock === true || color.isOutOfStock === "true",
        };

        if (color.countInStock !== "" && color.countInStock !== null && color.countInStock !== undefined) {
          normalized.countInStock = Math.max(0, Number(color.countInStock) || 0);
        }

        if (color._id && mongoose.Types.ObjectId.isValid(color._id)) {
          normalized._id = color._id;
        }

        if (color.image?.url) {
          normalized.image = {
            url: color.image.url,
            filename: color.image.filename || path.basename(color.image.url),
          };
        }

        return normalized;
      });

    // موجودی هر سایز نیز مانند رنگ به‌صورت مستقل قابل مدیریت است.
    // حفظ _id باعث می‌شود شناسه تنوع در سفارش‌های قبلی پایدار بماند.
    updateData.sizes = updateData.sizes
      .filter((size) => size && String(size.size || "").trim())
      .map((size) => {
        const normalized = {
          size: String(size.size).trim(),
          usage: String(size.usage || "").trim(),
          isOutOfStock: size.isOutOfStock === true || size.isOutOfStock === "true",
        };

        if (size._id && mongoose.Types.ObjectId.isValid(size._id)) {
          normalized._id = size._id;
        }

        if (size.countInStock !== "" && size.countInStock !== null && size.countInStock !== undefined) {
          normalized.countInStock = Math.max(0, Number(size.countInStock) || 0);
        }

        return normalized;
      });

    // پس از مهاجرت موجودی دقیق، variantStocks منبع حقیقت است. محصولی که یک بار
    // configured شده از فرم عمومی به حالت legacy برنمی‌گردد تا موجودی دقیق ترب/سفارش‌ها
    // تصادفی پاک نشود.
    const requestedMatrix = req.body.variantInventoryConfigured === true || req.body.variantInventoryConfigured === "true";
    const wantsMatrix = product.variantInventoryConfigured === true || requestedMatrix;
    updateData.variantInventoryConfigured = wantsMatrix;

    if (wantsMatrix) {
      try {
        const currentRows = Array.isArray(product.variantStocks) ? product.variantStocks : [];
        const currentByKey = new Map(currentRows.map((row) => [
          variantMatrix.pairKey(row?.colorId, row?.sizeId),
          row,
        ]));
        const rawRows = Array.isArray(req.body.variantStocks)
          ? req.body.variantStocks
          : currentRows.map((row) => ({
              colorId: String(row?.colorId || ""),
              sizeId: String(row?.sizeId || ""),
              countInStock: Number(row?.countInStock || 0),
              isOutOfStock: row?.isOutOfStock === true,
            }));

        // اگر مرورگر هنوز JS قدیمی داشته باشد و isOutOfStock ردیف را نفرستد،
        // وضعیت فعلی ردیف حفظ می‌شود و به‌صورت ناخواسته باز نمی‌شود.
        const rowsWithAvailability = rawRows.map((row) => {
          const key = variantMatrix.pairKey(row?.colorId, row?.sizeId);
          const existing = currentByKey.get(key);
          return {
            ...row,
            isOutOfStock: Object.prototype.hasOwnProperty.call(row || {}, "isOutOfStock")
              ? row.isOutOfStock
              : existing?.isOutOfStock === true,
          };
        });

        updateData.variantStocks = variantMatrix.normalizeRows(
          { colors: updateData.colors, sizes: updateData.sizes },
          rowsWithAvailability
        );

        const requestedTotal = Number(req.body.countInStock);
        const hasRequestedTotal = req.body.countInStock !== "" && Number.isFinite(requestedTotal) && requestedTotal >= 0;

        if (updateData.variantStocks.length === 1 && hasRequestedTotal) {
          const row = updateData.variantStocks[0];
          const key = variantMatrix.pairKey(row.colorId, row.sizeId);
          const oldRow = currentByKey.get(key);
          const oldRowCount = Math.max(0, Number(oldRow?.countInStock || 0));
          const oldTotal = Math.max(0, Number(product.countInStock || 0));
          const rowChanged = Number(row.countInStock) !== oldRowCount;
          const totalChanged = requestedTotal !== oldTotal;

          // برای محصول تک‌تنوعی، فیلد «موجودی» بالای فرم هم همان ردیف دقیق است.
          if (totalChanged && !rowChanged) {
            row.countInStock = Math.max(0, requestedTotal);
          } else if (totalChanged && rowChanged && Number(row.countInStock) !== requestedTotal) {
            return res.status(400).json({
              success: false,
              message: "موجودی کلی و موجودی تنوع با هم متفاوت‌اند. یکی از مقدارها را اصلاح کنید.",
            });
          }
        }

        const matrixTotal = variantMatrix.totalMatrixStock(updateData.variantStocks);
        if (updateData.variantStocks.length > 1 && hasRequestedTotal && requestedTotal !== matrixTotal) {
          return res.status(400).json({
            success: false,
            message: "برای محصول چندتنوعی، موجودی کل از جمع ردیف‌های رنگ × سایز محاسبه می‌شود. موجودی را از جدول تنوع‌ها تغییر دهید.",
          });
        }

        updateData.countInStock = matrixTotal;
        updateData.stockRevision = Number(product.stockRevision || 0) + 1;
      } catch (matrixError) {
        return res.status(400).json({ success: false, message: matrixError.message });
      }
    } else if (Object.prototype.hasOwnProperty.call(req.body, "variantInventoryConfigured")) {
      updateData.variantStocks = [];
      updateData.stockRevision = Number(product.stockRevision || 0) + 1;
    } else {
      delete updateData.variantInventoryConfigured;
      delete updateData.variantStocks;
      delete updateData.stockRevision;
    }

    updateData.updateTarikh = getPersianDate();
    product.set(updateData);
    await product.save();

    // هر جایگاه فقط یک محصول دارد؛ انتخاب محصول جدید، محصول قبلی همان جایگاه را خارج می‌کند.
    if (updateData.specialOfferPosition) {
      await Product.updateMany(
        {
          _id: { $ne: productId },
          specialOfferPosition: updateData.specialOfferPosition,
        },
        {
          $set: {
            specialOfferPosition: null,
            isFeatured: false,
          },
        }
      );
    }

    const updatedProduct = await Product.findById(productId)
      .populate("category")
      .populate("brand");

    return res.json({
      success: true,
      message: "محصول با موفقیت به‌روزرسانی شد",
      product: updatedProduct,
    });
  } catch (error) {
    console.error("خطا در ویرایش محصول:", error);
    return res.status(500).json({
      success: false,
      message: "خطای سرور در ویرایش محصول",
      error: error.message,
    });
  }
}
);

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

// Optional storefront presentation fields shared by category add/edit.
function categoryPresentation(body) {
  const out = {};
  if (body.displayOrder !== undefined && body.displayOrder !== "") {
    const n = Math.round(Number(body.displayOrder));
    if (Number.isFinite(n)) out.displayOrder = Math.max(-1000, Math.min(1000, n));
  }
  if (body.icon !== undefined) out.icon = /^cat-[a-z-]+$/.test(String(body.icon)) ? String(body.icon) : "";
  if (body.description !== undefined) out.description = String(body.description || "").trim().slice(0, 1000);
  if (body.isActive !== undefined) out.isActive = body.isActive === true || body.isActive === "true";
  return out;
}

router.post("/categories/add", async (req, res) => {
  try {
    const {
        name,
        categoryType = "product",
        parentId = null,
        img = null
    } = req.body;
    const presentation = categoryPresentation(req.body);
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "نام دسته‌بندی الزامی است",
      });
    }
    
    const normalizedImg =
        typeof img === "string" ? img.trim() : "";
    
    if (
        normalizedImg &&
        (
            !normalizedImg.startsWith("/uploads/") ||
            normalizedImg.includes("..") ||
            normalizedImg.includes("\\")
        )
    ) {
        return res.status(400).json({
            success: false,
            message: "آدرس تصویر باید از /uploads/ شروع شود"
        });
    }

    const category = new Category({
        name: name.trim(),
        categoryType,
        parentId: parentId || null,
        img: normalizedImg || null,
        ...presentation
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
        const {
            name,
            categoryType,
            parentId,
            img
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "شناسه دسته‌بندی نامعتبر است"
            });
        }

        if (!name || !String(name).trim()) {
            return res.status(400).json({
                success: false,
                message: "نام دسته‌بندی الزامی است"
            });
        }

        const normalizedImg =
            typeof img === "string" ? img.trim() : "";

        if (
            normalizedImg &&
            (
                !normalizedImg.startsWith("/uploads/") ||
                normalizedImg.includes("..") ||
                normalizedImg.includes("\\")
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "آدرس تصویر باید از /uploads/ شروع شود"
            });
        }

        // جلوگیری از انتخاب خود دسته‌بندی به عنوان والد
        if (
            parentId &&
            String(parentId) === String(req.params.id)
        ) {
            return res.status(400).json({
                success: false,
                message: "دسته‌بندی نمی‌تواند والد خودش باشد"
            });
        }

        const updatedCategory = await Category.findByIdAndUpdate(
            req.params.id,
            {
                name: String(name).trim(),
                categoryType: categoryType || "product",
                parentId: parentId || null,
                img: normalizedImg || null,
                ...categoryPresentation(req.body),
                updateTarikh: getPersianDate()
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!updatedCategory) {
            return res.status(404).json({
                success: false,
                message: "دسته‌بندی یافت نشد"
            });
        }

        res.json({
            success: true,
            message: "دسته‌بندی با موفقیت ویرایش شد",
            category: updatedCategory
        });

    } catch (error) {
        console.error("Error updating category:", error);

        res.status(500).json({
            success: false,
            message: "خطا در ویرایش دسته‌بندی",
            error: error.message
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


const normalizeSnappPayStatus = (value) => String(value || "").trim().toUpperCase();
const normalizeTorobPayStatus = (value) => String(value || "").trim().toUpperCase();

const requireIrreversibleConfirmation = (req, res) => {
  if (req.body.confirmed !== true) {
    res.status(400).json({
      success: false,
      message: "برای این عملیات برگشت‌ناپذیر، تایید مجدد مدیر الزامی است",
    });
    return false;
  }
  return true;
};

const restoreItemsToInventory = async (items) => {
  for (const item of items || []) {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const update = { $inc: { countInStock: quantity } };
    const arrayFilters = [];

    if (item.variantStockTracked) {
      update.$inc["variantStocks.$[variant].countInStock"] = quantity;
      arrayFilters.push({
        "variant.colorId": String(item.selectedVariantId || ""),
        "variant.sizeId": String(item.selectedSizeId || ""),
      });
    } else {
      if (item.colorStockTracked && item.selectedVariantId) {
        update.$inc["colors.$[color].countInStock"] = quantity;
        arrayFilters.push({ "color._id": String(item.selectedVariantId) });
      }
      if (item.sizeStockTracked && item.selectedSizeId) {
        update.$inc["sizes.$[size].countInStock"] = quantity;
        arrayFilters.push({ "size._id": String(item.selectedSizeId) });
      }
    }

    const options = { new: true };
    if (arrayFilters.length) options.arrayFilters = arrayFilters;
    const product = await Product.findOneAndUpdate({ _id: item.product }, update, options);
    if (!product) continue;

    if (Number(product.countInStock) > 0) product.isOutOfStock = false;
    if (!item.variantStockTracked) {
      if (item.colorStockTracked && item.selectedVariantId) {
        const color = product.colors?.id?.(item.selectedVariantId);
        if (color && Number(color.countInStock) > 0) color.isOutOfStock = false;
      }
      if (item.sizeStockTracked && item.selectedSizeId) {
        const size = product.sizes?.id?.(item.selectedSizeId);
        if (size && Number(size.countInStock) > 0) size.isOutOfStock = false;
      }
    }
    await product.save();
  }
};

const restoreOrderProductsToInventory = async (order) => {
  if (!order.inventoryReserved || order.inventoryRestored) return;
  await restoreItemsToInventory(order.products);
  order.inventoryReserved = false;
  order.inventoryRestored = true;
};

const getVerifiedSnappPayStatus = async (order) => {
  if (!order.snappPay?.paymentToken) {
    throw new Error("توکن پرداخت اسنپ‌پی برای این سفارش ثبت نشده است");
  }
  const statusResult = await snappPayService.getPaymentStatus(
    order.snappPay.paymentToken
  );
  const status = normalizeSnappPayStatus(statusResult?.status);
  const knownStatuses = new Set([
    "CREATED",
    "PENDING",
    "VERIFY",
    "SETTLE",
    "CANCEL",
    "REVERT",
    "FAILED",
  ]);
  order.snappPay.status = knownStatuses.has(status) ? status : "UNKNOWN";
  order.snappPay.lastStatusCheckAt = new Date();
  if (statusResult?.transactionId) {
    order.snappPay.transactionId = statusResult.transactionId;
  }
  return { status, statusResult };
};

router.post("/orders/:id/snappay/sync", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order || order.paymentMethod !== "اسنپ‌پی") {
      return res.status(404).json({ success: false, message: "سفارش اسنپ‌پی یافت نشد" });
    }
    if (order.snappPay?.processing) {
      return res.status(409).json({
        success: false,
        message: "عملیات دیگری روی این سفارش در حال انجام است",
      });
    }

    const { status, statusResult } = await getVerifiedSnappPayStatus(order);
    if (status === "SETTLE") {
      order.paymentStatus = "پرداخت شده";
      order.status = order.status === "در انتظار پرداخت" ? "در حال پردازش" : order.status;
      order.snappPay.settledAt = order.snappPay.settledAt || new Date();
    } else if (["CANCEL", "REVERT"].includes(status)) {
      order.paymentStatus = "لغو شده";
      order.status = "لغو شده";
      await restoreOrderProductsToInventory(order);
    } else if (status === "PENDING" || status === "VERIFY") {
      order.paymentStatus = "در حال بررسی";
    } else {
      order.paymentStatus = "نامشخص";
    }
    await order.save();

    return res.json({ success: true, message: "وضعیت با اسنپ‌پی همگام شد", status, data: statusResult });
  } catch (error) {
    console.error("SnappPay status sync error:", error);
    return res.status(error.httpStatus || 500).json({
      success: false,
      message: error.message || "خطا در استعلام وضعیت اسنپ‌پی",
      errorCode: error.errorCode,
    });
  }
});

router.post("/orders/:id/snappay/update", async (req, res) => {
  try {
    if (!requireIrreversibleConfirmation(req, res)) return;

    const order = await Order.findById(req.params.id);
    if (!order || order.paymentMethod !== "اسنپ‌پی") {
      return res.status(404).json({ success: false, message: "سفارش اسنپ‌پی یافت نشد" });
    }
    if (order.snappPay?.processing) {
      return res.status(409).json({ success: false, message: "عملیات دیگری روی این سفارش در حال انجام است" });
    }

    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (!requestedItems.length) {
      return res.status(400).json({ success: false, message: "تعداد جدید محصولات ارسال نشده است" });
    }

    const quantityMap = new Map(
      requestedItems.map((item) => [String(item.itemId || item.productId), Number(item.quantity)])
    );
    const previousProducts = order.products.map((item) => item.toObject());
    const nextProducts = [];
    const returnedItems = [];

    for (const current of previousProducts) {
      const key = String(current.snappItemId || current.product);
      const requestedQuantity = quantityMap.has(key)
        ? quantityMap.get(key)
        : Number(current.quantity);

      if (!Number.isInteger(requestedQuantity) || requestedQuantity < 0) {
        return res.status(400).json({ success: false, message: `تعداد جدید «${current.nameAtPurchase}» نامعتبر است` });
      }
      if (requestedQuantity > Number(current.quantity)) {
        return res.status(400).json({ success: false, message: "در آپدیت اسنپ‌پی افزایش تعداد محصول مجاز نیست" });
      }

      const removedQuantity = Number(current.quantity) - requestedQuantity;
      if (removedQuantity > 0) {
        returnedItems.push({
          product: current.product,
          quantity: removedQuantity,
          selectedVariantId: current.selectedVariantId || null,
          selectedSizeId: current.selectedSizeId || null,
          colorStockTracked: current.colorStockTracked === true,
          sizeStockTracked: current.sizeStockTracked === true,
          variantStockTracked: current.variantStockTracked === true,
        });
      }
      if (requestedQuantity > 0) {
        nextProducts.push({ ...current, quantity: requestedQuantity });
      }
    }

    if (!returnedItems.length) {
      return res.status(400).json({ success: false, message: "برای آپدیت باید حداقل یک تعداد کاهش یابد" });
    }
    if (!nextProducts.length) {
      return res.status(400).json({ success: false, message: "برای مرجوعی کامل از عملیات کنسل استفاده کنید" });
    }

    const previousSubtotal = previousProducts.reduce(
      (sum, item) => sum + Number(item.priceAtPurchase) * Number(item.quantity),
      0
    );
    const newSubtotal = nextProducts.reduce(
      (sum, item) => sum + Number(item.priceAtPurchase) * Number(item.quantity),
      0
    );

    // در مرجوعی/کاهش جزئی، تخفیف سفارش باید بین آیتم‌های باقی‌مانده
    // به نسبت مبلغ کالاها سرشکن شود. نگه داشتن کل تخفیف مبلغ ثابت روی
    // سبد کوچک‌تر می‌تواند amount را صفر کند و SnappPay با خطای 1005
    // ("باید بزرگتر از صفر باشد") درخواست update را رد می‌کند.
    const previousDiscountAmount = Math.min(
      Math.max(Number(order.discount?.calculatedAmount || order.discountAmount || 0), 0),
      previousSubtotal
    );
    let newDiscountAmount = 0;
    if (previousDiscountAmount > 0 && previousSubtotal > 0) {
      newDiscountAmount = Math.floor(
        (previousDiscountAmount * newSubtotal) / previousSubtotal
      );
    }

    const amounts = calculateOrderAmountsToman({
      products: nextProducts,
      taxAmount: order.taxAmount,
      discountAmount: newDiscountAmount,
      externalSourceAmount: order.externalSourceAmount,
    });

    if (amounts.amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "مبلغ نهایی سفارش بعد از کاهش باید بزرگتر از صفر باشد",
      });
    }
    if (amounts.amount >= Number(order.totalPrice)) {
      return res.status(400).json({ success: false, message: "مبلغ آپدیت باید از مبلغ فعلی سفارش کمتر باشد" });
    }

    order.snappPay.processing = true;
    await order.save();
    const { status } = await getVerifiedSnappPayStatus(order);
    if (status !== "SETTLE") {
      order.snappPay.processing = false;
      await order.save();
      return res.status(409).json({ success: false, message: `آپدیت فقط در وضعیت SETTLE ممکن است (وضعیت فعلی: ${status || "نامشخص"})` });
    }

    // SnappPay payment/v1/update requires the updated cart data in addition to
    // paymentToken/amount. Unlike the token payload, externalSourceAmount is not
    // part of the update request used by SnappPay's update flow; sending it as 0
    // can trigger the generic "must be greater than zero" validation error.
    const snappOrderPayload = buildSnappPayOrderPayload(order, {
      products: nextProducts,
      discountAmount: newDiscountAmount,
    });
    const { externalSourceAmount: _ignoredExternalSourceAmount, ...snappUpdateData } =
      snappOrderPayload;

    const updatePayload = {
      ...snappUpdateData,
      paymentMethodTypeDto: "INSTALLMENT",
      paymentToken: order.snappPay.paymentToken,
    };

    console.log("SnappPay update payload:", JSON.stringify(updatePayload));
    await snappPayService.update(updatePayload);

    await restoreItemsToInventory(returnedItems);

    order.products = nextProducts;
    order.originalPrice = amounts.itemsAmount;
    order.discountAmount = newDiscountAmount;
    if (order.discount) order.discount.calculatedAmount = newDiscountAmount;
    order.totalPrice = amounts.amount;
    order.snappPay.status = "SETTLE";
    order.snappPay.processing = false;
    order.snappPay.lastError = undefined;
    order.snappPay.updateHistory.push({
      amount: tomanToIrr(amounts.amount),
      changedBy: req.admin?._id,
      products: nextProducts.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        amount: tomanToIrr(item.priceAtPurchase),
      })),
    });
    await order.save();

    return res.json({
      success: true,
      message: "سفارش با موفقیت در اسنپ‌پی آپدیت شد",
      order,
    });
  } catch (error) {
    console.error("SnappPay order update error:", error);
    try {
      await Order.updateOne(
        { _id: req.params.id },
        { $set: { "snappPay.processing": false, "snappPay.lastError": error.message } }
      );
    } catch (_) {}
    return res.status(error.httpStatus || 500).json({
      success: false,
      message: error.message || "خطا در آپدیت سفارش اسنپ‌پی",
      errorCode: error.errorCode,
    });
  }
});

router.post("/orders/:id/snappay/cancel", async (req, res) => {
  try {
    if (!requireIrreversibleConfirmation(req, res)) return;

    const order = await Order.findById(req.params.id);
    if (!order || order.paymentMethod !== "اسنپ‌پی") {
      return res.status(404).json({ success: false, message: "سفارش اسنپ‌پی یافت نشد" });
    }
    if (order.snappPay?.processing) {
      return res.status(409).json({ success: false, message: "عملیات دیگری روی این سفارش در حال انجام است" });
    }
    if (order.snappPay?.status === "CANCEL") {
      return res.json({ success: true, message: "این سفارش قبلاً کنسل شده است", order });
    }

    order.snappPay.processing = true;
    await order.save();
    const { status } = await getVerifiedSnappPayStatus(order);
    if (status !== "SETTLE") {
      order.snappPay.processing = false;
      await order.save();
      return res.status(409).json({ success: false, message: `کنسل فقط در وضعیت SETTLE ممکن است (وضعیت فعلی: ${status || "نامشخص"})` });
    }

    const result = await snappPayService.cancel(order.snappPay.paymentToken);
    order.snappPay.status = "CANCEL";
    order.snappPay.transactionId = result?.transactionId || order.snappPay.transactionId;
    order.snappPay.cancelledAt = new Date();
    order.snappPay.processing = false;
    order.snappPay.lastError = undefined;
    order.paymentStatus = "لغو شده";
    order.status = "لغو شده";
    await restoreOrderProductsToInventory(order);
    await order.save();

    return res.json({ success: true, message: "سفارش با موفقیت در اسنپ‌پی کنسل شد", order });
  } catch (error) {
    console.error("SnappPay order cancel error:", error);
    try {
      await Order.updateOne(
        { _id: req.params.id },
        { $set: { "snappPay.processing": false, "snappPay.lastError": error.message } }
      );
    } catch (_) {}
    return res.status(error.httpStatus || 500).json({
      success: false,
      message: error.message || "خطا در کنسل سفارش اسنپ‌پی",
      errorCode: error.errorCode,
    });
  }
});

const getVerifiedTorobPayStatus = async (order) => {
  if (!order.torobPay?.paymentToken) {
    throw new Error("توکن پرداخت ترب‌پی برای این سفارش ثبت نشده است");
  }

  const statusResult = await torobPayService.getPaymentStatus(order.torobPay.paymentToken);
  const status = normalizeTorobPayStatus(statusResult?.status);
  const knownStatuses = new Set(["PENDING", "VERIFY", "SETTLE", "REVERT"]);
  order.torobPay.status = knownStatuses.has(status) ? status : "UNKNOWN";
  order.torobPay.lastStatusCheckAt = new Date();
  if (statusResult?.transactionId) {
    order.torobPay.transactionId = statusResult.transactionId;
  }
  return { status, statusResult };
};

router.post("/orders/:id/torobpay/sync", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order || order.paymentMethod !== "ترب‌پی") {
      return res.status(404).json({ success: false, message: "سفارش ترب‌پی یافت نشد" });
    }
    if (order.torobPay?.processing) {
      return res.status(409).json({
        success: false,
        message: "عملیات دیگری روی این سفارش در حال انجام است",
      });
    }

    const { status, statusResult } = await getVerifiedTorobPayStatus(order);
    if (status === "SETTLE") {
      order.paymentStatus = "پرداخت شده";
      order.status = order.status === "در انتظار پرداخت" ? "در حال پردازش" : order.status;
      order.torobPay.settledAt = order.torobPay.settledAt || new Date();
      order.paymentInfo.refId = statusResult?.transactionId || order.paymentInfo.refId;
      order.paymentInfo.paymentDate = order.paymentInfo.paymentDate || new Date();
    } else if (status === "REVERT") {
      order.paymentStatus = "لغو شده";
      order.status = "لغو شده";
      order.torobPay.cancelledAt = order.torobPay.cancelledAt || new Date();
      await restoreOrderProductsToInventory(order);
    } else if (["PENDING", "VERIFY"].includes(status)) {
      order.paymentStatus = "در حال بررسی";
    } else {
      order.paymentStatus = "نامشخص";
    }
    await order.save();

    return res.json({
      success: true,
      message: "وضعیت با ترب‌پی همگام شد",
      status,
      data: statusResult,
    });
  } catch (error) {
    console.error("TorobPay status sync error:", error);
    return res.status(error.httpStatus || 500).json({
      success: false,
      message: error.message || "خطا در استعلام وضعیت ترب‌پی",
      errorCode: error.errorCode,
    });
  }
});

router.post("/orders/:id/torobpay/update", async (req, res) => {
  try {
    if (!requireIrreversibleConfirmation(req, res)) return;

    const order = await Order.findById(req.params.id).populate("user");
    if (!order || order.paymentMethod !== "ترب‌پی") {
      return res.status(404).json({ success: false, message: "سفارش ترب‌پی یافت نشد" });
    }
    if (order.torobPay?.processing) {
      return res.status(409).json({ success: false, message: "عملیات دیگری روی این سفارش در حال انجام است" });
    }

    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (!requestedItems.length) {
      return res.status(400).json({ success: false, message: "تعداد جدید محصولات ارسال نشده است" });
    }

    const quantityMap = new Map(
      requestedItems.map((item) => [String(item.itemId || item.productId), Number(item.quantity)])
    );
    const previousProducts = order.products.map((item) => item.toObject());
    const nextProducts = [];
    const returnedItems = [];

    for (const current of previousProducts) {
      const key = String(current.product);
      const requestedQuantity = quantityMap.has(key)
        ? quantityMap.get(key)
        : Number(current.quantity);

      if (!Number.isInteger(requestedQuantity) || requestedQuantity < 0) {
        return res.status(400).json({ success: false, message: `تعداد جدید «${current.nameAtPurchase}» نامعتبر است` });
      }
      if (requestedQuantity > Number(current.quantity)) {
        return res.status(400).json({ success: false, message: "در آپدیت ترب‌پی افزایش تعداد محصول مجاز نیست" });
      }

      const removedQuantity = Number(current.quantity) - requestedQuantity;
      if (removedQuantity > 0) {
        returnedItems.push({
          product: current.product,
          quantity: removedQuantity,
          selectedVariantId: current.selectedVariantId || null,
          selectedSizeId: current.selectedSizeId || null,
          colorStockTracked: current.colorStockTracked === true,
          sizeStockTracked: current.sizeStockTracked === true,
          variantStockTracked: current.variantStockTracked === true,
        });
      }
      if (requestedQuantity > 0) {
        nextProducts.push({ ...current, quantity: requestedQuantity });
      }
    }

    if (!returnedItems.length) {
      return res.status(400).json({ success: false, message: "برای آپدیت باید حداقل یک تعداد کاهش یابد" });
    }
    if (!nextProducts.length) {
      return res.status(400).json({ success: false, message: "برای مرجوعی کامل از عملیات کنسل استفاده کنید" });
    }

    const newSubtotal = nextProducts.reduce(
      (sum, item) => sum + Number(item.priceAtPurchase) * Number(item.quantity),
      0
    );
    let newDiscountAmount = 0;
    if (order.discount?.type === "percent") {
      newDiscountAmount = Math.floor((newSubtotal * Number(order.discount.amount || 0)) / 100);
      newDiscountAmount = Math.min(
        newDiscountAmount,
        Number(order.discount.calculatedAmount || order.discountAmount || 0)
      );
    } else if (order.discount?.type === "amount") {
      newDiscountAmount = Math.min(Number(order.discount.amount || 0), newSubtotal);
    }

    const amounts = calculateOrderAmountsToman({
      products: nextProducts,
      taxAmount: order.taxAmount,
      discountAmount: newDiscountAmount,
      externalSourceAmount: order.externalSourceAmount,
    });
    if (amounts.amount >= Number(order.totalPrice)) {
      return res.status(400).json({ success: false, message: "مبلغ آپدیت باید از مبلغ فعلی سفارش کمتر باشد" });
    }

    order.torobPay.processing = true;
    await order.save();
    const { status } = await getVerifiedTorobPayStatus(order);
    if (status !== "SETTLE") {
      order.torobPay.processing = false;
      await order.save();
      return res.status(409).json({
        success: false,
        message: `آپدیت فقط برای سفارش فعال ترب‌پی ممکن است (وضعیت فعلی: ${status || "نامشخص"})`,
      });
    }

    const rawPayload = buildTorobPayOrderPayload(order, {
      products: nextProducts,
      discountAmount: newDiscountAmount,
      user: order.user,
    });
    const { returnURL, transactionId, mobile, ...torobUpdateFields } = rawPayload;
    await torobPayService.update({
      ...torobUpdateFields,
      paymentToken: order.torobPay.paymentToken,
    });

    await restoreItemsToInventory(returnedItems);

    order.products = nextProducts;
    order.originalPrice = amounts.itemsAmount;
    order.discountAmount = newDiscountAmount;
    if (order.discount) order.discount.calculatedAmount = newDiscountAmount;
    order.totalPrice = amounts.amount;
    order.torobPay.status = "SETTLE";
    order.torobPay.processing = false;
    order.torobPay.lastError = undefined;
    order.torobPay.updateHistory.push({
      amount: tomanToIrr(amounts.amount),
      changedBy: req.admin?._id,
      products: nextProducts.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        amount: tomanToIrr(item.priceAtPurchase),
      })),
    });
    await order.save();

    return res.json({
      success: true,
      message: "سفارش با موفقیت در ترب‌پی به‌روزرسانی شد",
      order,
    });
  } catch (error) {
    console.error("TorobPay order update error:", error);
    try {
      await Order.updateOne(
        { _id: req.params.id },
        { $set: { "torobPay.processing": false, "torobPay.lastError": error.message } }
      );
    } catch (_) {}
    return res.status(error.httpStatus || 500).json({
      success: false,
      message: error.message || "خطا در آپدیت سفارش ترب‌پی",
      errorCode: error.errorCode,
    });
  }
});

router.post("/orders/:id/torobpay/cancel", async (req, res) => {
  try {
    if (!requireIrreversibleConfirmation(req, res)) return;

    const order = await Order.findById(req.params.id);
    if (!order || order.paymentMethod !== "ترب‌پی") {
      return res.status(404).json({ success: false, message: "سفارش ترب‌پی یافت نشد" });
    }
    if (order.torobPay?.processing) {
      return res.status(409).json({ success: false, message: "عملیات دیگری روی این سفارش در حال انجام است" });
    }
    if (order.torobPay?.status === "REVERT") {
      return res.json({ success: true, message: "این سفارش قبلاً در ترب‌پی لغو شده است", order });
    }

    order.torobPay.processing = true;
    await order.save();
    const { status } = await getVerifiedTorobPayStatus(order);
    if (!["VERIFY", "SETTLE"].includes(status)) {
      order.torobPay.processing = false;
      await order.save();
      return res.status(409).json({
        success: false,
        message: `لغو ترب‌پی در وضعیت فعلی قابل انجام نیست (وضعیت: ${status || "نامشخص"})`,
      });
    }

    const result = await torobPayService.cancel(order.torobPay.paymentToken);
    order.torobPay.status = "REVERT";
    order.torobPay.transactionId = result?.transactionId || order.torobPay.transactionId;
    order.torobPay.cancelledAt = new Date();
    order.torobPay.processing = false;
    order.torobPay.lastError = undefined;
    order.paymentStatus = "لغو شده";
    order.status = "لغو شده";
    await restoreOrderProductsToInventory(order);
    await order.save();

    return res.json({ success: true, message: "سفارش با موفقیت در ترب‌پی لغو شد", order });
  } catch (error) {
    console.error("TorobPay order cancel error:", error);
    try {
      await Order.updateOne(
        { _id: req.params.id },
        { $set: { "torobPay.processing": false, "torobPay.lastError": error.message } }
      );
    } catch (_) {}
    return res.status(error.httpStatus || 500).json({
      success: false,
      message: error.message || "خطا در لغو سفارش ترب‌پی",
      errorCode: error.errorCode,
    });
  }
});

router.put("/orders/edit/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!status) {
      return res.status(400).json({ success: false, message: "وضعیت جدید الزامی است" });
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
      return res.status(400).json({ success: false, message: "وضعیت نامعتبر است" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "سفارش یافت نشد" });
    }

    if (
      status === "لغو شده" &&
      order.paymentMethod === "اسنپ‌پی" &&
      (order.snappPay?.status === "SETTLE" || order.paymentStatus === "پرداخت شده")
    ) {
      return res.status(409).json({
        success: false,
        message: "سفارش پرداخت‌شده اسنپ‌پی باید با دکمه «کنسل در اسنپ‌پی» لغو شود",
      });
    }

    if (
      status === "لغو شده" &&
      order.paymentMethod === "ترب‌پی" &&
      (order.torobPay?.status === "SETTLE" || order.paymentStatus === "پرداخت شده")
    ) {
      return res.status(409).json({
        success: false,
        message: "سفارش پرداخت‌شده ترب‌پی باید با دکمه «لغو در ترب‌پی» لغو شود تا عودت وجه توسط ترب‌پی انجام شود",
      });
    }

    order._updatedBy = req.admin?._id;
    order.status = status;
    await order.save();
    await order.populate("user", "fullName email mobile");

    return res.json({
      success: true,
      message: "وضعیت سفارش با موفقیت به‌روزرسانی شد",
      data: order,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    return res.status(500).json({
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
    delete duplicateData.sku;
    duplicateData.isNewProduct = true;
    duplicateData.isFeatured = false;
    duplicateData.specialOfferPosition = null;
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
            maxDiscountAmount ,
            oneTimePerUser,
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
            oneTimePerUser: oneTimePerUser || false,
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
            maxDiscountAmount ,
            oneTimePerUser
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
            description: description || null,
            oneTimePerUser: oneTimePerUser || false,
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
            .populate("user", "fullName email mobile")
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


// ============================================================== Banners
// Admin-managed storefront banners (see models/Banner.js for placements).
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp|avif)$/i.test(file.mimetype)),
});

const BANNER_FIELDS = ["placement", "eyebrow", "title", "subtitle", "ctaText", "url", "imageAlt", "theme", "categorySlug"];

function bannerPayload(body) {
  const data = {};
  BANNER_FIELDS.forEach((key) => {
    if (body[key] !== undefined) data[key] = String(body[key] == null ? "" : body[key]).trim();
  });
  if (body.isActive !== undefined) data.isActive = body.isActive === true || body.isActive === "true";
  if (body.order !== undefined && body.order !== "") data.order = Math.round(Number(body.order)) || 0;
  ["startsAt", "endsAt"].forEach((key) => {
    if (body[key] === undefined) return;
    const d = body[key] ? new Date(body[key]) : null;
    data[key] = d && !Number.isNaN(d.getTime()) ? d : null;
  });
  ["image", "mobileImage"].forEach((key) => {
    if (body[key] === undefined) return;
    const url = body[key] && typeof body[key] === "object" ? String(body[key].url || "") : String(body[key] || "");
    const safe = url && (url.startsWith("/uploads/banners/") || url.startsWith("/images/banners/") || url.startsWith("/images/editorial/") || url.startsWith("/uploads/")) && !url.includes("..");
    data[key] = safe ? { url, filename: url.split("/").pop() } : undefined;
  });
  return data;
}

function bannerError(res, error) {
  if (error && error.name === "ValidationError") {
    return res.status(400).json({ success: false, message: Object.values(error.errors).map((e) => e.message).join("، ") });
  }
  console.error("Banner error:", error && error.message);
  return res.status(500).json({ success: false, message: "خطا در ذخیره بنر" });
}

router.get("/banners", async (req, res) => {
  const banners = await Banner.find({}).sort({ placement: 1, order: 1, createdAt: 1 }).lean();
  res.json({ success: true, banners, placements: Banner.PLACEMENTS });
});

router.post("/banners/upload", bannerUpload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "فایل تصویر معتبر انتخاب نشده است" });
    const mobile = req.query.kind === "mobile";
    const dir = path.join("public", "uploads", "banners");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${mobile ? "-m" : ""}.webp`;
    await sharp(req.file.buffer)
      .rotate()
      .resize(mobile ? 900 : 2000, mobile ? 1400 : 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(path.join(dir, filename));
    res.json({ success: true, url: `/uploads/banners/${filename}`, filename });
  } catch (error) {
    console.error("Banner upload error:", error.message);
    res.status(400).json({ success: false, message: "پردازش تصویر ممکن نشد" });
  }
});

router.post("/banners/reorder", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((id) => mongoose.Types.ObjectId.isValid(id)) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "ترتیب نامعتبر است" });
  await Banner.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: (i + 1) * 10 } } } })));
  res.json({ success: true });
});

router.post("/banners", async (req, res) => {
  try {
    const banner = await Banner.create(bannerPayload(req.body));
    res.status(201).json({ success: true, banner });
  } catch (error) {
    bannerError(res, error);
  }
});

router.put("/banners/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: "بنر یافت نشد" });
    banner.set(bannerPayload(req.body));
    await banner.save();
    res.json({ success: true, banner });
  } catch (error) {
    bannerError(res, error);
  }
});

router.post("/banners/:id/toggle", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
  const banner = await Banner.findById(req.params.id);
  if (!banner) return res.status(404).json({ success: false, message: "بنر یافت نشد" });
  banner.isActive = !banner.isActive;
  await banner.save();
  res.json({ success: true, banner });
});

router.delete("/banners/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "شناسه نامعتبر است" });
  const banner = await Banner.findByIdAndDelete(req.params.id);
  if (!banner) return res.status(404).json({ success: false, message: "بنر یافت نشد" });
  // Remove uploaded files that are no longer referenced (seeded /images/ files are kept).
  for (const img of [banner.image, banner.mobileImage]) {
    if (img && img.url && img.url.startsWith("/uploads/banners/") && !(await Banner.exists({ $or: [{ "image.url": img.url }, { "mobileImage.url": img.url }] }))) {
      fs.promises.unlink(path.join("public", img.url)).catch(() => {});
    }
  }
  res.json({ success: true });
});

module.exports = router;
