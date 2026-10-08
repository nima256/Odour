const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");

class SnappPayApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SnappPayApiError";
    this.httpStatus = options.httpStatus;
    this.errorCode = options.errorCode;
    this.systemError = options.systemError;
    this.responseBody = options.responseBody;
    this.isTimeout = Boolean(options.isTimeout);
  }
}

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBaseUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }
  return url.endsWith("/") ? url : `${url}/`;
};

const config = {
  baseUrl: normalizeBaseUrl(process.env.SNAPPPAY_BASE_URL),
  clientId: String(process.env.SNAPPPAY_CLIENT_ID || "").trim(),
  clientSecret: String(process.env.SNAPPPAY_CLIENT_SECRET || "").trim(),
  username: String(process.env.SNAPPPAY_USERNAME || "").trim(),
  password: String(process.env.SNAPPPAY_PASSWORD || "").trim(),
  timeoutMs: parsePositiveInteger(process.env.SNAPPPAY_TIMEOUT_MS, 30000),
  // The documented eligible call only takes `amount` (official sample:
  // offer/v1/eligible?amount=40000). Extra filters are opt-in via env.
  paymentMethodTypes: String(process.env.SNAPPPAY_ELIGIBLE_PAYMENT_METHOD_TYPES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  paymentMethodTypeDto: String(
    process.env.SNAPPPAY_PAYMENT_METHOD_TYPE_DTO ?? "INSTALLMENT"
  ).trim(),
  installmentCount: parsePositiveInteger(process.env.SNAPPPAY_INSTALLMENT_COUNT, 4),
};

const assertConfigured = () => {
  const missing = [];
  if (!config.baseUrl) missing.push("SNAPPPAY_BASE_URL");
  if (!config.clientId) missing.push("SNAPPPAY_CLIENT_ID");
  if (!config.clientSecret) missing.push("SNAPPPAY_CLIENT_SECRET");
  if (!config.username) missing.push("SNAPPPAY_USERNAME");
  if (!config.password) missing.push("SNAPPPAY_PASSWORD");

  if (missing.length) {
    throw new SnappPayApiError(
      `تنظیمات اسنپ‌پی ناقص است: ${missing.join(", ")}`
    );
  }
};

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let tokenPromise = null;

const parseJsonSafely = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
};

const extractError = (body, statusCode) => {
  const errorData = body?.errorData || body?.error || body;
  const message =
    errorData?.message ||
    body?.message ||
    `خطا در ارتباط با اسنپ‌پی (HTTP ${statusCode})`;

  return new SnappPayApiError(message, {
    httpStatus: statusCode,
    errorCode: errorData?.errorCode,
    systemError: errorData?.systemError,
    responseBody: body,
  });
};

const rawRequest = ({
  method,
  path,
  headers = {},
  body,
  timeoutMs = config.timeoutMs,
}) =>
  new Promise((resolve, reject) => {
    assertConfigured();

    const target = new URL(path.replace(/^\//, ""), config.baseUrl);
    const transport = target.protocol === "http:" ? http : https;
    const payload = body === undefined || body === null ? null : String(body);

    const request = transport.request(
      target,
      {
        method,
        headers: {
          Accept: "application/json",
          ...headers,
          ...(payload
            ? { "Content-Length": Buffer.byteLength(payload, "utf8") }
            : {}),
        },
      },
      (response) => {
        let responseText = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseText += chunk;
        });
        response.on("end", () => {
          const responseBody = parseJsonSafely(responseText);
          const statusCode = response.statusCode || 500;

          if (statusCode < 200 || statusCode >= 300) {
            return reject(extractError(responseBody, statusCode));
          }

          resolve(responseBody);
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new SnappPayApiError("مهلت پاسخ‌گویی اسنپ‌پی به پایان رسید", {
          isTimeout: true,
        })
      );
    });

    request.on("error", (error) => {
      if (error instanceof SnappPayApiError) {
        return reject(error);
      }
      reject(
        new SnappPayApiError(error.message || "خطا در ارتباط با اسنپ‌پی", {
          isTimeout: error.code === "ETIMEDOUT",
        })
      );
    });

    if (payload) {
      request.write(payload, "utf8");
    }
    request.end();
  });

const authenticate = async ({ force = false } = {}) => {
  assertConfigured();

  const now = Date.now();
  if (!force && cachedToken && cachedTokenExpiresAt - now > 60000) {
    return cachedToken;
  }

  if (!force && tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    const form = new URLSearchParams({
      grant_type: "password",
      scope: "online-merchant",
      username: config.username,
      password: config.password,
    }).toString();

    const basicAuth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
      "utf8"
    ).toString("base64");

    const response = await rawRequest({
      method: "POST",
      path: "/api/online/v1/oauth/token",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    if (!response?.access_token) {
      throw new SnappPayApiError("توکن دسترسی معتبر از اسنپ‌پی دریافت نشد", {
        responseBody: response,
      });
    }

    const expiresInSeconds = parsePositiveInteger(response.expires_in, 3600);
    cachedToken = response.access_token;
    cachedTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    return cachedToken;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
};

const apiRequest = async ({ method, path, json, timeoutMs, retryAuth = true }) => {
  const accessToken = await authenticate();

  try {
    const response = await rawRequest({
      method,
      path,
      timeoutMs,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
    });

    if (response?.successful === false) {
      throw extractError(response, 400);
    }

    return response;
  } catch (error) {
    if (retryAuth && error.httpStatus === 401) {
      cachedToken = null;
      cachedTokenExpiresAt = 0;
      await authenticate({ force: true });
      return apiRequest({ method, path, json, timeoutMs, retryAuth: false });
    }
    throw error;
  }
};

const unwrapResponse = (body) => body?.response ?? body;

const eligible = async (amountIrr, paymentMethodTypes = config.paymentMethodTypes) => {
  const roundedAmountIrr = Math.round(amountIrr);
  const query = new URLSearchParams({ amount: String(roundedAmountIrr) });
  if (paymentMethodTypes?.length) {
    query.set("paymentMethodTypes", paymentMethodTypes.join(","));
  }

  const response = await apiRequest({
    method: "GET",
    path: `/api/online/offer/v1/eligible?${query.toString()}`,
  });
  return unwrapResponse(response);
};

// SnappPay review: `forcedPaymentMethodTypes` must never be sent to payment/v1/token.
// `paymentMethodTypeDto` (documented token/update field) is added here only, so
// it can be switched off with SNAPPPAY_PAYMENT_METHOD_TYPE_DTO= if ever required.
const stripForbiddenTokenFields = (payload = {}) => {
  const {
    forcedPaymentMethodTypes: _ignored,
    paymentMethodTypeDto: _dto,
    ...safePayload
  } = payload;
  return {
    ...safePayload,
    ...(config.paymentMethodTypeDto ? { paymentMethodTypeDto: config.paymentMethodTypeDto } : {}),
  };
};

const createPaymentToken = async (payload = {}) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/token",
    json: stripForbiddenTokenFields(payload),
  });
  return unwrapResponse(response);
};

