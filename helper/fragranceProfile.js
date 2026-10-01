// Turns a product's admin-managed `specifications` (free key/value rows) into a
// structured fragrance profile for the product page and the shop filters.
//
// Admins don't need a new form: they keep adding specification rows, using the
// keys below (common spelling variants are accepted). Values that list several
// items are separated with «،» or «,». Accords may carry a strength, e.g.
// «چوبی:100، ادویه‌ای گرم:80».

const W = "[\\s\u200c]*"; // optional space / zero-width non-joiner between words
const rx = (body) => new RegExp(`^${body}$`);

const FIELDS = {
  family: { label: "گروه بویایی", pattern: rx(`(گروه${W}(بویایی|عطری)|خانواده${W}(بویایی|عطری))`) },
  scentType: { label: "نوع رایحه", pattern: rx(`(نوع${W}رایحه|نوع${W}بو|تیپ${W}رایحه)`) },
  accords: { label: "آکوردهای اصلی", pattern: rx(`(آکورد|آکوردها|آکورد${W}های${W}اصلی|آکوردهای${W}اصلی)`) },
  top: { label: "نت آغازین", pattern: rx(`نت${W}(ها|های)?${W}(آغازین|اولیه|ابتدایی|بالا)`) },
  heart: { label: "نت میانی", pattern: rx(`نت${W}(ها|های)?${W}(میانی|میانه|قلب)`) },
  base: { label: "نت پایه", pattern: rx(`نت${W}(ها|های)?${W}(پایه|پایانی|انتهایی)`) },
  notes: { label: "نت‌های اصلی", pattern: rx(`(نت|نت${W}ها|نت${W}های${W}اصلی|نت${W}اصلی)`) },
  longevity: { label: "ماندگاری", pattern: rx(`ماندگاری`) },
  sillage: { label: "پخش بو", pattern: rx(`(پخش${W}بو|پخش${W}رایحه|پخش|پراکندگی|سیلاژ)`) },
  time: { label: "زمان مصرف", pattern: rx(`(زمان${W}مصرف|زمان${W}استفاده|مناسب${W}زمان)`) },
  season: { label: "فصل", pattern: rx(`(فصل|فصل${W}مصرف|فصل${W}های${W}مناسب|مناسب${W}فصل)`) },
  gender: { label: "جنسیت", pattern: rx(`(جنسیت|مناسب${W}برای)`) },
  concentration: { label: "غلظت", pattern: rx(`(غلظت|نوع${W}عطر)`) },
  personality: { label: "مناسب شخصیت", pattern: rx(`(مناسب${W}شخصیت|شخصیت|تیپ${W}شخصیتی)`) },
  volume: { label: "حجم", pattern: rx(`حجم`) },
};

const normalize = (value) =>
  String(value || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();

// Splits «روز و شب، بهار / تابستان» style lists.
const splitList = (value) =>
  normalize(value)
    .split(/\s*[،,؛;/|]\s*|\s+و\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

function fieldForKey(key) {
  const k = normalize(key);
  return Object.keys(FIELDS).find((name) => FIELDS[name].pattern.test(k)) || null;
}

const SEASONS = [
  { id: "winter", label: "زمستان", icon: "snow", re: /زمستان/ },
  { id: "spring", label: "بهار", icon: "flower", re: /بهار/ },
  { id: "summer", label: "تابستان", icon: "sun", re: /تابستان/ },
  { id: "autumn", label: "پاییز", icon: "leaf", re: /پاییز/ },
];

const toLatinDigits = (value) =>
  String(value).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

function parseAccords(value) {
  const items = normalize(value).split(/\s*[،,؛;]\s*/).filter(Boolean);
  return items.slice(0, 8).map((item, index) => {
    const [name, strength] = item.split(/\s*[:：]\s*/);
    const parsed = parseInt(toLatinDigits(strength || ""), 10);
    const fallback = Math.max(40, 100 - index * 12);
    return { name: name.trim(), strength: Number.isFinite(parsed) ? Math.min(100, Math.max(10, parsed)) : fallback };
  });
}

function parseFragranceProfile(specifications = []) {
  const profile = {
    family: null,
    scentType: null,
    accords: [],
    notes: { top: [], heart: [], base: [], general: [] },
    longevity: null,
    sillage: null,
    time: null, // { day, night, label }
    seasons: [], // [{id,label,icon,active}]
    gender: null,
    concentration: null,
    personality: null,
    volume: null,
    others: [], // non-fragrance specification rows, shown as "key attributes"
    hasFragranceData: false,
  };

  for (const spec of specifications || []) {
    if (!spec || !spec.key || !spec.value) continue;
    const field = fieldForKey(spec.key);
    const value = normalize(spec.value);
    switch (field) {
      case "accords":
        profile.accords = parseAccords(value);
        break;
      case "top":
      case "heart":
      case "base":
        profile.notes[field] = splitList(value);
        break;
      case "notes":
        profile.notes.general = splitList(value);
        break;
      case "time": {
        const day = /روز|صبح|عصر/.test(value);
        const night = /شب/.test(value);
        profile.time = { day: day || (!day && !night), night, label: value };
        break;
      }
      case "season": {
        const all = /چهار\s*فصل|همه\s*فصل/.test(value);
        profile.seasons = SEASONS.map((s) => ({ ...s, active: all || s.re.test(value) }));
        break;
      }
      case null:
        profile.others.push({ key: normalize(spec.key), value });
        break;
      default:
        profile[field] = value;
    }
  }

  const n = profile.notes;
  profile.hasNotes = Boolean(n.top.length || n.heart.length || n.base.length || n.general.length);
  profile.hasFragranceData = Boolean(
    profile.accords.length || profile.hasNotes || profile.longevity || profile.sillage ||
      profile.time || profile.seasons.length || profile.family
  );
  return profile;
}

// Filters offered on the shop page. Each one reads the matching spec rows.
const FILTER_FACETS = [
  { param: "gender", label: "جنسیت", fields: ["gender"] },
  { param: "family", label: "گروه بویایی", fields: ["family"] },
  { param: "scent", label: "نوع رایحه", fields: ["scentType"] },
  { param: "concentration", label: "غلظت", fields: ["concentration"] },
  { param: "note", label: "نت اصلی", fields: ["top", "heart", "base", "notes"] },
  { param: "time", label: "مناسب زمان", fields: ["time"] },
  { param: "season", label: "فصل", fields: ["season"] },
  { param: "personality", label: "مناسب شخصیت", fields: ["personality"] },
];

module.exports = {
  FIELDS,
  FILTER_FACETS,
  normalize,
  splitList,
  fieldForKey,
  parseFragranceProfile,
};
