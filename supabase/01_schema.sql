-- ═══════════════════════════════════════════════════════════════════════════
--  APEX Pump Station Manager — ساختارِ کاملِ پایگاهِ دادهٔ Supabase
--  ---------------------------------------------------------------------------
--  ⚠ این فایل را فقط در «پروژهٔ جدید و جداگانهٔ» Supabase مخصوصِ پمپ استیشن
--    اجرا کنید — هرگز در پروژهٔ APEX Store Manager.
--
--  طرزِ اجرا: Supabase → SQL Editor → New query → کلِ این فایل را Paste → Run.
--  اجرای دوباره بی‌خطر است (idempotent): چیزی پاک نمی‌شود و فقط کمبودها ساخته می‌شوند.
--
--  محتوا:
--    ۱) فضای کاری (workspaces) و عضویت (workspace_members) + تابعِ is_member
--    ۲) جدول‌های سینکِ داده (یک ساختارِ مشترک برای همهٔ کلکسیون‌ها، شاملِ meters و meter_readings)
--    ۳) store_settings (تنظیماتِ پمپ استیشن، انواعِ تیل، واحدها…) و sync_conflicts
--    ۴) تریگرِ updated_at / revision
--    ۵) RLS — هر کاربر فقط دادهٔ فضای کاریِ خودش را می‌بیند
--    ۶) RPC: bootstrap_workspace
--    ۷) Realtime
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────── ۱) فضای کاری ─────────────────────────────
create table if not exists public.workspaces (
    id          uuid primary key default gen_random_uuid(),
    name        text        not null default 'پمپ استیشن من',
    owner_id    uuid        not null references auth.users(id) on delete cascade,
    created_at  timestamptz not null default now()
);

create table if not exists public.workspace_members (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id      uuid not null references auth.users(id) on delete cascade,
    role         text not null default 'owner',
    created_at   timestamptz not null default now(),
    primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

-- آیا کاربرِ فعلی عضوِ این فضای کاری است؟ (security definer تا RLS حلقه نزند)
create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.workspace_members m
        where m.workspace_id = ws and m.user_id = auth.uid()
    );
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
    for select using (public.is_member(id));
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
    for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists members_select on public.workspace_members;
create policy members_select on public.workspace_members
    for select using (user_id = auth.uid() or public.is_member(workspace_id));

-- ───────────────────────────── ۲ و ۳) جدول‌های سینک ─────────────────────────────
-- ساختارِ مشترک: هر رکوردِ برنامه (فروش، ذخیره، شخص، میتر، قرائت، …) یک ردیف است.
--   record_id  = شناسهٔ پایدارِ رکورد (ساختهٔ برنامه)
--   data       = خودِ رکورد به‌صورتِ JSON
--   revision   = شمارندهٔ تغییر (تریگر زیاد می‌کند)
--   deleted_at = حذفِ نرم (tombstone) برای همگام‌سازیِ حذف بین دستگاه‌ها
do $$
declare
    t text;
    tbls text[] := array[
        'transactions', 'products', 'persons', 'expenses', 'cashboxes',
        'cashbox_transactions', 'returns', 'warehouses', 'warehouse_transfers',
        'meters', 'meter_readings',          -- ← مخصوصِ پمپ استیشن
        'services', 'currencies', 'exchange_rates',
        'store_settings'
    ];
begin
    foreach t in array tbls loop
        execute format($f$
            create table if not exists public.%1$I (
                workspace_id uuid        not null references public.workspaces(id) on delete cascade,
                record_id    text        not null,
                data         jsonb       not null default '{}'::jsonb,
                revision     bigint      not null default 1,
                updated_at   timestamptz not null default now(),
                deleted_at   timestamptz,
                device_key   text,
                created_at   timestamptz not null default now(),
                primary key (workspace_id, record_id)
            )$f$, t);
        execute format('create index if not exists %1$I on public.%2$I (workspace_id, updated_at)', t || '_ws_upd_idx', t);
        execute format('alter table public.%I enable row level security', t);

        execute format('drop policy if exists %1$I on public.%2$I', t || '_member_all', t);
        execute format($p$
            create policy %1$I on public.%2$I
                for all
                using (public.is_member(workspace_id))
                with check (public.is_member(workspace_id))$p$, t || '_member_all', t);

        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end loop;
