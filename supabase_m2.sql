-- ITSS L5 Study M2 / Supabase SQL Editor で実行
-- Auth は Supabase Dashboard 側で Email provider を有効にしてください。

create table if not exists public.user_question_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  starred boolean not null default false,
  star_updated_at timestamptz,
  attempt_count int not null default 0,
  correct_count int not null default 0,
  wrong_count int not null default 0,
  correct_streak int not null default 0,
  mastery_level smallint not null default 0 check (mastery_level between 0 and 4),
  recovery_count int not null default 0,
  correct_days jsonb not null default '[]'::jsonb,
  last_answered_at timestamptz,
  last_wrong_at timestamptz,
  next_review_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.user_question_state add column if not exists star_updated_at timestamptz;

create table if not exists public.attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  answered_at timestamptz not null,
  correct boolean not null,
  choice smallint not null,
  domain text not null,
  mastery_before smallint not null,
  mastery_after smallint not null
);

alter table public.user_question_state enable row level security;
alter table public.attempts enable row level security;

drop policy if exists "own question state" on public.user_question_state;
create policy "own question state" on public.user_question_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own attempts" on public.attempts;
create policy "own attempts" on public.attempts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists attempts_user_answered_idx on public.attempts(user_id, answered_at desc);
create index if not exists question_state_user_review_idx on public.user_question_state(user_id, next_review_at);
