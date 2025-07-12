const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { getPersianDate } = require("../helper/getPersianDate");

const orderSchema = new Schema({
  OrderNum: {
    type: String,
    required: true,
    unique: true,
  },
  postcode: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  products: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
      quantity: Number,
    },
  ],
  delivery: {
    type: String,
    enum: [
      "تیپاکس",
      "چاپار",
      "ایران-پیام",
    ],
    default: "تیپاکس",
  },
  originalPrice: { type: Number },
  totalPrice: { type: Number, required: true },
  discount: {
    type: { type: String, enum: ["percent", "amount"] },
    amount: Number,
    calculatedAmount: Number,
    code: String,
    originalValue: String,
  },
  discountAmount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: [
      "در انتظار پرداخت",
      "در حال پردازش",
      "بسته بندی شده",
      "در حال ارسال",
      "تحویل داده شد",
      "لغو شده",
    ],
    default: "در انتظار پرداخت",
  },
  createTarikh: {
    type: String,
    default: () => getPersianDate(),
  },
  updateTarikh: {
    type: String,
  },
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
