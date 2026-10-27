# APEX Pump Station Manager — راهنمای کاملِ راه‌اندازی

این برنامه از پایهٔ **APEX Store Manager** ساخته شده ولی یک برنامهٔ **کاملاً جداگانه** است:
پروژهٔ Supabase، مخزنِ گیت‌هاب، شناسه‌های اپلیکیشن، نامِ فایل‌های پشتیبان، کشِ وب و
حافظهٔ محلیِ مرورگر هیچ‌کدام با Store Manager مشترک نیستند.

| مورد | APEX Store Manager | APEX Pump Station Manager |
|---|---|---|
| شناسهٔ اندروید | com.hesabdar.app | **com.apexpump.station** |
| شناسهٔ ویندوز | com.hesabdar.desktop | **com.apexpump.station.desktop** |
| نامِ اجرایی | hesabdar.exe | **apex-pump-station.exe** |
| حافظهٔ مرورگر | بدونِ پیشوند | پیشوندِ **`apexps:`** (فایلِ `apex-ns.js`) |
| کشِ وب (PWA) | jouya-v… | **apexps-v…** (فقط کشِ خودش را پاک می‌کند) |
| پشتیبانِ گوگل‌درایو | نامِ فایلِ قبلی | **apex-pump-station-backup.json** |
| لایسنس | مخزن/پروژهٔ قبلی | جدولِ `licenses` در Supabaseِ جدید (+ مخزنِ پشتیبانِ `apex-pump-station-licenses`) |
| بروزرسانی | Hesabdar_Web_Version | **apex-pump-station-manager** |

---

## ۱) Supabase — پروژهٔ جدید (حدود ۱۰ دقیقه)

1. به <https://supabase.com> بروید → **New project** → نام: `apex-pump-station` → رمزِ دیتابیس را جایی امن نگه دارید → Region نزدیک (مثلاً Frankfurt/Mumbai).
2. **SQL Editor → New query**، محتوای این فایل‌ها را **به ترتیب** Paste و **Run** کنید:
   1. `supabase/01_schema.sql` — فضای کاری، همهٔ جدول‌های سینک (شاملِ `meters` و `meter_readings`)، RLS، تریگرها، Realtime
   2. `supabase/02_license_device_release.sql` — لایسنس، تأییدِ دستگاهِ وب، اعلانِ نسخه، اعلانات
   (اجرای دوباره بی‌خطر است.)
3. **Authentication → Providers → Email**: فعال باشد. اگر نمی‌خواهید ایمیلِ تأیید ارسال شود، **Confirm email** را خاموش کنید (همان تنظیمِ Store Manager).
4. **Project Settings → API**: دو مقدار را بردارید:
   - **Project URL** (مثل `https://abcd1234.supabase.co`)
   - کلیدِ **anon public**
5. فایلِ **`sync-config.js`** را باز کنید و همین دو مقدار را بگذارید:
   ```js
   url: 'https://abcd1234.supabase.co',
   anonKey: 'eyJhbGciOi...',
   ```
   ⚠ هرگز کلیدِ `service_role` را در هیچ فایلی نگذارید.
6. ساختِ کدِ فعال‌سازی: از `supabase/03_admin_examples.sql` بخشِ ۱ را اجرا کنید (مثلاً `PUMP-2026-0001`).

> تا وقتی `url` و `anonKey` خالی باشند، برنامه کاملاً آفلاین کار می‌کند.

**تأییدِ مرورگرِ تازه (فقط نسخهٔ وب):** صفحهٔ وب در مرورگرِ جدید یک کدِ ۶ رقمی نشان می‌دهد؛
با بخشِ ۲ِ `03_admin_examples.sql` آن را `approved` کنید. ویندوز و اندروید این مرحله را ندارند.

---

## ۲) گیت‌هاب — مخزنِ جدید

1. در گیت‌هاب **New repository** → نام دقیقاً: **`apex-pump-station-manager`** (اگر نامِ دیگری
   گذاشتید، دو خطِ `ND_UPDATE_REPO` در `script.js` و `repo` در `version.json` را هم با همان نام عوض کنید).
2. همهٔ محتوای این پوشه (همین فایل‌ها، با پوشه‌های `.github`, `assets`, `build`, `src-tauri`,
   `mobile-icons`, `supabase`, `tools`) را در ریشهٔ مخزن آپلود/Push کنید.
