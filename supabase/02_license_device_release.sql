-- ═══════════════════════════════════════════════════════════════════════════
--  APEX Pump Station Manager — لایسنس، تأییدِ دستگاه (نسخهٔ وب)، اعلانات، نسخهٔ جدید
--  ---------------------------------------------------------------------------
--  پس از 01_schema.sql اجرا کنید (همان پروژهٔ جداگانهٔ پمپ استیشن).
--  اجرای دوباره بی‌خطر است.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── لایسنس‌ها ─────────────────────────────
-- فقط شما (از داشبوردِ Supabase یا SQL) کد می‌سازید. کاربر هیچ دسترسیِ مستقیمی به این
-- جدول ندارد؛ برنامه فقط از راهِ توابعِ check_license / claim_license / license_status می‌خواند.
create table if not exists public.licenses (
    code               text primary key,              -- همیشه با حروفِ بزرگ ذخیره کنید
    active             boolean     not null default true,
    expires_at         timestamptz,                   -- null = بدونِ انقضا
    note               text,
    used_by_workspace  uuid references public.workspaces(id) on delete set null,
    used_by_email      text,
    used_at            timestamptz,
    created_at         timestamptz not null default now()
);
alter table public.licenses enable row level security;   -- بدونِ policy → فقط توابعِ security definer

