// 복습 주기 계산과 카드 추천 규칙 (순수 함수). 화면이나 DB와 무관해서 단독으로 테스트할 수 있어요.
export const MIN = 60000;
export const DAY = 86400000;
export const MAXIVL = 180;       // 복습 간격 상한(일)
export const STEPS = [1, 10];    // 학습 단계(분)
export const LEECH = 2;          // 이 횟수 이상 틀리면 '자주 틀림'

// 사용자가 직접 고르는 5단계 자기평가 (앱이 정답을 판정하지 않아요)
//  몰랐음: 전혀 기억이 안 남 / 틀림: 떠올렸지만 틀림 / 비슷함: 헷갈리거나 반만 맞음
//  맞았음: 떠올려서 맞힘 / 알고 있음: 너무 쉽게 안다 (간격을 크게 늘려요)
export const RATINGS = [
  { key: 'unknown', letter: 'u', label: '몰랐음' },
  { key: 'wrong', letter: 'w', label: '틀림' },
  { key: 'close', letter: 'c', label: '비슷함' },
  { key: 'right', letter: 'r', label: '맞았음' },
  { key: 'known', letter: 'k', label: '알고 있음' }
];
export const LETTER = { unknown: 'u', wrong: 'w', close: 'c', right: 'r', known: 'k' };

export function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function dayDue(now, days) { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); }

export function blank() {
  return { phase: 'new', ease: 2.3, ivl: 0, step: 0, reps: 0, lapses: 0, pend: 0, due: 0, last: 0, first: 0, n: 0, hist: [] };
}

// rating: 'unknown' | 'wrong' | 'close' | 'right' | 'known'. 새 카드 객체를 돌려줘요.
export function schedule(card, rating, now) {
  const c = Object.assign(blank(), card || {});
  c.hist = (c.hist || []).slice(-23);
  c.hist.push([now, LETTER[rating]]);
  if (!c.first) c.first = now;
  c.n = (c.n || 0) + 1;
  const fail = rating === 'unknown' || rating === 'wrong';

  if (c.phase === 'new') {
    c.reps = 0;
    if (rating === 'known') { c.phase = 'review'; c.reps = 2; c.ease = 2.5; c.ivl = 14; c.due = dayDue(now, 14); }
    else if (rating === 'right') { c.phase = 'review'; c.reps = 1; c.ivl = 3; c.due = dayDue(now, 3); }
    else {
      c.phase = 'learn'; c.step = 0;
      if (rating === 'wrong') c.ease = Math.max(1.3, c.ease - 0.1);   // 아는 줄 알았는데 틀린 단어는 조금 더 조심해요
      c.due = now + (rating === 'close' ? STEPS[1] : STEPS[0]) * MIN;
    }
  } else if (c.phase === 'learn') {
    if (fail) { c.reps = 0; c.step = 0; c.due = now + STEPS[0] * MIN; }
    else if (rating === 'close') { c.due = now + STEPS[Math.min(c.step, STEPS.length - 1)] * MIN; }
    else if (rating === 'known') {
      c.reps += 1; c.phase = 'review'; c.ivl = Math.max(3, c.pend > 0 ? c.pend * 2 : 7); c.pend = 0; c.step = 0; c.due = dayDue(now, c.ivl);
    } else {
      c.reps += 1; c.step += 1;
      if (c.step >= STEPS.length) {
        c.phase = 'review'; c.ivl = c.pend > 0 ? c.pend : 1; c.pend = 0; c.step = 0; c.due = dayDue(now, c.ivl);
      } else { c.due = now + STEPS[c.step] * MIN; }
    }
  } else {
    const late = Math.max(0, (now - c.due) / DAY);
    const base = c.ivl + Math.min(late, c.ivl) * 0.5;      // 늦게 맞힌 만큼 간격을 조금 더 줘요
    const pen = 1 / (1 + 0.12 * c.lapses);                 // 자주 틀린 단어는 간격을 덜 늘려요
    if (fail) {
      const total = rating === 'unknown';                  // 완전히 잊은 경우는 더 많이 되돌려요
      c.lapses += 1; c.reps = 0; c.ease = Math.max(1.3, c.ease - (total ? 0.3 : 0.2));
      c.pend = Math.max(1, Math.round(c.ivl * (total ? 0.1 : 0.25)));
      c.phase = 'learn'; c.step = 0; c.ivl = 0; c.due = now + STEPS[0] * MIN;
    } else if (rating === 'close') {
      c.ease = Math.max(1.3, c.ease - 0.05);
      c.ivl = Math.min(MAXIVL, Math.max(c.ivl + 1, Math.round(base * 1.2)));
      c.due = dayDue(now, c.ivl);
    } else if (rating === 'right') {
      c.reps += 1; c.ease = Math.min(3, c.ease + 0.05);
      let n;
      if (base <= 1) n = 3; else if (base <= 3) n = 7; else n = Math.round(base * c.ease * pen);
      c.ivl = Math.min(MAXIVL, Math.max(c.ivl + 1, n));
      c.due = dayDue(now, c.ivl);
    } else {
      c.reps += 1; c.ease = Math.min(3, c.ease + 0.15);
      let n;
      if (base <= 1) n = 7; else if (base <= 3) n = 14; else n = Math.round(base * c.ease * 1.4 * pen);
      c.ivl = Math.min(MAXIVL, Math.max(c.ivl + 2, n));
      c.due = dayDue(now, c.ivl);
    }
  }
  c.ease = Math.round(c.ease * 100) / 100;
  c.last = now;
  return c;
}

/* ---------- 카드 추천 규칙 ---------- */

// 복습 카드의 급한 정도 (클수록 먼저). 간격에 비해 얼마나 밀렸는지(= 잊어버렸을 가능성)와
// 자주 틀리거나 난이도 계수가 낮은 정도를 더해요. 같은 날 예정이어도 위험한 카드가 먼저 나와요.
export function urgency(c, now) {
  const span = Math.max(1, c.ivl || 1);
  const over = Math.max(0, (now - c.due) / DAY) / span;
  const weak = Math.min(c.lapses || 0, 5) * 0.25 + Math.max(0, 2 - (c.ease || 2.3)) * 0.5;
  return over + weak;
}

// 오늘 새 단어를 몇 개 더 보여 줄지. 하루 목표(perDay)에서 이미 본 만큼을 빼고,
// 하루 시작 때 밀린 복습(backlog)이 많으면 부담이 쌓이지 않게 자동으로 줄여요.
export function newBudget(perDay, usedToday, backlog) {
  const left = Math.max(0, perDay - usedToday);
  if (backlog > perDay * 3) return 0;
  if (backlog > perDay * 2) return Math.floor(left / 2);
  return left;
}

// 새 단어를 복습 사이사이에 고르게 섞어요. 복습 r장, 새 단어 n장이면 복습 ceil(r/n)장마다 새 단어 1장.
// (복습만 몰아서 하다가 지치거나, 새 단어만 몰아서 보는 것을 막아요)
export function shouldIntroduceNew(sinceNew, reviewsLeft, newLeft) {
  if (newLeft <= 0) return false;
  if (reviewsLeft <= 0) return true;
  return sinceNew >= Math.ceil(reviewsLeft / newLeft);
}

export function fmtDue(c, now) {
  const d = c.due - now;
  if (c.phase === 'learn' || d < 60 * MIN) return Math.max(1, Math.round(d / MIN)) + '분 후';
  const days = Math.round((c.due - startOfDay(now)) / DAY);
  if (days <= 1) return '내일';
  if (days < 30) return days + '일 후';
  if (days < 365) return Math.round(days / 30) + '개월 후';
  return '1년 후';
}
