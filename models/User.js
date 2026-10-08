const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { getPersianDate } = require("../helper/getPersianDate");
const validator = require("validator");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const userSchema = new mongoose.Schema(
  {
    // Phone + OTP sign-in only needs the mobile number; the name is collected
    // at checkout, so fullName/email/password are optional for those accounts.
    fullName: {
      type: String,
      trim: true,
      minlength: [3, "نام کامل نمی‌تواند کمتر از ۳ کاراکتر باشد"],
      maxlength: [50, "نام کامل نمی‌تواند بیشتر از ۵۰ کاراکتر باشد"],
    },
    mobile: {
      type: String,
      required: [true, "شماره موبایل الزامی است"],
      unique: true,
      validate: {
        validator: function (v) {
          return /^09\d{9}$/.test(v); // Iranian mobile format
        },
        message: "شماره موبایل معتبر نیست (فرمت: 09123456789)",
      },
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      // Empty strings would collide in the unique index, so store "no email" as undefined.
      set: (value) => (value ? value : undefined),
      validate: {
        validator: (value) => !value || validator.isEmail(value),
        message: "ایمیل معتبر نیست",
      },
    },
    password: {
      type: String,
      minlength: [8, "رمز عبور باید حداقل ۸ کاراکتر باشد"],
      select: false, // Never return password in queries
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    cart: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: [true, "محصول الزامی است"],
        },
        quantity: {
          type: Number,
          default: 1,
          min: [1, "تعداد نمی‌تواند کمتر از ۱ باشد"],
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
        selectedColor: {
          type: String,
        },
        selectedVariantId: {
          type: String,
        },
        selectedSize: {
          type: String,
        },
        selectedSizeId: {
          type: String,
        },
      },
    ],
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    wishlist: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    // Delivery addresses saved at checkout (most recent first) to prefill the next order.
    addresses: [
      {
        fullName: { type: String, trim: true, maxlength: 60 },
        mobile: { type: String, trim: true },
        province: { type: String, trim: true, maxlength: 100 },
        city: { type: String, trim: true, maxlength: 100 },
        address: { type: String, trim: true, maxlength: 500 },
        postcode: { type: String, trim: true },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    role: {
      type: String,
      enum: ["user", "admin", "editor"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
      select: false,
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
        delete ret.password;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.pre("save", function (next) {
  this.updateTarikh = getPersianDate();
  next();
});

userSchema.pre(/^find/, function (next) {
  this.find({ isActive: { $ne: false } });
  next();
});

userSchema.virtual("orderCount").get(function () {
  return this.orders?.length || 0;
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Partial unique index: many OTP accounts have no email at all.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);
userSchema.index({ role: 1 });
userSchema.index({ "addresses.city": 1 });
userSchema.index({ "addresses.province": 1 });

const User = mongoose.model("User", userSchema);

module.exports = User;
