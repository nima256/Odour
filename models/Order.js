const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { getPersianDate } = require("../helper/getPersianDate");

const orderSchema = new Schema(
  {
    OrderNum: {
      type: String,
      required: [true, "شماره سفارش الزامی است"],
      unique: true,
      index: true,
      validate: {
        validator: function (v) {
          return /^[A-Z0-9-]+$/.test(v);
        },
        message: "شماره سفارش باید شامل حروف انگلیسی، اعداد و خط تیره باشد",
      },
    },
    postcode: {
      type: String,
      required: [true, "کد پستی الزامی است"],
      validate: {
        validator: function (v) {
          return /^\d{10}$/.test(v);
        },
        message: "کد پستی باید ۱۰ رقم باشد",
      },
    },
    address: {
      type: String,
      required: [true, "آدرس الزامی است"],
      trim: true,
      minlength: [10, "آدرس نمی‌تواند کمتر از ۱۰ کاراکتر باشد"],
      maxlength: [500, "آدرس نمی‌تواند بیشتر از ۵۰۰ کاراکتر باشد"],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "کاربر الزامی است"],
      index: true,
    },
    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: [true, "محصول الزامی است"],
        },
        quantity: {
          type: Number,
          required: [true, "تعداد الزامی است"],
          min: [1, "تعداد باید حداقل ۱ باشد"],
        },
        priceAtPurchase: {
          type: Number,
          required: [true, "قیمت محصول در زمان خرید الزامی است"],
        },
        nameAtPurchase: {
          type: String,
          required: [true, "نام محصول در زمان خرید الزامی است"],
        },
      },
    ],
    delivery: {
      type: String,
      enum: {
        values: ["تیپاکس", "چاپار", "ایران-پیام"],
        message: "روش ارسال نامعتبر است",
      },
      default: "تیپاکس",
    },
    trackingNumber: {
      type: String,
      index: true,
    },
    originalPrice: {
      type: Number,
      required: [true, "مبلغ اصلی الزامی است"],
      min: [0, "مبلغ اصلی نمی‌تواند منفی باشد"],
    },
    totalPrice: {
      type: Number,
      required: [true, "مبلغ نهایی الزامی است"],
      min: [0, "مبلغ نهایی نمی‌تواند منفی باشد"],
    },
    discount: {
      type: {
        type: String,
        enum: {
          values: ["percent", "amount"],
          message: "نوع تخفیف نامعتبر است",
        },
      },
      amount: {
        type: Number,
        min: [0, "مقدار تخفیف نمی‌تواند منفی باشد"],
      },
      calculatedAmount: {
        type: Number,
        min: [0, "مقدار محاسبه شده تخفیف نمی‌تواند منفی باشد"],
      },
      code: String,
      originalValue: String,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, "مقدار تخفیف نمی‌تواند منفی باشد"],
    },
    status: {
      type: String,
      enum: {
        values: [
          "در انتظار پرداخت",
          "در حال پردازش",
          "بسته بندی شده",
          "در حال ارسال",
          "تحویل داده شد",
          "لغو شده",
        ],
        message: "وضعیت سفارش نامعتبر است",
      },
      default: "در انتظار پرداخت",
      index: true,
    },
    statusHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        note: String,
      },
    ],
    paymentMethod: {
      type: String,
      enum: ["آنلاین", "حضوری", "کارت به کارت"],
    },
    paymentStatus: {
      type: String,
      enum: ["پرداخت نشده", "پرداخت شده", "لغو شده"],
      default: "پرداخت نشده",
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

orderSchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();

  // Track status changes
  if (this.isModified("status")) {
    this.statusHistory = this.statusHistory || [];
    this.statusHistory.push({
      status: this.status,
      changedBy: this._updatedBy, // Should be set before save
    });
  }

  next();
});

orderSchema.virtual("userDetails", {
  ref: "User",
  localField: "user",
  foreignField: "_id",
  justOne: true,
});

orderSchema.virtual("productDetails", {
  ref: "Product",
  localField: "products.product",
  foreignField: "_id",
  justOne: false,
});

orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ createTarikh: -1 });
orderSchema.index({ totalPrice: 1 });

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
