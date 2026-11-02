-- ============================================================
-- 마이그레이션: 기억 강도 설정 + 기억 점검용 요약 열
-- Supabase > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- ※ 앱(Vercel)을 새 버전으로 배포하기 "전에" 먼저 실행하세요. (이 열이 없으면 설정 저장이 거부돼요)
-- 기존 사용자도 기본값 0.85(강화)가 적용돼요. 설정 화면의 '기억 강도'에서 바꿀 수 있어요.
-- ============================================================
alter table public.user_settings add column if not exists interval_scale real not null default 0.85;
alter table public.user_settings drop constraint if exists user_settings_interval_scale_check;
alter table public.user_settings add constraint user_settings_interval_scale_check check (interval_scale between 0.5 and 1);

-- 열을 끝에 덧붙이기만 해서 기존 열 순서는 그대로예요.
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
  (count(*) filter (where rating = 'known'))::int   as k,
  (count(*) filter (where phase_before = 'review'))::int as rn,
  (count(*) filter (where phase_before = 'review' and rating in ('right','known')))::int as rk,
  (count(*) filter (where reveal_ms is not null and reveal_ms < 1000))::int as fn
from public.review_log
group by user_id, local_date;
