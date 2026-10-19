-- Stock items model.
--   * Inventory is a list of STOCK ITEMS (a bead set, a box, ...). A product is built from one or more items
--     (lh_product_stock_links, with a quantity per sold unit), so two items can make up one product.
--   * Stock is taken out when an order becomes "confirmed" (confirmed / shipped / delivered all count as
--     confirmed) and put back when it leaves that group (pending, unreachable, cancelled, returned).
--   * Every change is written to lh_stock_movements so the quantity can be traced exactly.
--   * lh_products.cost_price follows the items' weighted-average cost; variant stock_quantity (what the store
--     reads to hide sold-out options) follows the items' availability.
--   * Profit counts confirmed orders only.

-- ---------------------------------------------------------------- tables
create table if not exists public.lh_stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  quantity integer not null default 0,
  avg_cost numeric not null default 0 check (avg_cost >= 0),
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists lh_stock_items_name_idx on public.lh_stock_items (lower(btrim(name)));
alter table public.lh_stock_items enable row level security;
drop policy if exists "admin all stock items" on public.lh_stock_items;
create policy "admin all stock items" on public.lh_stock_items
  for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

create table if not exists public.lh_product_stock_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  stock_item_id uuid not null references public.lh_stock_items(id) on delete cascade,
  qty_per_unit integer not null default 1 check (qty_per_unit > 0),
  unique (product_id, stock_item_id)
);
create index if not exists lh_product_stock_links_item_idx on public.lh_product_stock_links (stock_item_id);
alter table public.lh_product_stock_links enable row level security;
drop policy if exists "admin all stock links" on public.lh_product_stock_links;
create policy "admin all stock links" on public.lh_product_stock_links
  for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

create table if not exists public.lh_stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.lh_stock_items(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('purchase','purchase_removed','order_confirmed','order_released','order_edit','adjust')),
  order_id uuid references public.lh_orders(id) on delete set null,
  order_number bigint,
  created_at timestamptz not null default now()
);
create index if not exists lh_stock_movements_item_idx on public.lh_stock_movements (stock_item_id, created_at desc);
alter table public.lh_stock_movements enable row level security;
drop policy if exists "admin all stock movements" on public.lh_stock_movements;
create policy "admin all stock movements" on public.lh_stock_movements
  for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

-- Purchases now point at a stock item (the old product/variant columns stay for history).
alter table public.lh_stock_purchases add column if not exists stock_item_id uuid references public.lh_stock_items(id) on delete cascade;
alter table public.lh_stock_purchases alter column product_id drop not null;

-- ---------------------------------------------------------------- helpers
create or replace function public.lh_is_committed(s text) returns boolean
language sql immutable as $$ select s in ('confirmed','shipped','delivered') $$;

