const mongoose = require("mongoose");
const validator = require("validator");
const { getPersianDate } = require("../helper/getPersianDate");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "نام محصول الزامی است"],
      trim: true,
      minlength: [3, "نام محصول نمی‌تواند کمتر از ۳ کاراکتر باشد"],
      maxlength: [100, "نام محصول نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد"],
    },
    englishName: {
      type: String,
      trim: true,
      maxlength: [100, "نام انگلیسی نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد"],
    },
    slug: {
      type: String,
      unique: true,
      sparse: true,
      validate: {
        validator: (value) => /^[a-zA-Z\u0600-\u06FF0-9\-]+$/.test(value),
        message: "اسلاگ باید فقط شامل حروف انگلیسی، فارسی، اعداد و خط تیره (-) باشد",
      },
    },
    oldSlugs: [{ type: String }],
    lilDescription: {
      type: String,
      maxlength: [160, "توضیح کوتاه نمی‌تواند بیشتر از ۱۶۰ کاراکتر باشد"],
      trim: true,
    },
    description: {
      type: String,
      maxlength: 1000000,
    },
    images: [
      {
        url: {
          type: String,
          required: true,
          validate: {
            validator: (value) =>
              value.startsWith("/uploads/") ||
              /^https?:\/\//.test(value) ||
              validator.isURL(value, {
                protocols: ["http", "https"],
                require_protocol: true,
              }),
            message: "آدرس تصویر باید با /uploads/ شروع شود یا یک URL معتبر باشد",
          },
        },
        filename: { type: String, required: true },
        caption: String,
        alt: String,
      },
    ],
    price: {
      type: Number,
      required: [true, "قیمت محصول الزامی است"],
      min: [0, "قیمت محصول نمی‌تواند منفی باشد"],
    },
    offerPrice: {
      type: Number,
      min: [0, "قیمت تخفیف‌خورده نمی‌تواند منفی باشد"],
    },
    // Price the customer actually pays (offerPrice when it's a real discount).
    // Maintained in pre("save"); used to filter/sort the catalogue by price.
    finalPrice: {
      type: Number,
      index: true,
    },
    catName: { type: String, default: "" },
    brandName: { type: String, default: "" },
    catId: { type: String, default: "" },
    subCatId: { type: String, default: "" },
    subCat: { type: String, default: "" },
    category: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: [true, "دسته‌بندی الزامی است"],
        index: true,
      },
    ],
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: [true, "برند الزامی است"],
      index: true,
    },
    countInStock: {
      type: Number,
      required: [true, "موجودی محصول الزامی است"],
      min: [0, "موجودی نمی‌تواند منفی باشد"],
      default: 0,
    },
    isOutOfStock: {
      type: Boolean,
      default: false,
      index: true,
    },
    isFeatured: { type: Boolean, default: false },
    // جایگاه دستی محصول در اسلایدر SPECIAL OFFER صفحه اصلی (۱ تا ۶).
    // null یعنی این محصول در بخش پیشنهاد ویژه نمایش داده نشود.
    specialOfferPosition: {
      type: Number,
      min: [1, "جایگاه پیشنهاد ویژه باید بین ۱ تا ۶ باشد"],
      max: [6, "جایگاه پیشنهاد ویژه باید بین ۱ تا ۶ باشد"],
      default: null,
      index: true,
    },

    // وزن باید در مدل و JSON عدد باقی بماند تا داخل input[type=number]
    // بدون تبدیل و مشکل نمایش داده شود.
    weight: {
      type: Number,
      min: [0, "وزن نمی‌تواند منفی باشد"],
    },

    colors: [
      {
        // _id این subdocument شناسه پایدار هر تنوع رنگی برای ترب است.
        name: { type: String, trim: true },
        rgb: { type: String, required: true },
        image: {
          url: { type: String },
          filename: { type: String },
        },
        // موجودی اختیاری هر رنگ؛ اگر خالی باشد از موجودی کلی محصول استفاده می‌شود.
        countInStock: { type: Number, min: 0 },
        isOutOfStock: { type: Boolean, default: false },
      },
    ],
    btnColor: String,
    discount: {
      type: Number,
      min: [0, "تخفیف نمی‌تواند منفی باشد"],
      max: [100, "تخفیف نمی‌تواند بیشتر از ۱۰۰٪ باشد"],
    },
    // ---------- Merchandising (admin-managed storefront presentation) ----------
    sku: { type: String, trim: true, maxlength: 60, index: { sparse: true } },
    // Stock at or below this number shows a "low stock" note and appears on the dashboard.
    lowStockThreshold: { type: Number, min: 0, default: 3 },
    // One editorial badge at most. "Sale" is derived from the price automatically.
    badge: {
      type: String,
      enum: ["", "new", "bestseller", "limited", "exclusive"],
      default: "",
    },
    collectionName: { type: String, trim: true, maxlength: 60, default: "" },
    // Higher values are listed first in the "recommended" sort.
    sortPriority: { type: Number, default: 0, index: true },

    // ---------- Structured fragrance identity (perfumes) ----------
    // Values are stored as Persian labels so the shop filters can use them directly.
    // When a field is empty the storefront falls back to matching specification rows.
    fragrance: {
      family: { type: String, trim: true, maxlength: 60 },
      concentration: { type: String, trim: true, maxlength: 40 },
      gender: { type: String, trim: true, maxlength: 30 },
      volume: { type: String, trim: true, maxlength: 40 },
      top: [{ type: String, trim: true, maxlength: 40 }],
      heart: [{ type: String, trim: true, maxlength: 40 }],
      base: [{ type: String, trim: true, maxlength: 40 }],
      accords: [
        {
          _id: false,
          name: { type: String, trim: true, maxlength: 40 },
          strength: { type: Number, min: 0, max: 100 },
        },
      ],
      longevity: { type: String, trim: true, maxlength: 40 },
      sillage: { type: String, trim: true, maxlength: 40 },
      seasons: [{ type: String, enum: ["بهار", "تابستان", "پاییز", "زمستان"] }],
      dayNight: [{ type: String, enum: ["روز", "شب"] }],
      occasions: [{ type: String, trim: true, maxlength: 40 }],
      story: { type: String, trim: true, maxlength: 2000 },
      usage: { type: String, trim: true, maxlength: 1000 },
      ingredients: { type: String, trim: true, maxlength: 2000 },
      identityImage: {
        url: { type: String, trim: true },
        filename: { type: String, trim: true },
      },
    },
    isNewProduct: { type: Boolean, default: false },
    sizes: [
      {
        // _id زیرسند سایز برای URL و page_unique ترب باید پایدار بماند.
        size: { type: String, trim: true },
        usage: { type: String, trim: true },
        // موجودی اختیاری هر سایز؛ اگر خالی باشد از موجودی کلی محصول استفاده می‌شود.
        countInStock: { type: Number, min: 0 },
        isOutOfStock: { type: Boolean, default: false },
      },
    ],
    isPopular: { type: Boolean, default: false },
    specifications: [
      {
        key: { type: String, required: true, trim: true },
        value: { type: String, required: true, trim: true },
      },
    ],
    tags: [{ type: String, trim: true }],
    guarantee: {
      type: String,
      trim: true,
      default: "گارانتی اصالت و سلامت فیزیکی کالا",
    },
    product_group_id: {
      type: String,
      trim: true,
      default: "",
    },
    createTarikh: {
      type: String,
      default: () => getPersianDate(),
    },
    updateTarikh: String,
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
    publishedAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      getters: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      getters: true,
    },
  }
);

