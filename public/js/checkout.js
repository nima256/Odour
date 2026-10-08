/*
 * Cart + single-page checkout. Pricing rules mirror services/orderPricing.js:
 *  - online payment uses the product's special price;
 *  - SnappPay / TorobPay keep 50% of an existing special-price discount;
 *  - TorobPay adds 12% to the payable amount after discounts;
 *  - code ODOUR256 only applies to items without a special price.
 * The server recalculates everything on order creation; this is display only.
 */
(function () {
  "use strict";
  var ODOUR = window.ODOUR || {};
  var form = document.querySelector("[data-checkout]");
  if (!form) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fa = ODOUR.faDigits, faPrice = ODOUR.faPrice, toLatin = ODOUR.toLatin;
  var toman = function (n) { return faPrice(n) + " تومان"; };
  var discount = (ODOUR.checkout || {}).discount || null;
  var ODOUR256 = "ODOUR256";
  var TOROBPAY_SURCHARGE_RATE = 0.12;

  // ------------------------------------------------------------ pricing
  function lines() { return $$("[data-line]"); }
  function lineData(el) {
    return { price: Number(el.dataset.price) || 0, offer: Number(el.dataset.offer) || 0, qty: Number(el.dataset.qty) || 0 };
  }
  function method() { var r = $('input[name="paymentMethod"]:checked'); return r ? r.value : "zarinpal"; }
  function special(d) { return d.offer > 0 && d.offer < d.price; }
  function unitPrice(d, m) {
    if (!special(d)) return d.price;
    if (m === "snappay" || m === "torobpay") return d.price - Math.floor((d.price - d.offer) / 2);
    return d.offer;
  }
  function isOdour256() { return discount && String(discount.code || "").toUpperCase() === ODOUR256; }
  function totals() {
    var m = method(), gross = 0, sub = 0, base = 0;
    lines().forEach(function (el) {
      var d = lineData(el), u = unitPrice(d, m);
      gross += d.price * d.qty;
      sub += u * d.qty;
      if (!isOdour256() || !special(d)) base += u * d.qty;
    });
    var codeAmount = 0;
    if (discount) {
      var valid = !(isOdour256() && base <= 0) && !(discount.minOrderAmount && base < discount.minOrderAmount);
      if (!valid) {
        ODOUR.toast("کد تخفیف " + discount.code + " با سبد فعلی قابل استفاده نیست", { type: "error" });
        removeCoupon(true);
      } else if (discount.type === "percent") {
        codeAmount = Math.floor((base * discount.amount) / 100);
        if (discount.maxDiscountAmount) codeAmount = Math.min(codeAmount, discount.maxDiscountAmount);
      } else {
        codeAmount = Math.min(discount.amount, base);
      }
    }
    var payableBeforeFee = Math.max(0, sub - codeAmount);
    var torobFee = m === "torobpay" ? Math.round(payableBeforeFee * TOROBPAY_SURCHARGE_RATE) : 0;
    return {
      gross: gross,
      sub: sub,
      save: gross - sub,
      code: codeAmount,
      torobFee: torobFee,
      total: payableBeforeFee + torobFee
    };
  }

  function render() {
    var t = totals();
    var m = method();
    $("[data-sum-gross]").textContent = toman(t.gross);
    $("[data-sum-save-row]").hidden = t.save <= 0;
    $("[data-sum-save]").textContent = toman(t.save);
    $("[data-sum-code-row]").hidden = t.code <= 0;
    $("[data-sum-code]").textContent = "−" + toman(t.code);
    var torobFeeRow = $("[data-sum-torob-fee-row]");
    if (torobFeeRow) torobFeeRow.hidden = t.torobFee <= 0;
    var torobFeeValue = $("[data-sum-torob-fee]");
    if (torobFeeValue) torobFeeValue.textContent = toman(t.torobFee);
    $$("[data-sum-total]").forEach(function (el) { el.textContent = toman(t.total); });
    var count = 0;
    lines().forEach(function (el) {
      var d = lineData(el), u = unitPrice(d, m);
      count += d.qty;
      $("[data-line-total]", el).innerHTML = faPrice(u * d.qty) + ' <small style="font-weight:500;font-size:11px">تومان</small>';
      var was = $("[data-line-was]", el);
      was.hidden = !special(d);
      was.textContent = faPrice(d.price * d.qty);
      $("[data-line-qty-value]", el).textContent = fa(d.qty);
      $('[data-line-qty="-1"]', el).disabled = d.qty <= 1;
      $('[data-line-qty="1"]', el).disabled = d.qty >= (Number(el.dataset.stock) || 99);
    });
    $("[data-item-count]").textContent = fa(count);
    scheduleEligibility();
  }

  // ------------------------------------------------------------ cart lines
  function payload(el, qty) {
    var p = { productId: el.dataset.productId, quantity: qty };
    if (el.dataset.color) p.selectedColor = el.dataset.color;
    if (el.dataset.variantId) p.selectedVariantId = el.dataset.variantId;
    if (el.dataset.size) p.selectedSize = el.dataset.size;
    if (el.dataset.sizeId) p.selectedSizeId = el.dataset.sizeId;
    return p;
  }

  $("[data-lines]").addEventListener("click", function (e) {
    var el = e.target.closest("[data-line]");
    if (!el) return;
    var step = e.target.closest("[data-line-qty]");
    if (step && !step.disabled) {
      var next = Number(el.dataset.qty) + Number(step.getAttribute("data-line-qty"));
      if (next < 1) return;
      el.classList.add("is-busy");
      ODOUR.api("/api/cart/update", { method: "PUT", body: payload(el, next) })
        .then(function () { el.dataset.qty = next; render(); })
        .catch(function (err) { ODOUR.toast(err.message, { type: "error" }); })
        .finally(function () { el.classList.remove("is-busy"); });
      return;
    }
    if (e.target.closest("[data-line-remove]")) {
      el.classList.add("is-busy");
      ODOUR.api("/api/cart/remove/" + encodeURIComponent(el.dataset.productId) + "?lineId=" + encodeURIComponent(el.dataset.line), { method: "DELETE" })
        .then(function (data) {
          ODOUR.setCartCount(data.cartCount || 0);
          if (!data.cartCount) { location.reload(); return; }
          el.remove();
          render();
          ODOUR.toast("محصول از سبد خرید حذف شد");
        })
        .catch(function (err) { el.classList.remove("is-busy"); ODOUR.toast(err.message, { type: "error" }); });
    }
  });

  // ------------------------------------------------------------ coupon
  var couponForm = $("[data-coupon-form]");
  var couponApplied = $("[data-coupon-applied]");
  var couponInput = $("#discount-code");
  function applyCoupon(btn) {
    var code = couponInput.value.trim();
    if (!code) { couponInput.focus(); ODOUR.toast("کد تخفیف را وارد کنید", { type: "error" }); return; }
    btn.classList.add("is-loading");
    ODOUR.api("/api/cart/apply-discount", { method: "POST", body: { discountCode: code, subtotal: totals().sub, paymentMethod: method() } })
      .then(function (data) {
        var d = data.discount || {};
        discount = {
          code: d.code || code, type: d.type, amount: Number(d.amount) || 0, minOrderAmount: Number(d.minOrderAmount) || 0,
          maxDiscountAmount: d.type === "percent" ? Number(d.maxDiscountAmount) || 0 : 0,
        };
        $("[data-coupon-code]").textContent = discount.code;
        couponForm.hidden = true;
        couponApplied.hidden = false;
        ODOUR.toast(data.message || "کد تخفیف اعمال شد");
        render();
      })
      .catch(function (err) { ODOUR.toast(err.message, { type: "error" }); })
      .finally(function () { btn.classList.remove("is-loading"); });
  }
  function removeCoupon(silent) {
    discount = null;
    couponForm.hidden = false;
    couponApplied.hidden = true;
    return ODOUR.api("/api/cart/discount", { method: "DELETE" })
      .then(function () { if (!silent) ODOUR.toast("کد تخفیف حذف شد"); render(); })
      .catch(function () {});
  }
  $("[data-coupon-apply]").addEventListener("click", function (e) { applyCoupon(e.currentTarget); });
  couponInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyCoupon($("[data-coupon-apply]")); } });
  $("[data-coupon-remove]").addEventListener("click", function () { removeCoupon(false); });

  // ------------------------------------------------------------ instalment eligibility
  var eligTimer, eligSeq = 0;
  function delivery() { var r = $('input[name="delivery"]:checked'); return r ? r.value : ""; }
  function hideOption(opt) {
    var input = $("input", opt);
    var wasChecked = input.checked;
    opt.hidden = true;
    input.checked = false;
    if (wasChecked) { $('input[name="paymentMethod"][value="zarinpal"]').checked = true; render(); }
  }
  function checkEligibility() {
    var seq = ++eligSeq;
    var checking = $("[data-checking]");
    checking.hidden = false;
    var snapp = $("#snapp-pay-option"), torob = $("#torob-pay-option");
    var body = JSON.stringify({ delivery: delivery() });
    var req = function (url) {
      return fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: body })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
    };
    Promise.all([
      req("/api/order/snapp-pay/eligible").then(function (res) {
        if (seq !== eligSeq) return;
        // Title and description are rendered exactly as returned by SnappPay's
        // eligible service (title_message / description) — never static text.
        if (res.ok && res.d.success && res.d.eligible === true && res.d.title_message) {
          $("#snapp-pay-title").textContent = String(res.d.title_message);
          $("#snapp-pay-description").textContent = String(res.d.description || "");
          snapp.hidden = false;
        } else hideOption(snapp);
      }).catch(function () { hideOption(snapp); }),
      req("/api/order/torob-pay/eligible").then(function (res) {
        if (seq !== eligSeq) return;
        if (res.ok && res.d.success && res.d.enabled && res.d.eligible) {
          $("#torob-pay-title").textContent = res.d.title || "پرداخت اعتباری با ترب‌پی";
          var parts = [];
          if (res.d.description) parts.push(res.d.description);
          if (Number(res.d.amountToman) >= 0) parts.push("مبلغ قابل پرداخت: " + toman(Number(res.d.amountToman)));
          $("#torob-pay-description").textContent = parts.join(" • ");
          torob.hidden = false;
        } else hideOption(torob);
      }).catch(function () { hideOption(torob); }),
    ]).finally(function () { if (seq === eligSeq) checking.hidden = true; });
  }
  function scheduleEligibility() { clearTimeout(eligTimer); eligTimer = setTimeout(checkEligibility, 300); }

  form.addEventListener("change", function (e) {
    if (e.target.name === "paymentMethod") render();
    if (e.target.name === "delivery") scheduleEligibility();
  });

  // ------------------------------------------------------------ province / city
  var province = $("#province"), city = $("#city");
  var locations = typeof iranLocations !== "undefined" ? iranLocations : window.iranLocations || {};
  Object.keys(locations).forEach(function (p) { province.add(new Option(p, p)); });
  function fillCities(selectedCity) {
    city.innerHTML = "";
    var list = locations[province.value] || [];
    city.add(new Option(list.length ? "انتخاب شهر" : "ابتدا استان را انتخاب کنید", ""));
    list.forEach(function (c) { city.add(new Option(c, c)); });
    city.disabled = !list.length;
    if (selectedCity && list.indexOf(selectedCity) !== -1) city.value = selectedCity;
  }
  province.addEventListener("change", function () { fillCities(""); clearError(province); });
  if (province.dataset.value && locations[province.dataset.value]) {
    province.value = province.dataset.value;
    fillCities(city.dataset.value);
  }

  // ------------------------------------------------------------ validation
  function setError(field, msg) {
    var err = document.getElementById(field.id + "-err");
    field.setAttribute("aria-invalid", "true");
    if (err) err.innerHTML = ODOUR.icon("alert") + "<span>" + ODOUR.escapeHtml(msg) + "</span>";
  }
  function clearError(field) {
    var err = document.getElementById(field.id + "-err");
    field.removeAttribute("aria-invalid");
    if (err) err.innerHTML = "";
  }
  ["fullName", "recipientMobile", "address", "postcode", "city"].forEach(function (id) {
    var f = document.getElementById(id);
    f.addEventListener("input", function () { clearError(f); });
    f.addEventListener("change", function () { clearError(f); });
  });

  function digits(v) { return toLatin(v).replace(/\D/g, ""); }
  function normalizeMobile(v) {
    var d = digits(v);
    if (d.indexOf("0098") === 0) d = "0" + d.slice(4);
    else if (d.indexOf("98") === 0 && d.length === 12) d = "0" + d.slice(2);
    else if (d.length === 10 && d[0] === "9") d = "0" + d;
    return d;
  }

  function validate() {
    var first = null;
    var check = function (field, ok, msg) {
      if (ok) { clearError(field); return; }
      setError(field, msg);
      if (!first) first = field;
    };
    var name = $("#fullName"), mobile = $("#recipientMobile"), addr = $("#address"), post = $("#postcode");
    check(name, name.value.trim().length >= 3, "نام و نام خانوادگی را کامل وارد کنید");
    check(mobile, /^09\d{9}$/.test(normalizeMobile(mobile.value)), "شماره موبایل معتبر نیست؛ مثال: ۰۹۱۲۳۴۵۶۷۸۹");
    check(province, !!province.value, "استان را انتخاب کنید");
    check(city, !!city.value, "شهر را انتخاب کنید");
    check(addr, addr.value.trim().length >= 10, "نشانی باید حداقل ۱۰ حرف باشد");
    check(post, /^\d{10}$/.test(digits(post.value)), "کد پستی باید ۱۰ رقم باشد");
    if (first) {
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
    }
    return !first;
  }

  var paying = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (paying) return;
    var formError = $("[data-form-error]");
    formError.innerHTML = "";
    if (!validate()) {
      ODOUR.toast("لطفاً اطلاعات ارسال را کامل کنید", { type: "error" });
      return;
    }
    if (lines().some(function (el) { return el.querySelector(".od-line__warn"); })) {
      ODOUR.toast("ابتدا کالاهای ناموجود را از سبد حذف کنید", { type: "error" });
      return;
    }
    var fd = new FormData();
    fd.append("fullName", $("#fullName").value.trim());
    fd.append("recipientMobile", normalizeMobile($("#recipientMobile").value));
    fd.append("province", province.value);
    fd.append("city", city.value);
    fd.append("address", $("#address").value.trim());
    fd.append("postcode", digits($("#postcode").value));
    fd.append("delivery", delivery());
    fd.append("paymentMethod", method());

    paying = true;
    var buttons = $$("[data-pay]");
    buttons.forEach(function (b) { b.classList.add("is-loading"); });
    fetch("/api/order", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success && data.paymentUrl) {
          buttons.forEach(function (b) { b.textContent = "در حال انتقال به درگاه…"; });
          window.location.href = data.paymentUrl;
          return;
        }
        throw data;
      })
      .catch(function (data) {
        paying = false;
        buttons.forEach(function (b) { b.classList.remove("is-loading"); });
        var errors = (data && data.errors) || [];
        var mapped = false;
        errors.forEach(function (er) {
          var f = document.getElementById(er.path === "postcode" ? "postcode" : er.path);
          if (f) { setError(f, er.msg); mapped = true; }
        });
        var msg = (data && data.message) || "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.";
        formError.innerHTML = ODOUR.icon("alert") + "<span>" + ODOUR.escapeHtml(msg) + "</span>";
        ODOUR.toast(msg, { type: "error" });
        if (mapped) { var f0 = $('[aria-invalid="true"]', form); if (f0) f0.scrollIntoView({ behavior: "smooth", block: "center" }); }
      });
  });

  render();
  checkEligibility();
})();
