-- Abandoned carts: saved once the visitor has entered name + valid phone + wilaya + commune.
create table if not exists public.lh_abandoned_carts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique check (char_length(session_id) between 8 and 64),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  variant_id uuid references public.lh_product_variants(id) on delete set null,
  qty int not null default 1 check (qty between 1 and 20),
  customer_name text not null,
  customer_phone text not null,
  wilaya_code smallint not null,
  commune text not null,
  delivery_type text not null default 'home' check (delivery_type in ('home','desk')),
  ab_variant_id uuid,
  status text not null default 'open' check (status in ('open','contacted','dismissed','converted')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lh_abandoned_carts_updated_idx on public.lh_abandoned_carts (updated_at desc);
alter table public.lh_abandoned_carts enable row level security;
create policy "admin all abandoned carts" on public.lh_abandoned_carts
  for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

create or replace function public.lh_save_cart(
  p_session text, p_product uuid, p_variant uuid, p_qty int,
  p_name text, p_phone text, p_wilaya smallint, p_commune text,
  p_delivery_type text, p_ab uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s.\-]', '', 'g');
  v_name text := btrim(coalesce(p_name, ''));
  v_commune text := btrim(coalesce(p_commune, ''));
begin
  if char_length(coalesce(p_session, '')) not between 8 and 64 then return; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then return; end if;
  if v_phone !~ '^0[567][0-9]{8}$' then return; end if;
  if char_length(v_commune) < 2 or char_length(v_commune) > 100 then return; end if;
  if p_delivery_type not in ('home','desk') then return; end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then return; end if;
  if not exists (select 1 from public.lh_products where id = p_product and is_active) then return; end if;
  if not exists (select 1 from public.lh_delivery_rates where wilaya_code = p_wilaya and is_active) then return; end if;
  if p_variant is not null and not exists (select 1 from public.lh_product_variants where id = p_variant and product_id = p_product) then
    p_variant := null;
  end if;

  insert into public.lh_abandoned_carts (session_id, product_id, variant_id, qty, customer_name, customer_phone,
                                         wilaya_code, commune, delivery_type, ab_variant_id)
  values (p_session, p_product, p_variant, p_qty, v_name, v_phone, p_wilaya, v_commune, p_delivery_type, p_ab)
  on conflict (session_id) do update
    set product_id = excluded.product_id, variant_id = excluded.variant_id, qty = excluded.qty,
        customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
        wilaya_code = excluded.wilaya_code, commune = excluded.commune,
        delivery_type = excluded.delivery_type, ab_variant_id = coalesce(excluded.ab_variant_id, public.lh_abandoned_carts.ab_variant_id),
        updated_at = now()
    where public.lh_abandoned_carts.status in ('open','contacted');
end $$;
revoke all on function public.lh_save_cart(text, uuid, uuid, int, text, text, smallint, text, text, uuid) from public;
grant execute on function public.lh_save_cart(text, uuid, uuid, int, text, text, smallint, text, text, uuid) to anon, authenticated;

create or replace function public.lh_cart_done(p_session text) returns void
language sql security definer set search_path = public as $$
  update public.lh_abandoned_carts set status = 'converted', updated_at = now() where session_id = p_session;
$$;
revoke all on function public.lh_cart_done(text) from public;
grant execute on function public.lh_cart_done(text) to anon, authenticated;

-- Admin list: carts that never became an order (same phone, later order => treated as converted).
create or replace function public.lh_abandoned_list()
returns table (
  id uuid, customer_name text, customer_phone text, wilaya_code smallint, commune text, delivery_type text,
  qty int, product_id uuid, product_name text, variant_label text, amount numeric, status text, note text,
  created_at timestamptz, updated_at timestamptz, in_progress boolean
)
language sql security definer set search_path = public stable as $$
  select c.id, c.customer_name, c.customer_phone, c.wilaya_code, c.commune, c.delivery_type, c.qty,
         c.product_id, p.name,
         nullif(concat_ws(' / ', nullif(v.color, ''), nullif(v.size, '')), ''),
         coalesce(v.price, p.base_price) * c.qty,
         c.status, c.note, c.created_at, c.updated_at,
         c.updated_at > now() - interval '10 minutes'
  from public.lh_abandoned_carts c
  join public.lh_products p on p.id = c.product_id
  left join public.lh_product_variants v on v.id = c.variant_id
  where public.lh_is_admin()
    and c.status <> 'converted'
    and not exists (select 1 from public.lh_orders o where o.customer_phone = c.customer_phone and o.created_at >= c.created_at)
  order by c.updated_at desc
  limit 300;
$$;
revoke all on function public.lh_abandoned_list() from public, anon;
grant execute on function public.lh_abandoned_list() to authenticated;

-- Profit report per product. Cost = current lh_products.cost_price. Cancelled/returned/unreachable are excluded.
create or replace function public.lh_profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  product_id uuid, product_name text, orders bigint, units bigint, revenue numeric, cost numeric, profit numeric,
  delivered bigint, returned bigint, cancelled bigint, missing_cost boolean
)
language sql security definer set search_path = public stable as $$
  select p.id, p.name,
         count(distinct o.id) filter (where o.status not in ('cancelled','returned','unreachable')),
         coalesce(sum(i.quantity) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         coalesce(sum(i.line_total) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         coalesce(sum(i.quantity * coalesce(p.cost_price, 0)) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         coalesce(sum(i.line_total - i.quantity * coalesce(p.cost_price, 0)) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         count(distinct o.id) filter (where o.status = 'delivered'),
         count(distinct o.id) filter (where o.status = 'returned'),
         count(distinct o.id) filter (where o.status in ('cancelled','unreachable')),
         (p.cost_price is null or p.cost_price = 0)
  from public.lh_orders o
  join public.lh_order_items i on i.order_id = o.id
  join public.lh_products p on p.id = i.product_id
  where public.lh_is_admin() and o.created_at >= p_from and o.created_at < p_to
  group by p.id, p.name, p.cost_price
  order by 7 desc;
$$;
revoke all on function public.lh_profit_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.lh_profit_report(timestamptz, timestamptz) to authenticated;

-- Profit per A/B variant (orders credited by lh_ab_events).
create or replace function public.lh_ab_profit(p_test_id uuid)
returns table (variant_id uuid, profit numeric, returned bigint)
language sql security definer set search_path = public stable as $$
  select e.variant_id,
         coalesce(sum(i.line_total - i.quantity * coalesce(p.cost_price, 0)) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         count(distinct o.id) filter (where o.status in ('returned','cancelled','unreachable'))
  from public.lh_ab_events e
  join public.lh_orders o on o.order_number = e.order_number
  join public.lh_order_items i on i.order_id = o.id
  join public.lh_products p on p.id = i.product_id
  where public.lh_is_admin() and e.test_id = p_test_id and e.kind = 'order'
  group by e.variant_id;
$$;
revoke all on function public.lh_ab_profit(uuid) from public, anon;
grant execute on function public.lh_ab_profit(uuid) to authenticated;
