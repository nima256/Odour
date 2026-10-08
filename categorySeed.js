const mongoose = require("mongoose");
const Category = require("./models/Category");

mongoose
  .connect("mongodb://localhost:27017/odour")
  .then(async () => {
    console.log("Connected to Mongo");

    const categorySeeds = [
      {
        categoryType: "product",
        name: "آرایش صورت",
        images: [],
        color: "#fce7f3",
        textColor: "#ec4899",
        emoji: "💋",
        imgSvgForHome: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      },
      {
        categoryType: "product",
        name: "مراقبت پوست",
        images: [],
        color: "#f3e8ff",
        textColor: "#a855f7",
        emoji: "✨",
        imgSvgForHome: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
      },
      {
        categoryType: "product",
        name: "مراقبت مو",
        images: [],
        color: "#d1fae5",
        textColor: "#10b981",
        emoji: "💇‍♀️",
        imgSvgForHome: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      },
      {
        categoryType: "product",
        name: "عطر و ادکلن",
        images: [],
        color: "#fef9c3",
        textColor: "#eab308",
        emoji: "☀️",
        imgSvgForHome: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      },
      {
        categoryType: "weblog",
        name: "مراقبت از پوست",
        images: [],
      },
      {
        categoryType: "weblog",
        name: "آرایشی",
        images: [],
      },
      {
        categoryType: "weblog",
        name: "مو",
        images: [],
      },
      {
        categoryType: "weblog",
        name: "زیبایی",
        images: [],
      },
    ];

    await Category.create(categorySeeds);
    console.log("Category inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
