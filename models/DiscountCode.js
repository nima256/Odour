const mongoose = require("mongoose");
const validator = require("validator");
const { getPersianDate } = require("../helper/getPersianDate");

const discountCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "کد تخفیف الزامی است"],
      unique: true,
      trim: true,
      uppercase: true,
      validate: {
        validator: function (v) {
          return /^[A-Z0-9]+$/.test(v);
        },
        message: "کد تخفیف باید فقط شامل حروف انگلیسی و اعداد باشد",
      },
      minlength: [5, "کد تخفیف نمی‌تواند کمتر از ۵ کاراکتر باشد"],
      maxlength: [20, "کد تخفیف نمی‌تواند بیشتر از ۲۰ کاراکتر باشد"],
    },
    type: {
      type: String,
      required: [true, "نوع تخفیف الزامی است"],
      enum: {
        values: ["percent", "amount"],
        message: 'نوع تخفیف باید یا "percent" یا "amount" باشد',
      },
    },
    amount: {
      type: Number,
      required: [true, "مقدار تخفیف الزامی است"],
      min: [1, "مقدار تخفیف باید حداقل ۱ باشد"],
      validate: {
        validator: function (v) {
          if (this.type === "percent") {
            return v > 0 && v <= 100;
          }
          return v > 0;
        },
        message: "مقدار تخفیف درصدی باید بین ۱ تا ۱۰۰ باشد",
      },
    },
    usageLimit: {
      type: Number,
      min: [1, "محدودیت استفاده باید حداقل ۱ باشد"],
      validate: {
        validator: Number.isInteger,
        message: "محدودیت استفاده باید عدد صحیح باشد",
      },
    },
    usedCount: {
      type: Number,
      default: 0,
      min: [0, "تعداد استفاده نمی‌تواند منفی باشد"],
      validate: {
        validator: Number.isInteger,
        message: "تعداد استفاده باید عدد صحیح باشد",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expireDate: {
      type: Date,
      validate: {
        validator: function (v) {
          return !v || v > Date.now();
        },
        message: "تاریخ انقضا باید در آینده باشد",
      },
    },
    minOrderAmount: {
      type: Number,
      min: [0, "حداقل مبلغ سفارش نمی‌تواند منفی باشد"],
    },
    maxDiscountAmount: {
      type: Number,
      min: [0, "سقف تخفیف نمی‌تواند منفی باشد"],
      validate: {
        validator: function (v) {
          if (this.type === "percent" && v) {
            return v > 0;
          }
          return true;
        },
        message: "برای تخفیف درصدی، سقف تخفیف باید مشخص باشد",
      },
    },
    description: {
      type: String,
      maxlength: [200, "توضیحات نمی‌تواند بیشتر از ۲۰۰ کاراکتر باشد"],
    },
    applicableCategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    applicableProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      // required: true,
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

discountCodeSchema.pre("validate", function (next) {
  if (this.type === "percent" && !this.maxDiscountAmount) {
    this.invalidate(
      "maxDiscountAmount",
      "برای تخفیف درصدی، سقف تخفیف الزامی است"
    );
  }
  next();
});

discountCodeSchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();
  next();
});

discountCodeSchema.index({ isActive: 1 });
discountCodeSchema.index({ expireDate: 1 });
discountCodeSchema.index({ createdBy: 1 });

discountCodeSchema.virtual("remainingUses").get(function () {
  if (!this.usageLimit) return Infinity;
  return Math.max(0, this.usageLimit - this.usedCount);
});

discountCodeSchema.virtual("isExpired").get(function () {
  return this.expireDate && this.expireDate < new Date();
});

discountCodeSchema.virtual("isValid").get(function () {
  return (
    this.isActive &&
    !this.isExpired &&
    (this.remainingUses > 0 || !this.usageLimit)
  );
});

module.exports = mongoose.model("DiscountCode", discountCodeSchema);
