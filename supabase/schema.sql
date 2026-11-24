-- =====================================================================
-- WorkTrack — Supabase schema + security (Row Level Security)
--
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run (uses "if not exists" / "or replace").
--
-- Roles:
--   (no login)   : view only
--   viewer       : view only (account exists, no edit rights)
--   editor       : add + edit tasks, meetings, categories (no delete)
--   admin        : editor + delete, import, delete-all
--   super_admin  : admin + manage users/roles. Exactly one. Cannot be
--                  demoted or removed from the app.
-- =====================================================================

-- ---------- Profiles (one row per login account) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  role        text not null default 'viewer'
              check (role in ('viewer', 'editor', 'admin', 'super_admin')),
  created_at  timestamptz not null default now()
);

-- At most ONE super admin
create unique index if not exists profiles_one_super_admin
  on public.profiles ((true)) where role = 'super_admin';

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
-- No insert/update/delete policies: roles change ONLY through the functions below.
revoke insert, update, delete, truncate, references, trigger on public.profiles from anon, authenticated;

-- New sign-ups always start as viewer
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role of the current caller ('anon' when not signed in)
create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;
grant execute on function public.my_role() to anon, authenticated;

-- ---------- Data tables (each row = one item, stored as JSON) ----------
do $$
declare t text;
begin
  foreach t in array array['categories', 'tasks', 'meetings'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id          text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
        data        jsonb not null
                    check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 200000),
        updated_at  timestamptz not null default now(),
        updated_by  uuid
      )$f$, t);

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);

    -- Anyone with the link can read
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);

    -- Editor and above can add / edit
    execute format('drop policy if exists "editor insert" on public.%I', t);
    execute format($f$create policy "editor insert" on public.%I for insert to authenticated
      with check (public.my_role() in ('editor', 'admin', 'super_admin'))$f$, t);
    execute format('drop policy if exists "editor update" on public.%I', t);
    execute format($f$create policy "editor update" on public.%I for update to authenticated
      using (public.my_role() in ('editor', 'admin', 'super_admin'))
      with check (public.my_role() in ('editor', 'admin', 'super_admin'))$f$, t);

    -- Only admin and above can delete
    execute format('drop policy if exists "admin delete" on public.%I', t);
    execute format($f$create policy "admin delete" on public.%I for delete to authenticated
      using (public.my_role() in ('admin', 'super_admin'))$f$, t);
  end loop;
end $$;

-- Who changed what, and when (cannot be faked from the browser)
create or replace function public.stamp_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists stamp_categories on public.categories;
create trigger stamp_categories before insert or update on public.categories
  for each row execute function public.stamp_change();
drop trigger if exists stamp_tasks on public.tasks;
create trigger stamp_tasks before insert or update on public.tasks
  for each row execute function public.stamp_change();
drop trigger if exists stamp_meetings on public.meetings;
create trigger stamp_meetings before insert or update on public.meetings
  for each row execute function public.stamp_change();

-- ---------- User management (super admin only) ----------
create or replace function public.list_users()
returns table (id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_role() <> 'super_admin' then
    raise exception 'Only the super admin can manage users.' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.role, p.created_at, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.role when 'super_admin' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end, p.email;
end $$;

create or replace function public.set_user_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'super_admin' then
    raise exception 'Only the super admin can change roles.' using errcode = '42501';
  end if;
  if new_role not in ('viewer', 'editor', 'admin') then
    raise exception 'Invalid role.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = target and role = 'super_admin') then
    raise exception 'The super admin cannot be changed.' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
end $$;

create or replace function public.remove_user(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'super_admin' then
    raise exception 'Only the super admin can remove users.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = target and role = 'super_admin') then
    raise exception 'The super admin cannot be removed.' using errcode = '42501';
  end if;
  delete from auth.users where id = target;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
end $$;

revoke execute on function public.list_users() from public, anon;
revoke execute on function public.set_user_role(uuid, text) from public, anon;
revoke execute on function public.remove_user(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.list_users() to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.remove_user(uuid) to authenticated;

-- ---------- Live updates (other people see changes without refreshing) ----------
do $$
declare t text;
begin
  foreach t in array array['categories', 'tasks', 'meetings'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =====================================================================
-- AFTER running this file:
--   1. Open the WorkTrack site → Sign in → Create account with YOUR email.
--   2. Confirm the email, then come back here and run (with your email):
--
--        update public.profiles set role = 'super_admin' where email = 'YOUR_EMAIL_HERE';
--
--   This is the only way to create the super admin, on purpose.
-- =====================================================================
