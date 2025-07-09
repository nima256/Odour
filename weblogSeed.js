const mongoose = require("mongoose");
const Weblog = require("./models/Weblog");

mongoose
  .connect("mongodb://localhost:27017/odour")
  .then(async () => {
    console.log("Connected to Mongo");

    const weblogSeeds = [
      {
        name: "۱۰ نکته مراقبت از پوست در تابستان که باید بدانید",
        slug: "۱۰-نکته-مراقبت-از-پوست-در-تابستان-که-باید-بدانید",
        desciption:
          "از پوست خود در ماه‌های گرم تابستان با این نکات ضروری محافظت و تغذیه کنید.",
        weblogText:
          "از پوست خود در ماه‌های گرم تابستان با این نکات ضروری محافظت و تغذیه کنیداز پوست خود در ماه‌های گرم تابستان با این نکات ضروری محافظت و تغذیه کنیداز پوست خود در ماه‌های گرم تابستان با این نکات ضروری محافظت و تغذیه کنید",
        author: "ابلف",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/1717471580844b2bb3ce18f7a8613276e5d7068716.jpg?updatedAt=1751986979033",
          "https://ik.imagekit.io/vez3rkmrk/products/1698136680aa47c095011156e5cd5a9824faf90e5a.jpg?updatedAt=1752073322397",
          "https://ik.imagekit.io/vez3rkmrk/products/1697799357a31de6dc850f8db92ade7aac32f34923.jpg?updatedAt=1752073332766",
          "https://ik.imagekit.io/vez3rkmrk/products/168895776748e33818fcd26b6122bfc5fa2a4a6097.jpg?updatedAt=1752073332890",
        ],
      },
      {
        name: "راهنمای کامل برس‌های آرایشی",
        slug: "راهنمای-کامل-برس‌های-آرایشی",
        desciption:
          "بیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنید.",
        weblogText:
          "بیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنیدبیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنیدبیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنید",
        author: "256",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/1719404775ea85a47cc1dadff7590a33ef73a64e42.jpg?updatedAt=1752075003715",
          "https://ik.imagekit.io/vez3rkmrk/products/1717135780d272aa6164cee736f15f1ef9a0f58b4b.jpg?updatedAt=1752075022076",
          "https://ik.imagekit.io/vez3rkmrk/products/1738763302ffd9a0b4e04831560c579f598005f738.jpg?updatedAt=1752075022134",
          "https://ik.imagekit.io/vez3rkmrk/products/1736930102dacc2acbed2d0b3979599e6b696d4713.jpg?updatedAt=1752075024297",
        ],
      },
      {
        name: "دوتاش تکراری بود",
        slug: "دوتاش-تکراری-بود",
        desciption:
          "بیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنید.",
        weblogText:
          "بیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنیدبیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنیدبیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنید",
        author: "ابلف",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/1695710926c7126d98ec81a80b6121b5627391b589.jpg?updatedAt=1752075037452",
          "https://ik.imagekit.io/vez3rkmrk/products/1718249311cab3416f7eb0896d19020bcec284895f.jpg?updatedAt=1752075038830",
          "https://ik.imagekit.io/vez3rkmrk/products/1711548858c62b50847200c2f49ca32703ebd714ee_wk_sheglam.jpg?updatedAt=1752075048344",
          "https://ik.imagekit.io/vez3rkmrk/products/1717132945a252832680e7179bd5c9cd9cef1f4867.jpg?updatedAt=1752075078320",
        ],
      },
      {
        name: "یکیش تکراری بود",
        slug: "یکیش-تکراری-بود",
        desciption:
          "بیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنید.",
        weblogText:
          "بیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنیدبیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنیدبیاموزید که کدام برس‌ها را در مجموعه خود نیاز دارید و چگونه از آنها برای آرایش بی‌نقص استفاده کنید",
        author: "256",
        images: [
          "https://ik.imagekit.io/vez3rkmrk/products/16615061009f90aaac57b6bdb7fe71737820e5b313.jpg?updatedAt=1752075080887",
          "https://ik.imagekit.io/vez3rkmrk/products/1741919749c7b6d963f7a59bfa9da02ef89a020f87.jpg?updatedAt=1752075081727",
          "https://ik.imagekit.io/vez3rkmrk/products/1745477149a0859c0a34d92af19239b548debe223a.jpg?updatedAt=1752075085914",
          "https://ik.imagekit.io/vez3rkmrk/products/16802527366e0adbd094d19d3442b03a5e0f2b85e0_wk_sheglam.jpg?updatedAt=1752075090330",
        ],
      },
    ];

    await Weblog.insertMany(weblogSeeds);
    console.log("Weblog inserted");

    mongoose.disconnect();
  })
  .catch(console.error);
