/*
 * Shop / category listing: live filters, sorting, active-filter chips and
 * "load more". Progressive enhancement over a plain GET form.
 */
(function () {
  "use strict";
  var ODOUR = window.ODOUR || {};
  var cfg = ODOUR.catalog;
  if (!cfg) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var form = $("[data-filter-form]");
  var panel = $("#od-filters");
  var results = $("[data-results]");
  var chipsHost = $("[data-active-chips]");
  var moreBox = $("[data-more]");
  var moreBtn = $("[data-load-more]");
  var emptyBox = $("[data-empty]");
  var sortInput = $("[data-sort-input]");
  var isMobile = function () { return window.matchMedia("(max-width: 1023.98px)").matches; };
  var fa = ODOUR.faDigits || function (v) { return v; };
  var state = { page: cfg.page, pages: cfg.pages, total: cfg.total };
  var inflight;

  function params(extra) {
    var p = new URLSearchParams();
    new FormData(form).forEach(function (value, key) {
      value = String(value).trim();
      if (!value) return;
      if (key === "minPrice" || key === "maxPrice") value = (ODOUR.toLatin ? ODOUR.toLatin(value) : value).replace(/\D/g, "");
      if (value) p.append(key, value);
    });
    Object.keys(extra || {}).forEach(function (k) { p.set(k, extra[k]); });
    return p;
  }

  function apiUrl(p) {
    var q = new URLSearchParams(p);
    q.set("format", "html");
    q.set("limit", cfg.limit);
    if (cfg.scope) q.set("scope", cfg.scope);
    return "/api/products/filtered?" + q.toString();
  }

  function pageUrl(p) {
    var q = new URLSearchParams(p);
    q.delete("page");
    var s = q.toString();
    return cfg.basePath + (s ? "?" + s : "");
  }

  function fetchPage(p) {
    if (inflight) inflight.abort();
    inflight = "AbortController" in window ? new AbortController() : null;
    return fetch(apiUrl(p), { credentials: "same-origin", signal: inflight && inflight.signal }).then(function (r) {
      if (!r.ok) throw new Error("bad response");
      return r.json();
    });
  }

  function labelOf(input) {
    var label = input.closest("label");
    if (!label) return input.value;
    var clone = label.cloneNode(true);
    $$(".od-check__count, input", clone).forEach(function (n) { n.remove(); });
    return clone.textContent.trim();
  }

  function renderChips() {
    var html = "";
    var count = 0;
    $$("input[type=checkbox]:checked", form).forEach(function (input) {
      count++;
      html += '<button class="od-chip" type="button" data-remove-filter="' + input.name + '" data-value="' + ODOUR.escapeHtml(input.value) + '">' +
        ODOUR.escapeHtml(labelOf(input)) + " " + ODOUR.icon("x") + "</button>";
    });
    ["minPrice", "maxPrice"].forEach(function (name) {
      var input = form.elements[name];
      if (input && input.value.trim()) {
        count++;
        html += '<button class="od-chip" type="button" data-remove-filter="' + name + '">' + (name === "minPrice" ? "از " : "تا ") +
          ODOUR.escapeHtml(input.value) + " تومان " + ODOUR.icon("x") + "</button>";
      }
    });
    var search = form.elements.search;
    if (search && search.value) html += '<button class="od-chip" type="button" data-remove-filter="search">«' + ODOUR.escapeHtml(search.value) + "» " + ODOUR.icon("x") + "</button>";
    if (count > 1) html += '<a class="od-chip od-chip--clear" href="' + cfg.basePath + '">حذف همه</a>';
    chipsHost.innerHTML = html;
    $$("[data-active-count]").forEach(function (el) { el.setAttribute("data-count", count); el.textContent = count ? fa(count) : ""; });
    // Selected counters on facet headers.
    $$(".od-facet", form).forEach(function (facet) {
      var n = $$("input[type=checkbox]:checked", facet).length;
      var sel = $(".od-facet__sel", facet);
      if (!n && sel) sel.remove();
      if (n) {
        if (!sel) { sel = document.createElement("span"); sel.className = "od-facet__sel"; $("summary", facet).insertBefore(sel, $("summary .od-icon", facet)); }
        sel.textContent = fa(n);
      }
    });
  }

  function updateMore() {
    var shown = Math.min(state.page * cfg.limit, state.total);
    moreBox.hidden = state.page >= state.pages;
    $("[data-shown]").textContent = fa(shown);
    $("[data-total-2]").textContent = fa(state.total);
    $("[data-progress]").style.width = (state.total ? Math.round((shown / state.total) * 100) : 0) + "%";
    var p = params({ page: state.page + 1 });
    moreBtn.href = cfg.basePath + "?" + p.toString();
  }

  function setTotal(total) {
    state.total = total;
    $("[data-total]").textContent = fa(total);
    $$("[data-preview-count]").forEach(function (el) { el.textContent = fa(total); });
  }

  function apply(opts) {
    opts = opts || {};
    var p = params();
    results.classList.add("is-loading");
    results.setAttribute("aria-busy", "true");
    return fetchPage(p)
      .then(function (data) {
        var grid = $("[data-grid]", results);
        if (!grid) {
          grid = document.createElement("div");
          grid.className = "od-grid od-grid--4";
          grid.setAttribute("data-grid", "");
          results.insertBefore(grid, emptyBox);
        }
        grid.innerHTML = data.html || "";
        emptyBox.hidden = data.total > 0;
        grid.hidden = data.total === 0;
        state.page = 1;
        state.pages = data.pages;
        setTotal(data.total);
        updateMore();
        renderChips();
        history.replaceState(null, "", pageUrl(p));
        if (ODOUR.paintWish) ODOUR.paintWish();
        if (opts.scroll) {
          var top = results.getBoundingClientRect().top + window.scrollY - 140;
          if (window.scrollY > top) window.scrollTo({ top: top, behavior: "smooth" });
        }
      })
      .catch(function (err) {
        if (err.name !== "AbortError" && ODOUR.toast) ODOUR.toast("بارگذاری محصولات ناموفق بود. دوباره تلاش کنید.", { type: "error" });
      })
      .finally(function () { results.classList.remove("is-loading"); results.removeAttribute("aria-busy"); });
  }

  // Mobile sheet: preview the count while the shopper adjusts filters.
  var previewTimer;
  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      fetchPage(params()).then(function (d) {
        $$("[data-preview-count]").forEach(function (el) { el.textContent = fa(d.total); });
      }).catch(function () {});
    }, 250);
  }

  function onFilterChange() {
    if (isMobile() && panel.classList.contains("is-open")) { renderChips(); preview(); }
    else apply({ scroll: true });
  }

  form.addEventListener("change", function (e) {
    if (e.target.matches("[data-facet-search]")) return;
    onFilterChange();
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); onFilterChange(); });
  $$("[data-price-input]", form).forEach(function (input) {
    input.addEventListener("input", function () {
      var digits = (ODOUR.toLatin ? ODOUR.toLatin(input.value) : input.value).replace(/\D/g, "");
      input.value = digits ? ODOUR.faPrice(digits) : "";
    });
  });

  $("[data-apply-filters]").addEventListener("click", function () {
    apply({ scroll: true }).then(function () { ODOUR.closePanel(panel); });
  });

  // Brand search inside the facet.
  $$("[data-facet-search]", form).forEach(function (input) {
    var list = $("[data-facet-list]", input.closest(".od-facet__body"));
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      $$("label", list).forEach(function (l) { l.hidden = q && l.getAttribute("data-label").toLowerCase().indexOf(q) === -1; });
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
  });

  // Remove one active filter.
  chipsHost.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-remove-filter]");
    if (!chip) return;
    var name = chip.getAttribute("data-remove-filter");
    var value = chip.getAttribute("data-value");
    if (name === "minPrice" || name === "maxPrice") form.elements[name].value = "";
    else if (name === "search") form.elements.search.remove();
    else $$('input[name="' + name + '"]', form).forEach(function (i) { if (i.value === value) i.checked = false; });
    apply({ scroll: false });
  });

  // Sorting (desktop select + mobile sheet).
  function setSort(value) {
    sortInput.value = value === "popular" ? "" : value;
    $$("[data-sort-label]").forEach(function (el) { el.textContent = cfg.sortLabels[value]; });
    var select = $("[data-sort-select]");
    if (select) select.value = value;
    $$("[data-sort-radio]").forEach(function (r) { r.checked = r.value === value; });
    apply({ scroll: true });
  }
  var sortSelect = $("[data-sort-select]");
  if (sortSelect) sortSelect.addEventListener("change", function () { setSort(sortSelect.value); });
  $$("[data-sort-radio]").forEach(function (r) {
    r.addEventListener("change", function () { setSort(r.value); ODOUR.closePanel(r.closest("[data-panel]")); });
  });

  // Load more (keeps the URL for the first page so refresh/share stays simple).
  moreBtn.addEventListener("click", function (e) {
    e.preventDefault();
    moreBtn.classList.add("is-loading");
    fetchPage(params({ page: state.page + 1 }))
      .then(function (data) {
        var grid = $("[data-grid]", results);
        var tmp = document.createElement("div");
        tmp.innerHTML = data.html || "";
        var first = tmp.firstElementChild;
        while (tmp.firstChild) grid.appendChild(tmp.firstChild);
        state.page = data.page;
        state.pages = data.pages;
        updateMore();
        if (ODOUR.paintWish) ODOUR.paintWish();
        var link = first && first.querySelector("a");
        if (link) link.focus({ preventScroll: true });
      })
      .catch(function () { ODOUR.toast && ODOUR.toast("بارگذاری محصولات بیشتر ناموفق بود.", { type: "error" }); })
      .finally(function () { moreBtn.classList.remove("is-loading"); });
  });

  // Category description "read more".
  var readmore = $("[data-readmore]");
  var readmoreBtn = $("[data-readmore-toggle]");
  if (readmore && readmoreBtn) {
    if (readmore.scrollHeight <= readmore.clientHeight + 20) { readmore.classList.add("is-open"); readmoreBtn.hidden = true; }
    readmoreBtn.addEventListener("click", function () {
      var open = readmore.classList.toggle("is-open");
      readmoreBtn.textContent = open ? "بستن" : "بیشتر بخوانید";
    });
  }

  // Opening the sheet resets the preview count to the current total.
  if (panel) panel.addEventListener("od:open", function () { $$("[data-preview-count]").forEach(function (el) { el.textContent = fa(state.total); }); });
  // Closing the sheet without applying keeps the visible results consistent with the form.
  if (panel) panel.addEventListener("od:close", function () {
    var current = new URLSearchParams(location.search);
    current.delete("page");
    if (current.toString() !== params().toString()) apply({ scroll: false });
  });
})();
