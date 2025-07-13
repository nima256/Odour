const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: function (v) {
          return /^09\d{9}$/.test(v); // Iranian mobile format (09xxxxxxxxx)
        },
        message: (props) => `${props.value} شماره موبایل معتبر نیست`,
      },
    },
    code: {
      type: String,
      required: true,
      minlength: 5,
      maxlength: 5,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: "2m" }, // Auto-delete after 2 minutes
    },
    attempts: {
      type: Number,
      default: 0,
      max: 3, // Maximum allowed attempts
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    ipAddress: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

otpSchema.index({ mobile: 1, code: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 120 });

module.exports = mongoose.model("Otp", otpSchema);
