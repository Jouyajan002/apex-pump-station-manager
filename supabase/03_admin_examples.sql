-- ═══════════════════════════════════════════════════════════════════════════
--  APEX Pump Station Manager — دستورهای مدیریتی (نمونه)
--  هر بخش را جداگانه، هر وقت لازم شد، در SQL Editorِ همان پروژهٔ پمپ استیشن اجرا کنید.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ۱) ساختِ کدِ فعال‌سازی (لایسنس) ─────────────────────────────────────────
--  کد را با حروفِ بزرگ بنویسید. expires_at خالی = بدونِ انقضا.
insert into public.licenses (code, note)                     values ('PUMP-2026-0001', 'مشتری: آریانا پمپ استیشن');
insert into public.licenses (code, expires_at, note)         values ('PUMP-2026-0002', now() + interval '1 year', 'یک‌ساله');

-- فهرستِ لایسنس‌ها و اینکه کدام فضای کاری/ایمیل آن را گرفته
select code, active, expires_at, used_by_email, used_at from public.licenses order by created_at desc;

-- غیرفعال‌کردن / آزادکردنِ یک کد
update public.licenses set active = false where code = 'PUMP-2026-0002';
update public.licenses set used_by_workspace = null, used_by_email = null, used_at = null where code = 'PUMP-2026-0001';

-- ── ۲) تأییدِ مرورگرِ تازه (فقط نسخهٔ وب) ───────────────────────────────────
--  کاربر کدِ ۶ رقمیِ روی صفحه را برایتان می‌فرستد:
select device_key, label, code, status, created_at, last_seen from public.device_requests order by created_at desc;
update public.device_requests set status = 'approved', approved_at = now(), updated_at = now() where code = '123456';
--  مسدودکردن:
update public.device_requests set status = 'blocked', updated_at = now() where code = '123456';

-- ── ۳) اعلانِ نسخهٔ جدیدِ اندروید (بعد از هر انتشار) ────────────────────────
update public.app_release
   set version_name = '1.0.1',
       version_code = 2,                              -- = شمارهٔ run در GitHub Actions
       download_url = 'https://github.com/YOUR-USER/apex-pump-station-manager/releases/latest',
       notes        = 'بهبودها و رفعِ اشکال',
       mandatory    = false,
       updated_at   = now()
 where platform = 'android';

-- ── ۴) اعلان در «مرکز اعلانات»ِ برنامه ──────────────────────────────────────
insert into public.announcements (title, body) values ('خوش آمدید', 'به APEX Pump Station Manager خوش آمدید.');
update public.announcements set is_active = false where id = 1;

-- ── ۵) گزارشِ سریع: هر فضای کاری چند میتر/قرائت دارد ────────────────────────
select w.name, u.email,
       (select count(*) from public.meters m where m.workspace_id = w.id and m.deleted_at is null)          as meters,
       (select count(*) from public.meter_readings r where r.workspace_id = w.id and r.deleted_at is null)  as readings,
       (select count(*) from public.transactions t where t.workspace_id = w.id and t.deleted_at is null)    as transactions
  from public.workspaces w join auth.users u on u.id = w.owner_id
 order by w.created_at;
