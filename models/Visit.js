const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const visitSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "",
    },
    visitorId: {
      type: String,
      required: true,
      index: true,
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    referer: {
      type: String,
    },
    visitDate: {
      type: String,
      default: () => getPersianDate(),
    },
    visitTimestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

const Visit = mongoose.model("Visit", visitSchema);

module.exports = Visit;