-- ============================================================
-- 마이그레이션: 새 단어를 같은 Day 안에서 섞어 보여 주는 설정
-- Supabase > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- ※ 앱(Vercel)을 새 버전으로 배포하기 "전에" 먼저 실행하세요. (이 열이 없으면 설정 저장이 거부돼요)
-- 기존 사용자도 기본값 true(섞기 켜짐)가 적용돼요. 설정 화면의 '새 단어 순서'에서 바꿀 수 있어요.
-- ============================================================
alter table public.user_settings add column if not exists shuffle_new boolean not null default true;
