const mongoose = require("mongoose");

const discountCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  type: { type: String, enum: ["percent", "fixed"], default: "percent" },
  amount: { type: Number, required: true },
  expireDate: { type: Date },
  usageLimit: { type: Number }, 
  usedCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});

module.exports = mongoose.model("DiscountCode", discountCodeSchema);
