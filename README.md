# Admin Orders Dashboard (Next.js + Supabase)

## Setup

1) Install deps
```bash
npm i
```

2) Add `.env.local`
```env
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

3) Run locally
```bash
npm run dev
```

## Deploy to Vercel
- Import the repo
- Add the same env vars in Vercel project settings:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

## Supabase Admin-only RLS SQL

Run this in Supabase SQL editor:

```sql
-- 1) Admin table
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2) Orders RLS
alter table public.orders enable row level security;

-- admins can read all orders
drop policy if exists "admins_select_all_orders" on public.orders;
create policy "admins_select_all_orders"
on public.orders
for select
using (
  exists (select 1 from public.admin_users au where au.user_id = auth.uid())
);

-- admins can update order status (and other columns if you allow)
drop policy if exists "admins_update_orders" on public.orders;
create policy "admins_update_orders"
on public.orders
for update
using (
  exists (select 1 from public.admin_users au where au.user_id = auth.uid())
)
with check (
  exists (select 1 from public.admin_users au where au.user_id = auth.uid())
);

-- (Optional) If you use addresses too:
-- alter table public.addresses enable row level security;
-- create similar admin policies on addresses.
```

### Insert your first admin user
1) Create/login your admin user in Supabase Auth (email/password).
2) Copy the user's UUID from Auth users table.
3) Insert:
```sql
insert into public.admin_users (user_id) values ('YOUR_AUTH_USER_UUID');
```

## Realtime
Ensure realtime is enabled for `public.orders`:
Supabase Dashboard → Database → Replication → enable `orders` for realtime.
