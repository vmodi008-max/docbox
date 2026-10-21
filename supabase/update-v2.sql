-- DocBox update 2: no duplicate clients, remove client, several bank accounts per client.
-- Run ONCE in Supabase -> SQL Editor -> New query -> paste everything -> Run. Safe to run again.

alter table public.clients add column if not exists banks jsonb not null default '[]'::jsonb;
alter table public.clients add column if not exists link_to uuid references public.clients(id) on delete set null;

create or replace function public.guard_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_office() or current_setting('docbox.trusted', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.approved := false; new.offline := false; new.link_to := null;
    new.tally_company := ''; new.tally_bank := ''; new.banks := '[]'::jsonb; new.seen_at := null; new.created_at := now();
  else
    new.user_id := old.user_id; new.approved := old.approved; new.offline := old.offline; new.link_to := old.link_to;
    new.tally_company := old.tally_company; new.tally_bank := old.tally_bank; new.banks := old.banks;
    new.seen_at := old.seen_at; new.created_at := old.created_at;
  end if;
  return new;
end $$;

create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- Client sign-up. Refuses a GSTIN or mobile that already has a login. If it matches a client the
-- office added, it becomes a request that the office merges after checking.
create or replace function public.join_client(p_name text, p_gstin text, p_phone text) returns public.clients
language plpgsql security definer set search_path = public as $$
declare r public.clients; m public.clients; uid uuid := auth.uid(); g text; ph text; matched boolean;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into r from public.clients where user_id = uid;
  if found then return r; end if;
  g := upper(trim(coalesce(p_gstin, ''))); ph := public.norm_phone(p_phone);
  -- Already registered by someone with a login (approved or still waiting): refuse.
  select * into m from public.clients c
    where c.user_id is not null and ((g <> '' and c.gstin = g) or (ph <> '' and public.norm_phone(c.phone) = ph))
    limit 1;
  if found then
    raise exception 'DUPLICATE_REGISTERED: %', m.name;
  end if;
  -- Added by the office without a login: becomes a merge request.
  select * into m from public.clients c
    where c.user_id is null and c.link_to is null and ((g <> '' and c.gstin = g) or (ph <> '' and public.norm_phone(c.phone) = ph))
    limit 1;
  matched := found;
  perform set_config('docbox.trusted', 'on', true);
  insert into public.clients(user_id, name, gstin, phone, approved, link_to)
    values (uid, trim(p_name), g, ph, false, case when matched then m.id else null end)
    returning * into r;
  perform set_config('docbox.trusted', 'off', true);
  return r;
end $$;

-- Office: attach a pending sign-up to the client record the office already had.
create or replace function public.merge_client(p_new uuid) returns public.clients
language plpgsql security definer set search_path = public as $$
declare n public.clients; o public.clients;
begin
  if not public.is_office() then raise exception 'OFFICE_ONLY'; end if;
  select * into n from public.clients where id = p_new;
  if not found or n.link_to is null then raise exception 'NOTHING_TO_MERGE'; end if;
  select * into o from public.clients where id = n.link_to;
  if not found then raise exception 'TARGET_GONE'; end if;
  if o.user_id is not null then raise exception 'TARGET_HAS_LOGIN'; end if;
  update public.docs set client_id = o.id where client_id = n.id;
  update public.clients set user_id = null where id = n.id;
  update public.clients set user_id = n.user_id, offline = false, approved = true,
      phone = coalesce(nullif(o.phone, ''), n.phone), gstin = coalesce(nullif(o.gstin, ''), n.gstin)
    where id = o.id returning * into o;
  delete from public.clients where id = n.id;
  return o;
end $$;

-- Office: remove a client, their document list and their login. The app removes their files first.
create or replace function public.remove_client(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare u uuid;
begin
  if not public.is_office() then raise exception 'OFFICE_ONLY'; end if;
  select user_id into u from public.clients where id = p_id;
  delete from public.clients where id = p_id;
  if u is not null and not exists (select 1 from public.staff where user_id = u) then
    delete from auth.users where id = u;
  end if;
end $$;

-- Copy each client's existing bank ledger into the new list of bank accounts.
select set_config('docbox.trusted', 'on', false);
update public.clients
  set banks = jsonb_build_array(jsonb_build_object('ledger', tally_bank, 'last4', ''))
  where tally_bank <> '' and banks = '[]'::jsonb;
select set_config('docbox.trusted', 'off', false);

revoke execute on function public.join_client(text, text, text) from public, anon;
revoke execute on function public.merge_client(uuid) from public, anon;
revoke execute on function public.remove_client(uuid) from public, anon;
grant execute on function public.join_client(text, text, text) to authenticated;
grant execute on function public.merge_client(uuid) to authenticated;
grant execute on function public.remove_client(uuid) to authenticated;
revoke execute on function public.guard_client() from public, anon, authenticated;
