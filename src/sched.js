// 복습 주기 계산 (순수 함수). 화면이나 DB와 무관해서 단독으로 테스트할 수 있어요.
export const MIN = 60000;
export const DAY = 86400000;
export const MAXIVL = 180;       // 복습 간격 상한(일)
export const STEPS = [1, 10];    // 학습 단계(분)
export const LEECH = 2;          // 이 횟수 이상 틀리면 '자주 틀림'

export function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function dayDue(now, days) { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); }

export function blank() {
  return { phase: 'new', ease: 2.3, ivl: 0, step: 0, reps: 0, lapses: 0, pend: 0, due: 0, last: 0, first: 0, n: 0, hist: [] };
}

// rating: 'wrong' | 'close' | 'right'. 새 카드 객체를 돌려줘요.
export function schedule(card, rating, now) {
  const c = Object.assign(blank(), card || {});
  c.hist = (c.hist || []).slice(-23);
  c.hist.push([now, rating.charAt(0)]);
  if (!c.first) c.first = now;
  c.n = (c.n || 0) + 1;

  if (c.phase === 'new') {
    c.reps = 0;
    if (rating === 'right') { c.phase = 'review'; c.reps = 1; c.ivl = 3; c.due = dayDue(now, 3); }
    else { c.phase = 'learn'; c.step = 0; c.due = now + (rating === 'close' ? STEPS[1] : STEPS[0]) * MIN; }
  } else if (c.phase === 'learn') {
    if (rating === 'wrong') { c.reps = 0; c.step = 0; c.due = now + STEPS[0] * MIN; }
    else if (rating === 'close') { c.due = now + STEPS[Math.min(c.step, STEPS.length - 1)] * MIN; }
    else {
      c.reps += 1; c.step += 1;
      if (c.step >= STEPS.length) {
        c.phase = 'review'; c.ivl = c.pend > 0 ? c.pend : 1; c.pend = 0; c.step = 0; c.due = dayDue(now, c.ivl);
      } else { c.due = now + STEPS[c.step] * MIN; }
    }
  } else {
    const late = Math.max(0, (now - c.due) / DAY);
    const base = c.ivl + Math.min(late, c.ivl) * 0.5;      // 늦게 맞힌 만큼 간격을 조금 더 줘요
    const pen = 1 / (1 + 0.12 * c.lapses);                 // 자주 틀린 단어는 간격을 덜 늘려요
    if (rating === 'wrong') {
      c.lapses += 1; c.reps = 0; c.ease = Math.max(1.3, c.ease - 0.2);
      c.pend = Math.max(1, Math.round(c.ivl * 0.25));
      c.phase = 'learn'; c.step = 0; c.ivl = 0; c.due = now + STEPS[0] * MIN;
    } else if (rating === 'close') {
      c.ease = Math.max(1.3, c.ease - 0.05);
      c.ivl = Math.min(MAXIVL, Math.max(c.ivl + 1, Math.round(base * 1.2)));
      c.due = dayDue(now, c.ivl);
    } else {
      c.reps += 1; c.ease = Math.min(3, c.ease + 0.05);
      let n;
      if (base <= 1) n = 3; else if (base <= 3) n = 7; else n = Math.round(base * c.ease * pen);
      c.ivl = Math.min(MAXIVL, Math.max(c.ivl + 1, n));
      c.due = dayDue(now, c.ivl);
    }
  }
  c.ease = Math.round(c.ease * 100) / 100;
  c.last = now;
  return c;
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
