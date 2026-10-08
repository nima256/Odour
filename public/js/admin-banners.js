/*
 * Admin banner manager: grouped list, create/edit dialog with image upload,
 * activate/deactivate, reorder within a placement, delete.
 * Server routes: /admin/banners (see routes/admin.js).
 */
(function () {
  "use strict";
  var dataEl = document.getElementById("adm-banners-data");
  var list = document.querySelector("[data-banner-list]");
  var dialog = document.querySelector("[data-banner-dialog]");
  if (!dataEl || !list || !dialog) return;

  var state = JSON.parse(dataEl.textContent || "{}");
  var banners = state.banners || [];
  var placements = state.placements || {};
  var form = dialog.querySelector("[data-banner-form]");
  var editingId = null;
  var images = { image: null, mobileImage: null };

  var fa = function (n) { return String(n).replace(/\d/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹"[d]; }); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  var icon = function (name) { return '<svg class="od-icon od-icon--sm" aria-hidden="true"><use href="#i-' + name + '"></use></svg>'; };

  function toast(text, isError) {
    var t = document.createElement("div");
    t.className = "adm-toast" + (isError ? " is-error" : "");
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok || data.success === false) throw new Error(data.message || "خطا در ارتباط با سرور");
        return data;
      });
    });
  }

  function scheduleLabel(b) {
    var now = Date.now();
    if (b.startsAt && new Date(b.startsAt).getTime() > now) return ["زمان‌بندی‌شده", "adm-pill--info"];
    if (b.endsAt && new Date(b.endsAt).getTime() < now) return ["منقضی", "adm-pill--bad"];
    return b.isActive ? ["فعال", "adm-pill--ok"] : ["غیرفعال", ""];
  }

  function render() {
    var groups = Object.keys(placements).map(function (key) {
      var items = banners.filter(function (b) { return b.placement === key; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.createdAt).localeCompare(String(b.createdAt)); });
      return { key: key, label: placements[key], items: items };
    });
    list.innerHTML = groups.map(function (g) {
      var rows = g.items.map(function (b, i) {
        var st = scheduleLabel(b);
        var img = (b.image && b.image.url) || "";
        return '<div class="adm-card adm-banner' + (b.isActive ? "" : " is-off") + '">' +
          (img ? '<img class="adm-banner__img" src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="adm-banner__img"></span>') +
          '<div class="adm-banner__main"><strong>' + esc(b.title) + "</strong>" +
          (b.subtitle ? "<span>" + esc(b.subtitle) + "</span>" : "") +
          '<div class="adm-banner__meta"><span class="adm-pill ' + st[1] + '">' + st[0] + "</span>" +
          (b.url ? '<span class="adm-pill" dir="ltr">' + esc(b.url) + "</span>" : "") +
          (b.categorySlug ? '<span class="adm-pill">' + esc(b.categorySlug) + "</span>" : "") + "</div></div>" +
          '<div class="adm-banner__actions">' +
          '<button class="adm-iconbtn" type="button" data-act="up" data-id="' + b._id + '" aria-label="انتقال به بالا"' + (i === 0 ? " disabled" : "") + ">" + icon("arrow-up") + "</button>" +
          '<button class="adm-iconbtn" type="button" data-act="down" data-id="' + b._id + '" aria-label="انتقال به پایین"' + (i === g.items.length - 1 ? " disabled" : "") + ">" + icon("arrow-down") + "</button>" +
          '<button class="adm-iconbtn" type="button" data-act="toggle" data-id="' + b._id + '" aria-label="' + (b.isActive ? "غیرفعال کردن" : "فعال کردن") + '">' + icon(b.isActive ? "eye" : "eye-off") + "</button>" +
          '<button class="adm-iconbtn" type="button" data-act="edit" data-id="' + b._id + '" aria-label="ویرایش">' + icon("edit") + "</button>" +
          '<button class="adm-iconbtn" type="button" data-act="delete" data-id="' + b._id + '" aria-label="حذف" style="color:var(--a-danger)">' + icon("trash") + "</button>" +
          "</div></div>";
      }).join("");
      return '<section class="adm-banner-group"><h3>' + esc(g.label) + " <small>" + fa(g.items.length) + " بنر</small>" +
        '<button class="adm-btn adm-btn--ghost adm-btn--sm" type="button" data-act="new" data-placement="' + g.key + '" style="margin-inline-start:auto">' + icon("plus") + "افزودن</button></h3>" +
        '<div class="adm-banners">' + (rows || '<p class="adm-empty adm-card" style="padding:18px">بنری برای این جایگاه ثبت نشده است.</p>') + "</div></section>";
    }).join("");
  }

  // ------------------------------------------------------------ dialog
  function toLocalInput(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d)) return "";
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function paintUpload(key) {
    var box = dialog.querySelector('[data-banner-upload="' + key + '"]');
    var preview = box.querySelector("[data-preview]");
    var clear = box.querySelector("[data-clear]");
    var img = images[key];
    preview.style.backgroundImage = img ? "url('" + img.url.replace(/'/g, "%27") + "')" : "";
    preview.classList.toggle("has-img", !!img);
    clear.hidden = !img;
  }

  function syncCategoryField() {
    dialog.querySelector("[data-banner-catfield]").hidden = form.elements.placement.value !== "shop_top";
  }

  function open(banner, placement) {
    banner = banner || {};
    editingId = banner._id || null;
    form.reset();
    dialog.querySelector("[data-banner-title]").textContent = editingId ? "ویرایش بنر" : "بنر جدید";
    dialog.querySelector("[data-banner-error]").textContent = "";
    ["placement", "theme", "title", "eyebrow", "subtitle", "ctaText", "url", "imageAlt", "categorySlug"].forEach(function (k) {
      if (banner[k] !== undefined) form.elements[k].value = banner[k];
    });
    if (!editingId && placement) form.elements.placement.value = placement;
    form.elements.order.value = banner.order !== undefined ? banner.order : "";
    form.elements.startsAt.value = toLocalInput(banner.startsAt);
    form.elements.endsAt.value = toLocalInput(banner.endsAt);
    form.elements.isActive.checked = banner.isActive !== false;
    images.image = banner.image && banner.image.url ? banner.image : null;
    images.mobileImage = banner.mobileImage && banner.mobileImage.url ? banner.mobileImage : null;
    paintUpload("image");
    paintUpload("mobileImage");
    syncCategoryField();
    dialog.showModal();
    form.elements.title.focus();
  }

  function payload() {
    var el = form.elements;
    var toIso = function (v) { return v ? new Date(v).toISOString() : null; };
    return {
      placement: el.placement.value,
      theme: el.theme.value,
      title: el.title.value.trim(),
      eyebrow: el.eyebrow.value.trim(),
      subtitle: el.subtitle.value.trim(),
      ctaText: el.ctaText.value.trim(),
      url: el.url.value.trim(),
      imageAlt: el.imageAlt.value.trim(),
      categorySlug: el.placement.value === "shop_top" ? el.categorySlug.value : "",
      order: el.order.value,
      startsAt: toIso(el.startsAt.value),
      endsAt: toIso(el.endsAt.value),
      isActive: el.isActive.checked,
      image: images.image ? images.image.url : "",
      mobileImage: images.mobileImage ? images.mobileImage.url : "",
    };
  }

  function validate(p) {
    if (!p.title) return "عنوان بنر الزامی است.";
    if (p.url && !/^\/(?!\/)/.test(p.url) && !/^https?:\/\//i.test(p.url)) return "لینک مقصد باید با / شروع شود یا با https:// باشد.";
    if (p.startsAt && p.endsAt && new Date(p.startsAt) > new Date(p.endsAt)) return "تاریخ پایان باید بعد از تاریخ شروع باشد.";
    if (!p.image && p.placement !== "home_hero" && p.placement !== "home_strip") return "برای این جایگاه، تصویر دسکتاپ لازم است.";
    return "";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var p = payload();
    var err = validate(p);
    var errBox = dialog.querySelector("[data-banner-error]");
    errBox.textContent = err;
    if (err) return;
    var btn = dialog.querySelector("[data-banner-save]");
    btn.disabled = true;
    (editingId ? api("PUT", "/admin/banners/" + editingId, p) : api("POST", "/admin/banners", p))
      .then(function (res) {
        var i = banners.findIndex(function (b) { return b._id === res.banner._id; });
        if (i > -1) banners[i] = res.banner; else banners.push(res.banner);
        dialog.close();
        render();
        toast(editingId ? "بنر به‌روزرسانی شد" : "بنر اضافه شد");
      })
      .catch(function (error) { errBox.textContent = error.message; })
      .finally(function () { btn.disabled = false; });
  });

  form.elements.placement.addEventListener("change", syncCategoryField);
  dialog.querySelectorAll("[data-banner-close]").forEach(function (b) { b.addEventListener("click", function () { dialog.close(); }); });

  dialog.querySelectorAll("[data-banner-upload]").forEach(function (box) {
    var key = box.getAttribute("data-banner-upload");
    box.querySelector("[data-file]").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var fd = new FormData();
      fd.append("image", file);
      var preview = box.querySelector("[data-preview]");
      preview.textContent = "در حال بارگذاری…";
      fetch("/admin/banners/upload" + (key === "mobileImage" ? "?kind=mobile" : ""), { method: "POST", body: fd, credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          preview.textContent = key === "mobileImage" ? "همان تصویر دسکتاپ" : "بدون تصویر";
          if (!res.success) throw new Error(res.message);
          images[key] = { url: res.url, filename: res.filename };
          paintUpload(key);
        })
        .catch(function (error) {
          preview.textContent = key === "mobileImage" ? "همان تصویر دسکتاپ" : "بدون تصویر";
          toast(error.message || "بارگذاری ناموفق بود", true);
        });
      e.target.value = "";
    });
    box.querySelector("[data-clear]").addEventListener("click", function () { images[key] = null; paintUpload(key); });
  });

  // ------------------------------------------------------------ list actions
  function move(id, dir) {
    var b = banners.find(function (x) { return x._id === id; });
    var group = banners.filter(function (x) { return x.placement === b.placement; })
      .sort(function (a, c) { return (a.order || 0) - (c.order || 0) || String(a.createdAt).localeCompare(String(c.createdAt)); });
    var i = group.indexOf(b);
    var j = i + dir;
    if (j < 0 || j >= group.length) return;
    group.splice(i, 1);
    group.splice(j, 0, b);
    group.forEach(function (x, k) { x.order = (k + 1) * 10; });
    render();
    api("POST", "/admin/banners/reorder", { ids: group.map(function (x) { return x._id; }) })
      .catch(function (error) { toast(error.message, true); });
  }

  list.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-act");
    var banner = banners.find(function (b) { return b._id === id; });
    if (act === "new") return open(null, btn.getAttribute("data-placement"));
    if (act === "edit") return open(banner);
    if (act === "up") return move(id, -1);
    if (act === "down") return move(id, 1);
    if (act === "toggle") {
      return api("POST", "/admin/banners/" + id + "/toggle").then(function (res) {
        banner.isActive = res.banner.isActive;
        render();
        toast(banner.isActive ? "بنر فعال شد" : "بنر غیرفعال شد");
      }).catch(function (error) { toast(error.message, true); });
    }
    if (act === "delete") {
      if (!confirm("این بنر حذف شود؟ این کار قابل بازگشت نیست.")) return;
      return api("DELETE", "/admin/banners/" + id).then(function () {
        banners = banners.filter(function (b) { return b._id !== id; });
        render();
        toast("بنر حذف شد");
      }).catch(function (error) { toast(error.message, true); });
    }
  });

  document.querySelectorAll("[data-banner-new]").forEach(function (b) { b.addEventListener("click", function () { open(); }); });

  render();
  window.OdourBanners = { render: render, open: open };
})();