const verify = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/verify",
    json: { paymentToken },
    timeoutMs: config.timeoutMs,
  });
  return unwrapResponse(response);
};

const settle = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/settle",
    json: { paymentToken },
    timeoutMs: config.timeoutMs,
  });
  return unwrapResponse(response);
};

// Revert is only valid between a successful verify and settle (e.g. the order can no
// longer be fulfilled). After settle, use update/cancel instead.
const revert = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/revert",
    json: { paymentToken },
  });
  return unwrapResponse(response);
};

const getPaymentStatus = async (paymentToken) => {
  const query = new URLSearchParams({ paymentToken });
  const response = await apiRequest({
    method: "GET",
    path: `/api/online/payment/v1/status?${query.toString()}`,
  });
  return unwrapResponse(response);
};

const update = async (payload) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/update",
    json: stripForbiddenTokenFields(payload),
  });
  return unwrapResponse(response);
};

const cancel = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/cancel",
    json: { paymentToken },
  });
  return unwrapResponse(response);
};

const normalizeStatus = (status) => String(status || "").trim().toUpperCase();

const getStatusAfterUnknownResponse = async (paymentToken, originalError) => {
  try {
    const statusResult = await getPaymentStatus(paymentToken);
    return {
      statusResult,
      status: normalizeStatus(statusResult?.status),
    };
  } catch (statusError) {
    originalError.statusRecoveryError = statusError;
    throw originalError;
  }
};

// SnappPay recovery flow:
// Settle -> no/unknown response -> status -> VERIFY => retry Settle, SETTLE => success.
const settleWithStatusRecovery = async (paymentToken) => {
  let lastSettleError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await settle(paymentToken);
      return { status: "SETTLE", ...result };
    } catch (settleError) {
      lastSettleError = settleError;
      const { statusResult, status } = await getStatusAfterUnknownResponse(
        paymentToken,
        settleError
      );

      if (status === "SETTLE") {
        return { ...statusResult, status };
      }

      if (status === "VERIFY" && attempt === 0) {
        continue;
      }

      throw settleError;
    }
  }

  throw lastSettleError;
};

// Verify -> no/unknown response -> status -> VERIFY => Settle, PENDING => retry Verify.
const verifyAndSettle = async (paymentToken) => {
  let verifyResult;
  let lastVerifyError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      verifyResult = await verify(paymentToken);
      break;
    } catch (verifyError) {
      lastVerifyError = verifyError;
      const { statusResult, status } = await getStatusAfterUnknownResponse(
        paymentToken,
        verifyError
      );

      if (status === "SETTLE") {
        return { ...statusResult, status };
      }

      if (status === "VERIFY") {
        return settleWithStatusRecovery(paymentToken);
      }

      if (status === "PENDING" && attempt === 0) {
        continue;
      }

      throw verifyError;
    }
  }

  if (!verifyResult) {
    throw lastVerifyError || new SnappPayApiError("وضعیت Verify اسنپ‌پی نامشخص است");
  }

  const settled = await settleWithStatusRecovery(paymentToken);
  return {
    ...settled,
    transactionId: settled.transactionId || verifyResult?.transactionId,
  };
};

const isConfigured = () => {
  try {
    assertConfigured();
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  SnappPayApiError,
  cancel,
  config,
  createPaymentToken,
  eligible,
  getPaymentStatus,
  isConfigured,
  revert,
  settle,
  settleWithStatusRecovery,
  update,
  verify,
  verifyAndSettle,
};
