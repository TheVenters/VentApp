-- Friends and friend requests tables

-- Friend requests table
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(from_user_id, to_user_id)
);

-- Friends table (accepted friendships)
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, friend_id)
);

-- Indexes for efficient queries
create index if not exists friend_requests_from_user_idx on public.friend_requests(from_user_id);
create index if not exists friend_requests_to_user_idx on public.friend_requests(to_user_id);
create index if not exists friend_requests_status_idx on public.friend_requests(status);
create index if not exists friends_user_id_idx on public.friends(user_id);
create index if not exists friends_friend_id_idx on public.friends(friend_id);

-- Enable RLS
alter table public.friend_requests enable row level security;
alter table public.friends enable row level security;

-- Create a view for user profiles (safe to expose)
create or replace view public.user_profiles as
select 
  id,
  raw_user_meta_data->>'name' as name,
  raw_user_meta_data->>'username' as username,
  created_at
from auth.users;

-- Grant access to the view
grant select on public.user_profiles to anon, authenticated;

-- Friend requests policies
-- Users can see requests they sent or received
create policy "Users can view their own friend requests"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

-- Users can send friend requests
create policy "Users can send friend requests"
  on public.friend_requests for insert
  to authenticated
  with check (auth.uid() = from_user_id);

-- Users can update requests sent to them (accept/reject)
create policy "Users can respond to friend requests"
  on public.friend_requests for update
  to authenticated
  using (auth.uid() = to_user_id);

-- Users can delete requests they sent
create policy "Users can cancel their friend requests"
  on public.friend_requests for delete
  to authenticated
  using (auth.uid() = from_user_id);

-- Friends policies
-- Users can see their own friendships
create policy "Users can view their friendships"
  on public.friends for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- Users can add friends (when accepting request)
create policy "Users can add friends"
  on public.friends for insert
  to authenticated
  with check (auth.uid() = user_id or auth.uid() = friend_id);

-- Users can remove friends
create policy "Users can remove friends"
  on public.friends for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- Enable realtime
alter publication supabase_realtime add table public.friend_requests;
alter publication supabase_realtime add table public.friends;
