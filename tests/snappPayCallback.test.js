// Route-level tests for the SnappPay callback and the automatic status
// reconciliation, using in-memory fakes for the Order/User/Product models and
// the SnappPay API (no MongoDB or network needed).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");

// ---------------------------------------------------------------- fakes
const getPath = (obj, key) => key.split(".").reduce((value, part) => (value == null ? undefined : value[part]), obj);
const setPath = (obj, key, value) => {
  const parts = key.split(".");
  const last = parts.pop();
  const target = parts.reduce((value, part) => (value[part] ??= {}), obj);
  target[last] = value;
};
const matches = (doc, filter) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some((sub) => matches(doc, sub));
    const value = getPath(doc, key);
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      return Object.entries(condition).every(([op, operand]) => {
        if (op === "$ne") return value !== operand;
        if (op === "$lt") return value instanceof Date && value < operand;
        if (op === "$lte") return value instanceof Date && value <= operand;
        if (op === "$in") return operand.includes(value);
        if (op === "$exists") return operand ? value !== undefined : value === undefined;
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return String(value) === String(condition);
  });

const store = new Map();
const makeOrder = (fields) => {
  const doc = {
    paymentInfo: {},
    products: [],
    inventoryReserved: false,
    createdAt: new Date(),
    ...fields,
    snappPay: { processing: false, ...fields.snappPay },
    async save() {
      store.set(String(this._id), this);
      return this;
    },
  };
  store.set(String(doc._id), doc);
  return doc;
};
const FakeOrder = {
  async findOne(filter) {
    return [...store.values()].find((doc) => matches(doc, filter)) || null;
  },
  async findById(id) {
    return store.get(String(id)) || null;
  },
  async findOneAndUpdate(filter, update) {
    const doc = [...store.values()].find((item) => matches(item, filter));
    if (!doc) return null;
    for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
    return doc;
  },
  async updateOne() {},
  async deleteOne() {},
  find(filter) {
    const result = [...store.values()].filter((doc) => matches(doc, filter));
    const chain = {
      select: () => chain,
      sort: () => chain,
      limit: () => chain,
      lean: async () => result.map((doc) => ({ _id: doc._id })),
    };
    return chain;
  },
};

const calls = [];
const gateway = { status: new Map(), verifyFails: new Set() };
const fakeSnappPay = {
  isConfigured: () => true,
  config: {},
  async getPaymentStatus(token) {
    calls.push(["status", token]);
    return { status: gateway.status.get(token) || "PENDING", transactionId: undefined };
  },
  async verifyAndSettle(token) {
    calls.push(["verifyAndSettle", token]);
    if (gateway.verifyFails.has(token)) throw new Error("verify failed");
    gateway.status.set(token, "SETTLE");
    return { status: "SETTLE", transactionId: `TX-${token}` };
  },
  async settleWithStatusRecovery(token) {
    calls.push(["settle", token]);
    gateway.status.set(token, "SETTLE");
    return { status: "SETTLE" };
  },
  async verify(token) {
    calls.push(["verify", token]);
    return {};
  },
  async revert(token) {
    calls.push(["revert", token]);
    gateway.status.set(token, "REVERT");
    return {};
  },
};

