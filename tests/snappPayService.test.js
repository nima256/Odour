const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { URL } = require("node:url");

let server;
let requests = [];
const settleAttempts = new Map();
const verifyAttempts = new Map();

const readBody = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });

const sendJson = (res, value) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};

test.before(async () => {
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });

    if (req.url === "/api/online/v1/oauth/token") {
      return sendJson(res, { access_token: "test-token", expires_in: 3600 });
    }

    if (req.url.startsWith("/api/online/offer/v1/eligible")) {
      return sendJson(res, {
        successful: true,
        response: { eligible: true, title: "اعتباری", description: "توضیح" },
      });
    }

    if (req.url === "/api/online/payment/v1/token") {
      return sendJson(res, {
        successful: true,
        response: {
          paymentToken: "pay-token",
          paymentPageUrl: "https://example.test/pay",
        },
      });
    }

    if (req.url === "/api/online/payment/v1/update") {
      const parsed = body ? JSON.parse(body) : {};
      return sendJson(res, {
        successful: true,
        response: { transactionId: "ORD-1", amount: parsed.amount },
      });
    }

    if (req.url === "/api/online/payment/v1/cancel") {
      return sendJson(res, {
        successful: true,
        response: { transactionId: "ORD-1", status: "CANCEL" },
      });
    }

    const parsedBody = body ? JSON.parse(body) : {};
    const paymentToken = parsedBody.paymentToken;

    if (req.url === "/api/online/payment/v1/verify") {
      const attempts = (verifyAttempts.get(paymentToken) || 0) + 1;
      verifyAttempts.set(paymentToken, attempts);

      if (paymentToken === "recover-verify") {
        return sendJson(res, {
          successful: false,
          errorData: { message: "verify response lost" },
        });
      }

      if (paymentToken === "pending-retry" && attempts === 1) {
        return sendJson(res, {
          successful: false,
          errorData: { message: "first verify response lost" },
        });
      }

      if (paymentToken === "pending-then-verify" && attempts <= 2) {
        return sendJson(res, {
          successful: false,
          errorData: { message: "verify response lost" },
        });
      }

      return sendJson(res, {
        successful: true,
        response: { transactionId: "ORD-1" },
      });
    }

    if (req.url === "/api/online/payment/v1/settle") {
      const attempts = (settleAttempts.get(paymentToken) || 0) + 1;
      settleAttempts.set(paymentToken, attempts);

      if (paymentToken === "recover-settle") {
        return sendJson(res, {
          successful: false,
          errorData: { message: "settle response lost" },
        });
      }

      if (paymentToken === "retry-settle" && attempts === 1) {
        return sendJson(res, {
          successful: false,
          errorData: { message: "first settle response lost" },
        });
      }

      return sendJson(res, {
        successful: true,
        response: { transactionId: "ORD-1" },
      });
    }

    if (req.url.startsWith("/api/online/payment/v1/status")) {
      const target = new URL(req.url, "http://127.0.0.1");
      const token = target.searchParams.get("paymentToken");
      let status = "SETTLE";
      if (token === "recover-verify" || token === "retry-settle") {
        status = "VERIFY";
      } else if (token === "pending-retry") {
        status = "PENDING";
      } else if (token === "pending-then-verify") {
        status = (verifyAttempts.get(token) || 0) >= 2 ? "VERIFY" : "PENDING";
      }
      return sendJson(res, {
        successful: true,
        response: { transactionId: "ORD-1", status, amount: 1000 },
      });
    }

    res.statusCode = 404;
    return sendJson(res, { message: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.SNAPPPAY_BASE_URL = `http://127.0.0.1:${server.address().port}/`;
  process.env.SNAPPPAY_CLIENT_ID = "client";
  process.env.SNAPPPAY_CLIENT_SECRET = "secret";
  process.env.SNAPPPAY_USERNAME = "user";
  process.env.SNAPPPAY_PASSWORD = "pass";
  process.env.SNAPPPAY_PAYMENT_METHOD_TYPES = "INSTALLMENT";
  delete require.cache[require.resolve("../services/snappPayService")];
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("احراز هویت، eligible، token و verify/settle اجرا می‌شوند", async () => {
  const service = require("../services/snappPayService");
  const eligibility = await service.eligible(100000);
  assert.equal(eligibility.eligible, true);

  const token = await service.createPaymentToken({
    amount: 100000,
    forcedPaymentMethodTypes: ["INSTALLMENT"],
  });
  assert.equal(token.paymentToken, "pay-token");
  const tokenRequest = requests.find(
    (request) => request.url === "/api/online/payment/v1/token"
  );
  assert.deepEqual(JSON.parse(tokenRequest.body), { amount: 100000 });

  const settled = await service.verifyAndSettle("pay-token");
  assert.equal(settled.status, "SETTLE");
  assert.equal(settled.transactionId, "ORD-1");

  const authRequest = requests.find(
    (request) => request.url === "/api/online/v1/oauth/token"
  );
  assert.ok(authRequest.headers.authorization.startsWith("Basic "));
  assert.match(authRequest.body, /grant_type=password/);
  assert.ok(
    requests.some((request) => request.url === "/api/online/payment/v1/verify")
  );
  assert.ok(
    requests.some((request) => request.url === "/api/online/payment/v1/settle")
  );
});

test("status، update و cancel با endpointهای اسنپ‌پی اجرا می‌شوند", async () => {
  const service = require("../services/snappPayService");

  const status = await service.getPaymentStatus("pay-token");
  assert.equal(status.status, "SETTLE");

  const updated = await service.update({ paymentToken: "pay-token", amount: 90000 });
  assert.equal(updated.transactionId, "ORD-1");
  assert.equal(updated.amount, 90000);

  const cancelled = await service.cancel("pay-token");
  assert.equal(cancelled.status, "CANCEL");

  const updateRequest = requests.find((request) => request.url === "/api/online/payment/v1/update");
  assert.ok(updateRequest);
  assert.deepEqual(JSON.parse(updateRequest.body), { paymentToken: "pay-token", amount: 90000 });

  const cancelRequest = requests.find((request) => request.url === "/api/online/payment/v1/cancel");
  assert.ok(cancelRequest);
  assert.deepEqual(JSON.parse(cancelRequest.body), { paymentToken: "pay-token" });
});

test("اگر پاسخ verify نامشخص باشد، status و سپس settle اجرا می‌شود", async () => {
  const service = require("../services/snappPayService");
  const settled = await service.verifyAndSettle("recover-verify");

  assert.equal(settled.status, "SETTLE");
  assert.ok(
    requests.some(
      (request) =>
        request.url.includes("/api/online/payment/v1/status") &&
        request.url.includes("recover-verify")
    )
  );
  assert.equal(settleAttempts.get("recover-verify"), 1);
});

test("اگر پاسخ settle نامشخص باشد، وضعیت SETTLE از status پذیرفته می‌شود", async () => {
  const service = require("../services/snappPayService");
  const settled = await service.verifyAndSettle("recover-settle");

  assert.equal(settled.status, "SETTLE");
  assert.ok(
    requests.some(
      (request) =>
        request.url.includes("/api/online/payment/v1/status") &&
        request.url.includes("recover-settle")
    )
  );
});

test("اگر status در Verify برابر PENDING باشد، Verify دوباره اجرا می‌شود", async () => {
  const service = require("../services/snappPayService");
  const settled = await service.verifyAndSettle("pending-retry");

  assert.equal(settled.status, "SETTLE");
  assert.equal(verifyAttempts.get("pending-retry"), 2);
});

test("اگر Verify دوم هم پاسخ نامشخص بدهد و status به VERIFY برسد، Settle اجرا می‌شود", async () => {
  const service = require("../services/snappPayService");
  const settled = await service.verifyAndSettle("pending-then-verify");

  assert.equal(settled.status, "SETTLE");
  assert.equal(verifyAttempts.get("pending-then-verify"), 2);
  assert.equal(settleAttempts.get("pending-then-verify"), 1);
});

test("اگر status در Settle برابر VERIFY باشد، Settle یک بار دیگر اجرا می‌شود", async () => {
  const service = require("../services/snappPayService");
  const settled = await service.verifyAndSettle("retry-settle");

  assert.equal(settled.status, "SETTLE");
  assert.equal(settleAttempts.get("retry-settle"), 2);
});

