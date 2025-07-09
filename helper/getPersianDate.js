const jalaali = require("jalaali-js");

function getPersianDate(date = new Date()) {
  const jDate = jalaali.toJalaali(date);
  const weekdays = [
    "یک‌شنبه",
    "دوشنبه",
    "سه‌شنبه",
    "چهارشنبه",
    "پنج‌شنبه",
    "جمعه",
    "شنبه",
  ];
  const months = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
  ];

  const dayOfWeek = weekdays[date.getDay()];
  const day = jDate.jd.toString().padStart(2, "۰");
  const month = months[jDate.jm - 1];
  const year = jDate.jy;

  const hour = date.getHours().toString().padStart(2, "۰");
  const minute = date.getMinutes().toString().padStart(2, "۰");
  const second = date.getSeconds().toString().padStart(2, "۰");

  return `${hour}:${minute}:${second} ${dayOfWeek} ${day} ${month} ${year}`;
}

module.exports = { getPersianDate };
