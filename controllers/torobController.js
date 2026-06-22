const Product = require("../models/Product");
const mongoose = require("mongoose");

const formatProductForTorob = (product) => {
  // تاریخ انتشار به فرمت ISO 8601 با timezone
  const getDateAdded = () => {
    if (product.publishedAt) {
      return new Date(product.publishedAt).toISOString();
    }
    if (product.createdAt) {
      return new Date(product.createdAt).toISOString();
    }
    return new Date().toISOString();
  };

  // تاریخ به‌روزرسانی
  const getDateUpdated = () => {
    if (product.updatedAt) {
      return new Date(product.updatedAt).toISOString();
    }
    return getDateAdded();
  };

  // تبدیل مشخصات از آرایه به آبجکت
  const buildSpec = () => {
    const specObj = {};
    if (product.specifications && Array.isArray(product.specifications)) {
      product.specifications.forEach((item) => {
        if (item.key && item.value) {
          specObj[item.key] = item.value;
        }
      });
    }
    // اضافه کردن مشخصات اضافی
    if (product.weight) specObj["وزن"] = product.weight;
    if (product.colors && product.colors.length) {
      specObj["رنگ‌ها"] = product.colors.map((c) => c.name).join(", ");
    }
    if (product.sizes && product.sizes.length) {
      specObj["سایزها"] = product.sizes.map((s) => s.size).join(", ");
    }
    return specObj;
  };

  // قیمت فعلی (با اولویت قیمت تخفیف خورده)
  const currentPrice = product.offerPrice && product.offerPrice > 0 
    ? product.offerPrice
    : product.price;

  // قیمت قدیم (قیمت اصلی اگر تخفیف دارد)
  const oldPrice = (product.offerPrice && product.offerPrice > 0 && product.price > product.offerPrice)
    ? product.price
    : null;

  // ساخت آدرس تصاویر (تبدیل نسبی به مطلق)
  const getImageUrl = (imagePath) => {
    if (!imagePath || !imagePath.url) return null;
    if (imagePath.url.startsWith("http")) return imagePath.url;
    if (imagePath.url.startsWith("/uploads")) {
      // آدرس دامنه خود را جایگزین کنید
      return `https://kidle.ir${imagePath.url}`;
    }
    return imagePath.url;
  };

  const imageLinks = product.images
    .map((img) => getImageUrl(img))
    .filter((url) => url !== null);

  // ساخت page_unique یکتا (ترکیبی از id و slug)
  const pageUnique = `${product._id}_${product.slug || Date.now()}`;

  return {
    page_unique: pageUnique,
    page_url: `https://kidle.ir/productDetails/${product.slug || product._id}`,
    product_group_id: product.product_group_id || product._id.toString(),
    title: product.name,
    subtitle: product.lilDescription || "",
    current_price: currentPrice,
    old_price: oldPrice,
    availability: !product.isOutOfStock && product.countInStock > 0,
    category_name: product.catName || product.subCat || "",
    image_links: imageLinks,
    spec: buildSpec(),
    guarantee: product.guarantee || "",
    short_desc: product.lilDescription || "",
    date_added: getDateAdded(),
    date_updated: getDateUpdated(),
  };
};

