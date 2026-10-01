const https = require("https");

// Melipayamak shared-line pattern used for every verification SMS.
const OTP_BODY_ID = 347717;
const OTP_PATH = "/api/send/shared/b38b715606c847b491c032790a75c7d8";

// Local development only: print the code instead of sending an SMS.
// Never active in production, even if the flag is set.
const devLogOnly = () =>
  process.env.OTP_DEV_LOG === "true" && process.env.NODE_ENV !== "production";

function sendOtpSms(mobile, code) {
  if (devLogOnly()) {
    console.log(`[otp:dev] ${mobile} -> ${code}`);
    return Promise.resolve();
  }

  const data = JSON.stringify({ bodyId: OTP_BODY_ID, to: mobile, args: [code] });
  const options = {
    hostname: "console.melipayamak.com",
    port: 443,
    path: OTP_PATH,
    method: "POST",
    timeout: 10000,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`SMS provider responded with ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("SMS provider timeout")));
    req.on("error", reject);
    req.write(data, "utf8");
    req.end();
  });
}

module.exports = { sendOtpSms };
