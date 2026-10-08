const RecentAction = require("../models/RecentAction");

const logAction = async (req, res, next, actionData) => {
  try {
    const admin = req.admin;
    if (!admin) return next();
    
    const recentAction = new RecentAction({
      action: actionData.action,
      targetType: actionData.targetType,
      targetId: actionData.targetId,
      targetName: actionData.targetName,
      adminId: admin._id,
      adminName: admin.fullName,
      details: actionData.details || '',
      ipAddress: req.ip
    });
    
    await recentAction.save();
    next();
  } catch (error) {
    console.error("Error logging action:", error);
    next();
  }
};

// تابع کمکی برای لاگ کردن بعد از عملیات
const logAfterAction = (req, res, next, actionData) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    if (data && data.success) {
      logAction(req, res, () => {}, actionData);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

module.exports = { logAction, logAfterAction };