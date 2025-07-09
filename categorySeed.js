const mongoose = require("mongoose");
const Category = require("./models/Category");

mongoose
  .connect("mongodb://localhost:27017/odour")
  .then(async () => {
    console.log("Connected to Mongo");

    const categorySeeds = [
      {
        name: "آرایش صورت",
        slug: "آرایش-صورت",
        images: [],
        color: "",
        emoji: "💋",
      },
      {
        name: "مراقبت پوست",
        slug: "مراقبت-پوست",
        images: [],
        color: "",
        emoji: "✨",
      },
      {
        name: "مراقبت مو",
        slug: "مراقبت-مو",
        images: [],
        color: "",
        emoji: "💇‍♀️",
      },
      {
        name: "عطر و ادکلن",
        slug: "عطر-و-ادکلن",
        images: [],
        color: "",
        emoji: "☀️",
      },
    ];

    await Category.insertMany(categorySeeds);
    console.log("Category inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
