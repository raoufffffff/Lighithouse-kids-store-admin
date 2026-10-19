-- Expenses ledger (ads, packaging, ...) and stock purchase batches with weighted-average cost.

create table if not exists public.lh_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null default 'other' check (category in ('ads','packaging','salaries','other')),
  amount numeric not null check (amount >= 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists lh_expenses_date_idx on public.lh_expenses (expense_date desc);
alter table public.lh_expenses enable row level security;
create policy "admin all expenses" on public.lh_expenses
  for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

create table if not exists public.lh_stock_purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  variant_id uuid references public.lh_product_variants(id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  supplier text,
  note text,
  purchased_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists lh_stock_purchases_date_idx on public.lh_stock_purchases (purchased_at desc);
alter table public.lh_stock_purchases enable row level security;
create policy "admin all stock purchases" on public.lh_stock_purchases
  for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

-- New purchase: add stock to the variant and move the product cost to the weighted average.
create or replace function public.lh_stock_purchase_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cur_stock integer;
  cur_cost numeric;
begin
  select coalesce(sum(stock_quantity), 0) into cur_stock from lh_product_variants where product_id = new.product_id;
  select cost_price into cur_cost from lh_products where id = new.product_id;
  if cur_cost is null or cur_stock <= 0 then
    update lh_products set cost_price = new.unit_cost where id = new.product_id;
  else
    update lh_products set cost_price = round((cur_stock * cur_cost + new.quantity * new.unit_cost) / (cur_stock + new.quantity), 2)
    where id = new.product_id;
  end if;
  if new.variant_id is not null then
    update lh_product_variants set stock_quantity = stock_quantity + new.quantity where id = new.variant_id;
  end if;
  return new;
end $$;
create trigger lh_stock_purchase_apply after insert on public.lh_stock_purchases
  for each row execute function public.lh_stock_purchase_apply();

-- Deleting a purchase takes its units back out of stock (cost price is left as is).
create or replace function public.lh_stock_purchase_undo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.variant_id is not null then
    update lh_product_variants set stock_quantity = greatest(0, stock_quantity - old.quantity) where id = old.variant_id;
  end if;
  return old;
end $$;
create trigger lh_stock_purchase_undo after delete on public.lh_stock_purchases
  for each row execute function public.lh_stock_purchase_undo();

-- Freeze the unit cost on each order line so later purchases don't rewrite past profit.
alter table public.lh_order_items add column if not exists unit_cost numeric;
update public.lh_order_items i set unit_cost = p.cost_price from public.lh_products p
  where p.id = i.product_id and i.unit_cost is null;

create or replace function public.lh_order_item_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unit_cost is null then
    select cost_price into new.unit_cost from lh_products where id = new.product_id;
  end if;
  return new;
end $$;
create trigger lh_order_item_cost before insert on public.lh_order_items
  for each row execute function public.lh_order_item_cost();

create or replace function public.lh_profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  product_id uuid, product_name text, orders bigint, units bigint, revenue numeric, cost numeric, profit numeric,
  delivered bigint, returned bigint, cancelled bigint, missing_cost boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         count(distinct o.id) filter (where o.status not in ('cancelled','returned','unreachable')),
         coalesce(sum(i.quantity) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         coalesce(sum(i.line_total) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         coalesce(sum(i.quantity * coalesce(i.unit_cost, p.cost_price, 0)) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         coalesce(sum(i.line_total - i.quantity * coalesce(i.unit_cost, p.cost_price, 0)) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
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

create or replace function public.lh_ab_profit(p_test_id uuid)
returns table (variant_id uuid, profit numeric, returned bigint)
language sql security definer set search_path = public stable as $$
  select e.variant_id,
         coalesce(sum(i.line_total - i.quantity * coalesce(i.unit_cost, p.cost_price, 0)) filter (where o.status not in ('cancelled','returned','unreachable')), 0),
         count(distinct o.id) filter (where o.status in ('returned','cancelled','unreachable'))
  from public.lh_ab_events e
  join public.lh_orders o on o.order_number = e.order_number
  join public.lh_order_items i on i.order_id = o.id
  join public.lh_products p on p.id = i.product_id
  where public.lh_is_admin() and e.test_id = p_test_id and e.kind = 'order'
  group by e.variant_id;
$$;
