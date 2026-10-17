
-- ============================================================
-- 20261016133732_lighthouse_store_schema.sql
-- ============================================================
-- Lighthouse Kids Store: e-commerce schema (prefix lh_ to avoid clashes with existing tables)

create or replace function public.lh_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Admins (linked to Supabase Auth users)
create table public.lh_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.lh_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lh_admins a where a.user_id = (select auth.uid()));
$$;
revoke execute on function public.lh_is_admin() from public, anon;
grant execute on function public.lh_is_admin() to authenticated;

-- Categories
create table public.lh_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.lh_categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lh_categories_parent_idx on public.lh_categories(parent_id);

-- Products
create table public.lh_products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.lh_categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  brand text,
  gender text check (gender in ('boys','girls','unisex')),
  age_range text,
  base_price numeric(12,2) not null check (base_price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price >= 0),
  cost_price numeric(12,2) check (cost_price >= 0),
  sku text unique,
  images text[] not null default '{}',
  is_active boolean not null default true,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lh_products_category_idx on public.lh_products(category_id);
create index lh_products_active_idx on public.lh_products(is_active, is_featured);

-- Variants (size / color / stock)
create table public.lh_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  sku text unique,
  size text,
  color text,
  price numeric(12,2) check (price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lh_variants_product_idx on public.lh_product_variants(product_id);

-- Delivery rates per wilaya
create table public.lh_delivery_rates (
  wilaya_code smallint primary key check (wilaya_code between 1 and 58),
  wilaya_name text not null,
  home_fee numeric(12,2) not null default 0 check (home_fee >= 0),
  desk_fee numeric(12,2) not null default 0 check (desk_fee >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Customers
create table public.lh_customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  email text,
  wilaya_code smallint references public.lh_delivery_rates(wilaya_code),
  commune text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lh_customers_wilaya_idx on public.lh_customers(wilaya_code);

-- Orders
create table public.lh_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_id uuid references public.lh_customers(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  wilaya_code smallint references public.lh_delivery_rates(wilaya_code),
  commune text,
  address text,
  delivery_type text not null default 'home' check (delivery_type in ('home','desk')),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  payment_method text not null default 'cod' check (payment_method in ('cod','card','transfer')),
  status text not null default 'pending' check (status in ('pending','confirmed','shipped','delivered','cancelled','returned')),
  tracking_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lh_orders_customer_idx on public.lh_orders(customer_id);
create index lh_orders_wilaya_idx on public.lh_orders(wilaya_code);
create index lh_orders_status_idx on public.lh_orders(status, created_at desc);

-- Order items (snapshot of name/price at purchase time)
create table public.lh_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lh_orders(id) on delete cascade,
  product_id uuid references public.lh_products(id) on delete set null,
  variant_id uuid references public.lh_product_variants(id) on delete set null,
  product_name text not null,
  variant_label text,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);
create index lh_order_items_order_idx on public.lh_order_items(order_id);
create index lh_order_items_product_idx on public.lh_order_items(product_id);
create index lh_order_items_variant_idx on public.lh_order_items(variant_id);

-- Store settings
create table public.lh_store_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

-- updated_at triggers
create trigger lh_categories_updated before update on public.lh_categories for each row execute function public.lh_set_updated_at();
create trigger lh_products_updated before update on public.lh_products for each row execute function public.lh_set_updated_at();
create trigger lh_variants_updated before update on public.lh_product_variants for each row execute function public.lh_set_updated_at();
create trigger lh_delivery_updated before update on public.lh_delivery_rates for each row execute function public.lh_set_updated_at();
create trigger lh_customers_updated before update on public.lh_customers for each row execute function public.lh_set_updated_at();
create trigger lh_orders_updated before update on public.lh_orders for each row execute function public.lh_set_updated_at();
create trigger lh_settings_updated before update on public.lh_store_settings for each row execute function public.lh_set_updated_at();

-- RLS
alter table public.lh_admins enable row level security;
alter table public.lh_categories enable row level security;
alter table public.lh_products enable row level security;
alter table public.lh_product_variants enable row level security;
alter table public.lh_delivery_rates enable row level security;
alter table public.lh_customers enable row level security;
alter table public.lh_orders enable row level security;
alter table public.lh_order_items enable row level security;
alter table public.lh_store_settings enable row level security;

-- Public read (storefront)
create policy "public read active categories" on public.lh_categories for select to anon, authenticated using (is_active);
create policy "public read active products" on public.lh_products for select to anon, authenticated using (is_active);
create policy "public read active variants" on public.lh_product_variants for select to anon, authenticated using (is_active);
create policy "public read active delivery rates" on public.lh_delivery_rates for select to anon, authenticated using (is_active);
create policy "public read public settings" on public.lh_store_settings for select to anon, authenticated using (is_public);

-- Admin full access
create policy "admin all admins" on public.lh_admins for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all categories" on public.lh_categories for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all products" on public.lh_products for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all variants" on public.lh_product_variants for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all delivery rates" on public.lh_delivery_rates for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all customers" on public.lh_customers for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all orders" on public.lh_orders for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all order items" on public.lh_order_items for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());
create policy "admin all settings" on public.lh_store_settings for all to authenticated using (public.lh_is_admin()) with check (public.lh_is_admin());

-- Seed the 58 wilayas (fees to be set from the admin panel)
insert into public.lh_delivery_rates (wilaya_code, wilaya_name) values
(1,'Adrar'),(2,'Chlef'),(3,'Laghouat'),(4,'Oum El Bouaghi'),(5,'Batna'),(6,'Béjaïa'),(7,'Biskra'),(8,'Béchar'),(9,'Blida'),(10,'Bouira'),
(11,'Tamanrasset'),(12,'Tébessa'),(13,'Tlemcen'),(14,'Tiaret'),(15,'Tizi Ouzou'),(16,'Alger'),(17,'Djelfa'),(18,'Jijel'),(19,'Sétif'),(20,'Saïda'),
(21,'Skikda'),(22,'Sidi Bel Abbès'),(23,'Annaba'),(24,'Guelma'),(25,'Constantine'),(26,'Médéa'),(27,'Mostaganem'),(28,'M''Sila'),(29,'Mascara'),(30,'Ouargla'),
(31,'Oran'),(32,'El Bayadh'),(33,'Illizi'),(34,'Bordj Bou Arréridj'),(35,'Boumerdès'),(36,'El Tarf'),(37,'Tindouf'),(38,'Tissemsilt'),(39,'El Oued'),(40,'Khenchela'),
(41,'Souk Ahras'),(42,'Tipaza'),(43,'Mila'),(44,'Aïn Defla'),(45,'Naâma'),(46,'Aïn Témouchent'),(47,'Ghardaïa'),(48,'Relizane'),(49,'Timimoun'),(50,'Bordj Badji Mokhtar'),
(51,'Ouled Djellal'),(52,'Béni Abbès'),(53,'In Salah'),(54,'In Guezzam'),(55,'Touggourt'),(56,'Djanet'),(57,'El M''Ghair'),(58,'El Meniaa');

-- ============================================================
-- 20261016133738_lighthouse_store_images_bucket.sql
-- ============================================================
insert into storage.buckets (id, name, public)
values ('lh-products', 'lh-products', true)
on conflict (id) do nothing;

create policy "lh products images public read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'lh-products');

create policy "lh products images admin insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'lh-products' and public.lh_is_admin());

create policy "lh products images admin update"
on storage.objects for update to authenticated
using (bucket_id = 'lh-products' and public.lh_is_admin())
with check (bucket_id = 'lh-products' and public.lh_is_admin());

create policy "lh products images admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'lh-products' and public.lh_is_admin());

-- ============================================================
-- 20261016144315_lh_products_landing_images.sql
-- ============================================================
alter table public.lh_products
  add column if not exists landing_images text[] not null default '{}',
  add column if not exists landing_position text not null default 'below'
    check (landing_position in ('above','below'));

-- ============================================================
-- 20261016145640_lh_place_order_rpc_and_store_setting.sql
-- ============================================================
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

-- ============================================================
-- 20261016145859_lh_products_hide_cost_price_from_anon.sql
-- ============================================================
revoke select on public.lh_products from anon;
grant select (id, category_id, name, slug, description, base_price, compare_at_price, sku, images,
              landing_images, landing_position, is_active, is_featured, created_at, updated_at)
  on public.lh_products to anon;

-- ============================================================
-- 20261017000000_lh_orders_add_unreachable_status.sql
-- ============================================================
alter table public.lh_orders drop constraint if exists lh_orders_status_check;
alter table public.lh_orders add constraint lh_orders_status_check
  check (status in ('pending','confirmed','unreachable','shipped','delivered','cancelled','returned'));

-- ============================================================
-- 20261017170000_lh_product_pages_draft_publish_versions.sql
-- ============================================================
-- Product page builder: draft / published content + version history.
alter table public.lh_products
  add column if not exists page_draft jsonb,
  add column if not exists page_content jsonb,
  add column if not exists page_published_at timestamptz;

-- Visitors may read the PUBLISHED content only (page_draft stays private).
grant select (page_content) on public.lh_products to anon;

create table public.lh_product_page_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  content jsonb not null,
  label text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index lh_page_versions_product_idx
  on public.lh_product_page_versions(product_id, created_at desc);

alter table public.lh_product_page_versions enable row level security;
create policy "admin all page versions" on public.lh_product_page_versions
  for all to authenticated
  using (public.lh_is_admin()) with check (public.lh_is_admin());

-- Publishes the current draft atomically and snapshots it as a version.
-- SECURITY INVOKER: row level security still applies to the caller.
create or replace function public.lh_publish_product_page(p_product_id uuid, p_label text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_draft jsonb;
begin
  if not public.lh_is_admin() then
    raise exception 'forbidden';
  end if;

  select page_draft into v_draft from public.lh_products where id = p_product_id;
  if v_draft is null then
    raise exception 'no_draft';
  end if;

  update public.lh_products
     set page_content = v_draft, page_published_at = now()
   where id = p_product_id;

  insert into public.lh_product_page_versions (product_id, content, label)
  values (p_product_id, v_draft, nullif(btrim(coalesce(p_label, '')), ''));

  -- keep the 30 most recent versions per product
  delete from public.lh_product_page_versions
   where product_id = p_product_id
     and id not in (
       select id from public.lh_product_page_versions
        where product_id = p_product_id
        order by created_at desc
        limit 30
     );

  return jsonb_build_object('published_at', now());
end;
$$;

revoke all on function public.lh_publish_product_page(uuid, text) from public, anon;
grant execute on function public.lh_publish_product_page(uuid, text) to authenticated;
