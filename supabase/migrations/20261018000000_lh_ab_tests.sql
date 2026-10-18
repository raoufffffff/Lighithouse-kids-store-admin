-- A/B tests: shared link /ab/<slug>, variants baked into the static page, views/orders tracked via RPC.
create table if not exists public.lh_ab_tests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.lh_products(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.lh_ab_variants (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.lh_ab_tests(id) on delete cascade,
  label text not null,
  content jsonb not null,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.lh_ab_events (
  id bigint generated always as identity primary key,
  test_id uuid not null references public.lh_ab_tests(id) on delete cascade,
  variant_id uuid not null references public.lh_ab_variants(id) on delete cascade,
  kind text not null check (kind in ('view','order')),
  order_number bigint,
  value numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists lh_ab_events_one_order on public.lh_ab_events (variant_id, order_number) where kind = 'order';
-- RLS, anon column grants and the functions lh_ab_track / lh_ab_stats were applied directly to the project.