end $$;

-- لاگِ تعارض‌های همگام‌سازی (برای بررسیِ «کدام نسخه برنده شد»)
create table if not exists public.sync_conflicts (
    id                 bigserial primary key,
    workspace_id       uuid        not null references public.workspaces(id) on delete cascade,
    conflict_key       text        not null,
    entity             text,
    record_id          text,
    conflict_type      text,
    winning            jsonb,
    losing             jsonb,
    winning_revision   bigint,
    winning_updated_at timestamptz,
    losing_revision    bigint,
    source_device      text,
    status             text        not null default 'open',
    created_at         timestamptz not null default now(),
    unique (workspace_id, conflict_key)
);
alter table public.sync_conflicts enable row level security;
drop policy if exists sync_conflicts_member_all on public.sync_conflicts;
create policy sync_conflicts_member_all on public.sync_conflicts
    for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
grant select, insert, update, delete on public.sync_conflicts to authenticated;
grant usage, select on sequence public.sync_conflicts_id_seq to authenticated;

-- ───────────────────────────── ۴) تریگرِ زمان و نسخه ─────────────────────────────
create or replace function public.tg_sync_row()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := clock_timestamp();
    if tg_op = 'UPDATE' then
        new.revision   := coalesce(old.revision, 0) + 1;
        new.created_at := old.created_at;
    else
        new.revision := coalesce(new.revision, 1);
    end if;
    return new;
end;
$$;

do $$
declare
    t text;
    tbls text[] := array[
        'transactions', 'products', 'persons', 'expenses', 'cashboxes',
        'cashbox_transactions', 'returns', 'warehouses', 'warehouse_transfers',
        'meters', 'meter_readings', 'services', 'currencies', 'exchange_rates',
        'store_settings'
    ];
begin
    foreach t in array tbls loop
        execute format('drop trigger if exists %1$I on public.%2$I', t || '_tg_sync', t);
        execute format('create trigger %1$I before insert or update on public.%2$I for each row execute function public.tg_sync_row()', t || '_tg_sync', t);
    end loop;
end $$;

-- ───────────────────────────── ۶) bootstrap_workspace ─────────────────────────────
-- پس از ورود صدا زده می‌شود: اگر کاربر فضای کاری دارد همان را برمی‌گرداند، وگرنه می‌سازد.
-- (خنثی/idempotent — عضویتِ گم‌شده را هم ترمیم می‌کند)
create or replace function public.bootstrap_workspace(p_name text default 'پمپ استیشن من')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_ws  uuid;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '42501';
    end if;

    select m.workspace_id into v_ws
    from public.workspace_members m
    where m.user_id = v_uid
    order by m.created_at asc
    limit 1;

    if v_ws is null then
        -- فضای کاریِ متعلق به همین کاربر که عضویتش گم شده
        select w.id into v_ws from public.workspaces w where w.owner_id = v_uid order by w.created_at asc limit 1;
        if v_ws is null then
            insert into public.workspaces (name, owner_id)
            values (coalesce(nullif(trim(p_name), ''), 'پمپ استیشن من'), v_uid)
            returning id into v_ws;
        end if;
        insert into public.workspace_members (workspace_id, user_id, role)
        values (v_ws, v_uid, 'owner')
        on conflict do nothing;
    end if;

    return v_ws;
end;
$$;
revoke all on function public.bootstrap_workspace(text) from public;
grant execute on function public.bootstrap_workspace(text) to authenticated;

-- ───────────────────────────── ۷) Realtime ─────────────────────────────
do $$
declare
    t text;
    tbls text[] := array[
        'transactions', 'products', 'persons', 'expenses', 'cashboxes',
        'cashbox_transactions', 'returns', 'warehouses', 'warehouse_transfers',
        'meters', 'meter_readings', 'services', 'currencies', 'exchange_rates',
        'store_settings'
    ];
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
    foreach t in array tbls loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;