const normalizeSlug = (value) =>
  String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/\s+/g, "-")
    .replace(/ـ/g, "-")
    .replace(/[^a-zA-Z\u0600-\u06FF0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

productSchema.pre("validate", async function () {
  if (!this.slug && this.name) {
    this.slug = normalizeSlug(this.name) || `محصول-${Date.now()}`;
  } else if (this.slug) {
    this.slug = normalizeSlug(this.slug);
  }

  if (!this.isNew && this.isModified("slug")) {
    const original = await this.constructor
      .findById(this._id)
      .select("slug oldSlugs")
      .lean();

    if (original?.slug && original.slug !== this.slug) {
      this.oldSlugs = Array.from(
        new Set([...(original.oldSlugs || []), original.slug])
      ).filter((slug) => slug !== this.slug);
    }
  }

  if (this.slug) {
    const baseSlug = this.slug;
    let uniqueSlug = baseSlug;
    let counter = 1;

    while (true) {
      const exists = await this.constructor
        .findOne({ slug: uniqueSlug })
        .select("_id")
        .lean();

      if (!exists || String(exists._id) === String(this._id)) break;
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    this.slug = uniqueSlug;
  }
});

const computeFinalPrice = (price, offerPrice) => {
  const base = Number(price) || 0;
  const offer = Number(offerPrice) || 0;
  return offer > 0 && offer < base ? offer : base;
};

productSchema.pre("save", function () {
  this.updateTarikh = getPersianDate();
  this.finalPrice = computeFinalPrice(this.price, this.offerPrice);
  this.isOutOfStock = Number(this.countInStock || 0) <= 0;

  for (const color of this.colors || []) {
    if (color.countInStock !== undefined && color.countInStock !== null) {
      // اگر ادمین تنوع را دستی ناموجود کرده باشد، تا زمان برداشتن تیک
      // همان وضعیت حفظ می‌شود. موجودی صفر نیز همیشه ناموجود است.
      color.isOutOfStock = Boolean(color.isOutOfStock) || Number(color.countInStock) <= 0;
    }
  }
  for (const size of this.sizes || []) {
    if (size.countInStock !== undefined && size.countInStock !== null) {
      size.isOutOfStock = Boolean(size.isOutOfStock) || Number(size.countInStock) <= 0;
    }
  }

  if (this.isPublished && !this.publishedAt) {
    this.publishedAt = new Date();
  }
});

productSchema.virtual("discountPrice").get(function () {
  return Number(this.offerPrice) > 0 ? this.offerPrice : this.price;
});

// فقط برای نمایش در صفحات؛ فیلد اصلی weight همچنان Number است.
productSchema.virtual("weightText").get(function () {
  return this.weight === undefined || this.weight === null
    ? null
    : `${this.weight} گرم`;
});

productSchema.virtual("categoryDetails", {
  ref: "Category",
  localField: "category",
  foreignField: "_id",
  justOne: true,
});

productSchema.virtual("brandDetails", {
  ref: "Brand",
  localField: "brand",
  foreignField: "_id",
  justOne: true,
});

productSchema.index({ name: "text", description: "text", lilDescription: "text" });
productSchema.index({ price: 1 });
productSchema.index({ offerPrice: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isPopular: 1 });
productSchema.index({ isNewProduct: 1 });
productSchema.index({ "colors.rgb": 1 });
productSchema.index({ isPublished: 1, publishedAt: -1, createdAt: -1 });
productSchema.index({ isPublished: 1, updatedAt: -1 });

productSchema.statics.computeFinalPrice = computeFinalPrice;

module.exports = mongoose.model("Product", productSchema);
