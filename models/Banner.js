const mongoose = require("mongoose");

// Admin-managed promotional / editorial banners shown across the storefront.
// `placement` decides where (and in which visual layout) a banner renders.
const PLACEMENTS = {
  home_hero: "هیرو صفحه اصلی (متن و دکمه کنار مدل سه‌بعدی)",
  home_promo: "بنر تبلیغاتی عریض صفحه اصلی",
  home_collection: "کالکشن / فصلی صفحه اصلی",
  home_category: "کاشی دسته‌بندی صفحه اصلی",
  home_editorial: "بنر برند / داستان اودر",
  home_strip: "نوار تبلیغاتی بین بخش‌های محصول",
  shop_top: "بالای صفحه فروشگاه و دسته‌بندی",
};

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true },
    filename: { type: String, trim: true },
  },
  { _id: false }
);

const bannerSchema = new mongoose.Schema(
  {
    placement: { type: String, enum: Object.keys(PLACEMENTS), required: true, index: true },
    eyebrow: { type: String, trim: true, maxlength: 60, default: "" },
    title: { type: String, trim: true, maxlength: 120, required: [true, "عنوان بنر الزامی است"] },
    subtitle: { type: String, trim: true, maxlength: 300, default: "" },
    ctaText: { type: String, trim: true, maxlength: 40, default: "" },
    url: {
      type: String,
      trim: true,
      default: "",
      validate: {
        // Internal paths or absolute http(s) links only.
        validator: (v) => !v || /^\/(?!\/)/.test(v) || /^https?:\/\//i.test(v),
        message: "آدرس مقصد باید با / شروع شود یا یک لینک http(s) باشد",
      },
    },
    image: { type: imageSchema, default: undefined },
    mobileImage: { type: imageSchema, default: undefined },
    imageAlt: { type: String, trim: true, maxlength: 140, default: "" },
    // Visual tone of the text panel; all tones come from the brand palette.
    theme: { type: String, enum: ["cream", "olive", "dark", "light"], default: "cream" },
    // Optional: show a shop_top banner only on one category page (by slug).
    categorySlug: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

bannerSchema.index({ placement: 1, isActive: 1, order: 1 });

// Active banners grouped by placement, respecting the optional schedule.
bannerSchema.statics.activeByPlacement = async function (placements) {
  const now = new Date();
  const list = await this.find({
    placement: { $in: placements },
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  })
    .sort({ order: 1, createdAt: 1 })
    .lean();
  const grouped = Object.fromEntries(placements.map((p) => [p, []]));
  list.forEach((b) => grouped[b.placement].push(b));
  return grouped;
};

bannerSchema.statics.PLACEMENTS = PLACEMENTS;

module.exports = mongoose.model("Banner", bannerSchema);
