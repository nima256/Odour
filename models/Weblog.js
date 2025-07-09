const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const weblogSchema = mongoose.Schema(
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
    desciption: {
      type: String,
    },
    weblogText: {
      type: String,
    },
    images: [
      {
        type: String,
      },
    ],
    author: {
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

weblogSchema.set("toJSON", {
  virtual: true,
});

const Weblog = mongoose.model("Weblog", weblogSchema);
module.exports = Weblog;
