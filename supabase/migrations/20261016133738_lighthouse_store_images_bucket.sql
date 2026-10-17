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
