const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");
const slugify = require("slugify");
const validator = require("validator");

const productSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "نام محصول الزامی است"],
      trim: true,
      minlength: [3, "نام محصول نمی‌تواند کمتر از ۳ کاراکتر باشد"],
      maxlength: [100, "نام محصول نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد"],
    },
    slug: {
      type: String,
      immutable: true,
      unique: true,
      sparse: true,
      validate: {
        validator: function (v) {
          // Allows Persian letters (ا-ی), numbers (۰-۹), and hyphens (-)
          return /^[\u0600-\u06FF0-9-]+$/.test(v);
        },
        message: "اسلاگ باید فقط شامل حروف فارسی، اعداد و خط تیره (-) باشد",
      },
    },
    lilDescription: {
      type: String,
      maxlength: [160, "توضیح کوتاه نمی‌تواند بیشتر از ۱۶۰ کاراکتر باشد"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "توضیحات محصول الزامی است"],
      minlength: [20, "توضیحات محصول نمی‌تواند کمتر از ۲۰ کاراکتر باشد"],
      maxlength: 1000000
    },
    images: [
      {
        url: {
          type: String,
          required: true,
          validate: {
            validator: function (v) {
              // Allow both relative paths (/uploads/) and full URLs
              return (
                v.startsWith("/uploads/") ||
                /^https?:\/\//.test(v) ||
                validator.isURL(v, {
                  protocols: ["http", "https"],
                  require_protocol: true,
                })
              );
            },
            message:
              "آدرس تصویر باید با /uploads/ شروع شود یا یک URL معتبر باشد",
          },
        },
        filename: {
          type: String,
          required: true,
        },
      },
    ],
    price: {
      type: Number,
      required: [true, "قیمت محصول الزامی است"],
      min: [0, "قیمت محصول نمی‌تواند منفی باشد"],
    },
    offerPrice: {
      type: Number,
    },
    catName: {
      type: String,
      default: "",
    },
    brandName: {
      type: String,
      default: "",
    },
    catId: {
      type: String,
      default: "",
    },
    subCatId: {
      type: String,
      default: "",
    },
    subCat: {
      type: String,
      default: "",
    },
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
    rating: {
      type: Number,
      min: [0, "امتیاز نمی‌تواند کمتر از ۰ باشد"],
      max: [5, "امتیاز نمی‌تواند بیشتر از ۵ باشد"],
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    weight: {
      type: Number, // Changed to Number for calculations
      min: [0, "وزن نمی‌تواند منفی باشد"],
      get: (v) => (v ? `${v} گرم` : null),
    },
    reviewsNum: {
      type: Number,
      min: [0, "تعداد نظرات نمی‌تواند منفی باشد"],
      default: 0,
    },
    colors: [
      {
        name: {
          type: String,
          trim: true,
        },
        rgb: { type: String, required: true },
      },
    ],
    btnColor: {
      type: String,
    },
    discount: {
      type: Number,
      min: [0, "تخفیف نمی‌تواند منفی باشد"],
      max: [100, "تخفیف نمی‌تواند بیشتر از ۱۰۰٪ باشد"],
    },
    isNewProduct: {
      type: Boolean,
      default: false,
    },
    sizes: [
      {
        size: {
          type: String,
          required: [true, "سایز الزامی است"],
          trim: true,
        },
        usage: {
          type: String,
          required: [true, "کاربرد سایز الزامی است"],
          trim: true,
        },
      },
    ],
    isPopular: {
      type: Boolean,
      default: false,
    },
    specifications: [
      {
        key: {
          type: String,
          required: true,
          trim: true,
        },
        value: {
          type: String,
          required: true,
          trim: true,
        },
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    createTarikh: {
      type: String,
      default: () => getPersianDate(),
    },
    updateTarikh: {
      type: String,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      getters: true,
      transform: function (doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      getters: true,
    },
  }
);

productSchema.pre("validate", async function (next) {
  if (!this.slug && this.name) {
    let baseSlug = this.name
      .trim()
      .normalize("NFKD")
      .replace(/\s+/g, "-")
      .replace(/ـ/g, "-")
      .replace(/[^\u0600-\u06FF0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    // Ensure uniqueness
    let uniqueSlug = baseSlug;
    let counter = 1;
    while (true) {
      const exists = await this.constructor.findOne({ slug: uniqueSlug });
      if (!exists || exists._id.equals(this._id)) break;
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    this.slug = uniqueSlug || `دسته-${Date.now()}`;
  }

  next();
});

productSchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();
  next();
});

productSchema.virtual("discountPrice").get(function () {
  return this.offerPrice || this.price;
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

productSchema.index({
  name: "text",
  description: "text",
  lilDescription: "text",
});
productSchema.index({ price: 1 });
productSchema.index({ offerPrice: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isPopular: 1 });
productSchema.index({ isNewProduct: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ "colors.hex": 1 });

productSchema.set("toJSON", {
  virtual: true,
});

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
