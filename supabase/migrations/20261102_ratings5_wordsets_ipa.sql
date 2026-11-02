-- ============================================================
-- 마이그레이션: 5단계 평가, 발음기호, 단어장(여러 단어 묶음), 하루 새 단어 기본 60개
-- 이미 예전 schema.sql 로 만든 DB에서 Supabase > SQL Editor 에 통째로 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전해요. 새로 만드는 DB는 schema.sql 만 실행하면 돼요.
--
-- ※ 반드시 앱(Vercel)을 새 버전으로 배포하기 "전에" 먼저 실행하세요.
--    새 앱은 '몰랐음/알고 있음' 평가와 단어장 정보를 저장하는데, 이 SQL이 없으면 저장이 거부돼요.
--    (거부된 기록은 기기에 남아 있다가 이 SQL을 실행한 뒤 자동으로 올라가요.)
-- ============================================================

begin;

-- 1) 단어장 표
create table if not exists public.word_sets (
  id           text primary key,
  name         text not null,
  description  text,
  ord          integer not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.word_sets enable row level security;
drop policy if exists "word_sets readable by signed-in users" on public.word_sets;
create policy "word_sets readable by signed-in users" on public.word_sets
  for select to authenticated using (true);

-- 2) 기존 단어를 단어장에 넣기: 샘플 단어는 'sample', 그 밖의 단어는 'book'(내 단어장)
insert into public.word_sets (id, name, description, ord) values
  ('sample', '샘플 단어 40개', '동작을 확인하기 위한 임시 단어 (발음기호 포함)', 1)
on conflict (id) do nothing;
insert into public.word_sets (id, name, description, ord)
select 'book', '내 단어장', '단어장 원본에서 옮긴 단어', 0
where exists (select 1 from public.words where source <> 'sample')
on conflict (id) do nothing;

alter table public.words add column if not exists set_id text;
alter table public.words add column if not exists ipa text;
update public.words set set_id = case when source = 'sample' then 'sample' else 'book' end where set_id is null;
alter table public.words alter column set_id set not null;
alter table public.words drop constraint if exists words_set_id_fkey;
alter table public.words add constraint words_set_id_fkey
  foreign key (set_id) references public.word_sets(id) on delete cascade;
create index if not exists words_set_idx on public.words (set_id, ord);

-- 3) 샘플 단어 40개의 발음기호 채우기 (이미 값이 있으면 건드리지 않아요)
update public.words w set ipa = v.ipa
from (values
  ('w001','əˈbændən'),('w002','əˈbʌndənt'),('w003','əˈkɑːmplɪʃ'),('w004','ˈædɪkwət'),('w005','æmˈbɪɡjuəs'),
  ('w006','ænˈtɪsɪpeɪt'),('w007','əˈpriːʃieɪt'),('w008','ˈɑːrbɪtreri'),('w009','kənˈsiːl'),('w010','ˈkɑːnsəkwens'),
  ('w011','dɪˈlɪbərət'),('w012','dɪˈmɪnɪʃ'),('w013','ɪˈlæbərət'),('w014','ɪˈlɪmɪneɪt'),('w015','ɪˈmɜːrdʒ'),
  ('w016','ɪnˈhæns'),('w017','ˈflʌktʃueɪt'),('w018','ˈhɪndər'),('w019','ɪnˈevɪtəbl'),('w020','ɪnˈhɪrənt'),
  ('w021','ˈmɪtɪɡeɪt'),('w022','ˌɑːbsəˈliːt'),('w023','pərˈsɪst'),('w024','ˈplɔːzəbl'),('w025','ˈprevələnt'),
  ('w026','rɪˈlʌktənt'),('w027','rɪˈzɪliənt'),('w028','skers'),('w029','sɪɡˈnɪfɪkənt'),('w030','səˈsteɪn'),
  ('w031','ˈθɜːroʊ'),('w032','trænsˈpærənt'),('w033','ˌʌndərˈmaɪn'),('w034','ˈvʌlnərəbl'),('w035','ˈwɔːrənt'),
  ('w036','kənˈtempəreri'),('w037','kəmˈpelɪŋ'),('w038','koʊˈhɪrənt'),('w039','ˌfʌndəˈmentl'),('w040','nɪˈɡlekt')
) as v(id, ipa)
where w.id = v.id and w.ipa is null;

-- 4) 5단계 평가: 몰랐음 / 틀림 / 비슷함 / 맞았음 / 알고 있음
alter table public.review_log drop constraint if exists review_log_rating_check;
alter table public.review_log add constraint review_log_rating_check
  check (rating in ('unknown','wrong','close','right','known'));
alter table public.study_sessions add column if not exists n_unknown integer not null default 0;
alter table public.study_sessions add column if not exists n_known integer not null default 0;

-- 5) 설정: 공부할 단어장, 하루 새 단어 기본값 60
alter table public.user_settings add column if not exists active_sets text[];
alter table public.user_settings alter column new_per_day set default 60;
-- 이미 저장된 사람들의 값(대부분 예전 기본값 10)은 그대로 둬요. 모두 60으로 바꾸고 싶다면 아래 줄의 앞 '--' 를 지우고 실행하세요.
-- update public.user_settings set new_per_day = 60 where new_per_day = 10;

-- 6) 날짜별 요약 뷰: 몰랐음(u), 알고 있음(k) 열을 맨 뒤에 추가
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

commit;
