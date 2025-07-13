const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");
const slugify = require("slugify");

const brandSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "نام برند الزامی است"],
      trim: true,
      maxlength: [50, "نام برند نمی‌تواند بیشتر از ۵۰ کاراکتر باشد"],
      minlength: [2, "نام برند نمی‌تواند کمتر از ۲ کاراکتر باشد"],
    },
    slug: {
      type: String,
      required: [true, "Slug الزامی است"],
      unique: true,
      immutable: true, // Prevent modification after creation
      validate: {
        validator: function (v) {
          return /^[a-z0-9-]+$/.test(v);
        },
        message: "Slug باید فقط شامل حروف کوچک، اعداد و خط تیره باشد",
      },
    },
    emoji: {
      type: String,
      validate: {
        validator: function (v) {
          // Basic emoji validation (can be enhanced)
          return !v || /\p{Emoji}/u.test(v);
        },
        message: "فقط ایموجی معتبر قابل قبول است",
      },
    },
    logo: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /\.(jpg|jpeg|png|webp)$/i.test(v);
        },
        message: "فرمت لوگو نامعتبر است (فقط jpg, jpeg, png, webp)",
      },
    },
    description: {
      type: String,
      maxlength: [500, "توضیحات نمی‌تواند بیشتر از ۵۰۰ کاراکتر باشد"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
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
      transform: function (doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

brandSchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      locale: "fa",
    });
  }
  next();
});

brandSchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();
  next();
});

brandSchema.index({ name: "text", description: "text" });

brandSchema.virtual("productCount", {
  ref: "Product",
  localField: "_id",
  foreignField: "brand",
  count: true,
});

brandSchema.set("toJSON", {
  virtual: true,
});

const Brand = mongoose.model("Brand", brandSchema);
module.exports = Brand;
