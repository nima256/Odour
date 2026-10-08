// SnappPay review scenario + automatic status reconciliation rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSnappPayOrderPayload,
  calculateOrderAmountsToman,
  countUnits,
  getCheckoutUnitPriceToman,
  recalculateOrderDiscountToman,
} = require("../services/orderPricing");
const { resolveSnappPayAction } = require("../services/snappPayReconciler");

const MINUTE = 60 * 1000;

// SnappPay test scenario: 1 regular product ×2, 1 special-price product ×1,
// a high-percentage discount code, then two updates and a full cancel.
const regular = {
  product: "p-regular",
  quantity: 2,
  priceAtPurchase: getCheckoutUnitPriceToman({ regularPrice: 30000, offerPrice: 0, paymentProvider: "snappay" }),
  hadProductDiscount: false,
  nameAtPurchase: "عطر قیمت عادی",
  categoryAtPurchase: "ادکلن",
  snappItemId: 11,
};
const special = {
  product: "p-special",
  quantity: 1,
  priceAtPurchase: getCheckoutUnitPriceToman({ regularPrice: 40000, offerPrice: 20000, paymentProvider: "snappay" }),
  hadProductDiscount: true,
  nameAtPurchase: "عطر تخفیف‌دار",
  categoryAtPurchase: "ادکلن",
  snappItemId: 22,
};
const discount = { type: "percent", amount: 50, code: "TEST50" };

test("سبد سناریوی تست اسنپ‌پی طبق فرمول total/amount ساخته می‌شود", () => {
  const products = [regular, special];
  const itemsAmount = 2 * 30000 + 30000; // special keeps 50% of its discount: 40000 → 30000
  assert.equal(special.priceAtPurchase, 30000);
  const discountAmount = Math.floor((itemsAmount * 50) / 100);
  const payload = buildSnappPayOrderPayload({
    _id: "order-scenario",
    products,
    taxAmount: 0,
    discountAmount,
    externalSourceAmount: 0,
    snappPay: { cartId: 99 },
  });

  const cart = payload.cartList[0];
  // totalAmount = Σ count × amount (+ shipping/tax when not included)
  const itemsIrr = cart.cartItems.reduce((sum, item) => sum + item.count * item.amount, 0);
  assert.equal(cart.totalAmount, itemsIrr);
  // amount = totalAmount − (discountAmount + externalSourceAmount)
  assert.equal(payload.amount, cart.totalAmount - payload.discountAmount - payload.externalSourceAmount);
  assert.equal(payload.amount, (itemsAmount - discountAmount) * 10);
  assert.equal(cart.isTaxIncluded, true);
  assert.equal(cart.isShipmentIncluded, true);
  assert.equal(cart.shippingAmount, 0);
  assert.equal("forcedPaymentMethodTypes" in payload, false);
  assert.deepEqual(
    cart.cartItems.map((item) => [item.id, item.count, item.amount]),
    [[11, 2, 300000], [22, 1, 300000]]
  );
});

test("آپدیت دو مرحله‌ای سناریو مبلغ را کاهش و تخفیف را درست بازمحاسبه می‌کند", () => {
  const initial = [regular, special];
  const initialDiscount = Math.floor((90000 * 50) / 100); // 45,000

  // Step 1: regular product 2 → 1
  const step1 = [{ ...regular, quantity: 1 }, special];
  const discount1 = recalculateOrderDiscountToman({
    discount: { ...discount, calculatedAmount: initialDiscount },
    previousProducts: initial,
    nextProducts: step1,
  });
  assert.equal(discount1, 30000);
  const amounts1 = calculateOrderAmountsToman({ products: step1, discountAmount: discount1 });
  assert.equal(amounts1.amount, 30000);
  assert.ok(amounts1.amount < 45000);

  // Step 2: remove the special-price product entirely
  const step2 = [{ ...regular, quantity: 1 }];
  const discount2 = recalculateOrderDiscountToman({
    discount: { ...discount, calculatedAmount: discount1 },
    previousProducts: step1,
    nextProducts: step2,
  });
  assert.equal(discount2, 15000);
  const amounts2 = calculateOrderAmountsToman({ products: step2, discountAmount: discount2 });
  assert.equal(amounts2.amount, 15000);

  // Only one unit left: update must be disabled, only cancel is allowed.
  assert.equal(countUnits(step2), 1);
});

test("تخفیف مبلغ ثابت در مرجوعی به نسبت ارزش کالا سرشکن می‌شود و مبلغ صفر نمی‌شود", () => {
  const previous = [
    { priceAtPurchase: 70000, quantity: 1 },
    { priceAtPurchase: 30000, quantity: 1 },
  ];
  const next = [{ priceAtPurchase: 70000, quantity: 1 }];
  const value = recalculateOrderDiscountToman({
    discount: { type: "amount", amount: 50000, calculatedAmount: 50000 },
    previousProducts: previous,
    nextProducts: next,
  });
  assert.equal(value, 35000);
  assert.ok(70000 - value > 0);
});

test("سقف تخفیف درصدی و قانون ODOUR256 در بازمحاسبه حفظ می‌شود", () => {
  const capped = recalculateOrderDiscountToman({
    discount: { type: "percent", amount: 50, calculatedAmount: 20000 },
    previousProducts: [{ priceAtPurchase: 100000, quantity: 2 }],
    nextProducts: [{ priceAtPurchase: 100000, quantity: 1 }],
  });
  assert.equal(capped, 20000);

  const odour = recalculateOrderDiscountToman({
    discount: { type: "percent", amount: 10, code: "odour256", calculatedAmount: 10000 },
    previousProducts: [
      { priceAtPurchase: 100000, quantity: 1 },
      { priceAtPurchase: 50000, quantity: 1, hadProductDiscount: true },
    ],
    nextProducts: [{ priceAtPurchase: 50000, quantity: 1, hadProductDiscount: true }],
  });
  assert.equal(odour, 0);
});

test("تصمیم‌های سرویس Get Payment Status مطابق فلوی بازیابی اسنپ‌پی است", () => {
  const fresh = 20 * MINUTE;
  const old = 2 * 60 * MINUTE;
  assert.equal(resolveSnappPayAction({ status: "SETTLE", ageMs: fresh }), "settled");
  assert.equal(resolveSnappPayAction({ status: "VERIFY", ageMs: fresh }), "settle");
  assert.equal(resolveSnappPayAction({ status: "PENDING", ageMs: fresh }), "verify");
  assert.equal(resolveSnappPayAction({ status: "PENDING", ageMs: old }), "expire");
  assert.equal(resolveSnappPayAction({ status: "CANCEL", ageMs: fresh }), "cancelled");
  assert.equal(resolveSnappPayAction({ status: "REVERT", ageMs: fresh }), "cancelled");
  assert.equal(resolveSnappPayAction({ status: "", ageMs: fresh }), "wait");
  assert.equal(resolveSnappPayAction({ status: "", ageMs: old }), "expire");
  // Even a very old order is settled, never expired, if SnappPay says it is paid.
  assert.equal(resolveSnappPayAction({ status: "settle", ageMs: old }), "settled");
});