-- Recompute a product's cost (sum of item average costs) and variant availability from its stock links.
create or replace function public.lh_recalc_product_core(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_has boolean;
  v_cost numeric;
  v_avail integer;
begin
  select count(*) > 0,
         coalesce(sum(l.qty_per_unit * i.avg_cost), 0),
         coalesce(min(greatest(0, floor(i.quantity::numeric / l.qty_per_unit))), 0)::integer
    into v_has, v_cost, v_avail
    from public.lh_product_stock_links l join public.lh_stock_items i on i.id = l.stock_item_id
   where l.product_id = p_product;
  if not v_has then return; end if;
  update public.lh_products set cost_price = round(v_cost, 2) where id = p_product;
  update public.lh_product_variants set stock_quantity = v_avail where product_id = p_product;
end $$;
revoke all on function public.lh_recalc_product_core(uuid) from public, anon, authenticated;

create or replace function public.lh_recalc_product(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.lh_is_admin() then raise exception 'forbidden'; end if;
  perform public.lh_recalc_product_core(p_product);
end $$;
revoke all on function public.lh_recalc_product(uuid) from public, anon;
grant execute on function public.lh_recalc_product(uuid) to authenticated;

-- ---------------------------------------------------------------- purchases -> item quantity + average cost
create or replace function public.lh_stock_purchase_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cur_stock integer;
  cur_cost numeric;
begin
  if new.stock_item_id is not null then
    update public.lh_stock_items
       set avg_cost = case when quantity <= 0 then new.unit_cost
                           else round((quantity * avg_cost + new.quantity * new.unit_cost) / (quantity + new.quantity), 2) end,
           quantity = quantity + new.quantity
     where id = new.stock_item_id;
    insert into public.lh_stock_movements (stock_item_id, delta, reason) values (new.stock_item_id, new.quantity, 'purchase');
    return new;
  end if;
  -- legacy product-level purchase
  select coalesce(sum(stock_quantity), 0) into cur_stock from public.lh_product_variants where product_id = new.product_id;
  select cost_price into cur_cost from public.lh_products where id = new.product_id;
  if cur_cost is null or cur_stock <= 0 then
    update public.lh_products set cost_price = new.unit_cost where id = new.product_id;
  else
    update public.lh_products set cost_price = round((cur_stock * cur_cost + new.quantity * new.unit_cost) / (cur_stock + new.quantity), 2)
    where id = new.product_id;
  end if;
  if new.variant_id is not null then
    update public.lh_product_variants set stock_quantity = stock_quantity + new.quantity where id = new.variant_id;
  end if;
  return new;
end $$;

create or replace function public.lh_stock_purchase_undo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.stock_item_id is not null then
    update public.lh_stock_items set quantity = quantity - old.quantity where id = old.stock_item_id;
    insert into public.lh_stock_movements (stock_item_id, delta, reason) values (old.stock_item_id, -old.quantity, 'purchase_removed');
    return old;
  end if;
  if old.variant_id is not null then
    update public.lh_product_variants set stock_quantity = greatest(0, stock_quantity - old.quantity) where id = old.variant_id;
  end if;
  return old;
end $$;

-- An item's quantity / cost changed -> refresh the products built from it.
create or replace function public.lh_stock_item_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select product_id from public.lh_product_stock_links where stock_item_id = new.id loop
    perform public.lh_recalc_product_core(r.product_id);
  end loop;
  return new;
end $$;
drop trigger if exists lh_stock_item_changed on public.lh_stock_items;
create trigger lh_stock_item_changed after update of quantity, avg_cost on public.lh_stock_items
  for each row execute function public.lh_stock_item_changed();

create or replace function public.lh_stock_link_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then perform public.lh_recalc_product_core(new.product_id); end if;
  if tg_op <> 'INSERT' and (tg_op = 'DELETE' or old.product_id <> new.product_id) then
    perform public.lh_recalc_product_core(old.product_id);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists lh_stock_link_changed on public.lh_product_stock_links;
create trigger lh_stock_link_changed after insert or update or delete on public.lh_product_stock_links
  for each row execute function public.lh_stock_link_changed();

-- ---------------------------------------------------------------- orders -> stock
-- Take (p_sign = -1) or give back (p_sign = 1) the stock an order's lines use.
-- Products without stock links keep the old behaviour: the chosen variant's own stock_quantity moves.
create or replace function public.lh_apply_order_stock(p_order uuid, p_number bigint, p_sign integer, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select l.stock_item_id, sum(i.quantity * l.qty_per_unit)::integer as q
      from public.lh_order_items i join public.lh_product_stock_links l on l.product_id = i.product_id
     where i.order_id = p_order group by l.stock_item_id
  loop
    update public.lh_stock_items set quantity = quantity + p_sign * r.q where id = r.stock_item_id;
    insert into public.lh_stock_movements (stock_item_id, delta, reason, order_id, order_number)
    values (r.stock_item_id, p_sign * r.q, p_reason, p_order, p_number);
  end loop;
  update public.lh_product_variants v set stock_quantity = greatest(0, v.stock_quantity + p_sign * s.q)
    from (select i.variant_id, sum(i.quantity)::integer as q from public.lh_order_items i
           where i.order_id = p_order and i.variant_id is not null
             and not exists (select 1 from public.lh_product_stock_links l where l.product_id = i.product_id)
           group by i.variant_id) s
   where v.id = s.variant_id;
end $$;
revoke all on function public.lh_apply_order_stock(uuid, bigint, integer, text) from public, anon, authenticated;

create or replace function public.lh_orders_stock_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was boolean := public.lh_is_committed(old.status);
  nowc boolean := public.lh_is_committed(new.status);
begin
  if was = nowc then return new; end if;
  perform public.lh_apply_order_stock(new.id, new.order_number, case when nowc then -1 else 1 end,
                                      case when nowc then 'order_confirmed' else 'order_released' end);
  return new;
end $$;
drop trigger if exists lh_orders_stock_sync on public.lh_orders;
create trigger lh_orders_stock_sync after update of status on public.lh_orders
  for each row execute function public.lh_orders_stock_sync();

-- Editing a line's quantity (or removing it) on an already-confirmed order moves stock by the difference.
create or replace function public.lh_order_items_stock_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_number bigint;
  v_delta integer;
  v_item record;
  v_prod uuid := coalesce(new.product_id, old.product_id);
  v_var uuid := coalesce(new.variant_id, old.variant_id);
  v_order uuid := coalesce(new.order_id, old.order_id);
begin
  select status, order_number into v_status, v_number from public.lh_orders where id = v_order;
  if v_status is null or not public.lh_is_committed(v_status) then return coalesce(new, old); end if;
  v_delta := case when tg_op = 'DELETE' then -old.quantity else new.quantity - old.quantity end; -- units now sold, extra
  if v_delta = 0 then return coalesce(new, old); end if;
  if exists (select 1 from public.lh_product_stock_links where product_id = v_prod) then
    for v_item in select stock_item_id, qty_per_unit from public.lh_product_stock_links where product_id = v_prod loop
      update public.lh_stock_items set quantity = quantity - v_delta * v_item.qty_per_unit where id = v_item.stock_item_id;
      insert into public.lh_stock_movements (stock_item_id, delta, reason, order_id, order_number)
      values (v_item.stock_item_id, -v_delta * v_item.qty_per_unit, 'order_edit', v_order, v_number);
    end loop;
  elsif v_var is not null then
    update public.lh_product_variants set stock_quantity = greatest(0, stock_quantity - v_delta) where id = v_var;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists lh_order_items_stock_sync on public.lh_order_items;
create trigger lh_order_items_stock_sync after update of quantity or delete on public.lh_order_items
  for each row execute function public.lh_order_items_stock_sync();

-- ---------------------------------------------------------------- place_order: no reservation any more
-- Stock moves only on confirmation. Placing an order just checks the option still has stock.
create or replace function public.lh_place_order(
  p_name text, p_phone text, p_wilaya smallint, p_commune text, p_address text, p_delivery_type text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s.\-]', '', 'g');
  v_name text := btrim(coalesce(p_name, ''));
  v_commune text := btrim(coalesce(p_commune, ''));
  v_rate public.lh_delivery_rates%rowtype;
  v_fee numeric;
  v_customer uuid;
  v_order uuid;
  v_number bigint;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_qty int;
  v_prod public.lh_products%rowtype;
  v_var public.lh_product_variants%rowtype;
  v_price numeric;
  v_line numeric;
  v_offer numeric;
  v_label text;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^0[567][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  if char_length(v_commune) < 2 or char_length(v_commune) > 100 then raise exception 'invalid_commune'; end if;
  if p_delivery_type not in ('home', 'desk') then raise exception 'invalid_delivery_type'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'invalid_items';
  end if;

  select * into v_rate from public.lh_delivery_rates where wilaya_code = p_wilaya and is_active;
  if not found then raise exception 'invalid_wilaya'; end if;
  v_fee := case when p_delivery_type = 'home' then v_rate.home_fee else v_rate.desk_fee end;

  insert into public.lh_customers (full_name, phone, wilaya_code, commune, address)
  values (v_name, v_phone, p_wilaya, v_commune, nullif(btrim(coalesce(p_address, '')), ''))
  on conflict (phone) do update
    set full_name = excluded.full_name, wilaya_code = excluded.wilaya_code, commune = excluded.commune,
        address = coalesce(excluded.address, public.lh_customers.address), updated_at = now()
  returning id into v_customer;

  insert into public.lh_orders (customer_id, customer_name, customer_phone, wilaya_code, commune, address, delivery_type, delivery_fee)
  values (v_customer, v_name, v_phone, p_wilaya, v_commune, nullif(btrim(coalesce(p_address, '')), ''), p_delivery_type, v_fee)
  returning id, order_number into v_order, v_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then raise exception 'invalid_qty'; end if;

    select * into v_prod from public.lh_products where id = (v_item ->> 'product_id')::uuid and is_active;
    if not found then raise exception 'product_unavailable'; end if;

    v_label := null;
    v_price := v_prod.base_price;
    v_offer := null;

    if (v_item ->> 'variant_id') is not null then
      select * into v_var from public.lh_product_variants
       where id = (v_item ->> 'variant_id')::uuid and product_id = v_prod.id and is_active;
      if not found then raise exception 'variant_unavailable'; end if;
      if v_var.stock_quantity < v_qty then raise exception 'out_of_stock'; end if;
      v_price := coalesce(v_var.price, v_prod.base_price);
      v_label := nullif(concat_ws(' / ', nullif(v_var.color, ''), nullif(v_var.size, '')), '');
      if v_var.price is null then
        select total_price into v_offer from public.lh_product_offers
         where product_id = v_prod.id and qty = v_qty and is_active;
      end if;
    elsif exists (select 1 from public.lh_product_variants where product_id = v_prod.id and is_active) then
      raise exception 'variant_required';
    else
      select total_price into v_offer from public.lh_product_offers
       where product_id = v_prod.id and qty = v_qty and is_active;
    end if;

    v_line := coalesce(v_offer, v_price * v_qty);
    insert into public.lh_order_items (order_id, product_id, variant_id, product_name, variant_label, unit_price, quantity, line_total)
    values (v_order, v_prod.id, v_var.id, v_prod.name, v_label, round(v_line / v_qty, 2), v_qty, v_line);

    v_subtotal := v_subtotal + v_line;
    v_var := null;
  end loop;

  update public.lh_orders set subtotal = v_subtotal, total = v_subtotal + v_fee where id = v_order;
  return jsonb_build_object('order_number', v_number, 'total', v_subtotal + v_fee);
end;
$$;

-- ---------------------------------------------------------------- profit report: confirmed orders only
create or replace function public.lh_profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  product_id uuid, product_name text, orders bigint, units bigint, revenue numeric, cost numeric, profit numeric,
  delivered bigint, returned bigint, cancelled bigint, missing_cost boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         count(distinct o.id) filter (where public.lh_is_committed(o.status)),
         coalesce(sum(i.quantity) filter (where public.lh_is_committed(o.status)), 0),
         coalesce(sum(i.line_total) filter (where public.lh_is_committed(o.status)), 0),
         coalesce(sum(i.quantity * coalesce(i.unit_cost, p.cost_price, 0)) filter (where public.lh_is_committed(o.status)), 0),
         coalesce(sum(i.line_total - i.quantity * coalesce(i.unit_cost, p.cost_price, 0)) filter (where public.lh_is_committed(o.status)), 0),
         count(distinct o.id) filter (where o.status = 'delivered'),
         count(distinct o.id) filter (where o.status = 'returned'),
         count(distinct o.id) filter (where o.status in ('cancelled','unreachable')),
         bool_or(coalesce(i.unit_cost, p.cost_price, 0) = 0)
  from public.lh_orders o
  join public.lh_order_items i on i.order_id = o.id
  join public.lh_products p on p.id = i.product_id
  where public.lh_is_admin() and o.created_at >= p_from and o.created_at < p_to
  group by p.id, p.name
  order by 7 desc;
$$;

-- ---------------------------------------------------------------- move existing data to the new model
-- Each product that already has legacy purchases becomes a stock item (same name, quantity and weighted cost
-- from its purchases), linked 1:1 to the product. Editing purchases.stock_item_id does not fire the insert trigger.
do $$
declare r record; v_item uuid;
begin
  for r in
    select p.id as product_id, p.name,
           sum(sp.quantity)::integer as qty,
           round(sum(sp.quantity * sp.unit_cost) / nullif(sum(sp.quantity), 0), 2) as avg_cost
      from public.lh_stock_purchases sp join public.lh_products p on p.id = sp.product_id
     where sp.stock_item_id is null
     group by p.id, p.name
  loop
    insert into public.lh_stock_items (name, quantity, avg_cost) values (r.name, r.qty, coalesce(r.avg_cost, 0))
    on conflict (lower(btrim(name))) do update set name = excluded.name
    returning id into v_item;
    insert into public.lh_stock_movements (stock_item_id, delta, reason) values (v_item, r.qty, 'purchase');
    update public.lh_stock_purchases set stock_item_id = v_item where product_id = r.product_id and stock_item_id is null;
    insert into public.lh_product_stock_links (product_id, stock_item_id, qty_per_unit) values (r.product_id, v_item, 1)
    on conflict (product_id, stock_item_id) do nothing;
  end loop;
end $$;
