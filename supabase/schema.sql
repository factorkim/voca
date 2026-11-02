-- ============================================================
-- 단어 복습장 데이터베이스 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전해요.
-- ※ 이미 예전 버전으로 만들어 둔 DB라면 이 파일 대신 supabase/migrations 폴더의 SQL을 실행하세요.
-- ============================================================

-- 0) 단어장(단어 묶음). 학습자는 설정 화면에서 공부할 단어장을 골라요. 추가는 관리자가 SQL로 해요.
create table if not exists public.word_sets (
  id           text primary key,                      -- 예: 'toeic', 'suneung'
  name         text not null,                         -- 화면에 보이는 이름
  description  text,
  ord          integer not null default 0,            -- 목록 순서
  created_at   timestamptz not null default now()
);

-- 1) 단어 (모든 사용자가 같이 읽어요. 수정은 관리자만 SQL/Table editor로 해요)
create table if not exists public.words (
  id           text primary key,
  set_id       text not null references public.word_sets(id) on delete cascade,
  ord          integer not null default 0,
  en           text not null,
  ipa          text,                                  -- 발음기호 (슬래시 없이, 예: əˈbændən)
  ko           text not null,
  pos          text,
  example      text,
  example_ko   text,
  synonyms     jsonb not null default '[]'::jsonb,   -- [{"w":"hide","n":"가장 일반적"}]
  source       text not null default 'book',          -- book | sample
  ai_generated boolean not null default false,        -- 예문·유의어를 AI가 만들었는지
  page         integer,                               -- 단어장 원본 페이지
  created_at   timestamptz not null default now()
);

-- 2) 사용자 설정
create table if not exists public.user_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  new_per_day  integer not null default 60 check (new_per_day between 0 and 200),
  direction    text not null default 'en2ko' check (direction in ('en2ko','ko2en','mix')),
  active_sets  text[],                                -- 공부할 단어장 id 목록. null 이면 전체
  consented_at timestamptz,                           -- 학습 기록 저장 안내에 동의한 시각
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 3) 사용자 x 단어의 현재 학습 상태
create table if not exists public.card_state (
  user_id        uuid not null references auth.users(id) on delete cascade,
  word_id        text not null references public.words(id) on delete cascade,
  phase          text not null check (phase in ('new','learn','review')),
  ease           real not null,
  ivl            integer not null,                    -- 현재 복습 간격(일)
  step           integer not null default 0,          -- 학습 단계 (1분 -> 10분)
  reps           integer not null default 0,          -- 연속 정답 수
  lapses         integer not null default 0,          -- 복습 중 틀린 누적 횟수
  pend           integer not null default 0,          -- 틀린 뒤 재학습을 마치면 돌아갈 간격
  due            timestamptz,
  last_review    timestamptz,
  first_seen_at  timestamptz,
  total_reviews  integer not null default 0,
  hist           jsonb not null default '[]'::jsonb,  -- 최근 결과 [[ms,"r"],...]
  updated_at     timestamptz not null default now(),
  primary key (user_id, word_id)
);
create index if not exists card_state_due_idx on public.card_state (user_id, due);

