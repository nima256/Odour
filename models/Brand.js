const mongoose = require("mongoose");

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
  },
  { timestamps: true }
);

brandSchema.set("toJSON", {
  virtual: true,
});

const Brand = mongoose.model("Brand", brandSchema);
module.exports = Brand;
