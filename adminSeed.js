// adminSeed.js - نسخه جدید
const mongoose = require("mongoose");
const Admin = require("./models/Admins");
require("dotenv").config();

async function createAdmin() {
  try {
    await mongoose.connect(process.env.DB_URL || "mongodb://localhost:27017/odour");

    const adminEmail = "abfa@gmail.com";
    const adminPassword = "F3q37w0M7Val";
    const adminName = "ABFA";
    
    // سوپر ادمین با همه دسترسی‌ها
    const superAdmin = new Admin({
      fullName: adminName,
      email: adminEmail,
      password: adminPassword,
      role: 'super_admin',
      isActive: true,
      permissions: [
        'manage_products',
        'manage_orders',
        'manage_users',
        'manage_categories',
        'manage_brands',
        'manage_discounts',
        'manage_weblogs',
        'view_analytics',
        'manage_admins'
      ]
    });
    
    await superAdmin.save();
    
    console.log(`✅ ادمین‌ها با موفقیت ساخته شدند:
    
    🔹 سوپر ادمین:
       ایمیل: ${adminEmail}
       رمز: ${adminPassword}
       نقش: super_admin
       دسترسی‌ها: همه
    `);
    
    process.exit();
  } catch (error) {
    console.error("❌ خطا در ایجاد ادمین:", error);
    process.exit(1);
  }
}

createAdmin();