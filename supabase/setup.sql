-- DocBox database setup for V Modi & Associates
-- Run this ONCE: Supabase dashboard -> SQL Editor -> New query -> paste everything -> Run.
-- Running it again is safe.

-- 1. Tables ------------------------------------------------------------
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  gstin text not null default '',
  phone text not null default '',
  approved boolean not null default false,
  offline boolean not null default false,
  tally_company text not null default '',
  tally_bank text not null default '',
  created_at timestamptz not null default now(),
  last_upload_at timestamptz,
  seen_at timestamptz
);

create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type text not null,
  period text not null,
  note text not null default '',
  path text not null,
  file_name text not null,
  mime text,
  size bigint,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null default 'client',
  status text not null default 'new',
  ext jsonb,
  read_at timestamptz,
  exported_at timestamptz
);
create index if not exists docs_client_idx on public.docs(client_id, uploaded_at desc);

create table if not exists public.settings (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb
);
insert into public.settings(id) values (1) on conflict do nothing;

-- 2. Helper functions ---------------------------------------------------
create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff where user_id = auth.uid())
$$;

create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where user_id = auth.uid()
$$;

create or replace function public.my_client_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.clients where user_id = auth.uid()), false)
$$;

-- Clients cannot approve themselves or change office-only fields.
create or replace function public.guard_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_office() then return new; end if;
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.approved := false; new.offline := false;
    new.tally_company := ''; new.tally_bank := ''; new.seen_at := null; new.created_at := now();
  else
    new.user_id := old.user_id; new.approved := old.approved; new.offline := old.offline;
    new.tally_company := old.tally_company; new.tally_bank := old.tally_bank;
    new.seen_at := old.seen_at; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists guard_client on public.clients;
create trigger guard_client before insert or update on public.clients
  for each row execute function public.guard_client();

-- Client uploads always start as "new" with no office data.
create or replace function public.guard_doc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_office() then return new; end if;
  new.status := 'new'; new.ext := null; new.uploaded_by := 'client';
  new.read_at := null; new.exported_at := null; new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists guard_doc on public.docs;
create trigger guard_doc before insert on public.docs
  for each row execute function public.guard_doc();

-- 3. Row level security --------------------------------------------------
alter table public.staff enable row level security;
alter table public.clients enable row level security;
alter table public.docs enable row level security;
alter table public.settings enable row level security;

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated
  using (user_id = auth.uid() or public.is_office());

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using (user_id = auth.uid() or public.is_office());
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_office() or user_id = auth.uid());
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (user_id = auth.uid() or public.is_office())
  with check (user_id = auth.uid() or public.is_office());
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_office());

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated
  using (public.is_office() or client_id = public.my_client_id());
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated
  with check (public.is_office() or (client_id = public.my_client_id() and public.my_client_approved()));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (public.is_office()) with check (public.is_office());
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated
  using (public.is_office() or (client_id = public.my_client_id() and status = 'new'));

drop policy if exists settings_all on public.settings;
create policy settings_all on public.settings for all to authenticated
  using (public.is_office()) with check (public.is_office());

-- 4. File storage --------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('docs', 'docs', false, 20971520)
on conflict (id) do nothing;

drop policy if exists docbox_read on storage.objects;
create policy docbox_read on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (public.is_office() or (storage.foldername(name))[1] = public.my_client_id()::text));
drop policy if exists docbox_upload on storage.objects;
create policy docbox_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (public.is_office()
    or ((storage.foldername(name))[1] = public.my_client_id()::text and public.my_client_approved())));
drop policy if exists docbox_delete on storage.objects;
create policy docbox_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (public.is_office() or (storage.foldername(name))[1] = public.my_client_id()::text));

-- 4b. Only signed-in users may use the helper checks; the guards run only as triggers.
revoke execute on function public.guard_client() from public, anon, authenticated;
revoke execute on function public.guard_doc() from public, anon, authenticated;
revoke execute on function public.is_office() from public, anon;
revoke execute on function public.my_client_id() from public, anon;
revoke execute on function public.my_client_approved() from public, anon;
grant execute on function public.is_office() to authenticated;
grant execute on function public.my_client_id() to authenticated;
grant execute on function public.my_client_approved() to authenticated;

-- 5. Make YOUR office login (run separately, after creating the user) ----
-- Authentication -> Users -> Add user -> Create new user
--   Email: office@vmodi.in (any email you like), a strong password, tick "Auto Confirm User".
-- Then run this one line, with the same email:
-- insert into public.staff(user_id) select id from auth.users where email = 'office@vmodi.in';
