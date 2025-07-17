const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const bcrypt = require("bcrypt");
const emailValidator = require("email-validator");
const { body, validationResult } = require("express-validator");
const crypto = require("crypto");
const { promisify } = require("util");
const jwt = require("jsonwebtoken");
const Otp = require("../models/Otp");

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

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

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

    const user = await User.findOne({ mobile }).select("+password");
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
router.post("/forgotPassword", async (req, res) => {
  try {
    // 1. Get user based on mobile number
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "لطفاً شماره موبایل خود را وارد کنید",
      });
    }

    const user = await User.findOne({ mobile });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "کاربری با این شماره موبایل یافت نشد",
      });
    }

    // 2. Generate OTP and save it
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiration

    await Otp.findOneAndUpdate(
      { mobile },
      {
        code: otp,
        expiresAt,
        attempts: 0,
        purpose: "password_reset",
      },
      { upsert: true, new: true }
    );

    // 3. Send OTP to user's mobile (you'll need to implement this)
    // For now, we'll just return the OTP for testing
    return res.status(200).json({
      success: true,
      message: "کد تأیید برای بازیابی رمز عبور ارسال شد",
      otp: process.env.NODE_ENV === "development" ? otp : undefined, // Only return OTP in development
    });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    return res.status(500).json({
      success: false,
      message: "خطا در انجام عملیات بازیابی رمز عبور",
    });
  }
});

// Verify OTP for Password Reset
router.post("/verifyPasswordResetOtp", async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: "شماره موبایل و کد تأیید الزامی هستند",
      });
    }

    // 1. Find the OTP record
    const otpRecord = await Otp.findOne({
      mobile,
      purpose: "password_reset",
    });

    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        message: "کد تأیید یافت نشد یا منقضی شده است",
      });
    }

    // 2. Check if OTP is expired
    if (new Date() > otpRecord.expiresAt) {
      await Otp.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: "کد تأیید منقضی شده است",
      });
    }

    // 3. Check if OTP matches
    if (otpRecord.code !== otp) {
      await Otp.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });

      const remainingAttempts = 3 - (otpRecord.attempts + 1);

      if (remainingAttempts <= 0) {
        await Otp.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({
          success: false,
          message:
            "تعداد تلاش‌های شما به پایان رسید. لطفاً کد جدیدی دریافت کنید",
        });
      }

      return res.status(400).json({
        success: false,
        message: `کد تأیید اشتباه است. ${remainingAttempts} تلاش باقی مانده`,
      });
    }

    // 4. If everything is OK, generate a password reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Save the token to user document
    await User.findOneAndUpdate(
      { mobile },
      {
        passwordResetToken: hashedToken,
        passwordResetExpires: Date.now() + 10 * 60 * 1000, // 10 minutes
      }
    );

    // 5. Delete the OTP record
    await Otp.deleteOne({ _id: otpRecord._id });

    return res.status(200).json({
      success: true,
      message: "کد تأیید صحیح است",
      resetToken: resetToken,
    });
  } catch (err) {
    console.error("Verify OTP Error:", err);
    return res.status(500).json({
      success: false,
      message: "خطا در تأیید کد",
    });
  }
});

router.patch("/resetPassword/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "لطفاً رمز عبور جدید را وارد کنید",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "رمز عبور باید حداقل ۸ کاراکتر باشد",
      });
    }

    // 1. Hash the token to compare with stored token
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // 2. Find user by token and check expiration
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "توکن نامعتبر یا منقضی شده است",
      });
    }

    // 3. Hash the new password before saving
    const hashedPassword = await bcrypt.hash(password, 12); // 12 is the salt rounds

    // 4. Update password and clear reset token
    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordChangedAt = Date.now();
    await user.save();

    // 5. Log the user in (optional - send JWT)
    const authToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    return res.status(200).json({
      success: true,
      message: "رمز عبور با موفقیت تغییر یافت اکنون وارد شوید",
      token: authToken,
      data: {
        user: {
          _id: user._id,
          fullName: user.fullName,
          mobile: user.mobile,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error("Reset Password Error:", err);
    return res.status(500).json({
      success: false,
      message: "خطا در تغییر رمز عبور",
    });
  }
});

module.exports = router;
