-- Quantity offers ("buy 2 for X") + real stock tracking.
-- Until now stock was only CHECKED when an order was placed, never reduced. From this migration on:
--   * placing an order atomically reduces the variant's stock (and fails with out_of_stock if it is short);
--   * cancelling/returning an order puts the stock back (and re-reserving it if the status is reversed);
--   * an offer is priced server-side, so the browser cannot change the price.
-- RUN THIS IN THE SUPABASE SQL EDITOR (it replaces existing objects, which the migration tool refuses to do).
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
      -- atomic reservation: only succeeds while enough stock remains
      update public.lh_product_variants set stock_quantity = stock_quantity - v_qty
       where id = v_var.id and stock_quantity >= v_qty;
      if not found then raise exception 'out_of_stock'; end if;
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

-- Put stock back when an order is cancelled/returned; take it again if that is reversed.
create or replace function public.lh_orders_stock_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was_out boolean := old.status in ('cancelled','returned');
  now_out boolean := new.status in ('cancelled','returned');
begin
  if was_out = now_out then return new; end if;
  if now_out then
    update public.lh_product_variants v set stock_quantity = v.stock_quantity + i.quantity
      from public.lh_order_items i where i.order_id = new.id and i.variant_id = v.id;
  else
    update public.lh_product_variants v set stock_quantity = greatest(0, v.stock_quantity - i.quantity)
      from public.lh_order_items i where i.order_id = new.id and i.variant_id = v.id;
  end if;
  return new;
end $$;
drop trigger if exists lh_orders_stock_sync on public.lh_orders;
create trigger lh_orders_stock_sync after update of status on public.lh_orders
  for each row execute function public.lh_orders_stock_sync();
