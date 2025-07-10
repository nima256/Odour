const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const User = require("../models/User");
const { isLoggedIn } = require("../middlewares/isLoggedIn");
const multer = require("multer");
const upload = multer();

// For access to req.body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));



router.post("/", upload.none(), isLoggedIn, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { postcode, address, delivery } = req.body;

    if (!postcode || !address) {
      return res
        .status(400)
        .json({ success: false, message: "تمام فیلدهای لازم پر نشده است" });
    }

    const user = await User.findById(userId).populate("cart.productId");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "کاربر یافت نشد" });
    }

    if (!user.cart.length) {
      return res
        .status(400)
        .json({ success: false, message: "سبد خرید شما خالی است" });
    }

    const productIds = user.cart.map((item) => item.productId._id);

    const newOrder = new Order({
      OrderNum: req.session.OrderNum,
      postcode,
      address,
      user: userId,
      products: productIds,
      delivery: delivery || "",
      status: "در انتظار پرداخت",
    });

    await newOrder.save();

    user.cart = [];
    user.orders.push(newOrder._id);
    await user.save();

    res.json({
      success: true,
      message: "سفارش با موفقیت ثبت شد",
      orderId: newOrder._id,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res
      .status(500)
      .json({ success: false, message: "خطایی در ثبت سفارش رخ داد" });
  }
});

module.exports = router;
