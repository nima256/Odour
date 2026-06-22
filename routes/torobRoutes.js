const express = require("express");
const { torobApiV3, torobSitemap } = require("../controllers/torobController");

const router = express.Router();

// مسیر اصلی API ترب (مطابق مستندات)
router.post("/torob_api/v3/products", torobApiV3);

// نقشه سایت فروشگاه (بدون جاوااسکریپت)
router.get("/torob-sitemap", torobSitemap);

module.exports = router;