-- بررسیِ کد (فرمِ ثبت‌نام) — بدونِ ورود هم قابلِ فراخوانی است
-- خروجی: { valid: true, expires_at } یا { valid: false, error: not_found|inactive|expired|already_used }
create or replace function public.check_license(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    r public.licenses%rowtype;
begin
    select * into r from public.licenses where code = upper(trim(coalesce(p_code, '')));
    if not found then return jsonb_build_object('valid', false, 'error', 'not_found'); end if;
    if not r.active then return jsonb_build_object('valid', false, 'error', 'inactive'); end if;
    if r.expires_at is not null and r.expires_at < now() then return jsonb_build_object('valid', false, 'error', 'expired'); end if;
    if r.used_by_workspace is not null then return jsonb_build_object('valid', false, 'error', 'already_used'); end if;
    return jsonb_build_object('valid', true, 'expires_at', r.expires_at);
end;
$$;
revoke all on function public.check_license(text) from public;
grant execute on function public.check_license(text) to anon, authenticated;

-- ادعای کد برای فضای کاریِ کاربرِ واردشده (پس از ثبت‌نام/ورود)
create or replace function public.claim_license(p_code text, p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.licenses%rowtype;
    v_email text;
begin
    if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
    if not public.is_member(p_workspace) then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
    select * into r from public.licenses where code = upper(trim(coalesce(p_code, ''))) for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if not r.active then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
    if r.expires_at is not null and r.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
    if r.used_by_workspace is not null and r.used_by_workspace <> p_workspace then
        return jsonb_build_object('ok', false, 'error', 'already_used');
    end if;
    select email into v_email from auth.users where id = auth.uid();
    update public.licenses
       set used_by_workspace = p_workspace,
           used_by_email     = coalesce(used_by_email, v_email),
           used_at           = coalesce(used_at, now())
     where code = r.code;
    return jsonb_build_object('ok', true, 'expires_at', r.expires_at);
end;
$$;
revoke all on function public.claim_license(text, uuid) from public;
grant execute on function public.claim_license(text, uuid) to authenticated;

-- وضعیتِ لایسنسِ یک فضای کاری
create or replace function public.license_status(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    r public.licenses%rowtype;
begin
    if auth.uid() is null or not public.is_member(p_workspace) then
        return jsonb_build_object('active', false, 'error', 'not_member');
    end if;
    select * into r from public.licenses where used_by_workspace = p_workspace order by used_at desc nulls last limit 1;
    if not found then return jsonb_build_object('active', false, 'error', 'none'); end if;
    return jsonb_build_object(
        'active', (r.active and (r.expires_at is null or r.expires_at >= now())),
        'code', r.code, 'expires_at', r.expires_at);
end;
$$;
revoke all on function public.license_status(uuid) from public;
grant execute on function public.license_status(uuid) to authenticated;

-- ───────────────────────────── تأییدِ دستگاه (فقط نسخهٔ وب/PWA) ─────────────────────────────
-- مرورگرِ تازه یک کدِ ۶ رقمی می‌گیرد و تا وقتی شما آن را تأیید نکنید، صفحهٔ ورود قفل می‌ماند.
-- (نسخهٔ ویندوز و اندروید این مرحله را ندارند.)
create table if not exists public.device_requests (
    device_key  text primary key,
    label       text,
    code        text        not null,
    status      text        not null default 'pending'
                check (status in ('pending', 'approved', 'blocked', 'revoked')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    approved_at timestamptz,
    last_seen   timestamptz
);
alter table public.device_requests enable row level security;   -- فقط از راهِ توابع

create or replace function public.request_device_access(p_device_key text, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.device_requests%rowtype;
    v_code text;
begin
    if coalesce(trim(p_device_key), '') = '' then return jsonb_build_object('ok', false, 'status', 'none'); end if;
    select * into r from public.device_requests where device_key = p_device_key;
    if not found then
        v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
        insert into public.device_requests (device_key, label, code, status, last_seen)
        values (p_device_key, left(coalesce(p_label, ''), 120), v_code, 'pending', now())
        returning * into r;
    else
        update public.device_requests
           set last_seen = now(), label = coalesce(nullif(left(coalesce(p_label, ''), 120), ''), label)
         where device_key = p_device_key
        returning * into r;
    end if;
    return jsonb_build_object('ok', r.status = 'approved', 'status', r.status, 'code', r.code);
end;
$$;
revoke all on function public.request_device_access(text, text) from public;
grant execute on function public.request_device_access(text, text) to anon, authenticated;

create or replace function public.device_access_status(p_device_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.device_requests%rowtype;
begin
    select * into r from public.device_requests where device_key = p_device_key;
    if not found then return jsonb_build_object('ok', false, 'status', 'none'); end if;
    update public.device_requests set last_seen = now() where device_key = p_device_key;
    return jsonb_build_object('ok', r.status = 'approved', 'status', r.status, 'code', r.code);
end;
$$;
revoke all on function public.device_access_status(text) from public;
grant execute on function public.device_access_status(text) to anon, authenticated;

-- ───────────────────────────── اعلانِ نسخهٔ جدید (اندروید) ─────────────────────────────
create table if not exists public.app_release (
    platform      text primary key,
    version_name  text        not null,
    version_code  integer     not null,
    download_url  text        not null,
    notes         text        default '',
    mandatory     boolean     default false,
    updated_at    timestamptz not null default now()
);
alter table public.app_release enable row level security;
drop policy if exists app_release_read on public.app_release;
create policy app_release_read on public.app_release for select using (true);
grant select on public.app_release to anon, authenticated;

insert into public.app_release (platform, version_name, version_code, download_url, notes, mandatory)
values ('android', '1.0.0', 1, 'https://github.com/YOUR-USER/apex-pump-station-manager/releases', 'نسخهٔ نخستِ APEX Pump Station', false)
on conflict (platform) do nothing;

-- ───────────────────────────── مرکزِ اعلانات + شعارِ داشبورد ─────────────────────────────
create table if not exists public.announcements (
    id         bigserial primary key,
    title      text        not null,
    body       text        not null default '',
    is_active  boolean     not null default true,
    created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select using (true);
grant select on public.announcements to anon, authenticated;

create table if not exists public.app_config (
    key   text primary key,
    value text
);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select using (true);
grant select on public.app_config to anon, authenticated;

insert into public.app_config (key, value)
values ('dashboard_tagline', 'حسابدار آسان، سریع و خیال راحت برای شماست.')
on conflict (key) do nothing;
