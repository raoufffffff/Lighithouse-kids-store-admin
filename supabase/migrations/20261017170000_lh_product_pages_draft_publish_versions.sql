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
