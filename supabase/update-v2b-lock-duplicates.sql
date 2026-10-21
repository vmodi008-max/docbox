-- DocBox update 2b: database lock against duplicate GSTIN or mobile numbers.
-- Run AFTER removing any duplicate clients in the office page. If it fails with
-- "could not create unique index", a duplicate is still there: remove it and run again.

create unique index if not exists clients_gstin_unique on public.clients(gstin)
  where gstin <> '' and link_to is null;
create unique index if not exists clients_phone_unique on public.clients(public.norm_phone(phone))
  where phone <> '' and link_to is null;
