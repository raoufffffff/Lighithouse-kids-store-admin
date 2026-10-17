-- Usage log for AI page generation (used by the lh-generate-page function for rate limiting).
create table if not exists public.lh_ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  product_id uuid references public.lh_products(id) on delete set null,
  kind text not null default 'generate',
  created_at timestamptz not null default now()
);
create index if not exists lh_ai_generations_recent_idx on public.lh_ai_generations(created_at desc);

alter table public.lh_ai_generations enable row level security;
create policy "admin all ai generations" on public.lh_ai_generations
  for all to authenticated
  using (public.lh_is_admin()) with check (public.lh_is_admin());
