create table if not exists public.lh_product_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  qty int not null check (qty between 2 and 20),
  total_price numeric not null check (total_price > 0),
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, qty)
);
alter table public.lh_product_offers enable row level security;
create policy "public read active offers" on public.lh_product_offers for select to anon, authenticated using (is_active);
create policy "admin all offers" on public.lh_product_offers for all to authenticated
  using (public.lh_is_admin()) with check (public.lh_is_admin());
grant select on public.lh_product_offers to anon, authenticated;
