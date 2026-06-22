// models/Admin.js
const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "نام کامل الزامی است"],
      trim: true,
      minlength: [3, "نام کامل نمی‌تواند کمتر از ۳ کاراکتر باشد"],
      maxlength: [50, "نام کامل نمی‌تواند بیشتر از ۵۰ کاراکتر باشد"],
    },
    email: {
      type: String,
      required: [true, "ایمیل الزامی است"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "رمز عبور الزامی است"],
      minlength: [8, "رمز عبور باید حداقل ۸ کاراکتر باشد"],
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "super_admin"],
      default: "admin",
    },
    permissions: {
      type: [String],
      default: [],
      enum: [
        'manage_products',
        'manage_orders', 
        'manage_users',
        'manage_categories',
        'manage_brands',
        'manage_discounts',
        'manage_weblogs',
        'view_analytics',
        'manage_admins'  // دسترسی مدیریت ادمین‌ها
      ]
    },
    lastLoginAt: {
      type: Date
    },
    lastLoginIP: {
      type: String
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    createdAt: {
      type: String,
      default: () => getPersianDate(),
    },
    updatedAt: {
      type: String,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.__v;
        delete ret.password;
        return ret;
      },
    },
  }
);

// هش کردن رمز عبور قبل از ذخیره
adminSchema.pre("save", async function (next) {
  this.updatedAt = getPersianDate();
  
  if (!this.isModified("password")) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// متد بررسی رمز عبور
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// متد بررسی دسترسی
adminSchema.methods.hasPermission = function(permission) {
  if (this.role === 'super_admin') return true;
  return this.permissions.includes(permission);
};

const Admin = mongoose.model("Admin", adminSchema);
module.exports = Admin;