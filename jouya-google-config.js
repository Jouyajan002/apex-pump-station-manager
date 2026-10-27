
/**
 * jouya-google-config.js — شناسهٔ کلاینتِ وبِ گوگل
 * ============================================================================
 * این فایل برای نسخه‌هایی لازم است که ورودِ نیتیوِ گوگل ندارند:
 *    • نسخهٔ وب و وبِ موبایل  (پنجرهٔ ورودِ گوگل؛ اگر مسدود شد → صفحهٔ oauth-callback.html)
 *    • اپلیکیشنِ اندروید (Capacitor) — ورود در مرورگرِ سیستم و بازگشت با apexps://oauth
 *
 * نسخهٔ ویندوز (Tauri) به این فایل نیازی ندارد — ورودِ گوگل آن‌جا از راهِ
 * دستورِ نیتیوِ hb_google_signin انجام می‌شود (در tauri-bridge.js وصل شده).
 *
 * ── چطور شناسه را بگیرید ─────────────────────────────────────────────────────
 *  ۱) console.cloud.google.com → پروژه را انتخاب یا بسازید
 *  ۲) APIs & Services → Credentials → Create credentials → OAuth client ID
 *  ۳) Application type = Web application
 *  ۴) در Authorized JavaScript origins نشانیِ سایتِ خود را بیفزایید
 *     (برای اپلیکیشنِ اندرویدِ Capacitor معمولاً: https://localhost)
 *  ۵) شناسهٔ ساخته‌شده را این‌جا بگذارید — چیزی شبیهِ:
 *        123456789012-abcdefghijklmnop.apps.googleusercontent.com
 *
 * ⚠ این «Client ID» است، نه «Client Secret». گذاشتنِ Client ID در فایلِ سمتِ
 *   کلاینت عادی و بی‌خطر است؛ Client Secret هرگز نباید این‌جا بیاید.
 *
 * تا وقتی این مقدار خالی بماند، نسخهٔ وب و اندروید پیامِ راهنما نشان می‌دهند و
 * بقیهٔ برنامه کاملاً دست‌نخورده کار می‌کند.
 */
(function () {
    'use strict';
    // ⚠ شناسهٔ کلاینتِ «Web application»ِ پروژهٔ گوگلِ همین برنامه (نه APEX Store Manager).
    //   لازم نیست دستی پر شود: ورک‌فلوهای گیت‌هاب هنگامِ بیلد آن را از سیکرتِ
    //   APEXPS_GOOGLE_WEB_CLIENT_ID می‌گذارند. (اگر دستی بگذارید، همان استفاده می‌شود.)
    var WEB_CLIENT_ID = '';   // ← شناسه را این‌جا بگذارید

    // نشانیِ صفحهٔ بازگشتِ ورود (برای اپِ اندروید لازم است؛ در وب خودکار تشخیص داده می‌شود).
    //   ورک‌فلو آن را خودکار می‌سازد:  https://<OWNER>.github.io/<REPO>/oauth-callback.html
    var OAUTH_REDIRECT_URL = '';

    try {
        if (WEB_CLIENT_ID) {
            window.JOUYA_GOOGLE_WEB_CLIENT_ID = WEB_CLIENT_ID;
        } else {
            // اگر قبلاً از راهِ تنظیماتِ برنامه ذخیره شده باشد، همان استفاده می‌شود
            var saved = null;
            try { saved = localStorage.getItem('jouya_google_web_client_id'); } catch (e) {}
            if (saved) window.JOUYA_GOOGLE_WEB_CLIENT_ID = String(saved);
        }
        if (OAUTH_REDIRECT_URL) window.APEXPS_OAUTH_REDIRECT = OAUTH_REDIRECT_URL;
    } catch (e) {}
})();
