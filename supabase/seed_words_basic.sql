-- 기초 동사 샘플 단어장 15개 (단어장이 여러 개일 때 고르는 기능을 확인하는 용도예요)
-- 예문과 유의어는 AI가 만든 것이에요. 필요 없으면 아래 한 줄로 지울 수 있어요.
--   delete from public.word_sets where id = 'basic';   -- 단어와 그 학습 기록도 함께 지워져요
insert into public.word_sets (id, name, description, ord) values
  ('basic', '기초 동사 15개', '일상에서 자주 쓰는 기본 동사 (샘플)', 2)
on conflict (id) do nothing;
insert into public.words (id, ord, en, ko, pos, example, example_ko, synonyms, source, ai_generated, ipa, set_id) values
  ('b001', 1, 'borrow', '빌리다', 'v.', 'Can I borrow your pen for a moment?', '펜 잠깐 빌려도 될까요?', '[{"w":"lend","n":"반대로 빌려줌"},{"w":"rent","n":"돈을 내고 빌림"}]'::jsonb, 'sample', true, 'ˈbɑːroʊ', 'basic'),
  ('b002', 2, 'accept', '받아들이다', 'v.', 'She accepted the job offer yesterday.', '그녀는 어제 일자리 제안을 받아들였다.', '[{"w":"receive","n":"그냥 받음"},{"w":"agree to","n":"동의하며 받아들임"}]'::jsonb, 'sample', true, 'əkˈsept', 'basic'),
  ('b003', 3, 'arrange', '정리하다, 마련하다', 'v.', 'I arranged a meeting for next Monday.', '나는 다음 주 월요일에 회의를 잡았다.', '[{"w":"organize","n":"체계적으로 정리함"},{"w":"set up","n":"일정이나 모임을 마련함"}]'::jsonb, 'sample', true, 'əˈreɪndʒ', 'basic'),
  ('b004', 4, 'attend', '참석하다', 'v.', 'Nearly 200 people attended the lecture.', '거의 200명이 그 강연에 참석했다.', '[{"w":"go to","n":"가장 일반적인 표현"},{"w":"join","n":"함께 참여함"}]'::jsonb, 'sample', true, 'əˈtend', 'basic'),
  ('b005', 5, 'avoid', '피하다', 'v.', 'Try to avoid eating too late at night.', '밤늦게 먹는 것은 피하도록 해요.', '[{"w":"escape","n":"위험에서 벗어남"},{"w":"steer clear of","n":"가까이 가지 않음"}]'::jsonb, 'sample', true, 'əˈvɔɪd', 'basic'),
  ('b006', 6, 'compare', '비교하다', 'v.', 'Compare the two prices before you buy.', '사기 전에 두 가격을 비교해 보세요.', '[{"w":"contrast","n":"차이점을 강조해 비교함"},{"w":"weigh","n":"장단점을 따져 봄"}]'::jsonb, 'sample', true, 'kəmˈper', 'basic'),
  ('b007', 7, 'consider', '고려하다', 'v.', 'We should consider all the options.', '우리는 모든 선택지를 고려해야 한다.', '[{"w":"think about","n":"가장 일반적인 표현"},{"w":"contemplate","n":"깊이 생각함"}]'::jsonb, 'sample', true, 'kənˈsɪdər', 'basic'),
  ('b008', 8, 'decide', '결정하다', 'v.', 'He decided to study abroad.', '그는 유학을 가기로 결정했다.', '[{"w":"determine","n":"단호하게 정함"},{"w":"choose","n":"여럿 중에 고름"}]'::jsonb, 'sample', true, 'dɪˈsaɪd', 'basic'),
  ('b009', 9, 'describe', '묘사하다, 설명하다', 'v.', 'Can you describe what you saw?', '본 것을 설명해 줄 수 있나요?', '[{"w":"depict","n":"그림이나 글로 그려냄"},{"w":"explain","n":"이해되게 풀어 말함"}]'::jsonb, 'sample', true, 'dɪˈskraɪb', 'basic'),
  ('b010', 10, 'develop', '발전시키다, 개발하다', 'v.', 'The company developed a new app.', '그 회사는 새 앱을 개발했다.', '[{"w":"create","n":"새로 만들어냄"},{"w":"grow","n":"점점 커짐"}]'::jsonb, 'sample', true, 'dɪˈveləp', 'basic'),
  ('b011', 11, 'discover', '발견하다', 'v.', 'Scientists discovered a new species of frog.', '과학자들이 새로운 개구리 종을 발견했다.', '[{"w":"find","n":"가장 일반적인 표현"},{"w":"uncover","n":"숨겨진 것을 밝혀냄"}]'::jsonb, 'sample', true, 'dɪˈskʌvər', 'basic'),
  ('b012', 12, 'explain', '설명하다', 'v.', 'Please explain how this machine works.', '이 기계가 어떻게 작동하는지 설명해 주세요.', '[{"w":"clarify","n":"분명하게 밝힘"},{"w":"describe","n":"모습이나 상황을 말함"}]'::jsonb, 'sample', true, 'ɪkˈspleɪn', 'basic'),
  ('b013', 13, 'improve', '개선하다, 나아지다', 'v.', 'My English has improved a lot this year.', '올해 내 영어 실력이 많이 늘었다.', '[{"w":"enhance","n":"질을 높임"},{"w":"upgrade","n":"더 좋은 것으로 바꿈"}]'::jsonb, 'sample', true, 'ɪmˈpruːv', 'basic'),
  ('b014', 14, 'introduce', '소개하다, 도입하다', 'v.', 'Let me introduce my friend Jisu.', '제 친구 지수를 소개할게요.', '[{"w":"present","n":"공식적으로 소개함"},{"w":"launch","n":"새 제품이나 제도를 내놓음"}]'::jsonb, 'sample', true, 'ˌɪntrəˈduːs', 'basic'),
  ('b015', 15, 'require', '필요로 하다, 요구하다', 'v.', 'This job requires good communication skills.', '이 일은 좋은 소통 능력이 필요하다.', '[{"w":"need","n":"가장 일반적인 표현"},{"w":"demand","n":"강하게 요구함"}]'::jsonb, 'sample', true, 'rɪˈkwaɪər', 'basic')
on conflict (id) do nothing;
