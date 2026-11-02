// 사용법: node docs/experiments/simulate.mjs [intake|scheduler]    (빠르게: QUICK=1 node ...)
// 앱 코드에는 쓰이지 않는 실험 도구예요. 결과 해석은 docs/algorithm-notes.md 를 보세요.
// 학습 시뮬레이션: 1,200단어, 매일 예정된 복습을 모두 하는 학습자. 정답 기억 모델은 가정이에요(아래 MODELS).
import * as CURRENT from '../../src/sched.js';
import * as FSRS6 from './fsrs6.js';
const DAY = 86400000, MIN = 60000, T0 = new Date(2026, 0, 5, 0, 0).getTime();
const mulberry = (a) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
// 정답 기억 모델(가정): 안정도 H(일), 회상 확률 r = (1 + F t/H)^(-p) 로 R(H)=0.9. 성공하면 H 가 (1 + A(1-r)^B + C)배, 실패하면 FAIL 배
const MODELS = { 보통: { p: 0.35, S0: 1.6, A: 6, B: 0.6, C: 0.15, FAIL: 0.3 }, 느린기억: { p: 0.6, S0: 0.7, A: 4, B: 0.6, C: 0.10, FAIL: 0.3 }, 빠른기억: { p: 0.2, S0: 3.5, A: 8, B: 0.6, C: 0.20, FAIL: 0.3 } };
function run(mod, optsFor, model, seed, DAYS = 120, introFn = null) {
  let nextNew = 0;
  const rnd = mulberry(seed), N = 1200, PER = 60, M = MODELS[model];
  const w = Array.from({ length: N }, () => ({ m: Math.exp(0.4 * gauss(rnd)), pre: rnd() < 0.25, H: 0, tl: 0, seen: false, card: null }));
  const out = { reviews: 0, daily: [], keep: {}, atReview: [], weak: {} };
  const F = Math.pow(0.9, -1 / M.p) - 1; const recall = (x, t) => (x.seen ? Math.pow(1 + F * (t - x.tl) / DAY / x.H, -M.p) : (x.pre ? 0.85 : 0));
  for (let day = 0; day < DAYS; day++) {
    const ds = T0 + day * DAY; let t = ds + 9 * 3600000, reviewsToday = 0;
    const queue = [];
    for (let i = 0; i < N; i++) { const c = w[i].card; if (c && c.phase === 'review' && c.due <= ds) queue.push(i); }
    const nn = introFn ? introFn(day, queue.length) : (day < N / PER ? PER : 0);
    const intro = []; for (let k = 0; k < nn && nextNew < N; k++) { intro.push(nextNew); queue.push(nextNew++); }
    if (nextNew >= N && out.introDone === undefined) out.introDone = day + 1;
    out.intro = (out.intro || []).concat(intro.length);
    const again = [];
    const step = (i) => {
      const x = w[i], r = recall(x, t), first = !x.seen, rev = x.card && x.card.phase === 'review';
      const ok = rnd() < r; let rating;
      if (ok) rating = r > 0.97 && rnd() < 0.35 ? 'known' : (r < 0.8 && rnd() < 0.3 ? 'close' : 'right');
      else rating = first ? (rnd() < 0.6 ? 'unknown' : 'wrong') : (rnd() < 0.3 ? 'unknown' : 'wrong');
      if (first) { x.H = x.pre ? 25 * x.m : M.S0 * x.m; x.tl = t; x.seen = true; }
      else if (ok) { x.H *= 1 + M.A * Math.pow(1 - r, M.B) * Math.pow(x.m, 0.3) + M.C; x.tl = t; }
      else { x.H = Math.max(0.2, x.H * M.FAIL); x.tl = t; }
      if (rev && !first && day >= DAYS - 30) out.atReview.push(r);
      x.card = mod.schedule(x.card, rating, t, optsFor(i)); out.reviews++; reviewsToday++;
      if (x.card.phase === 'learn') again.push({ i, ready: x.card.due });
      t += 15000;
    };
    for (let k = 0; k < queue.length || again.length; ) {
      const dueAgain = again.findIndex((a) => a.ready <= t);
      if (dueAgain >= 0) { const [a] = again.splice(dueAgain, 1); step(a.i); }
      else if (k < queue.length) step(queue[k++]);
      else { t = Math.min(...again.map((a) => a.ready)); }
    }
    out.daily.push(reviewsToday);
    if ([29, 59, 89, 119].includes(day)) {
      const te = ds + DAY; let sum = 0, cnt = 0, weak = 0; for (const x of w) if (x.seen) { const r = recall(x, te); sum += r; cnt++; if (r < 0.7) weak++; }
      out.keep[day + 1] = sum / cnt; out.weak[day + 1] = weak / cnt;
    }
  }
  return out;
}


