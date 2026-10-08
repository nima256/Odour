const mongoose = require("mongoose");
const DiscountCode = require("./models/DiscountCode");

mongoose
  .connect("mongodb://odourir1_nima:pKyF61Enz8NK@localhost:27017/odourir1_odourDB")
  .then(async () => {
    console.log("Connected to Mongo");

    const discountCodeSeeds = [
      {
        code: "SUMMER2025",
        type: "percent",
        amount: 20,
        usageLimit: 100,
        usedCount: 15,
        isActive: true,
        expireDate: new Date("2027-09-01"),
        minOrderAmount: 300000,
        maxDiscountAmount: 50000,
      },
      {
        code: "WINTER2025",
        type: "percent",
        amount: 20,
        usageLimit: 100,
        usedCount: 15,
        isActive: true,
        expireDate: new Date("2027-09-01"),
        minOrderAmount: 200000,
        maxDiscountAmount: 40000,
      },
      {
        code: "VIP50000",
        type: "amount",
        amount: 50000,
        usageLimit: 50,
        usedCount: 5,
        isActive: true,
        expireDate: new Date("2027-12-31"),
      },
      {
        code: "EXPIRED10",
        type: "percent",
        amount: 10,
        usageLimit: 20,
        usedCount: 10,
        isActive: true,
        maxDiscountAmount: 40000,
        expireDate: new Date("2027-01-01"),
      },
      {
        code: "USED10",
        type: "percent",
        amount: 10,
        usageLimit: 10,
        usedCount: 10,
        isActive: true,
        maxDiscountAmount: 40000,
        expireDate: new Date("2027-12-31"),
      },
      {
        code: "DISABLED2025",
        type: "amount",
        amount: 30000,
        isActive: false,
        usageLimit: 100,
        usedCount: 0,
        expireDate: new Date("2027-08-01"),
      },
    ];

    await DiscountCode.insertMany(discountCodeSeeds);
    console.log("DiscountCode inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
