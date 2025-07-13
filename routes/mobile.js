const express = require("express");
const router = express.Router();
const https = require("https");
const Otp = require("../models/Otp");
const multer = require("multer");
const upload = multer();
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 OTP requests per windowMs
  message:
    "درخواست‌های ارسال کد بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر تلاش کنید",
  standardHeaders: true,
  legacyHeaders: false,
});

const validateMobile = [
  body("mobile")
    .trim()
    .isLength({ min: 11, max: 11 })
    .withMessage("شماره موبایل باید ۱۱ رقم باشد")
    .isNumeric()
    .withMessage("شماره موبایل باید عددی باشد"),
];

const validateOtp = [
  ...validateMobile,
  body("otp")
    .trim()
    .isLength({ min: 5, max: 5 })
    .withMessage("کد تأیید باید ۵ رقم باشد")
    .isNumeric()
    .withMessage("کد تأیید باید عددی باشد"),
];

const errorResponse = (res, status, message, details = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...details,
  });
};

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post("/sendOtp", otpLimiter, validateMobile, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, "خطا در اعتبارسنجی", {
        errors: errors.array(),
      });
    }

    const { mobile } = req.body;
    const otp = Math.floor(10000 + Math.random() * 90000).toString(); // 5-digit OTP
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes expiration

    await Otp.findOneAndUpdate(
      { mobile },
      {
        code: otp,
        expiresAt,
        attempts: 0, // Reset attempts on new OTP
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: "کد تأیید ارسال شد",
    });

    // const data = JSON.stringify({
    //   bodyId: 344616,
    //   to: mobile,
    //   args: [phoneNumber],
    // });

    // const options = {
    //   hostname: "console.melipayamak.com",
    //   port: 443,
    //   path: "/api/send/shared/b38b715606c847b491c032790a75c7d8",
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json; charset=utf-8",
    //     "Content-Length": Buffer.byteLength(data),
    //   },
    // };

    // const reqSms = https.request(options, async (smsRes) => {
    //   let responseData = "";
    //   smsRes.on("data", (d) => {
    //     responseData += d;
    //   });

    //   smsRes.on("end", async () => {
    //     if (smsRes.statusCode === 200) {
    //       // ذخیره OTP در MongoDB با انقضا 2 دقیقه
    //       const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

    //       await Otp.findOneAndUpdate(
    //         { mobile },
    //         { code: otp, expiresAt },
    //         { upsert: true, new: true }
    //       );

    //       return res
    //         .status(200)
    //         .json({ success: true, message: "کد تأیید ارسال شد" });
    //     } else {
    //       return res
    //         .status(500)
    //         .json({ success: false, message: "خطا در ارسال پیامک" });
    //     }
    //   });
    // });

    // reqSms.on("error", (error) => {
    //   console.error(error);
    //   return res
    //     .status(500)
    //     .json({ success: false, message: "خطا در اتصال به سامانه پیامک" });
    // });

    // reqSms.write(data, "utf8");
    // reqSms.end();
  } catch (error) {
    console.error("OTP Send Error:", error);
    return errorResponse(res, 500, "خطا در ارسال کد تأیید");
  }
});

router.post("/verifyOtp", validateOtp, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(res, 400, "خطا در اعتبارسنجی", {
        errors: errors.array(),
      });
    }

    const { mobile, otp } = req.body;
    const record = await Otp.findOne({ mobile });

    if (!record) {
      return errorResponse(res, 404, "کد تأیید برای این شماره یافت نشد");
    }

    if (new Date() > record.expiresAt) {
      await Otp.deleteOne({ mobile });
      return errorResponse(res, 400, "کد تأیید منقضی شده است");
    }

    if (record.attempts >= 3) {
      await Otp.deleteOne({ mobile });
      return errorResponse(
        res,
        429,
        "تعداد تلاش‌های شما بیش از حد مجاز است. لطفاً کد جدیدی دریافت کنید"
      );
    }

    if (record.code !== otp) {
      await Otp.updateOne({ mobile }, { $inc: { attempts: 1 } });

      const remainingAttempts = 3 - (record.attempts + 1);
      return errorResponse(res, 400, "کد تأیید اشتباه است", {
        remainingAttempts,
        message:
          remainingAttempts > 0
            ? `کد اشتباه است. ${remainingAttempts} تلاش باقی مانده`
            : "کد تأیید باطل شد. لطفاً کد جدیدی دریافت کنید",
      });
    }

    await Otp.deleteOne({ mobile });

    return res.status(200).json({
      success: true,
      message: "تأیید کد با موفقیت انجام شد",
      verified: true,
    });
  } catch (error) {
    console.error("OTP Verification Error:", error);
    return errorResponse(res, 500, "خطا در تأیید کد");
  }
});

module.exports = router;