3. **Settings → Actions → General → Workflow permissions** → **Read and write permissions** → Save.
4. **Settings → Pages → Build and deployment → Source = GitHub Actions**.
5. (اختیاری، برای ورودِ گوگل‌درایو در نسخهٔ ویندوز) **Settings → Secrets and variables → Actions → New repository secret**:
   - `APEXPS_GOOGLE_CLIENT_ID`
   - `APEXPS_GOOGLE_CLIENT_SECRET`

### ساختِ نسخه‌ها
| نسخه | ورک‌فلو | چگونه اجرا شود | خروجی |
|---|---|---|---|
| وب (PWA) | `pages-encrypted.yml` | هر Push به `main` | سایتِ GitHub Pages |
| ویندوز ۱۰/۱۱ | `desktop-tauri.yml` | ساختِ تگ `v1.0.0` یا اجرای دستی | `apex-pump-station-windows-setup` (exe/msi) |
| ویندوز ۷ | `desktop-tauri-win7.yml` | اجرای دستی (Actions → Run workflow) | `apex-pump-station-windows7-setup` |
| اندروید | `mobile-android.yml` | ساختِ تگ `v1.0.0` یا اجرای دستی | `APEX-Pump-Station-<نسخه>.apk` |

ساختِ تگ: **Releases → Draft a new release → Choose a tag → `v1.0.0` → Publish**.
با تگ، فایل‌ها خودکار در Releases هم منتشر می‌شوند.

---

## ۳) گوگل‌درایو (پشتیبان) — کلاینتِ جداگانه

شناسهٔ کلاینتِ Store Manager عمداً حذف شده تا پشتیبان‌ها قاطی نشوند.
در <https://console.cloud.google.com> یک پروژه بسازید → **APIs & Services → Credentials**:
- **OAuth client (Web application)** → شناسه را در `jouya-google-config.js` (متغیرِ `WEB_CLIENT_ID`) بگذارید.
  در *Authorized JavaScript origins* نشانیِ GitHub Pages و `https://localhost` (برای اندروید) را بیفزایید.
- **OAuth client (Desktop app)** → Client ID و Secret را در دو سیکرتِ بالا بگذارید.
- **Google Drive API** را Enable کنید.

---

## ۴) چه چیزهایی نباید در مخزن باشد
- `main.js`، `preload.js`، `diagnose-auth.js`، `repro_relogin.js` (نسخهٔ الکترون — دارای رمز/Secretِ واقعی بودند)
- کلیدِ `service_role` سوپابیس، رمزِ دیتابیس، هر فایلِ `.env` یا keystore

## ۵) نکتهٔ میزبانیِ وب
حافظهٔ محلیِ این برنامه با پیشوندِ `apexps:` جداست و Service Worker فقط کشِ خودش را پاک می‌کند،
پس حتی اگر هر دو برنامه روی یک حسابِ GitHub Pages باشند داده‌ها قاطی نمی‌شوند. با این حال،
نسخهٔ قدیمیِ Service Workerِ Store Manager همهٔ کش‌های دامنه را پاک می‌کند؛ اگر هر دو روی یک
دامنه باشند، ممکن است گاهی کشِ آفلاینِ پمپ استیشن یک‌بار از نو دانلود شود (بدونِ از دست رفتنِ داده).

## ۶) فایل‌های اختصاصیِ پمپ استیشن
| فایل | کار |
|---|---|
| `pump-station.js` | ذخایر/میتر، فورمِ تیل و ذخیره، تعریف و قرائتِ میتر، سطرهای بلِ فروش/خرید با ثقل، انتقال بین ذخایر، مصرف انتقال، ⊕ پرداختی، داشبورد، گزارشِ میتر |
| `pump-station.css` | استایلِ همین بخش‌ها (رنگ‌های برنامهٔ اصلی) |
| `apex-ns.js` | جداسازیِ حافظهٔ محلی از Store Manager — اولین اسکریپتِ صفحه |
| `supabase/*.sql` | ساختارِ کاملِ پایگاهِ داده |

**فرمولِ ثقل:** لیتر = (تن × ۱۰۰۰) ÷ ثقل — مثال: ۲ تن با ثقلِ ۰٫۷۵ = ۲۶۶۶٫۶۶۷ لیتر.
