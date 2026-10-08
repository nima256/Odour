# SnappPay integration — compliance report (branch `odour-snappay`)

Sources used (the only material available for this pass):

- **[MSG]** SnappPay support messages (activation steps, test scenario, review items 1–8, follow-ups).
- **[PDF-6]** Screenshot of the integration doc, section 6 "روش پرداخت اسنپ‌پی به چه صورت در سایت باید نمایش داده شود؟".
- **[PDP-PDF]** "Snapp!Pay PDP Guidelines.pdf" (UI Component / افقی).
- **[KIT]** `Gateway_Samples--New_Logo.rar` — new logo set (16/24/32/40 px, SVG + @2x/@3x) and two gateway samples.
- **[STAGE]** `odour-stage.txt` — staging base URL + credentials.

Not available to me: the full API PDF (pages 19–21 on Get Payment Status), and the two Aparat videos
(blocked from this environment). API shapes below follow the existing integration, the sample
payload SnappPay quoted, and the documented SnappPay Online API v1 endpoints.

Legend: ✅ implemented and verified here · 🟡 implemented, needs staging / SnappPay confirmation · ⛔ needs you or SnappPay.

## 1. Review items SnappPay rejected

| # | Requirement (source) | Where | Verified by | Status |
|---|---|---|---|---|
| 1 | `isTaxIncluded` must be `true` [MSG review #1] | `services/orderPricing.js` `buildSnappPayOrderPayload` | `tests/snappPayCompliance.test.js`, `tests/orderPricing.test.js` | ✅ |
| 2 | Never send `forcedPaymentMethodTypes` to `payment/v1/token` [MSG #2] | `services/snappPayService.js` `stripForbiddenTokenFields` (token **and** update) | `tests/snappPayService.test.js` (exact request body) | ✅ |
| 3 | Test cart: one regular-price product ×2 [MSG #3] | Test scenario, see §5 | `tests/snappPayCompliance.test.js` (scenario cart) | ⛔ you run it on staging |
| 4 | PDP per guideline; **no eligible call on PDP** [MSG #4, PDP-PDF] | `views/ProductDetails.ejs`, `public/css/odour.css` (`.od-snapppay-pdp`) | Screenshots + computed-style measurements (§3) | ✅ |
| 5 | Gateway: title + description **dynamic** from eligible, **two lines beside the logo** [MSG #5, follow-ups] | `views/Cart.ejs` (`#snapp-pay-option`), `public/js/checkout.js` | Screenshots at 320/375/768/1440, measurements | ✅ (320 px: see limits) |
| 5b | "فقط دسکریپشن رو نمایش میدید. تایتل چی شد؟" — title was missing | `checkout.js` now requires `title_message`; no static fallback text anywhere | code + screenshots | ✅ |
| 5c | Use the **new logo** on checkout [MSG follow-up, KIT] | `public/images/snapp-pay/logo-*.svg` (byte-identical to KIT); old flat logo deleted | md5 match, `currentSrc` in measurements | ✅ |
| 6 | Apply a discount code on the test order [MSG #6] | existing coupon flow; discount sent as `discountAmount` | scenario test (50 % code) | ⛔ run on staging |
| 7 | Perform update + cancel on the test order [MSG #7] | `routes/admin.js` `/orders/:id/snappay/update` & `/cancel`, `views/AdminPanel.ejs` | scenario test of both update steps; route logic | ⛔ run on staging |
| 8 | Get Payment Status implemented per doc pp. 19–21, **automatically in code** [MSG #8, activation list] | `services/snappPayService.js` (`verifyAndSettle`, `settleWithStatusRecovery`), `services/snappPayReconciler.js`, `routes/order.js` `reconcileSnappPayOrder`, started in `index.js` | `tests/snappPayService.test.js` (recovery), `tests/snappPayCallback.test.js` (reconciler) | 🟡 logic verified; pp. 19–21 not provided to me |

## 2. Technical requirements

| Requirement (source) | Where | Verified | Status |
|---|---|---|---|
| Amount formula: `total = Σ count×amount (+shipping/tax if not included)`, `amount = total − (discount + externalSource)` [MSG formula] | `orderPricing.js` | scenario test asserts both equations on the real payload | ✅ |
| Eligible called with the final cart amount, only `?amount=` like SnappPay's sample [MSG, PDF-6 #2/#6] | `snappPayService.eligible` (no extra query params by default), `/api/order/snapp-pay/eligible` | request URL asserted in test | ✅ |
| Eligible re-called whenever the amount changes [PDF-6 #6] | `checkout.js` `render()` → `scheduleEligibility()` on qty change, remove item, coupon apply/remove, payment-method change | code review | ✅ |
| Show gateway only when `eligible === true`, hide when `false` (e.g. < 4,000 or > 10,000,000 toman on staging) [PDF-6 #2, #4] | server returns `eligible` verbatim; client hides otherwise; server re-checks eligible before creating the token | code + tests | ✅ |
| No manual eligibility logic in our code [PDF-6 #3] | no generic min/max; only Odour's own ODOUR256 business rule remains (pre-existing) | code review | 🟡 see "Business rules" |
| verify and settle called **by the system**, not manually [MSG check #2] | callback → `verifyAndSettle`; reconciler for customers who never return | callback tests | ✅ |
| Transaction ID shown to the customer after success [MSG check #3] | `views/PaymentSuccess.ejs` "شناسه تراکنش اسنپ‌پی" | screenshot `payment-success-mobile-375.png` | ✅ |
| Transaction ID visible + searchable in admin orders, admin acts on the order from there [MSG check #3] | admin list shows it under the order no.; search box matches `snappPay.transactionId`; detail modal shows it + **payment token** | code review | ✅ |
| Update can run several times; cancel works on an updated order [MSG check #4] | update keeps status `SETTLE`; cancel only requires `SETTLE` | scenario test (two updates) | ✅ |
| Confirmation popup before every update/cancel [MSG] | `AdminPanel.ejs` confirm dialogs list each change; server rejects calls without `confirmed: true` | code review | ✅ |
| When only one item is left, update is disabled and only cancel remains [MSG final scenario] | UI disables the button with explanation; server rejects update when units ≤ 1 | `countUnits` test + route guard | ✅ |
| Discount handled correctly on partial returns | `recalculateOrderDiscountToman`: percent codes recomputed (cap and ODOUR256 rule kept), fixed codes pro-rated; amount never 0 | tests | ✅ |
| `payment/v1/update` payload | full cart (`amount`, `cartList`, `discountAmount`, `externalSourceAmount`, `paymentMethodTypeDto`) + `paymentToken` | code; previous version dropped `externalSourceAmount` | 🟡 confirm on staging |
| `paymentMethodTypeDto: "INSTALLMENT"` on token/update | service-level, switchable via `SNAPPPAY_PAYMENT_METHOD_TYPE_DTO=` | request body test | 🟡 confirm on staging |
| Duplicate callbacks / concurrent processing are idempotent | atomic `snappPay.processing` lock (with stale-lock expiry) in callback, reconciler and admin update/cancel | callback tests (duplicate, 409 on concurrent) | ✅ |
| Callback data is untrusted | amount mismatch never settles (left for status reconciliation); a `FAILED` callback is confirmed with Get Payment Status before cancelling | callback tests (tampered amount, forged FAILED) | ✅ |
| Late payment on an expired/cancelled order | verify → **revert** (new `revert` endpoint) | callback test | ✅ |
| Inventory | reserved at order creation; released on failure/expiry/cancel; returned items restocked on update | existing + tests | ✅ |
| Secrets server-side only | `.env` (git-ignored); nothing in frontend | code review | ✅ |

## 3. Branding / UI measurements

Measured in headless Chromium on the real EJS views (`docs/snappay/screenshots/measurements.json`).

| Element | Guideline | 320 px | 375 px | 768 px | 1440 px |
|---|---|---|---|---|---|
| PDP logo (official asset) | ≥ 24 px [PDP-PDF ①] | 32 (`logo-32x32.svg`) | 32 | 40 (`logo-40x40.svg`) | 40 |
| PDP title "هر قسط با اسنپ‌پی: X تومان" | > 12 px, Bold, #1A1C23 [②] | 13 / 700 / #1A1C23 | 13 | 14 | 14 |
| PDP subtitle "۴ قسط ماهانه. بدون سود، چک و ضامن." | > 10 px, Regular, #616475 [③] | 11 / 400 / #616475 | 11 | 12 | 12 |
| Checkout logo | new logo [KIT] | 32 | 32 | 40 | 40 |
| Checkout title (`title_message`) | dynamic, line 1 | 13 / 700 | 13, one line | 14, one line | 14, one line |
| Checkout description (`description`) | dynamic, line 2 | 11 / 400 | 11, one line | 12, one line | 12, one line |
| Horizontal overflow | — | 0 | 0 | 0 | 0 |

The PDP uses the two-line component drawn in the PDF on every device (no trailing dot after
"تومان", which the PDF only uses in the one-line desktop variant).

## 4. Limitations and open questions

1. **320 px phones:** the dynamic title "پرداخت قسطی و اعتباری با اسنپ‌پی" needs ~200 px at 13 px. A 320 px screen leaves ~176 px, so the title wraps onto a second line there. Going smaller would break the "> 12 px" rule. 375 px and wider are exactly two lines.
2. **Staging not reachable from this sandbox** (egress blocked, and SnappPay whitelists your server IP). No live SnappPay call was made. Everything was tested against mocks that follow the documented contracts.
3. **Shipping:** Odour collects shipping on delivery, so nothing is charged online. The payload sends `isShipmentIncluded: true, shippingAmount: 0`, which matches the sample SnappPay quoted. If you start charging shipping online, it must be added to the cart.
4. **Business rules to confirm with SnappPay before the demo:**
   - Special-price items cost more with SnappPay (the customer keeps only 50 % of the special discount).
   - ODOUR256 requires more than 3,000,000 toman for SnappPay.

   Both rules already existed. SnappPay may treat a different price for its users as non-compliant, so ask them.
5. Doc pp. 19–21 (Get Payment Status) and the Aparat videos were not available. Compare the recovery flow above with those pages.

## 5. Steps to final approval

1. On the staging server, copy the `SNAPPPAY_*` values into `.env` from `.env.snappay.example` and `odour-stage.txt`, and set `SITE_URL` to the public HTTPS URL. Restart. The reconciler starts automatically.
2. Send SnappPay the staging server's public IP and the tester's mobile number (they asked for both).
3. Record the test order, following the sample videos:
   - Build the cart: product A (regular price) ×2 and product B (special price) ×1, plus a high-percentage discount code. Keep the total under 100,000 toman.
   - Show the eligible = false case (an amount outside the limits) and the eligible = true case.
   - Pay → the callback page shows **شناسه تراکنش اسنپ‌پی**.
   - In admin, search for that ID → open the order → **بروزرسانی سفارش**: A 2→1 → confirm. Wait 30 s. Remove B → confirm. The update button is now disabled.
   - Click **کنسل کامل در اسنپ‌پی** → confirm.
4. Send the video together with the **payment token** (shown in the admin order modal as "پیمنت توکن").
5. Hold the live final demo (screen share + microphone). After approval, swap in the production credentials and base URL.