const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const SEEDS = process.env.QUICK ? [1, 2] : [1, 2, 3, 4, 5];
const which = process.argv[2] || 'intake';
if (which === 'scheduler') {
  // 실험 1: 간격 계산식 비교 — 현재(src/sched.js) vs FSRS-6 기본값 (하루 새 단어 60개 고정)
  const P = [['현재 방식', CURRENT, () => ({})], ['FSRS-6 목표 85%', FSRS6, (i) => ({ retention: 0.85, seed: 'u|' + i })], ['FSRS-6 목표 90%', FSRS6, (i) => ({ retention: 0.9, seed: 'u|' + i })]];
  for (const model of Object.keys(MODELS)) {
    console.log(`\n■ 학습자 유형: ${model} (${SEEDS.length}명 평균, 120일)`);
    console.log('방식'.padEnd(20), '총 복습', ' 하루 최대', '120일 기억률', '복습 때 실제 기억률');
    for (const [name, mod, of] of P) { const rs = SEEDS.map((s) => run(mod, of, model, s)); console.log(name.padEnd(20), String(Math.round(avg(rs.map((r) => r.reviews)))).padStart(7), String(Math.round(avg(rs.map((r) => Math.max(...r.daily))))).padStart(9), (avg(rs.map((r) => r.keep[120])) * 100).toFixed(1).padStart(9) + '%', (avg(rs.map((r) => avg(r.atReview))) * 100).toFixed(1).padStart(12) + '%'); }
  }
} else {
  // 실험 2: 새 단어를 넣는 규칙 비교 — 현재 간격 방식에서 '하루 복습 상한'을 바꿔 가며 (src/sched.js 의 newBudget 과 같은 식)
  const PER = 60, cost = 3.5;
  const pols = [['제한 없음 (60개/일 고정)', () => PER], ...[150, 200, 250, 300].map((cap) => [`하루 총 ${cap}번 이하로 맞춤`, (d, due) => Math.max(0, Math.min(PER, Math.floor((cap - due) / cost)))])];
  for (const model of ['보통', '느린기억']) {
    console.log(`\n■ 학습자 유형: ${model} — 1,200단어, 160일 (${SEEDS.length}명 평균)`);
    console.log('새 단어 정책'.padEnd(26), '다 넣는 데', ' 하루 최대', '1~30일 하루평균', '160일 기억률', '총 복습');
    for (const [name, fn] of pols) { const rs = SEEDS.map((s) => run(CURRENT, () => ({}), model, s, 160, fn)); console.log(name.padEnd(24), String(Math.round(avg(rs.map((r) => r.introDone || 160)))).padStart(7) + '일', String(Math.round(avg(rs.map((r) => Math.max(...r.daily))))).padStart(9), String(Math.round(avg(rs.map((r) => avg(r.daily.slice(0, 30)))))).padStart(13), (avg(rs.map((r) => r.keep[119] ?? r.keep[120])) * 100).toFixed(1).padStart(9) + '%', String(Math.round(avg(rs.map((r) => r.reviews)))).padStart(8)); }
  }
}
