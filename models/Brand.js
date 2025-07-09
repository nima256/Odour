const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const brandSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    emoji: {
      type: String,
    },
    createTarikh: {
      type: String,
      default: () => getPersianDate(),
    },
    updateTarikh: {
      type: String,
    },
  },
  { timestamps: true }
);

brandSchema.set("toJSON", {
  virtual: true,
});

const Brand = mongoose.model("Brand", brandSchema);
module.exports = Brand;
