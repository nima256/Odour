const crypto = require("crypto");

const TOROB_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAt6Mu4T0pBORY11W+QeM35UsmLO3vsf+6yKpFDEImFk0=
-----END PUBLIC KEY-----`;

const decodeBase64UrlJson = (value) => {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  return JSON.parse(decoded);
};

const audienceMatches = (claim, expected) => {
  if (Array.isArray(claim)) return claim.includes(expected);
  return claim === expected;
};

const verifyTorobJwt = (token, expectedAudience, nowSeconds = Math.floor(Date.now() / 1000)) => {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Missing Torob token");
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeBase64UrlJson(encodedHeader);
  const payload = decodeBase64UrlJson(encodedPayload);

  if (header.alg !== "EdDSA") throw new Error("Invalid JWT algorithm");
  if (header.v !== undefined && Number(header.v) !== 1) {
    throw new Error("Unsupported JWT version");
  }

  const isValidSignature = crypto.verify(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    TOROB_PUBLIC_KEY,
    Buffer.from(encodedSignature, "base64url")
  );
  if (!isValidSignature) throw new Error("Invalid JWT signature");

  const clockTolerance = 5;
  if (!Number.isFinite(Number(payload.exp)) || nowSeconds > Number(payload.exp) + clockTolerance) {
    throw new Error("JWT has expired");
  }
  if (!Number.isFinite(Number(payload.nbf)) || nowSeconds + clockTolerance < Number(payload.nbf)) {
    throw new Error("JWT is not active yet");
  }
  if (!audienceMatches(payload.aud, expectedAudience)) {
    throw new Error("Invalid JWT audience");
  }

  return payload;
};

const torobAuth = (req, res, next) => {
  // فقط برای تست محلی قابل غیرفعال‌سازی است؛ روی سرور اصلی غیرفعال نکنید.
  if (String(process.env.TOROB_AUTH_DISABLED || "").toLowerCase() === "true") {
    return next();
  }

  const tokenVersion = req.get("X-Torob-Token-Version");
  const token = req.get("X-Torob-Token");
  if (tokenVersion !== "1" || !token) {
    return res.status(401).json({ error: "Unauthorized Torob request" });
  }

  const expectedAudience = String(
    process.env.TOROB_EXPECTED_AUDIENCE || req.get("host") || ""
  ).trim();

  try {
    req.torobTokenPayload = verifyTorobJwt(token, expectedAudience);
    return next();
  } catch (error) {
    console.warn("Torob JWT validation failed:", error.message);
    return res.status(401).json({ error: "Unauthorized Torob request" });
  }
};

module.exports = {
  TOROB_PUBLIC_KEY,
  verifyTorobJwt,
  torobAuth,
};
