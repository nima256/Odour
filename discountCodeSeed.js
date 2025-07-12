const mongoose = require("mongoose");
const DiscountCode = require("./models/DiscountCode");

mongoose
  .connect("mongodb://localhost:27017/odour")
  .then(async () => {
    console.log("Connected to Mongo");

    const discountCodeSeeds = [
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

    await DiscountCode.insertMany(discountCodeSeeds);
    console.log("DiscountCode inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
