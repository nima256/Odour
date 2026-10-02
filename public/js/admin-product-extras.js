/*
 * Admin product editor — inventory, presentation and structured fragrance
 * fields (views/partials/admin-product-extras.ejs). The legacy editor calls
 * fill(product) when opening and merges collect() into its save payload.
 */
(function () {
  "use strict";
  var root = document.querySelector("[data-product-extras]");
  if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
  var identity = null; // { url, filename }

  function joinList(v) { return Array.isArray(v) ? v.join("، ") : (v || ""); }
  function splitList(v) {
    return String(v || "").split(/[,،\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function paintIdentity() {
    var box = $("[data-identity-preview]");
    var clear = $("[data-identity-clear]");
    if (identity && identity.url) {
      box.style.backgroundImage = "url('" + identity.url.replace(/'/g, "%27") + "')";
      box.classList.add("has-img");
      clear.hidden = false;
    } else {
      box.style.backgroundImage = "";
      box.classList.remove("has-img");
      clear.hidden = true;
    }
  }

  function fill(product) {
    product = product || {};
    var f = product.fragrance || {};
    $$("[data-x]").forEach(function (el) {
      var key = el.getAttribute("data-x");
      var v = product[key];
      el.value = v === undefined || v === null || (key === "sortPriority" && v === 0) ? "" : v;
    });
    var sku = document.getElementById("editSku");
    if (sku) sku.value = product.sku || "";
    $$("[data-f]").forEach(function (el) {
      var key = el.getAttribute("data-f");
      if (key === "accords") {
        el.value = (f.accords || []).map(function (a) { return a.name + (a.strength ? ":" + a.strength : ""); }).join("، ");
      } else {
        el.value = joinList(f[key]);
      }
    });
    $$("[data-f-list]").forEach(function (el) {
      var list = f[el.getAttribute("data-f-list")] || [];
      el.checked = list.indexOf(el.value) > -1;
    });
    identity = f.identityImage && f.identityImage.url ? { url: f.identityImage.url, filename: f.identityImage.filename } : null;
    paintIdentity();
  }

  function collect() {
    var out = { fragrance: {} };
    $$("[data-x]").forEach(function (el) { out[el.getAttribute("data-x")] = el.value.trim(); });
    var sku = document.getElementById("editSku");
    if (sku) out.sku = sku.value.trim();
    $$("[data-f]").forEach(function (el) {
      var key = el.getAttribute("data-f");
      var v = el.value.trim();
      if (key === "top" || key === "heart" || key === "base" || key === "occasions") v = splitList(v);
      if (key === "accords") {
        v = splitList(v).map(function (part) {
          var bits = part.split(/[:=]/);
          return { name: bits[0].trim(), strength: Number(String(bits[1] || "").replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); })) || 0 };
        });
      }
      out.fragrance[key] = v;
    });
    ["seasons", "dayNight"].forEach(function (key) {
      out.fragrance[key] = $$('[data-f-list="' + key + '"]').filter(function (el) { return el.checked; }).map(function (el) { return el.value; });
    });
    out.fragrance.identityImage = identity || null;
    return out;
  }

  $("[data-identity-file]").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var fd = new FormData();
    fd.append("image", file);
    var box = $("[data-identity-preview]");
    box.textContent = "در حال بارگذاری…";
    fetch("/admin/upload-image", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        box.textContent = "تصویر اول محصول استفاده می‌شود";
        if (res && res.url) { identity = { url: res.url.replace(/^https?:\/\/[^/]+/, ""), filename: res.filename }; paintIdentity(); }
        else alert("بارگذاری تصویر ناموفق بود");
      })
      .catch(function () { box.textContent = "تصویر اول محصول استفاده می‌شود"; alert("بارگذاری تصویر ناموفق بود"); });
    e.target.value = "";
  });
  $("[data-identity-clear]").addEventListener("click", function () { identity = null; paintIdentity(); });

  window.OdourProductExtras = { fill: fill, collect: collect };
})();
