/*
 * Product page: gallery + lightbox, variant selection (keeps the Torob feed
 * metadata, canonical URL and JSON-LD in sync with the chosen variant),
 * quantity and add-to-cart.
 */
(function () {
  "use strict";
  var ODOUR = window.ODOUR || {};
  var cfg = ODOUR.product;
  if (!cfg) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fa = ODOUR.faDigits;

  if (ODOUR.rememberProduct) ODOUR.rememberProduct(cfg.id);

  // ------------------------------------------------------------ gallery
  var track = $("[data-gallery-track]");
  var slides = track ? $$(".od-gallery__slide", track) : [];
  var thumbs = $$("[data-gallery-thumb]");
  var dots = $$(".od-gallery__dots span");
  var current = 0;

  function setActive(i) {
    current = i;
    thumbs.forEach(function (t, k) { t.setAttribute("aria-current", k === i ? "true" : "false"); });
    dots.forEach(function (d, k) { d.classList.toggle("is-active", k === i); });
  }
  function goTo(i, smooth) {
    if (!slides[i]) return;
    track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: smooth === false ? "auto" : "smooth" });
    setActive(i);
  }
  if (track && slides.length > 1) {
    var raf;
    track.addEventListener("scroll", function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        var w = track.clientWidth || 1;
        setActive(Math.min(slides.length - 1, Math.round(Math.abs(track.scrollLeft) / w)));
      });
    }, { passive: true });
    thumbs.forEach(function (t) { t.addEventListener("click", function () { goTo(Number(t.getAttribute("data-gallery-thumb"))); }); });
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(Math.min(slides.length - 1, current + 1)); }
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(Math.max(0, current - 1)); }
    });
  }

  // Lightbox (native <dialog>, pinch-zoom on touch, click-to-zoom on desktop).
  var lightbox = $("[data-lightbox]");
  if (lightbox && lightbox.showModal) {
    var ltrack = $("[data-lightbox-track]", lightbox);
    var lfigs = $$("figure", ltrack);
    var lcount = $("[data-lightbox-count]", lightbox);
    var updateCount = function () {
      var i = Math.round(Math.abs(ltrack.scrollLeft) / (ltrack.clientWidth || 1));
      lcount.textContent = fa(i + 1) + " / " + fa(lfigs.length);
    };
    ltrack.addEventListener("scroll", updateCount, { passive: true });
    $$("[data-gallery-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-gallery-open");
        var i = v === "current" ? current : Number(v);
        lightbox.showModal();
        document.body.classList.add("od-lock");
        ltrack.scrollTo({ left: lfigs[i] ? lfigs[i].offsetLeft : 0 });
        updateCount();
      });
    });
    var closeLb = function () { lightbox.close(); };
    $("[data-lightbox-close]", lightbox).addEventListener("click", closeLb);
    lightbox.addEventListener("close", function () { document.body.classList.remove("od-lock"); $$("img.is-zoomed", lightbox).forEach(function (im) { im.classList.remove("is-zoomed"); }); });
    $$("img", ltrack).forEach(function (img) {
      img.addEventListener("click", function (e) {
        if (!window.matchMedia("(hover: hover)").matches) return;
        var r = img.getBoundingClientRect();
        img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + "% " + ((e.clientY - r.top) / r.height * 100) + "%";
        img.classList.toggle("is-zoomed");
      });
    });
  }

  // ------------------------------------------------------------ variants
  var swatches = $$(".od-swatch");
  var sizes = $$(".od-size");
  var buyButtons = $$("[data-buy]");
  var meta = function (id) { return document.getElementById(id); };

  function selected(list) { return list.find(function (b) { return b.getAttribute("aria-checked") === "true"; }) || null; }
  function isOff(b) { return b.getAttribute("aria-disabled") === "true"; }

  function variantTitle(colorName, sizeName) {
    var parts = [cfg.name];
    if (colorName) parts.push("رنگ " + colorName);
    if (sizeName) parts.push("سایز " + sizeName);
    if (cfg.gender && !parts.some(function (p) { return p.indexOf(cfg.gender) !== -1; })) parts.push(cfg.gender);
    var visible = parts.filter(Boolean).join(" - ");
    return { visible: visible, page: cfg.englishName ? visible + " | " + cfg.englishName : visible };
  }

  function syncSeo() {
    var color = selected(swatches);
    var size = selected(sizes);
    var colorName = color ? color.getAttribute("data-color") : "";
    var variantId = color ? color.getAttribute("data-variant-id") : "";
    var sizeId = size ? size.getAttribute("data-size-id") : "";
    var sizeName = size ? size.getAttribute("data-size-label") : "";
    var image = color ? color.getAttribute("data-image") : "";
    var key = variantId && sizeId ? variantId + "--size-" + sizeId : variantId || (sizeId ? "size-" + sizeId : "base");
    var unique = cfg.id + "_" + key;
    var t = variantTitle(colorName, sizeName);

    document.title = t.page;
    var h1 = meta("product-page-title"); if (h1) h1.textContent = t.visible;
    [["product-name-meta", t.page], ["og-title-meta", t.page], ["torob-product-id", unique], ["torob-variant-id", key]].forEach(function (m) {
      var el = meta(m[0]); if (el) el.setAttribute("content", m[1]);
    });
    if (colorName && meta("torob-color-spec")) meta("torob-color-spec").setAttribute("content", "رنگ: " + colorName);
    if (sizeName && meta("torob-size-spec")) meta("torob-size-spec").setAttribute("content", "سایز: " + sizeName);

    // Keep incoming tracking params (utm_*, torob_clid…) and only replace variant/size.
    var url = new URL(location.href);
    variantId ? url.searchParams.set("variant", variantId) : url.searchParams.delete("variant");
    sizeId ? url.searchParams.set("size", sizeId) : url.searchParams.delete("size");
    history.replaceState(history.state, "", url.toString());

    var canonical = new URL(location.pathname, location.origin);
    if (variantId) canonical.searchParams.set("variant", variantId);
    if (sizeId) canonical.searchParams.set("size", sizeId);
    if (meta("torob-canonical")) meta("torob-canonical").setAttribute("href", canonical.toString());
    if (meta("og-url-meta")) meta("og-url-meta").setAttribute("content", canonical.toString());
    if (image && meta("og-image-meta")) meta("og-image-meta").setAttribute("content", new URL(image, location.origin).href);

    var ld = meta("torob-product-jsonld");
    if (ld) {
      try {
        var schema = JSON.parse(ld.textContent || "{}");
        schema.name = t.page;
        schema.color = colorName || undefined;
        schema.size = sizeName || undefined;
        schema.sku = unique;
        schema.mpn = unique;
        if (image) schema.image = [new URL(image, location.origin).href];
        if (schema.offers) schema.offers.url = canonical.toString();
        ld.textContent = JSON.stringify(schema);
      } catch (e) { /* keep server value */ }
    }
  }

  function updateBuyState() {
    var bad = (swatches.length && (!selected(swatches) || isOff(selected(swatches)))) ||
              (sizes.length && (!selected(sizes) || isOff(selected(sizes))));
    buyButtons.forEach(function (b) {
      b.disabled = !!bad;
      var label = $("[data-buy-label]", b);
      if (label) label.textContent = bad ? "این تنوع ناموجود است" : (b.closest(".od-buybar") ? "افزودن به سبد" : "افزودن به سبد خرید");
    });
  }

  function choose(list, btn) {
    if (!btn || isOff(btn)) return;
    list.forEach(function (b) { b.setAttribute("aria-checked", b === btn ? "true" : "false"); b.tabIndex = b === btn ? 0 : -1; });
  }

  function onColor(btn, fromUser) {
    choose(swatches, btn);
    var name = $("[data-selected-color]"); if (name) name.textContent = btn.getAttribute("data-color");
    var image = btn.getAttribute("data-image");
    if (image && track) {
      var abs = new URL(image, location.origin).href;
      var idx = slides.findIndex(function (s) { var im = $("img", s); return im && im.src === abs; });
      if (idx > -1) goTo(idx, fromUser);
      else if (slides[0]) { $("img", slides[0]).src = image; goTo(0, fromUser); }
    }
    syncSeo(); updateBuyState();
  }
  function onSize(btn) {
    choose(sizes, btn);
    var name = $("[data-selected-size]"); if (name) name.textContent = btn.getAttribute("data-size-label");
    syncSeo(); updateBuyState();
  }

  swatches.forEach(function (b) { b.addEventListener("click", function () { if (!isOff(b)) onColor(b, true); }); });
  sizes.forEach(function (b) { b.addEventListener("click", function () { if (!isOff(b)) onSize(b); }); });
  // Arrow keys within each radiogroup.
  [swatches, sizes].forEach(function (list) {
    list.forEach(function (b, i) {
      b.addEventListener("keydown", function (e) {
        var dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        for (var k = 1; k <= list.length; k++) {
          var next = list[(i + dir * k + list.length * 2) % list.length];
          if (!isOff(next)) { next.focus(); next.click(); break; }
        }
      });
    });
  });

  // Initial selection: server choice, else first available.
  var q = new URLSearchParams(location.search);
  var initColor = selected(swatches) || swatches.find(function (b) { return !isOff(b) && b.getAttribute("data-color") === q.get("color"); }) || swatches.find(function (b) { return !isOff(b); });
  if (initColor) { choose(swatches, initColor); var cn = $("[data-selected-color]"); if (cn) cn.textContent = initColor.getAttribute("data-color"); }
  else if ($("[data-selected-color]") && swatches.length) $("[data-selected-color]").textContent = "ناموجود";
  var initSize = selected(sizes) || sizes.find(function (b) { return !isOff(b); });
  if (initSize) { choose(sizes, initSize); var sn = $("[data-selected-size]"); if (sn) sn.textContent = initSize.getAttribute("data-size-label"); }
  updateBuyState();
  if (swatches.length || sizes.length) syncSeo();

  // ------------------------------------------------------------ quantity
  var qty = 1;
  var qtyBox = $("[data-qty]");
  if (qtyBox) {
    var out = $("[data-qty-value]", qtyBox);
    var minus = $('[data-qty-step="-1"]', qtyBox);
    var plus = $('[data-qty-step="1"]', qtyBox);
    var max = Math.max(1, Math.min(cfg.stock || 1, 10));
    var render = function () { out.textContent = fa(qty); minus.disabled = qty <= 1; plus.disabled = qty >= max; };
    qtyBox.addEventListener("click", function (e) {
      var b = e.target.closest("[data-qty-step]");
      if (!b || b.disabled) return;
      qty = Math.max(1, Math.min(max, qty + Number(b.getAttribute("data-qty-step"))));
      render();
    });
    render();
  }

  // ------------------------------------------------------------ add to cart
  buyButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      var payload = { productId: cfg.id, quantity: qty };
      var color = selected(swatches);
      var size = selected(sizes);
      if (color) { payload.selectedColor = color.getAttribute("data-color"); payload.selectedVariantId = color.getAttribute("data-variant-id"); }
      if (size) { payload.selectedSize = size.getAttribute("data-size"); payload.selectedSizeId = size.getAttribute("data-size-id"); }
      ODOUR.addToCart(payload, btn);
    });
  });

  // ------------------------------------------------------------ description read-more
  var readmore = $("[data-readmore]");
  var toggle = $("[data-readmore-toggle]");
  if (readmore && toggle) {
    if (readmore.scrollHeight <= readmore.clientHeight + 24) { readmore.classList.add("is-open"); toggle.hidden = true; }
    toggle.addEventListener("click", function () {
      var open = readmore.classList.toggle("is-open");
      toggle.textContent = open ? "بستن" : "بیشتر بخوانید";
    });
  }
})();
