alter table public.lh_products
  add column if not exists landing_images text[] not null default '{}',
  add column if not exists landing_position text not null default 'below'
    check (landing_position in ('above','below'));
