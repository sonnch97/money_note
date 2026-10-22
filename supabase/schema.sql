-- Chạy một lần trong Supabase Dashboard → SQL Editor.
-- Mỗi giao dịch, danh mục và khoản ngân sách là một hàng riêng.
create table if not exists public.moneynote_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('transaction', 'category', 'budget_total', 'category_budget')),
  record_id text not null check (length(record_id) between 1 and 512),
  payload jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, record_id)
);

create or replace function public.moneynote_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists moneynote_touch_updated_at on public.moneynote_records;
create trigger moneynote_touch_updated_at
before update on public.moneynote_records
for each row execute function public.moneynote_touch_updated_at();

alter table public.moneynote_records enable row level security;
revoke all on public.moneynote_records from anon;
grant select, insert, update, delete on public.moneynote_records to authenticated;

drop policy if exists "Read own MoneyNote records" on public.moneynote_records;
create policy "Read own MoneyNote records" on public.moneynote_records
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Insert own MoneyNote records" on public.moneynote_records;
create policy "Insert own MoneyNote records" on public.moneynote_records
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Update own MoneyNote records" on public.moneynote_records;
create policy "Update own MoneyNote records" on public.moneynote_records
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- DELETE vật lý không dùng: ứng dụng ghi deleted=true để thiết bị khác không phục hồi mục đã xóa.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moneynote_records'
  ) then
    alter publication supabase_realtime add table public.moneynote_records;
  end if;
end;
$$;
