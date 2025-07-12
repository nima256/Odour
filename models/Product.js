const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const productSchema = mongoose.Schema(
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
    lilDescription: {
      type: String,
    },
    description: {
      type: String,
      required: true,
    },
    images: [
      {
        type: String,
      },
    ],
    price: {
      type: Number,
      default: 0,
    },
    offerPrice: {
      type: Number,
      default: null,
    },
    catName: {
      type: String,
      default: "",
    },
    brandName: {
      type: String,
      default: "",
    },
    catId: {
      type: String,
      default: "",
    },
    subCatId: {
      type: String,
      default: "",
    },
    subCat: {
      type: String,
      default: "",
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    countInStock: {
      type: Number,
      required: true,
    },
    rating: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    weight: {
      type: String,
      default: null,
    },
    reviewsNum: {
      type: Number,
    },
    colors: [
      {
        name: { type: String, required: true },
        rgb: { type: String, required: true },
      },
    ],
    btnColor: {
      type: String,
    },
    discount: {
      type: Number,
    },
    isNewProdcut: {
      type: Boolean,
      default: false,
    },
    sizes: [
      {
        size: { type: String, required: true },
        usage: { type: String, required: true },
      },
    ],
    isPopular: {
      type: Boolean,
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

productSchema.set("toJSON", {
  virtual: true,
});

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
