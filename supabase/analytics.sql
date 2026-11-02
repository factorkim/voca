-- ============================================================
-- 쌓인 학습 데이터를 들여다보는 예시 쿼리 (관리자용)
-- Supabase > SQL Editor 에서 실행하면 모든 사용자의 데이터를 볼 수 있어요.
-- (앱 안에서는 각자 자기 기록만 보여요.)
-- ============================================================

-- 1) 가장 많이 틀리는 단어 TOP 20
select w.en, w.ko,
       count(*)                                            as 복습횟수,
       count(*) filter (where l.rating = 'wrong')          as 틀림,
       round(100.0 * count(*) filter (where l.rating = 'wrong') / count(*), 1) as 틀린비율
from review_log l join words w on w.id = l.word_id
group by w.en, w.ko
having count(*) >= 5
order by 틀린비율 desc
limit 20;

-- 2) 시간대별 정답률 (사용자 기준 시각)
select local_hour as 시,
       count(*) as 복습수,
       round(100.0 * count(*) filter (where rating = 'right') / count(*), 1) as 정답률
from review_log
group by local_hour order by local_hour;

-- 3) 늦게 복습할수록 틀리는지: 밀린 일수 구간별 정답률
select case when overdue_days is null then '새 단어'
            when overdue_days < 0.5 then '제때'
            when overdue_days < 2   then '1~2일 늦음'
            else '2일 이상 늦음' end as 구간,
       count(*) as 복습수,
       round(100.0 * count(*) filter (where rating = 'right') / count(*), 1) as 정답률
from review_log
group by 1 order by 1;

-- 4) 사람별 학습량 요약
select user_id, count(*) as 복습수, count(distinct local_date) as 학습한날,
       round(100.0 * count(*) filter (where rating = 'right') / count(*), 1) as 정답률,
       round(avg(reveal_ms) filter (where not was_hidden) / 1000.0, 1) as 평균_생각시간_초
from review_log group by user_id order by 복습수 desc;

-- 5) 방향별(영→한 / 한→영) 정답률
select direction, count(*) as 복습수,
       round(100.0 * count(*) filter (where rating = 'right') / count(*), 1) as 정답률
from review_log group by direction;
