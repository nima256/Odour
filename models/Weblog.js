const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const weblogSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "عنوان وبلاگ الزامی است"],
      trim: true,
      minlength: [5, "عنوان نمی‌تواند کمتر از ۵ کاراکتر باشد"],
      maxlength: [100, "عنوان نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد"],
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
    description: {
      type: String,
      required: [true, "توضیحات کوتاه الزامی است"],
      trim: true,
      maxlength: [160, "توضیحات کوتاه نمی‌تواند بیشتر از ۱۶۰ کاراکتر باشد"],
    },
    content: {
      type: String,
      required: [true, "محتوا الزامی است"],
      minlength: [100, "محتوا نمی‌تواند کمتر از ۱۰۰ کاراکتر باشد"],
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
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "نویسنده الزامی است"],
    },
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        validate: {
          validator: function (v) {
            return v.length > 0;
          },
          message: "حداقل یک دسته‌بندی باید انتخاب شود",
        },
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    readingTime: {
      type: Number,
      min: [1, "زمان مطالعه نمی‌تواند کمتر از ۱ دقیقه باشد"],
      default: 5,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
    },
    metaTitle: {
      type: String,
      maxlength: [60, "عنوان متا نمی‌تواند بیشتر از ۶۰ کاراکتر باشد"],
    },
    metaDescription: {
      type: String,
      maxlength: [160, "توضیحات متا نمی‌تواند بیشتر از ۱۶۰ کاراکتر باشد"],
    },
    viewCount: {
      type: Number,
      default: 0,
      min: [0, "تعداد بازدید نمی‌تواند منفی باشد"],
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

weblogSchema.pre("validate", function (next) {
  if (!this.slug && this.title) {
    this.slug = slugify(this.title, {
      lower: true,
      strict: true,
      locale: "fa",
      remove: /[*+~.()'"!:@]/g,
    });
  }

  // Auto-generate meta fields if empty
  if (!this.metaTitle && this.title) {
    this.metaTitle = this.title.substring(0, 60);
  }

  if (!this.metaDescription && this.description) {
    this.metaDescription = this.description.substring(0, 160);
  }

  next();
});

weblogSchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();

  if (this.isModified("isPublished") && this.isPublished && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  next();
});

weblogSchema.virtual("publishedTarikh").get(function () {
  return this.publishedAt ? getPersianDate(this.publishedAt) : null;
});

weblogSchema.virtual("authorDetails", {
  ref: "User",
  localField: "author",
  foreignField: "_id",
  justOne: true,
});

weblogSchema.virtual("categoryDetails", {
  ref: "Category",
  localField: "categories",
  foreignField: "_id",
});

weblogSchema.index({ title: "text", content: "text", description: "text" });
weblogSchema.index({ slug: 1 });
weblogSchema.index({ author: 1 });
weblogSchema.index({ isFeatured: 1 });
weblogSchema.index({ isPublished: 1 });
weblogSchema.index({ publishedAt: -1 });
weblogSchema.index({ viewCount: -1 });
weblogSchema.index({ tags: 1 });

weblogSchema.set("toJSON", {
  virtual: true,
});

const Weblog = mongoose.model("Weblog", weblogSchema);
module.exports = Weblog;
