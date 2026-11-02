// 복습 일정 계산과 카드 추천 규칙 (순수 함수). 화면이나 DB와 무관해서 단독으로 테스트할 수 있어요.
//
// 기억 모델은 FSRS-6(Free Spaced Repetition Scheduler)을 따라요. 공식 기본값 21개와 공식 구현(py-fsrs)의 계산식을 그대로 썼어요.
//  - 단어마다 '안정도 S'(기억이 90%로 떨어지기까지 걸리는 날수)와 '난이도 D'(1~10)를 기억해요.
//  - 지금 기억하고 있을 확률 R 은 마지막 복습 이후 흐른 시간 t 로 계산해요:  R = (1 + FACTOR * t / S) ^ DECAY
//  - 다음 복습 간격은 '목표 기억률'(기본 90%)까지 R 이 떨어지는 때로 정해요.
//  - 예정일보다 늦게/일찍 복습해도 실제 흐른 시간으로 R 을 계산해서 자연스럽게 반영돼요.
export const MIN = 60000;
export const DAY = 86400000;
export const MAXIVL = 180;       // 복습 간격 상한(일). 아무리 잘 외워도 이 간격마다 다시 나와요.
export const STEPS = [1, 10];    // 학습 단계(분): 새 단어와, 틀려서 다시 배우는 단어에 모두 써요
export const LEECH = 2;          // 이 횟수 이상 틀리면 '자주 틀림'
export const DEFAULT_RETENTION = 0.9;                 // 목표 기억률 기본값
export const RETENTION_CHOICES = [0.8, 0.85, 0.9, 0.95];

// 사용자가 직접 고르는 5단계 자기평가 (앱이 정답을 판정하지 않아요)
//  몰랐음: 전혀 기억이 안 남 / 틀림: 떠올렸지만 틀림 / 비슷함: 헷갈리거나 반만 맞음
//  맞았음: 떠올려서 맞힘 / 알고 있음: 너무 쉽게 안다
// FSRS 의 4단계에는 이렇게 대응해요: 몰랐음·틀림 → 다시(1), 비슷함 → 어려움(2), 맞았음 → 보통(3), 알고 있음 → 쉬움(4)
export const RATINGS = [
  { key: 'unknown', letter: 'u', label: '몰랐음' },
  { key: 'wrong', letter: 'w', label: '틀림' },
  { key: 'close', letter: 'c', label: '비슷함' },
  { key: 'right', letter: 'r', label: '맞았음' },
  { key: 'known', letter: 'k', label: '알고 있음' }
];
export const LETTER = { unknown: 'u', wrong: 'w', close: 'c', right: 'r', known: 'k' };
const GRADE = { unknown: 1, wrong: 1, close: 2, right: 3, known: 4 };

// FSRS-6 공식 기본 파라미터 (open-spaced-repetition/py-fsrs DEFAULT_PARAMETERS)
export const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const DECAY = -W[20];
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
const S_MIN = 0.001;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function dayDue(now, days) { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); }

export function blank() {
  return { phase: 'new', s: 0, d: 0, ivl: 0, step: 0, reps: 0, lapses: 0, due: 0, last: 0, first: 0, n: 0, hist: [] };
}

/* ---------- FSRS-6 계산식 ---------- */
// 지금 기억하고 있을 확률 (0~1). 아직 본 적 없는 카드는 0.
export function retrievability(c, now) {
  if (!c || !(c.s > 0) || !c.last) return 0;
  const t = Math.max(0, (now - c.last) / DAY);
  return Math.pow(1 + FACTOR * t / c.s, DECAY);
}
const initD = (g, limit = true) => { const d = W[4] - Math.exp(W[5] * (g - 1)) + 1; return limit ? clamp(d, 1, 10) : d; };
const nextD = (d, g) => {
  const damped = d + (10 - d) * (-W[6] * (g - 3)) / 9;                 // 선형 감쇠
  return clamp(W[7] * initD(4, false) + (1 - W[7]) * damped, 1, 10);  // 평균 회귀
};
const recallS = (d, s, r, g) => s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
const forgetS = (d, s, r) => Math.min(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]), s / Math.exp(W[17] * W[18]));
const sameDayS = (s, g) => { let k = Math.exp(W[17] * (g - 3 + W[18])) * Math.pow(s, -W[19]); if (g >= 2) k = Math.max(k, 1); return s * k; };
// 목표 기억률 r 이 되는 날수
export function intervalFor(s, retention) { return (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1); }

