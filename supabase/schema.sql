-- MOZILANIM persistent storage
-- Run this once in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.mozilanim_state (
  id text primary key,
  anime jsonb not null default '[]'::jsonb,
  applications jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  users jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.mozilanim_state (id)
values ('main')
on conflict (id) do nothing;

create table if not exists public.mozilanim_users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'studio-maker', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.mozilanim_sessions (
  token_hash text primary key,
  user_id text,
  role text not null check (role in ('user', 'studio-maker', 'admin')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mozilanim_sessions_expiry_idx
  on public.mozilanim_sessions (expires_at);

create table if not exists public.mozilanim_uploads (
  id text primary key,
  name text not null,
  mime_type text not null default 'video/mp4',
  size bigint not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('mozilanim-videos', 'mozilanim-videos', false)
on conflict (id) do update set public = false;