// اندپوینت اصلی ترب
exports.torobApiV3 = async (req, res) => {
  try {
      
    console.log("=== Torob API Request ===");
    console.log("Body:", req.body);
    console.log("Content-Type:", req.headers['content-type']);

    const requestBody = req.body || {};

    if (Object.keys(requestBody).length === 0) {
      console.log("Empty body received - returning error");
      return res.status(400).json({
        error: "Request body is required. Please provide {page: 1, sort: 'date_added_desc'} or {page_urls: [...]} or {page_uniques: [...]}"
      });
    }

    // حالت 1: دریافت محصولات با آدرس‌های صفحه
    if (requestBody.page_urls && Array.isArray(requestBody.page_urls)) {
      const urls = requestBody.page_urls;
      const products = [];

      for (const url of urls) {
        // استخراج slug از آدرس
        const slugMatch = url.match(/\/productDetails\/([^\/?#]+)/);
        if (slugMatch) {
          const slug = slugMatch[1];
          const product = await Product.findOne({ slug, isPublished: true })
            .populate("categoryDetails")
            .populate("brandDetails")
            .lean();

          if (product) {
            products.push(formatProductForTorob(product));
          }
        }
      }

      return res.json({
        api_version: "torob_api_v3",
        current_page: 1,
        total: products.length,
        max_pages: 1,
        products: products,
      });
    }

    // حالت 2: دریافت محصولات با شناسه یکتا
    else if (requestBody.page_uniques && Array.isArray(requestBody.page_uniques)) {
      const uniques = requestBody.page_uniques;
      const products = [];

      for (const unique of uniques) {
        const [productId] = unique.split("_");
        if (mongoose.Types.ObjectId.isValid(productId)) {
          const product = await Product.findById(productId)
            .populate("categoryDetails")
            .populate("brandDetails")
            .lean();

          if (product && product.isPublished) {
            products.push(formatProductForTorob(product));
          }
        }
      }

      return res.json({
        api_version: "torob_api_v3",
        current_page: 1,
        total: products.length,
        max_pages: 1,
        products: products,
      });
    }

    // حالت 3: دریافت صفحه‌بندی شده با مرتب‌سازی
    else if (requestBody.page && requestBody.sort) {
      const page = parseInt(requestBody.page) || 1;
      const sort = requestBody.sort;
      const limit = 100; // ترب هر صفحه حداکثر 100 محصول می‌خواهد
      const skip = (page - 1) * limit;

      // تنظیم مرتب‌سازی
      let sortQuery = {};
      if (sort === "date_added_desc") {
        sortQuery = { publishedAt: -1, createdAt: -1 };
      } else if (sort === "date_updated_desc") {
        sortQuery = { updatedAt: -1 };
      } else {
        return res.status(400).json({
          error: "sort parameter must be date_added_desc or date_updated_desc",
        });
      }

      // دریافت محصولات منتشر شده
      const query = { isPublished: true };
      
      const [products, total] = await Promise.all([
        Product.find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .populate("categoryDetails")
          .populate("brandDetails")
          .lean(),
        Product.countDocuments(query),
      ]);

      const formattedProducts = products.map(formatProductForTorob);
      const maxPages = Math.ceil(total / limit);

      return res.json({
        api_version: "torob_api_v3",
        current_page: page,
        total: total,
        max_pages: maxPages,
        products: formattedProducts,
      });
    }
    
    else {
      return res.status(400).json({
        error: "Invalid request. Provide (page and sort) OR (page_urls array) OR (page_uniques array)"
      });
    }

    // درخواست نامعتبر
    return res.status(400).json({
      error: "Invalid request. Provide page_urls, page_uniques, or (page and sort)",
    });
  } catch (error) {
    console.error("Torob API Error:", error);
    console.error("Error stack:", error.stack);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message // در دیباگ، جزئیات خطا را هم برگردانید
    });
  }
};

// اندپوینت sitemap ساده بدون جاوااسکریپت
exports.torobSitemap = async (req, res) => {
  try {
    const products = await Product.find({ isPublished: true })
      .sort({ publishedAt: -1, createdAt: -1 })
      .select("slug name updatedAt")
      .lean();

    const baseUrl = "https://kidle.ir";

    let html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نقشه سایت فروشگاه - جدیدترین محصولات</title>
    <style>
        body { font-family: Tahoma, Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
        .product-list { list-style: none; padding: 0; }
        .product-item { margin: 10px 0; padding: 10px; border-bottom: 1px solid #eee; }
        .product-item a { text-decoration: none; color: #2196F3; font-size: 16px; }
        .product-item a:hover { text-decoration: underline; }
        .date { color: #666; font-size: 12px; margin-right: 15px; }
        .count { background: #4CAF50; color: white; padding: 5px 10px; border-radius: 20px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📦 نقشه سایت فروشگاه - جدیدترین محصولات</h1>
        <p>تعداد کل محصولات: <span class="count">${products.length}</span></p>
        <ul class="product-list">`;

    products.forEach((product, index) => {
      const date = product.updatedAt 
        ? new Date(product.updatedAt).toLocaleDateString("fa-IR")
        : "";
      html += `
        <li class="product-item">
            <span>${index + 1}.</span>
            <a href="${baseUrl}/product/${product.slug}">${product.name}</a>
            <span class="date">${date}</span>
        </li>`;
    });

    html += `
        </ul>
    </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    console.error("Sitemap Error:", error);
    return res.status(500).send("خطا در تولید نقشه سایت");
  }
};