const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const bcrypt = require("bcrypt");
const emailValidator = require("email-validator");

// Models
const User = require("../models/User");

// For access to req.body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post("/signUp", upload.none(), async (req, res) => {
    console.log("in signup")
  try {
    if (
      !req.body ||
      !req.body.fullName ||
      !req.body.mobile ||
      !req.body.email ||
      !req.body.password ||
      !req.body.confirmPassword
    ) {
      res
        .status(400)
        .json({ success: false, message: "لطفا تمام فیلد ها را پر کنید" });
      res.redirect("/");
      return;
    }

    const { fullName, mobile, email, password, confirmPassword } = req.body;
    const regex = /^[a-zA-Z0-9]+$/;
    const exsistUser = await User.findOne({ mobile });

    if (mobile.length < 11) {
      res.status(400).json({
        success: false,
        message: "شماره موبایل خود را درست وارد کنید",
      });
      res.redirect("/");
      return;
    }
    if (exsistUser) {
      res.status(409).json({
        success: false,
        message: "شماره موبایل وارد شده ثبت شده است لطفا وارد شوید",
      });
      res.redirect("/");
      return;
    }

    if (!emailValidator.validate(email)) {
      res.status(400).json({ success: false, message: "ایمیل شما معتبر نیست" });
      res.redirect("/");
      return;
    }

    if (password.length < 8) {
      res.status(400).json({
        success: false,
        message: "رمز عبور باید حداقل ۸ کاراکتر باشد",
      });
      res.redirect("/");
      return;
    }
    if (!regex.test(password)) {
      res.status(400).json({
        success: false,
        message: "رمز عبور باید شامل حروف انگلیسی و اعداد باشد",
      });
      res.redirect("/");
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({
        success: false,
        message: "رمز عبور شما با تکرار آن همخوانی ندارد",
      });
      res.redirect("/");
      return;
    }

    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);
    const user = new User({ fullName, mobile, email, password: hash });
    await user.save();

    return res
      .status(201)
      .json({ success: true, message: "عضویت شما با موفقیت انجام شد" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "خطا در عضویت" });
  }
});

router.post("/signIn", upload.none(), async (req, res) => {
  try {
    if (!req.body || !req.body.mobile || !req.body.password) {
      res
        .status(400)
        .json({ success: false, message: "لطفا تمام فیلد ها را پر کنید" });
      res.redirect("/");
      return;
    }

    const { mobile, password } = req.body;

    if (mobile.length < 11) {
      res.status(400).json({
        success: false,
        message: "شماره موبایل خود را درست وارد کنید",
      });
      res.redirect("/");
      return;
    }
    if (password.length < 8) {
      res.status(400).json({
        success: false,
        message: "رمز عبور باید حداقل ۸ کاراکتر باشد",
      });
      res.redirect("/");
      return;
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      res.status().json({
        success: false,
        message: "شماره موبایل یا رمز عبور شما اشتباه است",
      });
      res.redirect("/");
      return;
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status().json({
        success: false,
        message: "شماره موبایل یا رمز عبور شما اشتباه است",
      });
      res.redirect("/");
      return;
    }

    return res
      .status(201)
      .json({ success: true, message: "ورود شما با موفقیت انجام شد" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "خطا در ورود" });
  }
});

module.exports = router;
