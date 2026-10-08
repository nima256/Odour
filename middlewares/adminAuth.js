// middlewares/adminAuth.js
const Admin = require("../models/Admins");

const isAdminLoggedIn = async (req, res, next) => {
  try {
    // مسیرهای عمومی
    if (req.path === '/login' || 
        req.path === '/login-page' || 
        req.path.startsWith('/css/') || 
        req.path.startsWith('/js/') || 
        req.path.startsWith('/fonts/') ||
        req.path === '/favicon.ico') {
      return next();
    }
    
    // چک کردن سشن
    if (!req.session || !req.session.adminId) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({
          success: false,
          message: "لطفاً وارد حساب مدیریت شوید"
        });
      }
      return res.redirect('/admin/login');
    }
    
    const admin = await Admin.findById(req.session.adminId).select('+isActive');
    
    if (!admin) {
      req.session.destroy();
      return res.redirect('/admin/login');
    }
    
    if (!admin.isActive) {
      req.session.destroy();
      return res.redirect('/admin/login?error=account_disabled');
    }
    
    req.admin = admin;
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    res.redirect('/admin/login');
  }
};

module.exports = { isAdminLoggedIn };