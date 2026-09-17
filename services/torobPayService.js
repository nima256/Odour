class TorobPayApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TorobPayApiError";
    this.httpStatus = options.httpStatus;
    this.errorCode = options.errorCode;
    this.responseBody = options.responseBody;
    this.isTimeout = Boolean(options.isTimeout);
    this.stage = options.stage;
  }
}

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBaseUrl = (value) =>
  String(value || "https://cpg.torobpay.com").trim().replace(/\/+$/, "");

const config = {
  baseUrl: normalizeBaseUrl(process.env.TOROBPAY_BASE_URL),
  clientId: String(process.env.TOROBPAY_CLIENT_ID || "").trim(),
  clientSecret: String(process.env.TOROBPAY_CLIENT_SECRET || "").trim(),
  username: String(process.env.TOROBPAY_USERNAME || "").trim(),
  password: String(process.env.TOROBPAY_PASSWORD || "").trim(),
  timeoutMs: parsePositiveInteger(process.env.TOROBPAY_TIMEOUT_MS, 30000),
};

const assertConfigured = () => {
  const missing = [];
  if (!config.clientId) missing.push("TOROBPAY_CLIENT_ID");
  if (!config.clientSecret) missing.push("TOROBPAY_CLIENT_SECRET");
  if (!config.username) missing.push("TOROBPAY_USERNAME");
  if (!config.password) missing.push("TOROBPAY_PASSWORD");

  if (missing.length) {
    throw new TorobPayApiError(`تنظیمات ترب‌پی ناقص است: ${missing.join(", ")}`, {
      httpStatus: 503,
      stage: "CONFIG",
    });
  }
};

const parseResponseText = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
};

const extractError = (body, statusCode, stage) => {
  const errorData = body?.error || body || {};
  const message =
    errorData?.user_message ||
    errorData?.message_user ||
    errorData?.message ||
    body?.message ||
    `خطا در ارتباط با ترب‌پی (HTTP ${statusCode})`;

  return new TorobPayApiError(message, {
    httpStatus: statusCode,
    errorCode: errorData?.code,
    responseBody: body,
    stage,
  });
};

const fetchJson = async (path, options = {}, stage = "API") => {
  assertConfigured();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    const body = await parseResponseText(response);
    if (!response.ok || body?.successful === false) {
      // فقط پاسخ خطا را لاگ می‌کنیم؛ هیچ credential یا access token چاپ نمی‌شود.
      console.error(`[TOROBPAY ${stage}] HTTP ${response.status}`, JSON.stringify(body));
      throw extractError(body, response.status, stage);
    }
    return body;
  } catch (error) {
    if (error instanceof TorobPayApiError) throw error;
    if (error?.name === "AbortError") {
      throw new TorobPayApiError("مهلت پاسخ‌گویی ترب‌پی به پایان رسید", {
        isTimeout: true,
        stage,
      });
    }
    throw new TorobPayApiError(error?.message || "خطا در ارتباط با ترب‌پی", {
      stage,
    });
  } finally {
    clearTimeout(timer);
  }
};

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let tokenPromise = null;

const authenticate = async ({ force = false } = {}) => {
  assertConfigured();

  const now = Date.now();
  if (!force && cachedToken && cachedTokenExpiresAt - now > 60_000) return cachedToken;
  if (!force && tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString(
      "base64"
    );

    // عین الگوی پروژه سالم cribflag: JSON + Basic Auth
    const response = await fetchJson(
      "/api/online/v1/oauth/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
        }),
      },
      "AUTH"
    );

    const accessToken = response?.access_token || response?.response?.access_token;
    if (!accessToken) {
      throw new TorobPayApiError("توکن دسترسی معتبر از ترب‌پی دریافت نشد", {
        responseBody: response,
        stage: "AUTH",
      });
    }

    cachedToken = accessToken;
    cachedTokenExpiresAt = Date.now() + 55 * 60 * 1000;
    return cachedToken;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
};

const apiRequest = async ({ method, path, json, retryAuth = true, stage = "API" }) => {
  const accessToken = await authenticate();

  try {
    return await fetchJson(
      path,
      {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      },
      stage
    );
  } catch (error) {
    if (retryAuth && error instanceof TorobPayApiError && error.httpStatus === 401) {
      cachedToken = null;
      cachedTokenExpiresAt = 0;
      await authenticate({ force: true });
      return apiRequest({ method, path, json, retryAuth: false, stage });
    }
    throw error;
  }
};

const unwrapResponse = (body) => body?.response ?? body;

const eligible = async (amountIrr) => {
  const amount = Math.round(Number(amountIrr));
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new TorobPayApiError("مبلغ بررسی صلاحیت ترب‌پی معتبر نیست", {
      httpStatus: 400,
      stage: "ELIGIBLE",
    });
  }

  const response = await apiRequest({
    method: "GET",
    path: `/api/online/offer/v1/eligible?amount=${encodeURIComponent(amount)}`,
    stage: "ELIGIBLE",
  });
  return unwrapResponse(response);
};

const createPaymentToken = async (payload) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/token",
    json: payload,
    stage: "PAYMENT_TOKEN",
  });
  return unwrapResponse(response);
};

const verify = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/verify",
    json: { paymentToken },
    stage: "VERIFY",
  });
  return unwrapResponse(response);
};

const settle = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/settle",
    json: { paymentToken },
    stage: "SETTLE",
  });
  return unwrapResponse(response);
};

const revert = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/revert",
    json: { paymentToken },
    stage: "REVERT",
  });
  return unwrapResponse(response);
};

const cancel = async (paymentToken) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/cancel",
    json: { paymentToken },
    stage: "CANCEL",
  });
  return unwrapResponse(response);
};

const update = async (payload) => {
  const response = await apiRequest({
    method: "POST",
    path: "/api/online/payment/v1/update",
    json: payload,
    stage: "UPDATE",
  });
  return unwrapResponse(response);
};

const getPaymentStatus = async (paymentToken) => {
  const response = await apiRequest({
    method: "GET",
    path: `/api/online/payment/v1/status?paymentToken=${encodeURIComponent(String(paymentToken))}`,
    stage: "STATUS",
  });
  return unwrapResponse(response);
};

const normalizeStatus = (value) => String(value || "").trim().toUpperCase();

const verifyAndSettle = async (paymentToken) => {
  try {
    const verified = await verify(paymentToken);
    try {
      const settled = await settle(paymentToken);
      return { ...verified, ...settled, status: "SETTLE" };
    } catch (settleError) {
      const statusResult = await getPaymentStatus(paymentToken);
      const status = normalizeStatus(statusResult?.status);
      if (status === "SETTLE") return { ...statusResult, status };
      if (status === "VERIFY") {
        const settled = await settle(paymentToken);
        return { ...statusResult, ...settled, status: "SETTLE" };
      }
      throw settleError;
    }
  } catch (verifyError) {
    const statusResult = await getPaymentStatus(paymentToken);
    const status = normalizeStatus(statusResult?.status);
    if (status === "SETTLE") return { ...statusResult, status };
    if (status === "VERIFY") {
      const settled = await settle(paymentToken);
      return { ...statusResult, ...settled, status: "SETTLE" };
    }
    throw verifyError;
  }
};

const isConfigured = () => {
  try {
    assertConfigured();
    return true;
  } catch (_) {
    return false;
  }
};

module.exports = {
  TorobPayApiError,
  cancel,
  config,
  createPaymentToken,
  eligible,
  getPaymentStatus,
  isConfigured,
  revert,
  settle,
  update,
  verify,
  verifyAndSettle,
};
