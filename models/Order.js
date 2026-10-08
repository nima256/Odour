const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const orderSchema = new mongoose.Schema(
  {
    OrderNum: {
      type: String,
      required: [true, "شماره سفارش الزامی است"],
      unique: true,
      index: true,
      validate: {
        validator: (value) => /^[A-Z0-9-]+$/.test(value),
        message: "شماره سفارش باید شامل حروف انگلیسی، اعداد و خط تیره باشد",
      },
    },
    postcode: {
      type: String,
      required: [true, "کد پستی الزامی است"],
      validate: {
        validator: (value) => /^\d{10}$/.test(value),
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
    province: {
      type: String,
      trim: true,
      maxlength: [100, "نام استان نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد"],
    },
    city: {
      type: String,
      trim: true,
      maxlength: [100, "نام شهر نمی‌تواند بیشتر از ۱۰۰ کاراکتر باشد"],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "کاربر الزامی است"],
      index: true,
    },
    // Who receives the parcel (entered at checkout; may differ from the account holder).
    recipientName: { type: String, trim: true, maxlength: 60 },
    recipientMobile: { type: String, trim: true },
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
        originalUnitPrice: { type: Number, min: 0 },
        hadProductDiscount: { type: Boolean, default: false },
        categoryAtPurchase: { type: String, default: "عمومی" },
        commissionType: { type: Number, default: 100 },
        snappItemId: { type: Number },
        nameAtPurchase: {
          type: String,
          required: [true, "نام محصول در زمان خرید الزامی است"],
        },
        selectedColor: {
          type: String,
          default: null,
        },
        selectedVariantId: {
          type: String,
          default: null,
        },
        colorStockTracked: {
          type: Boolean,
          default: false,
        },
        selectedSize: {
          type: String,
          default: null,
        },
        selectedSizeId: {
          type: String,
          default: null,
        },
        sizeStockTracked: {
          type: Boolean,
          default: false,
        },
        variantStockTracked: {
          type: Boolean,
          default: false,
        },
      },
    ],
    delivery: {
      type: String,
      enum: {
        values: ["تیپاکس", "چاپار", "ایران-پیام", "ارسال-سریع-به-کرج", "ارسال-سریع-به-تهران"],
        message: "روش ارسال نامعتبر است",
      },
      default: "تیپاکس",
    },
    trackingNumber: { type: String, index: true },
    // Idempotent order-registration SMS state (customer + both admins).
    orderRegisteredSmsKeys: { type: [String], default: [] },
    orderRegisteredSmsSentAt: Date,
    orderRegisteredSmsLockAt: Date,
    inventoryReserved: { type: Boolean, default: false },
    inventoryRestored: { type: Boolean, default: false },
    originalPrice: {
      type: Number,
      required: [true, "مبلغ اصلی الزامی است"],
      min: [0, "مبلغ اصلی نمی‌تواند منفی باشد"],
    },
    taxAmount: { type: Number, default: 0, min: 0 },
    externalSourceAmount: { type: Number, default: 0, min: 0 },
    totalPrice: {
      type: Number,
      required: [true, "مبلغ نهایی الزامی است"],
      min: [0, "مبلغ نهایی نمی‌تواند منفی باشد"],
    },
    discount: {
      discountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DiscountCode",
      },
      type: {
        type: String,
        enum: {
          values: ["percent", "amount"],
          message: "نوع تخفیف نامعتبر است",
        },
      },
      amount: { type: Number, min: [0, "مقدار تخفیف نمی‌تواند منفی باشد"] },
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
        status: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        note: String,
      },
    ],
    paymentMethod: {
      type: String,
      enum: ["آنلاین", "زرین‌پال", "اسنپ‌پی", "ترب‌پی", "حضوری", "کارت به کارت"],
      default: "آنلاین",
    },
    paymentStatus: {
      type: String,
      enum: ["پرداخت نشده", "در حال بررسی", "پرداخت شده", "لغو شده", "نامشخص"],
      default: "پرداخت نشده",
    },
    paymentInfo: {
      authority: String,
      refId: String,
      cardPan: String,
      paymentDate: Date,
      paymentUrl: String,
      returnSessionTokenHash: String,
      returnSessionExpiresAt: Date,
    },
    snappPay: {
      paymentToken: { type: String, index: true, unique: true, sparse: true },
      transactionId: { type: String, index: true, unique: true, sparse: true },
      cartId: Number,
      status: {
        type: String,
        enum: ["CREATED", "PENDING", "VERIFY", "SETTLE", "CANCEL", "REVERT", "FAILED", "UNKNOWN"],
      },
      callbackState: String,
      callbackAmountIrr: Number,
      eligibleTitle: String,
      eligibleDescription: String,
      returnSessionTokenHash: String,
      returnSessionExpiresAt: Date,
      lastStatusCheckAt: Date,
      lastError: String,
      processing: { type: Boolean, default: false },
      processingStartedAt: Date,
      updateHistory: [
        {
          amount: Number,
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
          products: [
            {
              product: mongoose.Schema.Types.ObjectId,
              quantity: Number,
              amount: Number,
            },
          ],
        },
      ],
      cancelledAt: Date,
      settledAt: Date,
      revertedAt: Date,
    },
    torobPay: {
      paymentToken: { type: String, index: true, unique: true, sparse: true },
      transactionId: { type: String, index: true, unique: true, sparse: true },
      status: {
        type: String,
        enum: ["PENDING", "VERIFY", "SETTLE", "REVERT", "FAILED", "UNKNOWN"],
      },
      callbackState: String,
      callbackAmountIrr: Number,
      eligibleTitle: String,
      eligibleDescription: String,
      returnSessionTokenHash: String,
      returnSessionExpiresAt: Date,
      lastStatusCheckAt: Date,
      lastError: String,
      processing: { type: Boolean, default: false },
      updateHistory: [
        {
          amount: Number,
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
          products: [
            {
              product: mongoose.Schema.Types.ObjectId,
              quantity: Number,
              amount: Number,
            },
          ],
        },
      ],
      cancelledAt: Date,
      settledAt: Date,
    },
    createTarikh: {
      type: String,
      default: () => getPersianDate(),
    },
    updateTarikh: String,
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

orderSchema.pre("save", function () {
  this.updateTarikh = getPersianDate();

  if (this.isModified("status")) {
    this.statusHistory = this.statusHistory || [];
    this.statusHistory.push({
      status: this.status,
      changedBy: this._updatedBy,
    });
  }
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

module.exports = mongoose.model("Order", orderSchema);
