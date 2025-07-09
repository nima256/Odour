const mongoose = require("mongoose");
const Brand = require("./models/Brand");

mongoose
  .connect("mongodb://localhost:27017/odour")
  .then(async () => {
    console.log("Connected to Mongo");

    const brandSeeds = [
      {
        name: "لورآل",
        slug: "لورآل",
        emoji: "✨",
      },
      {
        name: "شانل",
        slug: "شانل",
        emoji: "💎",
      },
      {
        name: "میبلین",
        slug: "میبلین",
        emoji: "🌟",
      },
      {
        name: "نیوآ",
        slug: "نیوآ",
        emoji: "💫",
      },
    ];

    await Brand.insertMany(brandSeeds);
    console.log("Brand inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
