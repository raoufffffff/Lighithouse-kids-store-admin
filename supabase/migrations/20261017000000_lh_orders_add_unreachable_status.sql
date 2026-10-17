alter table public.lh_orders drop constraint if exists lh_orders_status_check;
alter table public.lh_orders add constraint lh_orders_status_check
  check (status in ('pending','confirmed','unreachable','shipped','delivered','cancelled','returned'));
