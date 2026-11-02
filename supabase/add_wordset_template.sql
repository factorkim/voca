-- ============================================================
-- 새 단어장(단어 DB) 추가 템플릿
-- Supabase > SQL Editor 에서 아래를 내 단어에 맞게 고쳐서 Run 하세요.
-- 추가하면 모든 사용자의 설정 > 단어장 선택 목록에 바로 나타나요. (지우면 그 단어의 학습 기록도 함께 지워져요)
-- ============================================================

-- 1) 단어장 만들기: id 는 영문 소문자/숫자/밑줄, ord 는 목록 순서(작을수록 위)
insert into public.word_sets (id, name, description, ord) values
  ('toeic', '토익 필수 단어', '토익 빈출 어휘', 10)
on conflict (id) do update set name = excluded.name, description = excluded.description, ord = excluded.ord;

-- 2) 단어 넣기
--    id   : 모든 단어장을 통틀어 겹치지 않게 (예: 'toeic-001')
--    ord  : 단어장 안에서의 순서 (이 순서대로 새 단어가 나와요)
--    ipa  : 발음기호. 슬래시(/) 없이 적어요. 없으면 null
--    synonyms : [{"w":"단어","n":"뜻의 차이"}] 형식. 없으면 '[]'
--    작은따옴표(') 가 들어가면 두 번('')으로 적어요.
insert into public.words (id, set_id, ord, en, ipa, ko, pos, example, example_ko, synonyms, source, ai_generated) values
  ('toeic-001', 'toeic', 1, 'negotiate', 'nɪˈɡoʊʃieɪt', '협상하다', 'v.', 'They negotiated a better price.', '그들은 더 나은 가격에 협상했다.', '[{"w":"bargain","n":"가격을 흥정함"}]'::jsonb, 'book', false),
  ('toeic-002', 'toeic', 2, 'revenue',   'ˈrevənuː',     '수익, 매출', 'n.', 'Annual revenue rose by ten percent.', '연간 매출이 10퍼센트 늘었다.', '[]'::jsonb, 'book', false)
on conflict (id) do nothing;

-- 3) (선택) 단어장 이름 바꾸기 / 지우기
-- update public.word_sets set name = '새 이름' where id = 'toeic';
-- delete from public.word_sets where id = 'toeic';
