-- Real courier tariff per wilaya (private, admin only). lh_delivery_rates stays the customer-facing price.
-- Seeded from the courier's "départ Alger — standard" tariff (wilayas 50, 54, 56 are not in that sheet).
create table if not exists public.lh_delivery_costs (
  wilaya_code smallint primary key,
  home_cost numeric(10,2) not null default 0 check (home_cost >= 0),
  desk_cost numeric(10,2) not null default 0 check (desk_cost >= 0),
  updated_at timestamptz not null default now()
);
alter table public.lh_delivery_costs enable row level security;
create policy "admin all delivery costs" on public.lh_delivery_costs
  for all to authenticated
  using (public.lh_is_admin()) with check (public.lh_is_admin());

insert into public.lh_delivery_costs (wilaya_code, home_cost, desk_cost) values
(1,1650,1000),(2,800,450),(3,900,500),(4,800,450),(5,800,450),(6,800,450),(7,800,450),(8,1400,700),(9,650,450),(10,800,450),
(11,1650,1000),(12,800,450),(13,800,450),(14,800,450),(15,800,450),(16,450,350),(17,900,500),(18,800,450),(19,800,450),(20,800,450),
(21,800,450),(22,800,450),(23,800,450),(24,800,450),(25,800,450),(26,800,450),(27,800,450),(28,800,450),(29,800,450),(30,900,500),
(31,800,450),(32,1100,500),(33,1800,1200),(34,800,450),(35,650,450),(36,800,450),(37,1650,1000),(38,800,450),(39,900,500),(40,800,450),
(41,800,450),(42,650,450),(43,800,450),(44,800,450),(45,1100,500),(46,800,450),(47,900,450),(48,800,450),(49,1650,1000),
(51,900,500),(52,1650,1000),(53,1650,700),(55,900,500),(57,900,500),(58,1100,600)
on conflict (wilaya_code) do update set home_cost = excluded.home_cost, desk_cost = excluded.desk_cost, updated_at = now();
