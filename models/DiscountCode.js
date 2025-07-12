const mongoose = require("mongoose");

const discountCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ["percent", "amount"], required: true }, // percent: درصدی، amount: عددی
    amount: { type: Number, required: true },
    usageLimit: { type: Number }, // چند بار قابل استفاده است
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    expireDate: { type: Date },
    minOrderAmount: { type: Number }, // مبلغ حداقل سفارش برای استفاده از کد
    maxDiscountAmount: { type: Number }, // سقف تخفیف درصدی
  },
  { timestamps: true }
);

module.exports = mongoose.model("DiscountCode", discountCodeSchema);
