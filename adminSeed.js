#!/usr/bin/env node
/*
 * Create (or reset) a super-admin account from environment variables.
 * Credentials are never hard-coded and the password is never printed.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-unique-passphrase' \
 *   ADMIN_NAME='مدیر فروشگاه' DB_URL=mongodb://127.0.0.1:27017/odour node adminSeed.js
 *
 * - If an admin with ADMIN_EMAIL exists, its password is reset (and it is re-activated).
 * - With NODE_ENV=production the script refuses to run unless --confirm-production is passed.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Admin = require("./models/Admins");

const PERMISSIONS = [
  "manage_products",
  "manage_orders",
  "manage_users",
  "manage_categories",
  "manage_brands",
  "manage_discounts",
  "manage_weblogs",
  "view_analytics",
  "manage_admins",
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  const fullName = String(process.env.ADMIN_NAME || "مدیر فروشگاه").trim();

  if (process.env.NODE_ENV === "production" && !process.argv.includes("--confirm-production")) {
    return fail("NODE_ENV=production: re-run with --confirm-production if you really intend to create/reset a production admin.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Set ADMIN_EMAIL to a valid email address.");
  if (password.length < 12) return fail("Set ADMIN_PASSWORD to at least 12 characters (it is not printed or stored in plain text).");

  await mongoose.connect(process.env.DB_URL || "mongodb://127.0.0.1:27017/odour");
  let admin = await Admin.findOne({ email }).select("+password");
  const created = !admin;
  if (!admin) {
    admin = new Admin({ fullName, email, role: "super_admin", permissions: PERMISSIONS });
  }
  admin.password = password; // hashed by the model's pre-save hook
  admin.isActive = true;
  if (created || process.env.ADMIN_NAME) admin.fullName = fullName;
  await admin.save();
  console.log(`${created ? "Created" : "Reset password for"} super admin ${email}.`);
}

main()
  .catch((error) => fail(`Admin seed failed: ${error.message}`))
  .finally(() => mongoose.disconnect().catch(() => {}));
