-- Create pins table for user posts on the map
create table if not exists public.pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text', 'media')),
  content text, -- text content or backwards compat
  caption text, -- caption for media posts
  media_url text, -- URL for photo/video
  media_type text check (media_type in ('photo', 'video')), -- photo or video
  lat double precision not null,
  lng double precision not null,
  layer text not null default 'public', -- public, friends, private, events
  author_name text,
  author_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for efficient geospatial queries
create index if not exists pins_location_idx on public.pins(lat, lng);

-- Index for user's own pins
create index if not exists pins_user_id_idx on public.pins(user_id);

-- Index for layer filtering
create index if not exists pins_layer_idx on public.pins(layer);

-- Enable Row Level Security
alter table public.pins enable row level security;

-- Policy: Anyone can read public pins
create policy "Public pins are viewable by everyone"
  on public.pins for select
  using (layer = 'public');

-- Policy: Authenticated users can insert their own pins
create policy "Users can create their own pins"
  on public.pins for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Policy: Users can update their own pins
create policy "Users can update their own pins"
  on public.pins for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Policy: Users can delete their own pins
create policy "Users can delete their own pins"
  on public.pins for delete
  to authenticated
  using (auth.uid() = user_id);

-- Enable realtime for pins table
alter publication supabase_realtime add table public.pins;