// 계정+카드마다 고정된 0~1 값 (앱을 다시 열어도, 다른 기기에서도 같은 값이 나오게 해요)
function unit(seed) {
  let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = (h >>> 0) | 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// 같은 날 외운 단어들이 같은 날 한꺼번에 돌아오지 않도록 간격을 조금 흩어요 (공식 구현의 fuzz 와 같은 범위)
function fuzz(ivl, u) {
  if (ivl < 2.5) return ivl;
  let delta = 1;
  for (const [a, b, f] of [[2.5, 7, 0.15], [7, 20, 0.10], [20, Infinity, 0.05]]) delta += f * Math.max(Math.min(ivl, b) - a, 0);
  const hi = Math.min(Math.round(ivl + delta), MAXIVL), lo = Math.min(Math.max(2, Math.round(ivl - delta)), hi);
  return Math.min(Math.floor(u * (hi - lo + 1) + lo), MAXIVL);
}
const baseInterval = (s, retention) => clamp(Math.round(intervalFor(s, retention)), 1, MAXIVL);

// rating: 'unknown' | 'wrong' | 'close' | 'right' | 'known'. 새 카드 객체를 돌려줘요.
//  opts.retention : 목표 기억률 (기본 0.9)    opts.seed : 간격을 흩는 값의 씨앗 (보통 사용자+단어)
//  opts.fuzz / opts.ordered : false 면 각각 '간격 흩기' / '버튼 간격 순서 보정'을 꺼요 (공식 구현과 비교할 때 써요)
export function schedule(card, rating, now, opts = {}) {
  const retention = clamp(opts.retention || DEFAULT_RETENTION, 0.7, 0.97);
  const g = GRADE[rating];
  const c = Object.assign(blank(), card || {});
  c.hist = (c.hist || []).slice(-23);
  c.hist.push([now, LETTER[rating]]);
  if (!c.first) c.first = now;
  c.n = (c.n || 0) + 1;
  const wasReview = c.phase === 'review';
  const elapsed = c.last ? Math.max(0, (now - c.last) / DAY) : 0;
  const r = retrievability(c, now);
  let s, d = c.d, byGrade = null;

  // ① 기억의 세기(S)와 난이도(D) 갱신
  if (!(c.s > 0)) { s = Math.max(S_MIN, W[g - 1]); d = initD(g); }                                   // 처음 본 카드
  else if (elapsed < 1) { s = Math.max(S_MIN, sameDayS(c.s, g)); if (!wasReview) d = nextD(c.d, g); } // 같은 날 다시 본 카드
  else if (g === 1) {                                                                                  // 잊었어요
    s = forgetS(c.d, c.s, r);
    if (rating === 'unknown') s *= 0.5;                  // 아무것도 떠오르지 않았다면 더 많이 되돌려요 (이 앱의 보정이에요)
    s = Math.max(S_MIN, s); d = nextD(c.d, g);
  } else {                                                                                             // 기억했어요
    s = Math.max(S_MIN, recallS(c.d, c.s, r, g)); d = nextD(c.d, g);
    if (wasReview) byGrade = { 2: recallS(c.d, c.s, r, 2), 3: recallS(c.d, c.s, r, 3), 4: recallS(c.d, c.s, r, 4) };
  }
  c.s = s; c.d = d; c.last = now;

  // ② 상태 이동: 학습 단계 ↔ 복습
  let graduate = false;
  if (wasReview) {
    if (g === 1) { c.lapses += 1; c.reps = 0; c.phase = 'learn'; c.step = 0; c.ivl = 0; c.due = now + STEPS[0] * MIN; }
    else graduate = true;
  } else {
    c.phase = 'learn';
    if (g === 1) { c.step = 0; c.reps = 0; c.due = now + STEPS[0] * MIN; }
    else if (g === 2) { c.due = now + (c.step === 0 && STEPS.length > 1 ? (STEPS[0] + STEPS[1]) / 2 : STEPS[Math.min(c.step, STEPS.length - 1)]) * MIN; }
    else if (g === 3 && c.step + 1 < STEPS.length) { c.step += 1; c.reps += 1; c.due = now + STEPS[c.step] * MIN; }
    else graduate = true;
  }
  if (graduate) {
    c.phase = 'review'; c.step = 0; c.reps += 1;
    const u = opts.fuzz === false ? 0.5 : unit((opts.seed || '') + '|' + c.n);
    const pick = (stab) => { const b = baseInterval(stab, retention); return opts.fuzz === false ? b : fuzz(b, u); };
    let ivl = pick(c.s);
    if (byGrade && g >= 2 && opts.ordered !== false) {    // 어려움 < 보통 < 쉬움 순서가 뒤바뀌지 않게 해요 (공식 구현에는 없는 화면용 보정)
      const i2 = pick(byGrade[2]), i3 = Math.max(pick(byGrade[3]), Math.min(i2 + 1, MAXIVL)), i4 = Math.max(pick(byGrade[4]), Math.min(i3 + 1, MAXIVL));
      ivl = g === 2 ? i2 : g === 3 ? i3 : i4;
    }
    c.ivl = ivl; c.due = dayDue(now, ivl);
  }
  c.s = Math.round(c.s * 1e6) / 1e6; c.d = Math.round(c.d * 1e6) / 1e6;   // DB 저장 정밀도(real)와 비슷한 6자리
  return c;
}

/* ---------- 카드 추천 규칙 ---------- */

// 복습 카드의 급한 정도 (클수록 먼저) = 잊었을 확률(1 − 기억 확률). 가장 잊었을 것 같은 카드부터 나와요.
export function urgency(c, now) { return 1 - retrievability(c, now); }

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
  const byRecall = (a, b) => retrievability(cards.get(a), now) - retrievability(cards.get(b), now);   // 기억 확률이 낮은 순
  learn.sort(byDue);
  rev.sort(byRecall);
  const nl = Math.min(news.length, Math.max(0, newLeft));
  // 오늘의 할 일: ① 학습 중 → ② 새 단어를 복습 사이에 섞기 → ③ 기억 확률이 가장 낮은 복습
  if (learn.length) return { id: learn[0], kind: 'learn' };
  if (shouldIntroduceNew(sinceNew, rev.length, nl)) return { id: news[0], kind: 'new' };
  if (rev.length) return { id: rev[0], kind: 'review' };
  // 할 일을 모두 마쳐도 멈추지 않고 이어가요: ④ 다음 새 단어 → ⑤ 곧 볼 학습 카드 → ⑥ 기억 확률이 가장 낮은 복습(앞당겨)
  // 방금 푼 카드는 다른 카드가 있으면 뒤로 미뤄서 같은 카드가 바로 또 나오지 않게 해요.
  if (news.length) return { id: news[0], kind: 'bonus-new' };
  const first = (arr) => arr.find((id) => id !== lastId) || arr[0];
  if (later.length) { later.sort(byDue); return { id: first(later), kind: 'bonus-learn' }; }
  if (early.length) { early.sort(byRecall); return { id: first(early), kind: 'bonus-review' }; }
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
