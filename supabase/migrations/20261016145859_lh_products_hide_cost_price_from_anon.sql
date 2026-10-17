revoke select on public.lh_products from anon;
grant select (id, category_id, name, slug, description, base_price, compare_at_price, sku, images,
              landing_images, landing_position, is_active, is_featured, created_at, updated_at)
  on public.lh_products to anon;
