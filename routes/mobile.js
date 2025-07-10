const express = require("express");
const router = express.Router();
const https = require("https");
const Otp = require("../models/Otp");
const multer = require("multer");
const upload = multer();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post("/sendOtp", async (req, res) => {
  const { mobile } = req.body;
  if (!mobile || mobile.length !== 11) {
    return res
      .status(400)
      .json({ success: false, message: "شماره معتبر نیست" });
  }
  const otp = Math.floor(10000 + Math.random() * 90000).toString(); // 5 رقمی

  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

  await Otp.findOneAndUpdate(
    { mobile },
    { code: otp, expiresAt },
    { upsert: true, new: true }
  );

  return res.status(200).json({ success: true, message: "کد تأیید ارسال شد" });

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
});

router.post("/verifyOtp", async (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res
      .status(400)
      .json({ success: false, message: "اطلاعات ناقص است" });
  }

  const record = await Otp.findOne({ mobile });

  if (!record) {
    return res.status(400).json({ success: false, message: "کدی یافت نشد" });
  }

  if (new Date() > record.expiresAt) {
    await Otp.deleteOne({ mobile });
    return res
      .status(400)
      .json({ success: false, message: "کد منقضی شده است" });
  }

  if (record.code !== otp) {
    return res
      .status(400)
      .json({ success: false, message: "کد وارد شده اشتباه است" });
  }

  // تأیید موفق
  await Otp.deleteOne({ mobile });

  return res
    .status(200)
    .json({ success: true, message: "تایید کد با موفقیت انجام شد" });
});

module.exports = router;
