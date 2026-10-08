const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSnappPayOrderPayload,
  buildTorobPayOrderPayload,
  calculateOrderAmountsToman,
  getTorobPaySurchargeToman,
  normalizeIranMobile,
  stableNumericId,
  tomanToIrr,
} = require("../services/orderPricing");

test("محاسبه مبلغ سفارش بدون هزینه ارسال مطابق فرمول اسنپ‌پی است", () => {
  const result = calculateOrderAmountsToman({
    products: [
      { quantity: 2, priceAtPurchase: 30000 },
      { quantity: 1, priceAtPurchase: 20000 },
    ],
    taxAmount: 5000,
    discountAmount: 7000,
    externalSourceAmount: 3000,
  });

  assert.deepEqual(result, {
    itemsAmount: 80000,
    taxAmount: 5000,
    cartTotal: 85000,
    discountAmount: 7000,
    externalSourceAmount: 3000,
    amount: 75000,
  });
});

test("payload هزینه ارسال را صفر و خارج از مبلغ پرداخت نگه می‌دارد", () => {
  const payload = buildSnappPayOrderPayload({
    _id: "order-1",
    products: [
      {
        product: "product-1",
        quantity: 2,
        priceAtPurchase: 40000,
        nameAtPurchase: "محصول تست",
        categoryAtPurchase: "عطر",
        commissionType: 100,
        snappItemId: 123,
      },
    ],
    taxAmount: 0,
    discountAmount: 5000,
    externalSourceAmount: 0,
    snappPay: { cartId: 456 },
  });

  assert.equal(payload.amount, 750000);
  assert.equal(payload.cartList[0].totalAmount, 800000);
  assert.equal(payload.cartList[0].shippingAmount, 0);
  assert.equal(payload.cartList[0].cartItems[0].amount, 400000);
  assert.equal(payload.cartList[0].cartItems[0].count, 2);
  assert.equal(payload.discountAmount, 50000);
  assert.equal(payload.cartList[0].isShipmentIncluded, true);
  assert.equal(payload.cartList[0].isTaxIncluded, true);
});


test("ارزش افزوده ترب‌پی ۱۲ درصد مبلغ قابل پرداخت است", () => {
  assert.equal(getTorobPaySurchargeToman(1000000), 120000);
  assert.equal(getTorobPaySurchargeToman(833333), 100000);
});

test("شماره موبایل ایران به قالب مورد انتظار اسنپ‌پی تبدیل می‌شود", () => {
  assert.equal(normalizeIranMobile("09123456789"), "+989123456789");
  assert.equal(normalizeIranMobile("989123456789"), "+989123456789");
  assert.throws(() => normalizeIranMobile("02112345678"));
});

test("شناسه عددی پایدار و مبلغ ریالی معتبر تولید می‌شود", () => {
  assert.equal(stableNumericId("abc"), stableNumericId("abc"));
  assert.ok(stableNumericId("abc") > 0);
  assert.equal(tomanToIrr(12345), 123450);
});


test("payload ترب‌پی فیلدهای مستندات و مبالغ ریالی را درست می‌سازد", () => {
  const payload = buildTorobPayOrderPayload(
    {
      OrderNum: "ORD-75945109",
      products: [
        {
          product: "product-1",
          quantity: 2,
          priceAtPurchase: 40000,
          nameAtPurchase: "عطر تست",
          categoryAtPurchase: "عطر",
        },
      ],
      taxAmount: 0,
      discountAmount: 5000,
      externalSourceAmount: 0,
      address: "تهران، خیابان تست، پلاک ۱۰",
      postcode: "1234567890",
      province: "تهران",
      city: "تهران",
    },
    {
      user: { fullName: "کاربر تست", mobile: "09123456789" },
      returnURL: "https://www.odour.ir/api/order/torob-pay/callback",
    }
  );

  assert.equal(payload.amount, 750000);
  assert.equal(payload.discountAmount, 50000);
  assert.equal(payload.paymentMethodTypeDto, "ONLINE_CREDIT");
  assert.equal(payload.transactionId, "ORD-75945109");
  assert.equal(payload.mobile, "09123456789");
  assert.equal(payload.name_full_customer, "کاربر تست");
  assert.equal(payload.number_phone_registration, "09123456789");
  assert.equal(payload.city, "تهران");
  assert.equal(payload.province, "تهران");
  assert.equal(payload.cartList.length, 1);
  assert.equal(payload.cartList[0].cartId, "ORD-75945109");
  assert.equal(payload.cartList[0].totalAmount, 800000);
  assert.equal(payload.cartList[0].shippingAmount, 0);
  assert.equal(payload.cartList[0].isShipmentIncluded, false);
  assert.equal(payload.cartList[0].cartItems[0].amount, 400000);
  assert.equal(payload.cartList[0].cartItems[0].count, 2);
  assert.equal(payload.cartList[0].cartItems[0].commissionType, 0);
});
