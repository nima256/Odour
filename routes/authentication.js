const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const bcrypt = require("bcrypt");
const emailValidator = require("email-validator");
const { body, validationResult } = require("express-validator");

// Models
const User = require("../models/User");
const { isLoggedIn } = require("../middlewares/isLoggedIn");

const errorResponse = (res, status, message, details = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...details,
  });
};

const validateSignUp = [
  body("fullName").trim().notEmpty().withMessage("نام کامل الزامی است"),
  body("mobile")
    .trim()
    .isLength({ min: 11, max: 11 })
    .withMessage("شماره موبایل باید ۱۱ رقم باشد")
    .isNumeric()
    .withMessage("شماره موبایل باید عددی باشد"),
  body("email")
    .trim()
    .isEmail()
    .withMessage("ایمیل معتبر نیست")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 8 })
    .withMessage("رمز عبور باید حداقل ۸ کاراکتر باشد")
    .matches(/^[a-zA-Z0-9]+$/)
    .withMessage("رمز عبور باید شامل حروف انگلیسی و اعداد باشد"),
  body("confirmPassword")
    .custom((value, { req }) => value === req.body.password)
    .withMessage("رمز عبور و تکرار آن مطابقت ندارند"),
];

router.post("/signUp", upload.none(), validateSignUp, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, "خطا در اعتبارسنجی", {
        errors: errors.array(),
      });
    }

    if (req.session.userId) {
      return errorResponse(res, 403, "شما قبلا وارد شده اید");
    }

    const { fullName, mobile, email, password } = req.body;

    const existingUser = await User.findOne({ $or: [{ mobile }, { email }] });
    if (existingUser) {
      const conflictField =
        existingUser.mobile === mobile ? "شماره موبایل" : "ایمیل";
      return errorResponse(res, 409, `${conflictField} قبلا ثبت شده است`);
    }

    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);

    const user = new User({
      fullName,
      mobile,
      email,
      password: hash,
    });
    await user.save();

    req.session.userId = user._id;

    return res.status(201).json({
      success: true,
      message: "عضویت شما با موفقیت انجام شد",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("SignUp Error:", error);

    if (error.code === 11000) {
      return errorResponse(res, 409, "کاربری با این مشخصات قبلا ثبت شده است");
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      return errorResponse(res, 400, "خطا در اعتبارسنجی داده‌ها");
    }

    return errorResponse(res, 500, "خطای سرور در هنگام ثبت نام");
  }
});

const validateSignIn = [
  body("mobile")
    .trim()
    .isLength({ min: 11, max: 11 })
    .withMessage("شماره موبایل باید ۱۱ رقم باشد")
    .isNumeric()
    .withMessage("شماره موبایل باید عددی باشد"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("رمز عبور باید حداقل ۸ کاراکتر باشد"),
];

router.post("/signIn", upload.none(), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, "خطا در اعتبارسنجی", {
        errors: errors.array(),
      });
    }

    if (req.session.userId) {
      return errorResponse(res, 403, "شما قبلا وارد شده اید");
    }

    const { mobile, password } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return errorResponse(res, 401, "شماره موبایل یا رمز عبور اشتباه است");
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return errorResponse(res, 401, "شماره موبایل یا رمز عبور اشتباه است");
    }

    req.session.userId = user._id;

    return res.status(200).json({
      success: true,
      message: "ورود شما با موفقیت انجام شد",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("SignIn Error:", error);
    return errorResponse(res, 500, "خطای سرور در هنگام ورود");
  }
});

// Add password reset routes
router.post("/forgot-password", async (req, res) => {
  // Implement using user.createPasswordResetToken()
});

router.patch("/reset-password/:token", async (req, res) => {
  // Implement password reset logic
});

module.exports = router;