-- 4) 복습 로그: 복습 한 번마다 한 줄. 나중에 분석/기능 추가에 쓰는 핵심 데이터예요.
create table if not exists public.review_log (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null,                       -- 재전송해도 중복 저장되지 않게 하는 값
  word_id        text not null,                       -- 단어가 지워져도 기록은 남도록 FK 없음
  reviewed_at    timestamptz not null,
  local_date     text not null,                       -- 사용자 기준 날짜 YYYY-MM-DD
  local_hour     smallint not null,                   -- 사용자 기준 시각(0-23)
  tz             text,
  rating         text not null check (rating in ('unknown','wrong','close','right','known')),   -- 몰랐음/틀림/비슷함/맞았음/알고 있음
  direction      text not null check (direction in ('en2ko','ko2en')),
  mode           text not null default 'daily',       -- daily | leech
  is_new         boolean not null,                    -- 처음 본 단어였는지
  phase_before   text, phase_after text,
  ivl_before     integer, ivl_after integer,
  ease_before    real,    ease_after real,
  reps_before    integer, reps_after integer,
  lapses_before  integer, lapses_after integer,
  step_before    integer,
  due_before     timestamptz, due_after timestamptz,
  overdue_days   real,                                -- 예정일보다 얼마나 늦게 복습했는지
  reveal_ms      integer,                             -- 카드가 뜬 뒤 '정답 보기'까지 걸린 시간
  rate_ms        integer,                             -- 정답을 보고 평가를 고르기까지 걸린 시간
  was_hidden     boolean not null default false,      -- 카드를 보는 중 앱이 백그라운드로 갔는지
  speak_count    smallint not null default 0,         -- 발음 듣기를 누른 횟수
  session_id     uuid,
  card_index     integer,                             -- 이 세션의 몇 번째 카드였는지
  queue_left     integer,                             -- 평가 직전 남은 카드 수
  device         jsonb,                               -- 화면 크기, 설치 여부, 언어, UA
  app_version    text,
  created_at     timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists review_log_user_time_idx on public.review_log (user_id, reviewed_at);
create index if not exists review_log_user_word_idx on public.review_log (user_id, word_id, reviewed_at);

-- 5) 학습 세션
create table if not exists public.study_sessions (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  started_at       timestamptz not null,
  last_activity_at timestamptz not null,
  mode             text not null default 'daily',
  cards_done       integer not null default 0,
  n_unknown        integer not null default 0,
  n_wrong          integer not null default 0,
  n_close          integer not null default 0,
  n_right          integer not null default 0,
  n_known          integer not null default 0,
  n_new            integer not null default 0,
  tz               text,
  device           jsonb,
  app_version      text
);
create index if not exists study_sessions_user_idx on public.study_sessions (user_id, started_at);

-- 6) 날짜별 요약 (앱의 통계 화면이 사용해요)
create or replace view public.daily_stats with (security_invoker = true) as
select
  user_id,
  local_date,
  count(*)::int                                   as n,
  (count(*) filter (where rating = 'wrong'))::int as w,
  (count(*) filter (where rating = 'close'))::int as c,
  (count(*) filter (where rating = 'right'))::int as r,
  (count(*) filter (where is_new))::int           as nw,
  (count(*) filter (where rating = 'unknown'))::int as u,
  (count(*) filter (where rating = 'known'))::int   as k
from public.review_log
group by user_id, local_date;

-- ------------------------------------------------------------
-- 접근 권한 (Row Level Security): 각자 자기 기록만 볼 수 있어요.
-- ------------------------------------------------------------
alter table public.word_sets      enable row level security;
alter table public.words          enable row level security;
alter table public.user_settings  enable row level security;
alter table public.card_state     enable row level security;
alter table public.review_log     enable row level security;
alter table public.study_sessions enable row level security;

drop policy if exists "word_sets readable by signed-in users" on public.word_sets;
create policy "word_sets readable by signed-in users" on public.word_sets
  for select to authenticated using (true);

drop policy if exists "words readable by signed-in users" on public.words;
create policy "words readable by signed-in users" on public.words
  for select to authenticated using (true);

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own cards" on public.card_state;
create policy "own cards" on public.card_state
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own sessions" on public.study_sessions;
create policy "own sessions" on public.study_sessions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 복습 로그: 읽기, 추가, 내 기록 삭제만 가능 (수정은 불가)
drop policy if exists "own log select" on public.review_log;
create policy "own log select" on public.review_log
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own log insert" on public.review_log;
create policy "own log insert" on public.review_log
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own log delete" on public.review_log;
create policy "own log delete" on public.review_log
  for delete to authenticated using (user_id = auth.uid());
