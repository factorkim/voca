-- ============================================================
-- 마이그레이션: 하루 복습 상한 (오늘 예정된 복습이 많으면 새 단어를 자동으로 줄이는 기준)
-- Supabase > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- ※ 앱(Vercel)을 새 버전으로 배포하기 "전에" 먼저 실행하세요. (이 열이 없으면 설정 저장이 거부돼요)
-- 기존 사용자도 기본값 250 이 적용돼요. 설정 화면의 '하루 복습 상한'에서 바꿀 수 있어요. (0 = 제한 없음)
-- ============================================================
alter table public.user_settings add column if not exists daily_cap integer not null default 250;
alter table public.user_settings drop constraint if exists user_settings_daily_cap_check;
alter table public.user_settings add constraint user_settings_daily_cap_check check (daily_cap = 0 or daily_cap between 50 and 1000);
