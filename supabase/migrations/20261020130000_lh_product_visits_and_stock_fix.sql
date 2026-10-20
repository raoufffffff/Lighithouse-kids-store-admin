-- 1) Attach purchases that were recorded before stock items existed (e.g. from the old inventory page).
do $$
declare r record; v_item uuid;
begin
  for r in select * from public.lh_stock_purchases where stock_item_id is null and product_id is not null loop
    select l.stock_item_id into v_item from public.lh_product_stock_links l where l.product_id = r.product_id order by l.qty_per_unit limit 1;
    if v_item is null then
      insert into public.lh_stock_items (name, quantity, avg_cost)
      select p.name, 0, 0 from public.lh_products p where p.id = r.product_id
      on conflict (lower(btrim(name))) do update set name = excluded.name
      returning id into v_item;
      insert into public.lh_product_stock_links (product_id, stock_item_id, qty_per_unit) values (r.product_id, v_item, 1)
      on conflict (product_id, stock_item_id) do nothing;
    end if;
    update public.lh_stock_items
       set avg_cost = case when quantity <= 0 then r.unit_cost
                           else round((quantity * avg_cost + r.quantity * r.unit_cost) / (quantity + r.quantity), 2) end,
           quantity = quantity + r.quantity
     where id = v_item;
    insert into public.lh_stock_movements (stock_item_id, delta, reason) values (v_item, r.quantity, 'purchase');
    update public.lh_stock_purchases set stock_item_id = v_item where id = r.id;
  end loop;
end $$;

-- 2) Product page visits (one row per visit; the same visitor is counted once per product every 30 minutes).
create table if not exists public.lh_product_visits (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.lh_products(id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 8 and 64),
  visited_at timestamptz not null default now()
);
create index if not exists lh_product_visits_time_idx on public.lh_product_visits (visited_at desc);
create index if not exists lh_product_visits_product_idx on public.lh_product_visits (product_id, visited_at desc);
create index if not exists lh_product_visits_visitor_idx on public.lh_product_visits (product_id, visitor_id, visited_at desc);
alter table public.lh_product_visits enable row level security;
drop policy if exists "admin read visits" on public.lh_product_visits;
create policy "admin read visits" on public.lh_product_visits for select to authenticated using (public.lh_is_admin());

create or replace function public.lh_track_visit(p_product uuid, p_visitor text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_product is null or char_length(coalesce(p_visitor, '')) not between 8 and 64 then return; end if;
  if not exists (select 1 from public.lh_products where id = p_product) then return; end if;
  if exists (select 1 from public.lh_product_visits
              where product_id = p_product and visitor_id = p_visitor and visited_at > now() - interval '30 minutes') then
    return;
  end if;
  insert into public.lh_product_visits (product_id, visitor_id) values (p_product, p_visitor);
end $$;
revoke all on function public.lh_track_visit(uuid, text) from public;
grant execute on function public.lh_track_visit(uuid, text) to anon, authenticated;

-- Admin report: visits and distinct visitors per product and per hour of day (Algeria time).
-- p_product null = all products. hour = 0..23 (local); day = local date.
create or replace function public.lh_visits_report(p_from timestamptz, p_to timestamptz, p_product uuid default null)
returns table (product_id uuid, product_name text, day date, hour integer, visits bigint, visitors bigint)
language sql stable security definer set search_path = public as $$
  select v.product_id, p.name,
         (v.visited_at at time zone 'Africa/Algiers')::date,
         extract(hour from v.visited_at at time zone 'Africa/Algiers')::integer,
         count(*), count(distinct v.visitor_id)
  from public.lh_product_visits v join public.lh_products p on p.id = v.product_id
  where public.lh_is_admin() and v.visited_at >= p_from and v.visited_at < p_to
    and (p_product is null or v.product_id = p_product)
  group by 1, 2, 3, 4;
$$;
revoke all on function public.lh_visits_report(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.lh_visits_report(timestamptz, timestamptz, uuid) to authenticated;
