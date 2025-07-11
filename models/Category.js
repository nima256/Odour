const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const categorySchema = mongoose.Schema(
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
    images: [
      {
        type: String,
      },
    ],
    color: {
      type: String,
    },
    textColor: {
      type: String,
    },
    parentId: {
      type: String,
    },
    emoji: {
      type: String,
    },
    imgSvgForHome: {
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

categorySchema.set("toJSON", {
  virtual: true,
});

const Category = mongoose.model("Category", categorySchema);
module.exports = Category;
