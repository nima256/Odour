const mongoose = require("mongoose");
const Product = require("./models/Product");
const Category = require("./models/Category");
const Brand = require("./models/Brand");

mongoose
  .connect("mongodb://localhost:27017/odour")
  .then(async () => {
    console.log("Connected to Mongo");

    const category1 = await Category.findOne({ slug: "آرایش-صورت" });
    const category2 = await Category.findOne({ slug: "مراقبت-پوست" });
    const category3 = await Category.findOne({ slug: "مراقبت-مو" });
    const category4 = await Category.findOne({ slug: "عطر-و-ادکلن" });

    const brand2 = await Brand.findOne({ slug: "لورآل" });
    const brand1 = await Brand.findOne({ slug: "شانل" });
    const brand3 = await Brand.findOne({ slug: "میبلین" });
    const brand4 = await Brand.findOne({ slug: "نیوآ" });

    if (!category1) {
      console.error("Category not found");
      return;
    }
    if (!category2) {
      console.error("Category not found");
      return;
    }
    if (!category3) {
      console.error("Category not found");
      return;
    }
    if (!category4) {
      console.error("Category not found");
      return;
    }

    if (!brand1) {
      console.error("Brand not found");
      return;
    }
    if (!brand2) {
      console.error("Brand not found");
      return;
    }
    if (!brand3) {
      console.error("Brand not found");
      return;
    }
    if (!brand4) {
      console.error("Brand not found");
      return;
    }

    const productSeeds = [
      {
        name: "رژ لب مات پریمیوم",
        slug: "رژ-لب-مات-پریمیوم",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/1717471580844b2bb3ce18f7a8613276e5d7068716.jpg?updatedAt=1751986979033",
          "https://ik.imagekit.io/vez3rkmrk/products/1698136680aa47c095011156e5cd5a9824faf90e5a.jpg?updatedAt=1752073322397",
          "https://ik.imagekit.io/vez3rkmrk/products/1697799357a31de6dc850f8db92ade7aac32f34923.jpg?updatedAt=1752073332766",
          "https://ik.imagekit.io/vez3rkmrk/products/168895776748e33818fcd26b6122bfc5fa2a4a6097.jpg?updatedAt=1752073332890",
        ],
        price: 320000,
        catName: "آرایش صورت",
        brandName: "لورآل",
        catId: category1._id,
        subCatId: "",
        subCat: "",
        category: category1._id,
        brand: brand1._id,
        countInStock: 5,
        rating: 5,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "قرمز", rgb: "#FF0000" },
          { name: "آبی", rgb: "#0000FF" },
          { name: "سبز", rgb: "#00FF00" },
          { name: "مشکی", rgb: "#000000" },
        ],
        sizes: [
          { size: "10ml", usage: "مسافرتی" },
          { size: "20ml", usage: "استاندارد" },
          { size: "30ml", usage: "اکونومی" },
          { size: "40ml", usage: "اتمی" },
        ],
        reviewsNum: 24,
        lilDescription: "رنگ‌های جذاب و ماندگار با فرمول مخصوص",
        btnColor: "from-purple-600 to-pink-600",
        isPopular: true,
      },
      {
        name: "عطر گل یاس پاریسی",
        slug: "عطر-گل-یاس-پاریسی",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/1719404775ea85a47cc1dadff7590a33ef73a64e42.jpg?updatedAt=1752075003715",
          "https://ik.imagekit.io/vez3rkmrk/products/1717135780d272aa6164cee736f15f1ef9a0f58b4b.jpg?updatedAt=1752075022076",
          "https://ik.imagekit.io/vez3rkmrk/products/1738763302ffd9a0b4e04831560c579f598005f738.jpg?updatedAt=1752075022134",
          "https://ik.imagekit.io/vez3rkmrk/products/1736930102dacc2acbed2d0b3979599e6b696d4713.jpg?updatedAt=1752075024297",
        ],
        price: 420000,
        offerPrice: 120000,
        catName: "مراقبت پوست",
        brandName: "شانل",
        catId: category2._id,
        subCatId: "",
        subCat: "",
        category: category2._id,
        brand: brand2._id,
        countInStock: 8,
        rating: 3,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "صورتی کلاسیک", rgb: "#f4e6e7" },
          { name: "قرمز یاقوتی", rgb: "#e8b4b8" },
          { name: "نود طبیعی", rgb: "#f5d5ae" },
          { name: "مرجانی گرم", rgb: "#f7f3f0" },
        ],
        sizes: [
          { size: "20ml", usage: "استاندارد" },
          { size: "40ml", usage: "بمبی" },
        ],
        reviewsNum: 12,
        lilDescription: "آبرسانی عمیق و جوان‌سازی پوست",
        btnColor: "from-blue-600 to-teal-600",
        isNew: true,
        discount: 15,
      },
      {
        name: "پالت سایه چشم",
        slug: "پالت-سایه-چشم",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/1695710926c7126d98ec81a80b6121b5627391b589.jpg?updatedAt=1752075037452",
          "https://ik.imagekit.io/vez3rkmrk/products/1718249311cab3416f7eb0896d19020bcec284895f.jpg?updatedAt=1752075038830",
          "https://ik.imagekit.io/vez3rkmrk/products/1711548858c62b50847200c2f49ca32703ebd714ee_wk_sheglam.jpg?updatedAt=1752075048344",
          "https://ik.imagekit.io/vez3rkmrk/products/1717132945a252832680e7179bd5c9cd9cef1f4867.jpg?updatedAt=1752075078320",
        ],
        price: 320000,
        offerPrice: 150000,
        catName: "مراقبت مو",
        brandName: "میبلین",
        catId: category3._id,
        subCatId: "",
        subCat: "",
        category: category3._id,
        brand: brand3._id,
        countInStock: 2,
        rating: 1,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "سفید", rgb: "#FFFFFF" },
          { name: "خاکستری", rgb: "#808080" },
          { name: "نارنجی", rgb: "#FFA500" },
          { name: "زرد", rgb: "#FFFF00" },
        ],
        sizes: [
          { size: "20ml", usage: "استاندارد" },
          { size: "30ml", usage: "بمبی" },
          { size: "60ml", usage: "بنگر" },
        ],
        reviewsNum: 76,
        lilDescription: "رایحه‌ای لوکس و جذاب برای مناسبات خاص",
        btnColor: "from-green-600 to-emerald-600",
        discount: 41,
        isPopular: true,
      },
      {
        name: "سرم هیالورونیک اسید",
        slug: "سرم-هیالورونیک-اسید",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/16615061009f90aaac57b6bdb7fe71737820e5b313.jpg?updatedAt=1752075080887",
          "https://ik.imagekit.io/vez3rkmrk/products/1741919749c7b6d963f7a59bfa9da02ef89a020f87.jpg?updatedAt=1752075081727",
          "https://ik.imagekit.io/vez3rkmrk/products/1745477149a0859c0a34d92af19239b548debe223a.jpg?updatedAt=1752075085914",
          "https://ik.imagekit.io/vez3rkmrk/products/16802527366e0adbd094d19d3442b03a5e0f2b85e0_wk_sheglam.jpg?updatedAt=1752075090330",
        ],
        price: 126000,
        catName: "عطر و ادکلن",
        brandName: "نیوآ",
        catId: category4._id,
        subCatId: "",
        subCat: "",
        category: category4._id,
        brand: brand4._id,
        countInStock: 8,
        rating: 3,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "صورتی", rgb: "#FFC0CB" },
          { name: "بنفش", rgb: "#800080" },
          { name: "فیروزه‌ای", rgb: "#40E0D0" },
          { name: "قهوه‌ای", rgb: "#8B4513" },
        ],
        sizes: [{ size: "10", usage: "استاندارد" }],
        reviewsNum: 98,
        lilDescription: "تقویت و نرمی موهای آسیب‌دیده",
        btnColor: "from-yellow-600 to-orange-600",
      },
      {
        name: "بالم مرطوب‌کننده لب",
        slug: "بالم-مرطوب‌کننده-لب",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/16844824866f5550505821cb9917822e33394230f1.jpg?updatedAt=1752075102516",
          "https://ik.imagekit.io/vez3rkmrk/products/16802527400bb0d46b1531d06e00dfc245a006e036_wk_sheglam.jpg?updatedAt=1752075105234",
          "https://ik.imagekit.io/vez3rkmrk/products/1732243270e90b1b4e51d69ec0ffbab3023327aad8.jpg?updatedAt=1752075119305",
          "https://ik.imagekit.io/vez3rkmrk/products/1661506099f05805110052755896d29c44cde7a621.jpg?updatedAt=1752075140937",
          "https://ik.imagekit.io/vez3rkmrk/products/1732186102598d8c0d95e284ebcc4c05167ebdafd5.jpg?updatedAt=1752075212559",
        ],
        price: 560000,
        offerPrice: 544000,
        catName: "آرایش صورت",
        brandName: "لورآل",
        catId: category1._id,
        subCatId: "",
        subCat: "",
        category: category1._id,
        brand: brand1._id,
        countInStock: 1,
        rating: 5,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "طلایی", rgb: "#FFD700" },
          { name: "نقره‌ای", rgb: "#C0C0C0" },
          { name: "لاجوردی", rgb: "#1E90FF" },
          { name: "سبز زیتونی", rgb: "#808000" },
        ],
        sizes: [
          { size: "20ml", usage: "استاندارد" },
          { size: "30ml", usage: "بمبی" },
          { size: "60ml", usage: "بنگر" },
        ],
        reviewsNum: 154,
        lilDescription: "12 رنگ متنوع برای آرایش حرفه‌ای",
        btnColor: "from-purple-600 to-pink-600",
        isNew: true,
        discount: 6,
      },
      {
        name: "شامپو ترمیم‌ کننده",
        slug: "شامپو-ترمیم‌-کننده",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/17314192656e30257f79a81af35c6b23ad6b526b3c.jpg?updatedAt=1752075142323",
          "https://ik.imagekit.io/vez3rkmrk/products/171688378408d59d3bcf3bcf437da05a3f9e2543ea.jpg?updatedAt=1752075143441",
          "https://ik.imagekit.io/vez3rkmrk/products/17419197519ec93fef2d4d540d34d8f41acc52e7ea.jpg?updatedAt=1752075155857",
          "https://ik.imagekit.io/vez3rkmrk/products/16937985864a4750ea7ce23cafbf50f61a71f58077.jpg?updatedAt=1752075166260",
          "https://ik.imagekit.io/vez3rkmrk/products/17361420899325e4439b7f5756a81ae45c219b7294.jpg?updatedAt=1752075201249",
        ],
        price: 888000,
        offerPrice: 876000,
        catName: "مراقبت پوست",
        brandName: "شانل",
        catId: category2._id,
        subCatId: "",
        subCat: "",
        category: category2._id,
        brand: brand2._id,
        countInStock: 56,
        rating: 5,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "یاسی", rgb: "#E6E6FA" },
          { name: "عنابی", rgb: "#800000" },
          { name: "سرخابی", rgb: "#FF00FF" },
          { name: "یشمی", rgb: "#00A86B" },
        ],
        sizes: [
          { size: "20ml", usage: "استاندارد" },
          { size: "30ml", usage: "بمبی" },
          { size: "60ml", usage: "بنگر" },
        ],
        reviewsNum: 87,
        lilDescription: "نرمی و حفاظت طولانی مدت",
        btnColor: "from-blue-600 to-teal-600",
        discount: 30,
        isPopular: true,
      },
      {
        name: "کرم ضد آفتاب",
        slug: "کرم-ضد-آفتاب",
        description:
          "رژ لب مایع مات لاکچری با فرمول پیشرفته و کیفیت بی‌نظیر، انتخابی عالی برای خانم‌های شیک‌پوش است. این محصول با بافت کرمی و نرم، به راحتی روی لب‌ها پخش می‌شود و پس از خشک شدن، فینیش مات زیبا و یکنواختی ایجاد می‌کند. فرمول غنی شده با ویتامین E و روغن‌های طبیعی، ضمن ایجاد رنگ زیبا و پوشش کامل، از خشکی لب‌ها جلوگیری می‌کند. این رژ لب تا ۱۲ ساعت بر روی لب‌ها باقی می‌ماند و نیازی به تجدید مکرر ندارد.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند.مناسب برای تمام مناسبت‌ها از جمله استفاده روزانه، مهمانی‌ها و مراسم خاص. رنگ‌بندی متنوع این محصول امکان انتخاب مناسب برای هر سلیقه و تن پوستی را فراهم می‌کند",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/174131514786a64f6c263c2fe9e63d1be62ac57c0a.jpg?updatedAt=1752075177217",
          "https://ik.imagekit.io/vez3rkmrk/products/169814102019be71fd5dac11241f564ccb56df8013_wk_sheglam.jpg?updatedAt=1752075191525",
          "https://ik.imagekit.io/vez3rkmrk/products/172077650052eadbae11f7fe2f49be358830555e01.jpg?updatedAt=1752075191654",
          "https://ik.imagekit.io/vez3rkmrk/products/173876334092bde06d743648a1c04250ed7cb60b8a.jpg?updatedAt=1752075192498",
          "https://ik.imagekit.io/vez3rkmrk/products/17321861018514cd4fb6e7a56d44d57b35e6d9cad8.jpg?updatedAt=1752075200808",
        ],
        price: 920000,
        catName: "مراقبت مو",
        brandName: "میبلین",
        catId: category3._id,
        subCatId: "",
        subCat: "",
        category: category3._id,
        brand: brand3._id,
        countInStock: 85,
        rating: 3,
        isFeatured: true,
        weight: "10",
        colors: [
          { name: "آبی نفتی", rgb: "#003366" },
          { name: "زغالی", rgb: "#36454F" },
          { name: "آبی آسمانی", rgb: "#87CEEB" },
          { name: "لیمویی", rgb: "#FFF44F" },
        ],
        sizes: [
          { size: "20ml", usage: "استاندارد" },
          { size: "40ml", usage: "بمبی" },
        ],
        reviewsNum: 24,
        lilDescription: "محافظت کامل در برابر اشعه UV",
        btnColor: "from-green-600 to-emerald-600",
        isPopular: true,
      },
    ];

    await Product.insertMany(productSeeds);
    console.log("Products inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
