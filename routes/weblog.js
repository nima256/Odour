const express = require('express');
const router = express.Router();
const Weblog = require('../models/Weblog');
const Category = require('../models/Category');

// دریافت همه مقالات با دسته‌بندی‌ها
router.get('/api/weblog/posts', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = { isPublished: true };
    
    if (category && category !== 'all') {
      const categoryDoc = await Category.findOne({ 
        name: category, 
        categoryType: 'weblog' 
      });
      if (categoryDoc) {
        filter.categories = categoryDoc._id;
      }
    }
    
    const posts = await Weblog.find(filter)
      .populate('categories', 'name color textColor')
      .populate('authorDetails', 'fullName')
      .sort({ publishedAt: -1 })
      .limit(50);
    
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// دریافت آخرین ۵ مقاله
router.get('/api/weblog/latest', async (req, res) => {
  try {
    const posts = await Weblog.find({ isPublished: true })
      .populate('categories', 'name color textColor')
      .populate('authorDetails', 'fullName')
      .sort({ publishedAt: -1 })
      .limit(5);
    
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// دریافت یک مقاله با اسلاگ
router.get('/api/weblog/post/:slug', async (req, res) => {
  try {
    const post = await Weblog.findOne({ slug: req.params.slug, isPublished: true })
      .populate('categories', 'name color textColor')
      .populate('authorDetails', 'fullName');
    
    if (!post) {
      return res.status(404).json({ success: false, message: 'مقاله یافت نشد' });
    }
    
    // افزایش تعداد بازدید
    post.viewCount += 1;
    await post.save();
    
    // دریافت مقالات مشابه
    const relatedPosts = await Weblog.find({
      _id: { $ne: post._id },
      isPublished: true,
      categories: { $in: post.categories }
    })
      .populate('categories', 'name')
      .limit(4)
      .sort({ publishedAt: -1 });
    
    res.json({ success: true, post, relatedPosts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// دریافت همه دسته‌بندی‌های وبلاگ
router.get('/api/weblog/categories', async (req, res) => {
  try {
    const categories = await Category.find({ 
      categoryType: 'weblog',
      isActive: true 
    }).select('name slug color textColor');
    
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// دریافت آمار وبلاگ
router.get('/api/weblog/stats', async (req, res) => {
  try {
    const articlesCount = await Weblog.countDocuments({ isPublished: true });
    const commentsCount = 1203; // می‌توانید از مدل کامنت واقعی استفاده کنید
    
    res.json({ 
      success: true, 
      stats: {
        articles: articlesCount,
        satisfaction: 98,
        writers: 8,
        comments: commentsCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
