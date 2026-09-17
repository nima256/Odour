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
const https = require("https");


// Models
const User = require("../models/User");
const Admin = require("../models/Admins");
const RecentAction = require("../models/RecentAction");
const { isLoggedIn } = require("../middlewares/isLoggedIn");

const errorResponse = (res, status, message, details = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...details,
  });
};

const regenerateSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });

const saveSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// اگر از express-validator استفاده می‌کنید، مطمئن شوید:
const validateSignUp = [
  body('fullName').notEmpty().withMessage('نام کامل الزامی است'),
  body('mobile').matches(/^09\d{9}$/).withMessage('شماره موبایل نامعتبر است'),
  body('email').isEmail().withMessage('ایمیل نامعتبر است'),
  body('password').isLength({ min: 8 }).withMessage('رمز عبور باید حداقل ۸ کاراکتر باشد'),
  // ... سایر اعتبارسنجی‌ها
];

router.post("/signUp", upload.none(), validateSignUp, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array()); // اضافه کنید
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

    await regenerateSession(req);
    req.session.userId = user._id;
    await saveSession(req);

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

router.post("/signIn", upload.none(), validateSignIn, async (req, res) => {
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

    await regenerateSession(req);
    req.session.userId = user._id;
    await saveSession(req);

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
    const now = new Date();

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

    const existingOtp = await Otp.findOne({
      mobile,
      purpose: "password_reset",
      expiresAt: { $gt: new Date() }
    });

    if (existingOtp) {
      return res.status(400).json({
        success: false,
        message: "کد تأیید قبلی هنوز معتبر است. لطفاً منتظر بمانید.",
      });
    }


    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    
    await Otp.findOneAndUpdate(
      { mobile, purpose: "password_reset" },
      {
        code: otp,
        expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
        purpose: "password_reset",
      },
      { upsert: true, new: true }
    );


    const data = JSON.stringify({
      bodyId: 347717,
      to: mobile,
      args: [otp],
    });

    const options = {
      hostname: "console.melipayamak.com",
      port: 443,
      path: "/api/send/shared/b38b715606c847b491c032790a75c7d8",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const reqSms = https.request(options, async (smsRes) => {
      let responseData = "";
      smsRes.on("data", (d) => {
        responseData += d;
      });

      smsRes.on("end", async () => {
        if (smsRes.statusCode === 200) {
          // ذخیره OTP در MongoDB با انقضا 2 دقیقه
          const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

          await Otp.findOneAndUpdate(
            { mobile },
            {
              code: otp,
              expiresAt,
              attempts: 0,
              lastSentAt: now,
              purpose: "password_reset",
            },
            { upsert: true, new: true }
          );

          return res.status(200).json({
            success: true,
            message: "کد تأیید برای بازیابی رمز عبور ارسال شد",
            otp,
          });
        } else {
          return res
            .status(500)
            .json({ success: false, message: "خطا در ارسال پیامک" });
        }
      });
    });

    reqSms.on("error", (error) => {
      console.error(error);
      Otp.deleteOne({ mobile, purpose: "password_reset" }).catch(console.error);
      return res
        .status(500)
        .json({ success: false, message: "خطا در اتصال به سامانه پیامک" });
    });

    reqSms.write(data, "utf8");
    reqSms.end();
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

router.post("/admin/logout", async (req, res) => {
  try {
    if (req.session.adminId) {
      const admin = await Admin.findById(req.session.adminId);
      if (admin) {
        const recentAction = new RecentAction({
          action: 'admin_logout',
          targetType: 'admin',
          targetId: admin._id,
          targetName: admin.fullName,
          adminId: admin._id,
          adminName: admin.fullName,
          ipAddress: req.ip
        });
        await recentAction.save();
      }
    }
    
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "خطا در خروج از سیستم"
        });
      }
      res.clearCookie('sessionId');
      return res.status(200).json({
        success: true,
        message: "با موفقیت خارج شدید"
      });
    });
  } catch (error) {
    console.error("Admin logout error:", error);
    return res.status(500).json({
      success: false,
      message: "خطا در خروج از سیستم"
    });
  }
});

router.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
        
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "ایمیل و رمز عبور الزامی است"
      });
    }
    
    // پیدا کردن ادمین با select password
    const admin = await Admin.findOne({ email }).select('+password');
       
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "ایمیل یا رمز عبور اشتباه است"
      });
    }
    
    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: "حساب کاربری شما غیرفعال شده است"
      });
    }
    
    // بررسی رمز عبور
    const isValidPassword = await admin.comparePassword(password);
        
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "ایمیل یا رمز عبور اشتباه است"
      });
    }
    
    // بروزرسانی آخرین لاگین
    admin.lastLoginAt = new Date();
    admin.lastLoginIP = req.ip;
    await admin.save();
    
    // ذخیره در سشن
    req.session.adminId = admin._id;
    req.session.adminRole = admin.role;

    const recentAction = new RecentAction({
      action: 'admin_login',
      targetType: 'admin',
      targetId: admin._id,
      targetName: admin.fullName,
      adminId: admin._id,
      adminName: admin.fullName,
      ipAddress: req.ip
    });
    await recentAction.save();

    
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          success: false,
          message: "خطا در ایجاد نشست کاربری"
        });
      }
      
      return res.status(200).json({
        success: true,
        message: "ورود موفقیت‌آمیز بود",
        admin: {
          id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions
        }
      });
    });
    
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      success: false,
      message: "خطا در ورود به سیستم",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// خروج ادمین
router.post("/logout", async (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "خطا در خروج از سیستم"
        });
      }
      res.clearCookie('sessionId');
      return res.status(200).json({
        success: true,
        message: "با موفقیت خارج شدید"
      });
    });
  } catch (error) {
    console.error("Admin logout error:", error);
    return res.status(500).json({
      success: false,
      message: "خطا در خروج از سیستم"
    });
  }
});


module.exports = router;
