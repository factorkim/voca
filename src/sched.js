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
    const early = c.due > now;                             // 예정일보다 앞당겨 복습한 카드
    const late = Math.max(0, (now - c.due) / DAY);
    const base = c.ivl + Math.min(late, c.ivl) * 0.5;      // 늦게 맞힌 만큼 간격을 조금 더 줘요
    const pen = 1 / (1 + 0.12 * c.lapses);                 // 자주 틀린 단어는 간격을 덜 늘려요
    if (fail) {
      const total = rating === 'unknown';                  // 완전히 잊은 경우는 더 많이 되돌려요
      c.lapses += 1; c.reps = 0; c.ease = Math.max(1.3, c.ease - (total ? 0.3 : 0.2));
      c.pend = Math.max(1, Math.round(c.ivl * (total ? 0.1 : 0.25)));
      c.phase = 'learn'; c.step = 0; c.ivl = 0; c.due = now + STEPS[0] * MIN;
    } else if (early) {
      // 앞당겨 복습해서 맞힌 카드는 간격과 예정일을 그대로 둬요. 아직 잊을 때가 안 된 카드를 맞힌 것으로
      // 간격을 늘리면 실제보다 오래 기억하는 것처럼 계산되기 때문이에요. 기록만 남기고, 헷갈렸다면(비슷함) 난이도 계수만 조금 낮춰요.
      c.reps += 1;
      if (rating === 'close') c.ease = Math.max(1.3, c.ease - 0.05);
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

// 오늘 새 단어를 몇 개 더 보여 줄지. 하루 목표(perDay)와, '하루 복습 상한(cap)'에서 오늘 예정된 복습(backlog)을 뺀 여유 중 작은 쪽까지만 보여 줘요.
// 새 단어 하나는 첫날에만 평균 2.5번쯤 복습 화면을 만들고, 이후 며칠도 복습을 늘려요. 그래서 여유 있게 NEW_COST(3.5)번으로 쳐요.
// cap 이 0 이면 상한 없이 하루 목표만큼 보여 줘요. (시뮬레이션: 상한을 두면 하루 최대 복습이 크게 줄고, 160일 뒤 기억률은 같았어요)
export const NEW_COST = 3.5;
export const DEFAULT_CAP = 250;
export const CAP_CHOICES = [150, 200, 250, 300, 0];   // 0 = 제한 없음
export function newBudget(perDay, usedToday, backlog, cap = 0) {
  const byLoad = cap > 0 ? Math.max(0, Math.floor((cap - backlog) / NEW_COST)) : Infinity;
  return Math.max(0, Math.min(perDay, byLoad) - usedToday);
}

// 새 단어를 복습 사이사이에 고르게 섞어요. 복습 r장, 새 단어 n장이면 복습 ceil(r/n)장마다 새 단어 1장.
// (복습만 몰아서 하다가 지치거나, 새 단어만 몰아서 보는 것을 막아요)
export function shouldIntroduceNew(sinceNew, reviewsLeft, newLeft) {
  if (newLeft <= 0) return false;
  if (reviewsLeft <= 0) return true;
  return sinceNew >= Math.ceil(reviewsLeft / newLeft);
}

// 다음에 보여 줄 카드를 고르는 규칙. 화면과 무관한 순수 함수라서 단독으로 테스트할 수 있어요.
//  order    : 공부할 단어 id 목록 (순서대로)
//  cards    : id -> 카드 상태 (없거나 phase 가 'new' 면 새 단어)
//  newLeft  : 오늘 더 보여 줄 새 단어 수(예산)    sinceNew : 마지막 새 단어 뒤에 푼 카드 수    lastId : 방금 푼 카드
// 돌려주는 값: { id, kind } 또는 (볼 카드가 하나도 없을 때만) null.
//  kind: learn(학습 중) / new / review  → 오늘의 할 일
//        bonus-new / bonus-learn / bonus-review → 오늘 할 일을 모두 마친 뒤 멈추지 않고 이어가는 카드
export function chooseNext({ order, cards, now, newLeft, sinceNew, lastId }) {
  const learn = [], rev = [], news = [], later = [], early = [];
  for (const id of order) {
    const c = cards.get(id);
    if (!c || c.phase === 'new') { news.push(id); continue; }
    if (c.due <= now) (c.phase === 'learn' ? learn : rev).push(id);
    else (c.phase === 'learn' ? later : early).push(id);
  }
  const byDue = (a, b) => cards.get(a).due - cards.get(b).due;
  learn.sort(byDue);
  rev.sort((a, b) => urgency(cards.get(b), now) - urgency(cards.get(a), now));
  const nl = Math.min(news.length, Math.max(0, newLeft));
  // 오늘의 할 일: ① 학습 중 → ② 새 단어를 복습 사이에 섞기 → ③ 잊을 위험이 큰 복습
  if (learn.length) return { id: learn[0], kind: 'learn' };
  if (shouldIntroduceNew(sinceNew, rev.length, nl)) return { id: news[0], kind: 'new' };
  if (rev.length) return { id: rev[0], kind: 'review' };
  // 할 일을 모두 마쳐도 멈추지 않고 이어가요: ④ 다음 새 단어 → ⑤ 곧 볼 학습 카드 → ⑥ 가장 가까운 복습(앞당겨)
  // 방금 푼 카드는 다른 카드가 있으면 뒤로 미뤄서 같은 카드가 바로 또 나오지 않게 해요.
  if (news.length) return { id: news[0], kind: 'bonus-new' };
  const first = (arr) => arr.find((id) => id !== lastId) || arr[0];
  if (later.length) { later.sort(byDue); return { id: first(later), kind: 'bonus-learn' }; }
  if (early.length) { early.sort(byDue); return { id: first(early), kind: 'bonus-review' }; }
  return null;
}

// 같은 묶음(예: 같은 Day)에 속한 '연속된' 단어끼리만 섞어요. 묶음 순서와 묶음의 위치는 그대로 유지돼요.
//  ids      : 단어 id 목록 (원래 순서)
//  groupOf  : id -> 묶음 이름 (없으면 null/빈 값 → 그 단어는 섞지 않고 제자리에 둬요)
//  seed     : 같은 seed 면 늘 같은 순서가 나와요 (앱을 다시 열어도 순서가 바뀌지 않게, 사용자별로 다르게)
export function shuffleWithinGroups(ids, groupOf, seed) {
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (a) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = []; let i = 0;
  while (i < ids.length) {
    const g = groupOf(ids[i]); let j = i + 1;
    if (g) while (j < ids.length && groupOf(ids[j]) === g) j++;
    const run = ids.slice(i, j);
    if (g && run.length > 1) {
      const rand = rng(hash(seed + '|' + g));
      for (let k = run.length - 1; k > 0; k--) { const m = Math.floor(rand() * (k + 1)); const tmp = run[k]; run[k] = run[m]; run[m] = tmp; }
    }
    for (const id of run) out.push(id);
    i = j;
  }
  return out;
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
