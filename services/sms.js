const https = require("https");

// Melipayamak shared-line credentials already used by the project for OTP.
const OTP_BODY_ID = 347717;
const SMS_API_KEY = String(
  process.env.SMS_API_KEY || "b38b715606c847b491c032790a75c7d8"
).trim();

// Local development only: print the message instead of sending an SMS.
// Never active in production, even if the flag is set.
const devLogOnly = () =>
  process.env.OTP_DEV_LOG === "true" && process.env.NODE_ENV !== "production";

function sendSharedSms(mobile, bodyId, args) {
  const recipient = String(mobile || "").trim();
  const patternId = Number(bodyId);
  const normalizedArgs = Array.isArray(args) ? args.map((value) => String(value ?? "").trim()) : [];

  if (!/^09\d{9}$/.test(recipient)) {
    return Promise.reject(new Error("Invalid SMS destination"));
  }
  if (!Number.isSafeInteger(patternId) || patternId <= 0 || !Array.isArray(args)) {
    return Promise.reject(new Error("Invalid SMS pattern configuration"));
  }

  if (devLogOnly()) {
    console.log(`[sms:dev] bodyId=${patternId} to=${recipient} args=${normalizedArgs.join(",")}`);
    return Promise.resolve({ development: true });
  }

  if (!SMS_API_KEY) return Promise.reject(new Error("SMS provider is not configured"));

  const data = JSON.stringify({ bodyId: patternId, to: recipient, args: normalizedArgs });
  const options = {
    hostname: "console.melipayamak.com",
    port: 443,
    path: `/api/send/shared/${encodeURIComponent(SMS_API_KEY)}`,
    method: "POST",
    timeout: 10000,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => {
        if (responseBody.length < 4096) responseBody += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`SMS provider responded with ${res.statusCode}`));
        }

        if (!responseBody) return resolve({ accepted: true });
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed && parsed.recId) return resolve({ recId: String(parsed.recId) });
          if (parsed && parsed.status && !parsed.recId) {
            return reject(new Error(`SMS provider rejected message: ${String(parsed.status).slice(0, 150)}`));
          }
          return resolve({ accepted: true });
        } catch (_) {
          return resolve({ accepted: true });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("SMS provider timeout")));
    req.on("error", reject);
    req.write(data, "utf8");
    req.end();
  });
}

function sendOtpSms(mobile, code) {
  return sendSharedSms(mobile, OTP_BODY_ID, [code]);
}

module.exports = { sendOtpSms, sendSharedSms };
