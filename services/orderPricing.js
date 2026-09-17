const crypto = require("crypto");

const toNonNegativeInteger = (value, fieldName) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} باید یک عدد نامنفی باشد`);
  }
  return Math.round(number);
};

const tomanToIrr = (amountToman) =>
  toNonNegativeInteger(amountToman, "مبلغ تومان") * 10;

const irrToToman = (amountIrr) =>
  Math.round(toNonNegativeInteger(amountIrr, "مبلغ ریال") / 10);

const normalizeIranMobile = (mobile) => {
  const digits = String(mobile || "").replace(/\D/g, "");

  if (/^09\d{9}$/.test(digits)) {
    return `+98${digits.slice(1)}`;
  }

  if (/^989\d{9}$/.test(digits)) {
    return `+${digits}`;
  }

  if (/^9\d{9}$/.test(digits)) {
    return `+98${digits}`;
  }

  throw new Error("شماره موبایل برای اسنپ‌پی معتبر نیست");
};

const stableNumericId = (value) => {
  const digest = crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest();

  // Keep IDs inside signed 32-bit integer range and never return zero.
  return (digest.readUInt32BE(0) % 2147483646) + 1;
};

const getOrderItemPriceToman = (item) =>
  toNonNegativeInteger(item.priceAtPurchase, "قیمت محصول");

const hasSpecialPrice = (regularPrice, offerPrice) => {
  const regular = Number(regularPrice);
  const offer = Number(offerPrice);
  return Number.isFinite(regular) && regular >= 0 && Number.isFinite(offer) && offer > 0 && offer < regular;
};

// For installment gateways (SnappPay and TorobPay), keep 50% of the existing
// special-price discount. Example: regular 1,000,000 and offer 800,000 =>
// installment price 900,000 toman.
const getSnappPaySpecialPriceToman = (regularPrice, offerPrice) => {
  const regular = toNonNegativeInteger(regularPrice, "قیمت اصلی محصول");
  if (!hasSpecialPrice(regular, offerPrice)) return regular;

  const offer = toNonNegativeInteger(offerPrice, "قیمت ویژه محصول");
  const originalDiscount = regular - offer;
  const snappDiscount = Math.floor(originalDiscount / 2);
  return regular - snappDiscount;
};

const getCheckoutUnitPriceToman = ({ regularPrice, offerPrice, paymentProvider }) => {
  const regular = toNonNegativeInteger(regularPrice, "قیمت اصلی محصول");
  if (!hasSpecialPrice(regular, offerPrice)) return regular;

  const normalizedProvider = String(paymentProvider || "").toLowerCase();
  if (["snappay", "torobpay"].includes(normalizedProvider)) {
    return getSnappPaySpecialPriceToman(regular, offerPrice);
  }

  return toNonNegativeInteger(offerPrice, "قیمت ویژه محصول");
};

const calculateOrderAmountsToman = ({
  products,
  taxAmount = 0,
  discountAmount = 0,
  externalSourceAmount = 0,
}) => {
  const itemsAmount = (products || []).reduce((sum, item) => {
    const quantity = toNonNegativeInteger(item.quantity, "تعداد محصول");
    if (quantity < 1) {
      throw new Error("تعداد هر محصول باید حداقل یک باشد");
    }
    return sum + getOrderItemPriceToman(item) * quantity;
  }, 0);

  const tax = toNonNegativeInteger(taxAmount, "مالیات");
  const discount = toNonNegativeInteger(discountAmount, "تخفیف");
  const external = toNonNegativeInteger(
    externalSourceAmount,
    "مبلغ منبع خارجی"
  );

  // Shipping is cash-on-delivery and is never included in the online order amount.
  const cartTotal = itemsAmount + tax;
  const amount = cartTotal - discount - external;

  if (amount < 0) {
    throw new Error("مبلغ نهایی سفارش نمی‌تواند منفی باشد");
  }

  return {
    itemsAmount,
    taxAmount: tax,
    cartTotal,
    discountAmount: discount,
    externalSourceAmount: external,
    amount,
  };
};

const buildSnappPayCartItem = (item) => ({
  amount: tomanToIrr(getOrderItemPriceToman(item)),
  category: String(item.categoryAtPurchase || item.category || "عمومی").slice(
    0,
    100
  ),
  count: toNonNegativeInteger(item.quantity, "تعداد محصول"),
  id: Number(item.snappItemId) || stableNumericId(item.product || item._id),
  name: String(item.nameAtPurchase || item.name || "محصول").slice(0, 100),
  commissionType: Number(item.commissionType) || 100,
});


const buildTorobPayCartItem = (item) => ({
  id: String(item.product || item._id || item.snappItemId || "item"),
  name: String(item.nameAtPurchase || item.name || "محصول").slice(0, 250),
  count: toNonNegativeInteger(item.quantity, "تعداد محصول"),
  amount: tomanToIrr(getOrderItemPriceToman(item)),
  category: String(item.categoryAtPurchase || item.category || "عمومی").slice(0, 120),
  commissionType: 0,
});

const buildTorobPayOrderPayload = (order, options = {}) => {
  const products = options.products || order.products || [];
  const amounts = calculateOrderAmountsToman({
    products,
    taxAmount: options.taxAmount ?? order.taxAmount ?? 0,
    discountAmount: options.discountAmount ?? order.discountAmount ?? 0,
    externalSourceAmount:
      options.externalSourceAmount ?? order.externalSourceAmount ?? 0,
  });

  const user = options.user || order.user || {};
  const mobile = String(options.mobile || user.mobile || "").trim();
  const customerName = String(
    options.customerName || user.fullName || order.customerName || "مشتری"
  ).trim();

  return {
    amount: tomanToIrr(amounts.amount),
    discountAmount: tomanToIrr(amounts.discountAmount),
    externalSourceAmount: tomanToIrr(amounts.externalSourceAmount),
    mobile,
    paymentMethodTypeDto: "ONLINE_CREDIT",
    returnURL: String(options.returnURL || ""),
    transactionId: String(order.OrderNum || order._id || ""),
    cartList: [
      {
        cartId: String(order.OrderNum || order._id || ""),
        totalAmount: tomanToIrr(amounts.cartTotal),
        taxAmount: tomanToIrr(amounts.taxAmount),
        shippingAmount: 0,
        isTaxIncluded: false,
        // هزینه ارسال این فروشگاه آنلاین دریافت نمی‌شود و در مبلغ ترب‌پی نیست.
        isShipmentIncluded: false,
        cartItems: products.map(buildTorobPayCartItem),
      },
    ],
    address: String(options.address ?? order.address ?? "").trim(),
    postalCode: String(options.postalCode ?? order.postcode ?? "").trim(),
    name_full_customer: customerName,
    city: String(options.city ?? order.city ?? "").trim(),
    province: String(options.province ?? order.province ?? "").trim(),
    number_phone_registration: mobile,
  };
};

const buildSnappPayOrderPayload = (order, options = {}) => {
  const products = options.products || order.products || [];
  const amounts = calculateOrderAmountsToman({
    products,
    taxAmount: options.taxAmount ?? order.taxAmount ?? 0,
    discountAmount: options.discountAmount ?? order.discountAmount ?? 0,
    externalSourceAmount:
      options.externalSourceAmount ?? order.externalSourceAmount ?? 0,
  });

  const cartItems = products.map(buildSnappPayCartItem);
  const cartId =
    Number(order.snappPay?.cartId) || stableNumericId(order._id || order.OrderNum);

  return {
    amount: tomanToIrr(amounts.amount),
    cartList: [
      {
        cartId,
        cartItems,
        // Shipping is paid to the carrier on delivery; SnappPay receives no shipping fee.
        isShipmentIncluded: true,
        // SnappPay guideline: product/cart amounts are sent tax-inclusive.
        isTaxIncluded: true,
        shippingAmount: 0,
        taxAmount: tomanToIrr(amounts.taxAmount),
        totalAmount: tomanToIrr(amounts.cartTotal),
      },
    ],
    discountAmount: tomanToIrr(amounts.discountAmount),
    externalSourceAmount: tomanToIrr(amounts.externalSourceAmount),
  };
};

module.exports = {
  buildSnappPayOrderPayload,
  buildTorobPayOrderPayload,
  calculateOrderAmountsToman,
  getCheckoutUnitPriceToman,
  getSnappPaySpecialPriceToman,
  hasSpecialPrice,
  irrToToman,
  normalizeIranMobile,
  stableNumericId,
  tomanToIrr,
};
