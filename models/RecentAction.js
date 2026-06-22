const mongoose = require("mongoose");
const { getPersianDate } = require("../helper/getPersianDate");

const recentActionSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'create_product',
        'update_product', 
        'delete_product',
        'create_category',
        'update_category',
        'delete_category',
        'create_brand',
        'update_brand',
        'delete_brand',
        'create_discount',
        'update_discount',
        'delete_discount',
        'update_order_status',
        'create_weblog',
        'update_weblog',
        'delete_weblog',
        'admin_login',
        'admin_logout'
      ]
    },
    targetType: {
      type: String,
      enum: ['product', 'category', 'brand', 'discount', 'order', 'weblog', 'admin'],
      required: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    targetName: {
      type: String,
      required: true
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true
    },
    adminName: {
      type: String,
      required: true
    },
    details: {
      type: String,
      default: ''
    },
    ipAddress: {
      type: String
    },
    createdAt: {
      type: String,
      default: () => getPersianDate()
    },
    createdAtTimestamp: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// ایندکس برای جستجوی سریع
recentActionSchema.index({ createdAtTimestamp: -1 });
recentActionSchema.index({ adminId: 1 });
recentActionSchema.index({ action: 1 });

const RecentAction = mongoose.model("RecentAction", recentActionSchema);
module.exports = RecentAction;