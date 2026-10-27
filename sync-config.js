/**
 * sync-config.js — پیکربندیِ سینکِ ابری (APEX Pump Station Manager)
 * ---------------------------------------------------------------------------
 * ⚠ این برنامه «پروژهٔ Supabaseِ جداگانهٔ خودش» را دارد و هرگز نباید به پروژهٔ
 *   APEX Store Manager وصل شود؛ وگرنه حساب‌ها، لایسنس‌ها و داده‌ها قاطی می‌شوند.
 *
 * پس از ساختِ پروژهٔ جدید در supabase.com:
 *   Project Settings → API  →  «Project URL» و کلیدِ «anon public» را این‌جا بگذارید.
 *
 * فقط کلیدهای «عمومی» اینجا هستند (امن برای قرارگیری در برنامه/apk).
 * هرگز service_role key را اینجا نگذارید — امنیتِ واقعی با RLS در سرور است.
 *
 * تا وقتی این دو مقدار خالی باشند، برنامه کاملاً آفلاین (محلی) کار می‌کند و
 * هیچ درخواستی به هیچ سروری فرستاده نمی‌شود.
 * ---------------------------------------------------------------------------
 */
window.JOUYA_SYNC_CONFIG = {
    // آدرسِ پروژهٔ Supabaseِ «APEX Pump Station Manager» — مثل: https://abcdefgh.supabase.co
    url: 'https://nixdzurhksbpxyqagemg.supabase.co',

    // کلیدِ عمومی (anon/public) همان پروژه
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5peGR6dXJoa3NicHh5cWFnZW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNTg4NTAsImV4cCI6MjEwODYzNDg1MH0.PVO77D1n3xAsxE9PW1SBnrvk2nuqP4FKyObJuEMubJ8',

    // نسخهٔ پروتکلِ سینک (برای سازگاریِ آینده بینِ دسکتاپ و موبایل)
    syncProtocolVersion: 1,

    // سینکِ زنده: پس از ورود + مهاجرتِ موفق، push/pull خودکار و Realtime فعال می‌شوند.
    liveSyncEnabled: true
};
