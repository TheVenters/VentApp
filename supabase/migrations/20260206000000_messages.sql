-- Private messages table

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Set replica identity to full for realtime to work with RLS
alter table public.messages replica identity full;

-- Indexes for efficient queries
create index if not exists messages_from_user_idx on public.messages(from_user_id);
create index if not exists messages_to_user_idx on public.messages(to_user_id);
create index if not exists messages_created_at_idx on public.messages(created_at);

-- Conversation index (for fetching messages between two users)
create index if not exists messages_conversation_idx on public.messages(from_user_id, to_user_id, created_at);

-- Enable RLS
alter table public.messages enable row level security;

-- Users can see messages they sent or received
create policy "Users can view their own messages"
  on public.messages for select
  to authenticated
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

-- Users can send messages
create policy "Users can send messages"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = from_user_id);

-- Users can update messages they received (mark as read)
create policy "Users can mark messages as read"
  on public.messages for update
  to authenticated
  using (auth.uid() = to_user_id);

-- Users can delete their own sent messages
create policy "Users can delete their sent messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = from_user_id);

-- Enable realtime for messages
alter publication supabase_realtime add table public.messages;
