const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { getPersianDate } = require("../helper/getPersianDate");

const orderSchema = new Schema({
  OrderNum: {
    type: String,
    required: true,
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
      type: Schema.Types.ObjectId,
      ref: "Product",
    },
  ],
  delivery: {
    type: String,
  },
  originalPrice: { type: Number },
  totalPrice: { type: Number, required: true },
  discount: {
    type: {
      type: String, // "percent" or "fixed"
    },
    amount: Number,
    code: String,
  },
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
