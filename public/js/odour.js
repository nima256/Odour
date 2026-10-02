/*
 * Odour storefront runtime: panels (drawer / sheet / search / auth), toasts,
 * cart + wishlist actions, search suggestions, recently viewed, OTP sign-in.
 * Vanilla JS, no dependencies. Loaded with `defer` on every storefront page.
 */
(function () {
  "use strict";

  var ODOUR = (window.ODOUR = window.ODOUR || {});
  var doc = document;
  var $ = function (sel, root) { return (root || doc).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- digits
  var FA = "۰۱۲۳۴۵۶۷۸۹";
  function faDigits(v) { return String(v == null ? "" : v).replace(/\d/g, function (d) { return FA[d]; }); }
  function toLatin(v) {
    return String(v == null ? "" : v)
      .replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); })
      .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); });
  }
  function faPrice(n) { return faDigits(Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name, cls) { return '<svg class="od-icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>'; }
  ODOUR.faDigits = faDigits; ODOUR.toLatin = toLatin; ODOUR.faPrice = faPrice; ODOUR.escapeHtml = escapeHtml; ODOUR.icon = icon;

  // ---------------------------------------------------------------- storage (never throws)
  var store = {
    get: function (k, fallback) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  ODOUR.store = store;

  // ---------------------------------------------------------------- fetch
  function api(url, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: { Accept: "application/json" } };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          var err = new Error(data.message || "ابتدا وارد حساب کاربری شوید");
          err.status = 401;
          throw err;
        }
        if (!res.ok || data.success === false) {
          var e = new Error(data.message || (data.errors && data.errors[0] && data.errors[0].msg) || "خطایی رخ داد. دوباره تلاش کنید.");
          e.status = res.status; e.data = data;
          throw e;
        }
        return data;
      });
    });
  }
  ODOUR.api = api;

  // ---------------------------------------------------------------- toasts
  function toast(message, opts) {
    opts = opts || {};
    var host = $("[data-toasts]");
    if (!host) return;
    var el = doc.createElement("div");
    el.className = "od-toast" + (opts.type === "error" ? " od-toast--error" : "");
    el.innerHTML = icon(opts.type === "error" ? "alert" : "check") + "<span>" + escapeHtml(message) + "</span>" +
      (opts.action ? '<a href="' + escapeHtml(opts.action.href) + '">' + escapeHtml(opts.action.label) + "</a>" : "");
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-leaving");
      setTimeout(function () { el.remove(); }, 260);
    }, opts.duration || 3200);
  }
  ODOUR.toast = toast;

  // ---------------------------------------------------------------- panels
  var backdrop = $("[data-backdrop]");
  var openStack = [];
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function panelEl(name) { return $('[data-panel="' + name + '"]'); }

  function openPanel(name, trigger) {
    var el = panelEl(name);
    if (!el || el.classList.contains("is-open")) return;
    $$('[aria-controls="' + el.id + '"]').forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
    openStack.push({ el: el, trigger: trigger || doc.activeElement });
    el.hidden = false;
    if (backdrop) backdrop.hidden = false;
    void el.offsetWidth; // let the browser apply the start state before animating
    el.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
    doc.body.classList.add("od-lock");
    var focusTarget = el.querySelector("[autofocus]") || el.querySelector("input:not([type=hidden])") || el.querySelector(FOCUSABLE);
    setTimeout(function () { if (focusTarget) focusTarget.focus({ preventScroll: true }); }, reduceMotion ? 0 : 60);
    el.dispatchEvent(new CustomEvent("od:open"));
  }

  function closePanel(el) {
    el = el || (openStack[openStack.length - 1] || {}).el;
    if (!el) return;
    var idx = openStack.findIndex(function (p) { return p.el === el; });
    var entry = idx >= 0 ? openStack.splice(idx, 1)[0] : null;
    el.classList.remove("is-open");
    $$('[aria-controls="' + el.id + '"]').forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
    if (backdrop && !openStack.length) backdrop.classList.remove("is-open");
    if (!openStack.length) doc.body.classList.remove("od-lock");
    setTimeout(function () {
      if (!el.classList.contains("is-open")) el.hidden = true;
      if (backdrop && !backdrop.classList.contains("is-open")) backdrop.hidden = true;
    }, reduceMotion ? 0 : 420);
    if (entry && entry.trigger && entry.trigger.focus) entry.trigger.focus({ preventScroll: true });
    el.dispatchEvent(new CustomEvent("od:close"));
  }
  ODOUR.openPanel = openPanel;
  ODOUR.closePanel = closePanel;

  doc.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open]");
    if (opener) { e.preventDefault(); openPanel(opener.getAttribute("data-open"), opener); return; }
    var closer = e.target.closest("[data-close]");
    if (closer) { e.preventDefault(); closePanel(closer.closest("[data-panel]")); return; }
    if (e.target === backdrop) {
      openStack.slice().reverse().forEach(function (p) { closePanel(p.el); });
    }
  });

  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openStack.length) { closePanel(); return; }
    // Basic focus trap for the top-most panel.
    if (e.key === "Tab" && openStack.length) {
      var top = openStack[openStack.length - 1].el;
      var items = $$(FOCUSABLE, top).filter(function (n) { return n.offsetParent !== null; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "/" && !openStack.length && tag !== "input" && tag !== "textarea" && !e.target.isContentEditable) {
      e.preventDefault();
      openPanel("search");
    }
  });

  // ---------------------------------------------------------------- header
  var header = $("[data-header]");
  if (header) {
    // Mobile: fold the search row while scrolling down, bring it back on any upward scroll.
    var lastY = window.scrollY, root = document.documentElement;
    var onScroll = function () {
      var y = window.scrollY;
      header.classList.toggle("is-scrolled", y > 4);
      if (Math.abs(y - lastY) < 6) return;
      root.classList.toggle("od-hdr-folded", y > lastY && y > 120);
      lastY = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Mega menu: opens on hover (with intent delay) and on click/keyboard.
  $$("[data-mega]").forEach(function (item) {
    var btn = item.querySelector("button");
    var timer;
    function set(open) {
      clearTimeout(timer);
      item.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (window.matchMedia("(hover: hover)").matches) {
      item.addEventListener("mouseenter", function () { clearTimeout(timer); timer = setTimeout(function () { set(true); }, 120); });
      item.addEventListener("mouseleave", function () { clearTimeout(timer); timer = setTimeout(function () { set(false); }, 160); });
    }
    btn.addEventListener("click", function () { set(!item.classList.contains("is-open")); });
    item.addEventListener("keydown", function (e) { if (e.key === "Escape") { set(false); btn.focus(); } });
    item.addEventListener("focusout", function (e) { if (!item.contains(e.relatedTarget)) set(false); });
  });

  // ---------------------------------------------------------------- cart count
  function setCartCount(n) {
    $$("[data-cart-count]").forEach(function (el) {
      el.setAttribute("data-count", n);
      el.textContent = n ? faDigits(n) : "";
    });
  }
  ODOUR.setCartCount = setCartCount;

  // ---------------------------------------------------------------- auth (phone + OTP)
  var pendingAction = null;
  function requireAuth(action) {
    if (ODOUR.loggedIn) return true;
    pendingAction = action || null;
    if (panelEl("auth")) openPanel("auth");
    else window.location.href = "/?login=1";
    return false;
  }
  ODOUR.requireAuth = requireAuth;

  doc.addEventListener("click", function (e) {
    var t = e.target.closest("[data-auth-open]");
    if (!t) return;
    e.preventDefault();
    requireAuth(null);
  });

  (function initAuth() {
    var sheet = panelEl("auth");
    if (!sheet) return;
    var phoneForm = $('[data-auth-step="phone"]', sheet);
    var codeForm = $('[data-auth-step="code"]', sheet);
    var mobileInput = $("#od-auth-mobile", sheet);
    var mobileErr = $("#od-auth-mobile-err", sheet);
    var codeErr = $("#od-auth-code-err", sheet);
    var otpBox = $("[data-otp]", sheet);
    var digits = $$("input", otpBox);
    var timerEl = $("[data-auth-timer]", sheet);
    var resendBtn = $("[data-auth-resend]", sheet);
    var backBtns = $$("[data-auth-back]", sheet);
    var mobile = "";
    var countdown;

    function normalizeMobile(v) {
      var d = toLatin(v).replace(/\D/g, "");
      if (d.indexOf("0098") === 0) d = "0" + d.slice(4);
      else if (d.indexOf("98") === 0 && d.length === 12) d = "0" + d.slice(2);
      else if (d.length === 10 && d[0] === "9") d = "0" + d;
      return d;
    }

    function showStep(step) {
      phoneForm.hidden = step !== "phone";
      codeForm.hidden = step !== "code";
      backBtns[0].hidden = step !== "code";
      if (step === "code") setTimeout(function () { digits[0].focus(); }, 50);
      else setTimeout(function () { mobileInput.focus(); }, 50);
    }

    function startTimer(seconds) {
      clearInterval(countdown);
      resendBtn.hidden = true;
      var left = seconds;
      function tick() {
        if (left <= 0) {
          clearInterval(countdown);
          timerEl.textContent = "کد را دریافت نکردید؟";
          resendBtn.hidden = false;
          return;
        }
        var m = Math.floor(left / 60), s = left % 60;
        timerEl.textContent = "ارسال مجدد تا " + faDigits(m + ":" + (s < 10 ? "0" : "") + s);
        left--;
      }
      tick();
      countdown = setInterval(tick, 1000);
    }

    function sendCode(btn) {
      if (btn) btn.classList.add("is-loading");
      return api("/api/authentication/otp/request", { method: "POST", body: { mobile: mobile } })
        .then(function (data) {
          $("[data-auth-phone]", sheet).textContent = faDigits(mobile);
          digits.forEach(function (d) { d.value = ""; });
          codeErr.textContent = "";
          otpBox.removeAttribute("aria-invalid");
          showStep("code");
          startTimer(data.retryAfter || 120);
        })
        .catch(function (err) {
          if (err.data && err.data.retryAfter) {
            // A code is still valid — let the user enter it.
            $("[data-auth-phone]", sheet).textContent = faDigits(mobile);
            showStep("code");
            startTimer(err.data.retryAfter);
            codeErr.textContent = err.message;
            return;
          }
          (phoneForm.hidden ? codeErr : mobileErr).textContent = err.message;
        })
        .finally(function () { if (btn) btn.classList.remove("is-loading"); });
    }

    phoneForm.addEventListener("submit", function (e) {
      e.preventDefault();
      mobile = normalizeMobile(mobileInput.value);
      if (!/^09\d{9}$/.test(mobile)) {
        mobileErr.textContent = "شماره موبایل معتبر نیست؛ مثال: ۰۹۱۲۳۴۵۶۷۸۹";
        mobileInput.setAttribute("aria-invalid", "true");
        mobileInput.focus();
        return;
      }
      mobileErr.textContent = "";
      mobileInput.removeAttribute("aria-invalid");
      sendCode(phoneForm.querySelector('[type="submit"]'));
    });
    mobileInput.addEventListener("input", function () {
      if (mobileErr.textContent) { mobileErr.textContent = ""; mobileInput.removeAttribute("aria-invalid"); }
    });

    function code() { return digits.map(function (d) { return d.value; }).join(""); }

    function fill(str, from) {
      var chars = toLatin(str).replace(/\D/g, "").split("");
      for (var i = from; i < digits.length && chars.length; i++) digits[i].value = chars.shift();
      var next = digits.find(function (d) { return !d.value; });
      (next || digits[digits.length - 1]).focus();
      if (code().length === digits.length) codeForm.requestSubmit ? codeForm.requestSubmit() : codeForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }

    digits.forEach(function (input, i) {
      input.addEventListener("input", function () {
        var v = toLatin(input.value).replace(/\D/g, "");
        input.value = "";
        if (v) fill(v, i);
        codeErr.textContent = ""; otpBox.removeAttribute("aria-invalid");
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !input.value && i > 0) { digits[i - 1].value = ""; digits[i - 1].focus(); e.preventDefault(); }
        if (e.key === "ArrowLeft" && i < digits.length - 1) digits[i + 1].focus();
        if (e.key === "ArrowRight" && i > 0) digits[i - 1].focus();
      });
      input.addEventListener("paste", function (e) {
        e.preventDefault();
        fill((e.clipboardData || window.clipboardData).getData("text"), 0);
      });
      input.addEventListener("focus", function () { input.select(); });
    });

    var verifying = false;
    codeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (verifying) return;
      var otp = code();
      if (otp.length !== digits.length) {
        codeErr.textContent = "کد ۵ رقمی را کامل وارد کنید";
        return;
      }
      verifying = true;
      var btn = codeForm.querySelector('[type="submit"]');
      btn.classList.add("is-loading");
      api("/api/authentication/otp/verify", { method: "POST", body: { mobile: mobile, otp: otp } })
        .then(function () {
          ODOUR.loggedIn = true;
          clearInterval(countdown);
          toast("خوش آمدید! وارد حساب خود شدید.");
          var action = pendingAction;
          pendingAction = null;
          // Only same-site paths are followed (no open redirect via ?next=).
          var next = new URLSearchParams(location.search).get("next") || "";
          var go = function () {
            if (/^\/(?!\/)/.test(next)) location.href = next;
            else location.reload();
          };
          if (typeof action === "function") {
            closePanel(sheet);
            Promise.resolve(action()).finally(function () { setTimeout(go, 900); });
          } else {
            setTimeout(go, 400);
          }
        })
        .catch(function (err) {
          codeErr.textContent = err.message;
          otpBox.setAttribute("aria-invalid", "true");
          otpBox.classList.remove("is-shake"); void otpBox.offsetWidth; otpBox.classList.add("is-shake");
          if (err.data && err.data.expired) { clearInterval(countdown); timerEl.textContent = ""; resendBtn.hidden = false; }
          digits.forEach(function (d) { d.value = ""; });
          digits[0].focus();
        })
        .finally(function () { verifying = false; btn.classList.remove("is-loading"); });
    });

    resendBtn.addEventListener("click", function () { sendCode(resendBtn); });
    backBtns.forEach(function (b) { b.addEventListener("click", function () { clearInterval(countdown); showStep("phone"); }); });
    sheet.addEventListener("od:close", function () { if (!ODOUR.loggedIn) pendingAction = null; });

    if (/[?&]login=1/.test(location.search)) openPanel("auth");
  })();

  // ---------------------------------------------------------------- add to cart
  function addToCart(payload, btn) {
    if (!requireAuth(function () { return addToCart(payload, null); })) return Promise.resolve();
    if (btn) btn.classList.add("is-loading");
    return api("/api/cart/add", { method: "POST", body: payload })
      .then(function (data) {
        setCartCount(data.cartCount || 0);
        toast(data.message || "به سبد خرید اضافه شد", { action: { href: "/cart", label: "مشاهده سبد" } });
        doc.dispatchEvent(new CustomEvent("od:cart-added", { detail: data }));
        if (navigator.vibrate && !reduceMotion) navigator.vibrate(8);
      })
      .catch(function (err) {
        if (err.status === 401) { ODOUR.loggedIn = false; requireAuth(function () { return addToCart(payload, null); }); return; }
        toast(err.message, { type: "error" });
      })
      .finally(function () { if (btn) btn.classList.remove("is-loading"); });
  }
  ODOUR.addToCart = addToCart;

  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-add-to-cart]");
    if (!btn) return;
    e.preventDefault();
    if (btn.hasAttribute("data-needs-options")) { window.location.href = btn.getAttribute("data-href"); return; }
    addToCart({ productId: btn.getAttribute("data-add-to-cart"), quantity: 1 }, btn);
  });

  // ---------------------------------------------------------------- wishlist
  var wishIds = null;
  function paintWish() {
    if (!wishIds) return;
    $$("[data-wishlist]").forEach(function (b) {
      var on = wishIds.indexOf(b.getAttribute("data-wishlist")) !== -1;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.setAttribute("aria-label", on ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها");
    });
  }
  ODOUR.paintWish = paintWish;
  if (ODOUR.loggedIn && doc.querySelector("[data-wishlist]")) {
    api("/api/wishlist").then(function (d) { wishIds = d.ids || []; paintWish(); }).catch(function () {});
  }
  function toggleWish(id, btn) {
    if (!requireAuth(function () { return toggleWish(id, null); })) return Promise.resolve();
    return api("/api/wishlist/toggle", { method: "POST", body: { productId: id } })
      .then(function (d) {
        wishIds = d.ids || [];
        paintWish();
        if (btn) { btn.classList.remove("is-pop"); void btn.offsetWidth; btn.classList.add("is-pop"); }
        toast(d.added ? "به علاقه‌مندی‌ها اضافه شد" : "از علاقه‌مندی‌ها حذف شد", d.added ? { action: { href: "/userProfile#wishlist", label: "مشاهده" } } : {});
      })
      .catch(function (err) { toast(err.message, { type: "error" }); });
  }
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-wishlist]");
    if (!btn) return;
    e.preventDefault();
    toggleWish(btn.getAttribute("data-wishlist"), btn);
  });

  // ---------------------------------------------------------------- recently viewed
  var RV_KEY = "od:recent";
  ODOUR.rememberProduct = function (id) {
    if (!id) return;
    var list = store.get(RV_KEY, []).filter(function (x) { return x !== id; });
    list.unshift(id);
    store.set(RV_KEY, list.slice(0, 12));
  };
  $$("[data-recently-viewed]").forEach(function (host) {
    var exclude = host.getAttribute("data-exclude");
    var ids = store.get(RV_KEY, []).filter(function (x) { return x !== exclude; }).slice(0, 8);
    if (!ids.length) return;
    // Server-rendered cards: identical markup to every other product list.
    api("/api/products/cards?format=html&ids=" + encodeURIComponent(ids.join(","))).then(function (d) {
      if (!d.html) return;
      host.querySelector("[data-rv-list]").innerHTML = d.html;
      host.hidden = false;
      paintWish();
    }).catch(function () {});
  });

  // ---------------------------------------------------------------- search
  (function initSearch() {
    var panel = panelEl("search");
    if (!panel) return;
    var input = $("#od-search-input", panel);
    var form = $("[data-search-form]", panel);
    var idle = $("[data-search-idle]", panel);
    var results = $("[data-search-results]", panel);
    var recentWrap = $("[data-recent-searches]", panel);
    var recentList = $("[data-recent-list]", panel);
    var RS_KEY = "od:recent-searches";
    var timer, controller, activeIndex = -1;

    function renderRecent() {
      var items = store.get(RS_KEY, []);
      recentWrap.hidden = !items.length;
      recentList.innerHTML = items.map(function (q) {
        return '<a class="od-chip" href="/shop?search=' + encodeURIComponent(q) + '">' + icon("history") + escapeHtml(q) + "</a>";
      }).join("");
    }
    function saveRecent(q) {
      q = q.trim();
      if (!q) return;
      var items = store.get(RS_KEY, []).filter(function (x) { return x !== q; });
      items.unshift(q);
      store.set(RS_KEY, items.slice(0, 8));
    }
    $("[data-clear-recent]", panel).addEventListener("click", function () { store.set(RS_KEY, []); renderRecent(); });
    panel.addEventListener("od:open", renderRecent);

    function highlight(text, q) {
      var safe = escapeHtml(text);
      var terms = q.trim().split(/\s+/).filter(Boolean).map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
      if (!terms.length) return safe;
      return safe.replace(new RegExp("(" + terms.map(escapeHtml).join("|") + ")", "gi"), "<mark>$1</mark>");
    }

    function render(data, q) {
      var html = "";
      if (data.categories && data.categories.length || data.brands && data.brands.length) {
        html += '<div class="od-search__section"><div class="od-search__chips">' +
          (data.categories || []).map(function (c) { return '<a class="od-chip" href="/category/' + encodeURIComponent(c.slug) + '">' + icon("grid") + escapeHtml(c.name) + "</a>"; }).join("") +
          (data.brands || []).map(function (b) { return '<a class="od-chip" href="/shop?brand=' + encodeURIComponent(b.name) + '">' + icon("tag") + escapeHtml(b.name) + "</a>"; }).join("") +
          "</div></div>";
      }
      if (data.products && data.products.length) {
        html += '<div class="od-search__section"><div class="od-search__label"><span>محصولات</span>' +
          '<a class="od-link" style="font-size:12px" href="/shop?search=' + encodeURIComponent(q) + '">همه نتایج (' + faDigits(data.total || data.products.length) + ")</a></div>" +
          '<div class="od-search__results">' +
          data.products.map(function (p, i) {
            var pr = p.pricing || {};
            return '<a class="od-sresult" role="option" id="od-sr-' + i + '" aria-selected="false" href="' + escapeHtml(p.url) + '">' +
              '<span class="od-sresult__img"><img src="' + escapeHtml(p.image) + '" alt="" loading="lazy"></span>' +
              '<span style="min-width:0"><span class="od-sresult__name">' + highlight(p.name, q) + "</span>" +
              '<span class="od-meta od-num">' + (p.inStock ? faPrice(pr.now) + " تومان" : "ناموجود") + (p.brand ? " · " + escapeHtml(p.brand) : "") + "</span></span></a>";
          }).join("") + "</div></div>";
      }
      if (!html) {
        html = '<div class="od-search__empty"><div class="od-state__art" style="margin:0 auto 12px">' + icon("search") + "</div>" +
          "<p>نتیجه‌ای برای «" + escapeHtml(q) + "» پیدا نشد.</p><p class=\"od-meta\">املای کلمه را بررسی کنید یا نام برند را جستجو کنید.</p></div>";
      }
      results.innerHTML = html;
      activeIndex = -1;
    }

    function query(q) {
      if (controller) controller.abort();
      controller = "AbortController" in window ? new AbortController() : null;
      results.setAttribute("aria-busy", "true");
      fetch("/api/search/suggest?q=" + encodeURIComponent(q), { credentials: "same-origin", signal: controller && controller.signal })
        .then(function (r) { return r.json(); })
        .then(function (d) { render(d, q); })
        .catch(function (err) { if (err.name !== "AbortError") results.innerHTML = '<p class="od-search__empty">جستجو با خطا مواجه شد. دوباره تلاش کنید.</p>'; })
        .finally(function () { results.removeAttribute("aria-busy"); });
    }

    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(timer);
      var has = q.length >= 2;
      idle.hidden = has;
      results.hidden = !has;
      input.setAttribute("aria-expanded", has ? "true" : "false");
      if (has) {
        if (!results.innerHTML) results.innerHTML = '<div class="od-search__results">' + [0, 1, 2, 3].map(function () {
          return '<div class="od-sresult"><span class="od-sresult__img od-skel"></span><span style="flex:1"><span class="od-skel" style="display:block;height:12px;width:70%"></span><span class="od-skel" style="display:block;height:10px;width:35%;margin-top:8px"></span></span></div>';
        }).join("") + "</div>";
        timer = setTimeout(function () { query(q); }, 220);
      }
    });

    input.addEventListener("keydown", function (e) {
      var opts = $$(".od-sresult[role=option]", results);
      if (!opts.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      e.preventDefault();
      activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach(function (o, i) { o.setAttribute("aria-selected", i === activeIndex ? "true" : "false"); });
      input.setAttribute("aria-activedescendant", opts[activeIndex].id);
      opts[activeIndex].scrollIntoView({ block: "nearest" });
    });

    form.addEventListener("submit", function (e) {
      var sel = $('.od-sresult[aria-selected="true"]', results);
      if (sel) { e.preventDefault(); window.location.href = sel.getAttribute("href"); return; }
      if (!input.value.trim()) { e.preventDefault(); return; }
      saveRecent(input.value);
    });
    results.addEventListener("click", function () { saveRecent(input.value); });
  })();

  // ---------------------------------------------------------------- flash messages from server
  if (ODOUR.flash && ODOUR.flash.length) ODOUR.flash.forEach(function (f) { toast(f.text, { type: f.type }); });
})();