const stub = (relativePath, exports) => {
  const resolved = require.resolve(path.join(__dirname, "..", relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub("models/Order.js", FakeOrder);
stub("models/User.js", { findById: async () => null });
stub("models/Product.js", { findOneAndUpdate: async () => null, findById: async () => null });
stub("services/snappPayService.js", fakeSnappPay);
stub("services/orderNotifications.js", { notifyRegisteredOrder: async () => {} });

const orderRouter = require("../routes/order");

let server;
let baseUrl;
test.before(async () => {
  const app = express();
  app.use((req, res, next) => {
    req.session = {};
    next();
  });
  app.use("/api/order", orderRouter);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => {
  calls.length = 0;
});

const callback = (fields) =>
  fetch(`${baseUrl}/api/order/snapp-pay/callback`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

const pendingOrder = (num, extra = {}) =>
  makeOrder({
    _id: `id-${num}`,
    OrderNum: num,
    paymentMethod: "اسنپ‌پی",
    status: "در انتظار پرداخت",
    paymentStatus: "پرداخت نشده",
    totalPrice: 15000,
    snappPay: { paymentToken: `tok-${num}`, transactionId: num, status: "PENDING" },
    ...extra,
  });

// ---------------------------------------------------------------- tests
test("callback موفق: verify/settle سیستمی و نمایش صفحه موفق", async () => {
  const order = pendingOrder("ORD-OK");
  const res = await callback({ transactionId: "ORD-OK", state: "OK", amount: "150000" });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /payment-success\?orderNum=ORD-OK/);
  assert.equal(order.paymentStatus, "پرداخت شده");
  assert.equal(order.status, "در حال پردازش");
  assert.equal(order.snappPay.status, "SETTLE");
  assert.equal(order.snappPay.processing, false);
  assert.deepEqual(calls, [["verifyAndSettle", "tok-ORD-OK"]]);
});

test("callback تکراری دوباره verify/settle نمی‌کند", async () => {
  const res = await callback({ transactionId: "ORD-OK", state: "OK", amount: "150000" });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /payment-success/);
  assert.equal(calls.length, 0);
});

test("callback بدون پارامتر amount هم با verify سرور تایید می‌شود", async () => {
  const order = pendingOrder("ORD-NOAMOUNT");
  const res = await callback({ transactionId: "ORD-NOAMOUNT", state: "OK" });
  assert.match(res.headers.get("location"), /payment-success/);
  assert.equal(order.paymentStatus, "پرداخت شده");
});

test("callback ناموفق پس از استعلام وضعیت سفارش را لغو می‌کند", async () => {
  const order = pendingOrder("ORD-FAIL");
  const res = await callback({ transactionId: "ORD-FAIL", state: "FAILED", amount: "150000" });
  assert.match(res.headers.get("location"), /payment-failed/);
  assert.equal(order.status, "لغو شده");
  assert.equal(order.paymentStatus, "لغو شده");
  assert.deepEqual(calls, [["status", "tok-ORD-FAIL"]]);
});

test("callback جعلی FAILED پرداخت تسویه‌شده را لغو نمی‌کند", async () => {
  const order = pendingOrder("ORD-FORGED");
  gateway.status.set("tok-ORD-FORGED", "VERIFY");
  const res = await callback({ transactionId: "ORD-FORGED", state: "FAILED" });
  assert.match(res.headers.get("location"), /payment-success/);
  assert.equal(order.paymentStatus, "پرداخت شده");
});

test("مبلغ دستکاری‌شده در callback تایید نمی‌شود و برای استعلام خودکار باز می‌ماند", async () => {
  const order = pendingOrder("ORD-TAMPER");
  const res = await callback({ transactionId: "ORD-TAMPER", state: "OK", amount: "10" });
  assert.match(res.headers.get("location"), /payment-failed/);
  assert.equal(order.status, "در انتظار پرداخت");
  assert.equal(order.paymentStatus, "نامشخص");
  assert.equal(order.snappPay.processing, false);
  assert.equal(calls.length, 0);
});

test("پرداخت دیرهنگام روی سفارش منقضی‌شده revert می‌شود", async () => {
  const order = pendingOrder("ORD-LATE", { status: "لغو شده", paymentStatus: "لغو شده" });
  const res = await callback({ transactionId: "ORD-LATE", state: "OK", amount: "150000" });
  assert.match(res.headers.get("location"), /payment-failed/);
  assert.deepEqual(calls, [["verify", "tok-ORD-LATE"], ["revert", "tok-ORD-LATE"]]);
  assert.equal(order.snappPay.status, "REVERT");
});

test("قفل پردازش هم‌زمان: callback دوم در حین پردازش 409 می‌گیرد", async () => {
  pendingOrder("ORD-LOCK", {}).snappPay.processing = true;
  store.get("id-ORD-LOCK").snappPay.processingStartedAt = new Date();
  const res = await callback({ transactionId: "ORD-LOCK", state: "OK", amount: "150000" });
  assert.equal(res.status, 409);
  assert.equal(calls.length, 0);
});

test("استعلام خودکار: کاربری که پرداخت کرده ولی برنگشته تسویه و سفارشش ثبت می‌شود", async () => {
  const old = new Date(Date.now() - 20 * 60 * 1000);
  const paid = pendingOrder("ORD-RECON-PAID", { createdAt: old });
  const settled = pendingOrder("ORD-RECON-VERIFY", { createdAt: old });
  gateway.status.set("tok-ORD-RECON-VERIFY", "VERIFY");
  const abandoned = pendingOrder("ORD-RECON-ABANDONED", { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
  gateway.verifyFails.add("tok-ORD-RECON-ABANDONED");
  const fresh = pendingOrder("ORD-RECON-FRESH");

  const stop = orderRouter.startSnappPayReconciler();
  stop();
  // Run one pass directly through the exported scheduler hook.
  const { reconcileOpenSnappPayOrders } = orderRouter;
  await reconcileOpenSnappPayOrders();

  assert.equal(paid.paymentStatus, "پرداخت شده");
  assert.equal(settled.paymentStatus, "پرداخت شده");
  assert.ok(calls.some(([name, token]) => name === "settle" && token === "tok-ORD-RECON-VERIFY"));
  assert.equal(abandoned.status, "لغو شده");
  assert.equal(fresh.status, "در انتظار پرداخت");
  assert.ok(!calls.some(([, token]) => token === "tok-ORD-RECON-FRESH"));
});
