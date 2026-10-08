/* Account area: hash-based sections, order filter, profile form, addresses, logout. */
(function () {
  "use strict";
  var ODOUR = window.ODOUR || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var panels = $$("[data-panel-id]");
  var links = $$("[data-acc-nav] [data-tab]");

  function show(id) {
    if (!panels.some(function (p) { return p.getAttribute("data-panel-id") === id; })) id = "orders";
    panels.forEach(function (p) { p.hidden = p.getAttribute("data-panel-id") !== id; });
    links.forEach(function (l) { l.setAttribute("aria-current", l.getAttribute("data-tab") === id ? "true" : "false"); });
  }
  links.forEach(function (l) {
    l.addEventListener("click", function (e) {
      e.preventDefault();
      var id = l.getAttribute("data-tab");
      history.replaceState(null, "", "#" + id);
      show(id);
      var panel = document.getElementById(id);
      if (panel && window.innerWidth < 1024) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  window.addEventListener("hashchange", function () { show(location.hash.slice(1)); });
  show(location.hash.slice(1));

  // Recently viewed empty state (the list itself is filled by odour.js).
  var rv = $("[data-recently-viewed]");
  if (rv) {
    var observer = new MutationObserver(function () { if (!rv.hidden) $("[data-rv-empty]").hidden = true; });
    observer.observe(rv, { attributes: true, attributeFilter: ["hidden"] });
  }

  // Order filter.
  var filter = $("[data-order-filter]");
  if (filter) {
    filter.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-filter]");
      if (!btn) return;
      $$("[data-filter]", filter).forEach(function (b) { b.setAttribute("aria-selected", b === btn ? "true" : "false"); });
      var g = btn.getAttribute("data-filter");
      $$(".od-order").forEach(function (o) { o.hidden = g !== "all" && o.getAttribute("data-group") !== g; });
    });
  }

  // Profile form.
  var form = $("[data-profile-form]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("button[type=submit]", form);
      btn.classList.add("is-loading");
      ODOUR.api("/api/account/profile", { method: "PATCH", body: { fullName: form.fullName.value, email: form.email.value } })
        .then(function (d) { ODOUR.toast(d.message); })
        .catch(function (err) { ODOUR.toast(err.message, { type: "error" }); })
        .finally(function () { btn.classList.remove("is-loading"); });
    });
  }

  // Delete address.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-address-delete]");
    if (!btn) return;
    if (!window.confirm("این آدرس حذف شود؟")) return;
    btn.classList.add("is-loading");
    ODOUR.api("/api/account/addresses/" + encodeURIComponent(btn.getAttribute("data-address-delete")), { method: "DELETE" })
      .then(function (d) { btn.closest("[data-address]").remove(); ODOUR.toast(d.message); })
      .catch(function (err) { btn.classList.remove("is-loading"); ODOUR.toast(err.message, { type: "error" }); });
  });

  // Logout.
  var logout = $("[data-logout]");
  if (logout) {
    logout.addEventListener("click", function () {
      logout.disabled = true;
      ODOUR.api("/api/authentication/user/logout", { method: "POST" })
        .then(function () { location.href = "/"; })
        .catch(function (err) { logout.disabled = false; ODOUR.toast(err.message, { type: "error" }); });
    });
  }
})();
