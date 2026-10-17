create or replace function public.lh_place_order(
  p_name text,
  p_phone text,
  p_wilaya smallint,
  p_commune text,
  p_address text,
  p_delivery_type text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_label text;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'invalid_name';
  end if;
  if v_phone !~ '^0[567][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if char_length(v_commune) < 2 or char_length(v_commune) > 100 then
    raise exception 'invalid_commune';
  end if;
  if p_delivery_type not in ('home', 'desk') then
    raise exception 'invalid_delivery_type';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'invalid_items';
  end if;

  select * into v_rate from public.lh_delivery_rates
   where wilaya_code = p_wilaya and is_active;
  if not found then
    raise exception 'invalid_wilaya';
  end if;
  v_fee := case when p_delivery_type = 'home' then v_rate.home_fee else v_rate.desk_fee end;

  insert into public.lh_customers (full_name, phone, wilaya_code, commune, address)
  values (v_name, v_phone, p_wilaya, v_commune, nullif(btrim(coalesce(p_address, '')), ''))
  on conflict (phone) do update
    set full_name = excluded.full_name,
        wilaya_code = excluded.wilaya_code,
        commune = excluded.commune,
        address = coalesce(excluded.address, public.lh_customers.address),
        updated_at = now()
  returning id into v_customer;

  insert into public.lh_orders (customer_id, customer_name, customer_phone, wilaya_code, commune,
                                address, delivery_type, delivery_fee)
  values (v_customer, v_name, v_phone, p_wilaya, v_commune,
          nullif(btrim(coalesce(p_address, '')), ''), p_delivery_type, v_fee)
  returning id, order_number into v_order, v_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'invalid_qty';
    end if;

    select * into v_prod from public.lh_products
     where id = (v_item ->> 'product_id')::uuid and is_active;
    if not found then
      raise exception 'product_unavailable';
    end if;

    v_label := null;
    v_price := v_prod.base_price;

    if (v_item ->> 'variant_id') is not null then
      select * into v_var from public.lh_product_variants
       where id = (v_item ->> 'variant_id')::uuid
         and product_id = v_prod.id and is_active;
      if not found then
        raise exception 'variant_unavailable';
      end if;
      if v_var.stock_quantity < v_qty then
        raise exception 'out_of_stock';
      end if;
      v_price := coalesce(v_var.price, v_prod.base_price);
      v_label := nullif(concat_ws(' / ', nullif(v_var.color, ''), nullif(v_var.size, '')), '');
    elsif exists (select 1 from public.lh_product_variants
                   where product_id = v_prod.id and is_active) then
      raise exception 'variant_required';
    end if;

    insert into public.lh_order_items (order_id, product_id, variant_id, product_name,
                                       variant_label, unit_price, quantity, line_total)
    values (v_order, v_prod.id, v_var.id, v_prod.name, v_label, v_price, v_qty, v_price * v_qty);

    v_subtotal := v_subtotal + v_price * v_qty;
    v_var := null;
  end loop;

  update public.lh_orders
     set subtotal = v_subtotal, total = v_subtotal + v_fee
   where id = v_order;

  return jsonb_build_object('order_number', v_number, 'total', v_subtotal + v_fee);
end;
$$;

revoke all on function public.lh_place_order(text, text, smallint, text, text, text, jsonb) from public;
grant execute on function public.lh_place_order(text, text, smallint, text, text, text, jsonb) to anon, authenticated;

insert into public.lh_store_settings (key, value, is_public)
values ('store', '{"name":"Lighthouse Toys","tagline":"ألعاب ذكية تنمي العقل وتُبعد الأطفال عن الشاشات","logo_url":""}'::jsonb, true)
on conflict (key) do nothing;
