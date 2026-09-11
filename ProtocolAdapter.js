/**
 * ProtocolAdapter - اینترفیس پایه‌ای که تمام پروتکل‌ها باید پیاده‌سازی کنند.
 * افزودن پروتکل جدید = ساخت یک فایل جدید در همین پوشه که این کلاس را extend کند
 * و در protocols/index.js ثبت شود. بدون نیاز به تغییر در بقیه‌ی پروژه.
 */
class ProtocolAdapter {
  /** نام پروتکل، باید با enum Protocol در schema.prisma یکی باشد */
  static key = "BASE";

  /** لیست فیلدهای فرم اختصاصی این پروتکل (برای رندر داینامیک در فرانت‌اند) */
  static fields = [];

  /**
   * اعتبارسنجی ورودی کاربر برای این پروتکل.
   * @param {object} input
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validate(input) {
    throw new Error("validate() باید پیاده‌سازی شود");
  }

  /**
   * تولید ساختار نهایی settings که در دیتابیس ذخیره می‌شود (بعد از validate)
   * @param {object} input
   * @returns {object} settings
   */
  static generate(input) {
    throw new Error("generate() باید پیاده‌سازی شود");
  }

  /**
   * تبدیل settings ذخیره‌شده + اطلاعات سرور/پورت به یک URI/لینک قابل Import
   * @param {object} config شامل server, port, settings, name
   * @returns {string}
   */
  static parse(config) {
    throw new Error("parse() باید پیاده‌سازی شود");
  }

  /**
   * نرمال‌سازی settings قدیمی/ناقص به فرمت استاندارد فعلی (برای سازگاری با نسخه‌های قبلی)
   * @param {object} settings
   * @returns {object}
   */
  static normalize(settings) {
    return settings || {};
  }
}

module.exports = ProtocolAdapter;
