const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");
const slugify = require("slugify");
const validator = require("validator");

const categorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "نام دسته‌بندی الزامی است"],
      trim: true,
      maxlength: [50, "نام نمی‌تواند بیشتر از ۵۰ کاراکتر باشد"],
      minlength: [2, "نام نمی‌تواند کمتر از ۲ کاراکتر باشد"],
    },
    slug: {
      type: String,
      required: [true, "Slug الزامی است"],
      unique: true,
      immutable: true,
      validate: {
        validator: function (v) {
          return /^[a-z0-9-]+$/.test(v);
        },
        message: "Slug باید فقط شامل حروف کوچک، اعداد و خط تیره باشد",
      },
    },
    images: [
      {
        type: String,
        validate: {
          validator: function (v) {
            return validator.isURL(v, {
              protocols: ["http", "https"],
              require_protocol: true,
            });
          },
          message: "آدرس تصویر نامعتبر است",
        },
      },
    ],
    color: {
      type: String,
      default: "#ffffff",
      validate: {
        validator: function (v) {
          return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
        },
        message: "رنگ باید در فرمت HEX باشد",
      },
    },
    textColor: {
      type: String,
      default: "#000000",
      validate: {
        validator: function (v) {
          return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
        },
        message: "رنگ متن باید در فرمت HEX باشد",
      },
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      validate: {
        validator: async function (v) {
          if (!v) return true;
          const category = await mongoose.model("Category").findById(v);
          return !!category;
        },
        message: "دسته‌بندی والد معتبر نیست",
      },
    },
    emoji: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /\p{Emoji}/u.test(v);
        },
        message: "فقط ایموجی معتبر قابل قبول است",
      },
    },
    imgSvgForHome: {
      type: String,
      validate: {
        validator: function (v) {
          return (
            !v ||
            validator.isURL(v, {
              protocols: ["http", "https"],
              require_protocol: true,
            })
          );
        },
        message: "آدرس SVG نامعتبر است",
      },
    },
    description: {
      type: String,
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
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

categorySchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      locale: "fa",
      remove: /[*+~.()'"!:@]/g,
    });
  }
  next();
});

categorySchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();
  next();
});

categorySchema.pre("remove", async function (next) {
  await mongoose.model("Category").deleteMany({ parentId: this._id });
  next();
});

categorySchema.virtual("parent", {
  ref: "Category",
  localField: "parentId",
  foreignField: "_id",
  justOne: true,
});

categorySchema.virtual("children", {
  ref: "Category",
  localField: "_id",
  foreignField: "parentId",
});

categorySchema.virtual("productCount", {
  ref: "Product",
  localField: "_id",
  foreignField: "category",
  count: true,
});

categorySchema.index({ name: "text", description: "text" });
categorySchema.index({ slug: 1 });
categorySchema.index({ parentId: 1 });
categorySchema.index({ isActive: 1 });

categorySchema.set("toJSON", {
  virtual: true,
});

const Category = mongoose.model("Category", categorySchema);
module.exports = Category;
