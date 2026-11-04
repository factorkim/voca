// 사용법: node docs/experiments/pick_sim.mjs   — 카드 선택 규칙(chooseNext)이 새 단어/학습 중/복습을 얼마나 고르게 섞는지 순서로 보여 줘요 (N 새 단어, L 학습 중, R 복습).
// 앱 코드에는 쓰이지 않는 실험 도구예요.
import { chooseNext, schedule, blank, MIN, DAY } from '../../src/sched.js';
const group = (id) => id.split('-')[0];
function run({ name, nNew, nRev, pUnknownNew, pRightLearn, pRightRev, cards = 70, perDay = 60, seed = 1 }) {
  let rs = seed; const rnd = () => (rs = (rs * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const t0 = new Date(2026, 10, 5, 9).getTime(); let now = t0;
  const order = []; const cardsMap = new Map();
  for (let i = 0; i < nRev; i++) { const id = 'r-' + i; order.push(id); cardsMap.set(id, { ...blank(), phase: 'review', ivl: 5, ease: 2.3, reps: 3, due: t0 - DAY * (0.2 + rnd()), last: t0 - 5 * DAY, hist: [] }); }
  for (let i = 0; i < nNew; i++) order.push('n-' + String(i).padStart(2, '0'));
  let sinceNew = 0, lastId = null, introduced = 0; const recent = []; const seq = [];
  for (let k = 0; k < cards; k++) {
    const r = chooseNext({ order, cards: cardsMap, now, newLeft: perDay - introduced, sinceNew, lastId, groupOf: group, recent });
    if (!r) break; const c = cardsMap.get(r.id); const isNew = !c || c.phase === 'new';
    let rating;
    if (isNew) rating = rnd() < pUnknownNew ? 'unknown' : 'right';
    else if (c.phase === 'learn') rating = rnd() < pRightLearn ? 'right' : 'unknown';
    else rating = rnd() < pRightRev ? 'right' : 'wrong';
    cardsMap.set(r.id, schedule(c, rating, now));
    if (isNew) { introduced++; sinceNew = 0; } else sinceNew++;
    lastId = r.id; recent.push({ id: r.id, kind: r.kind }); if (recent.length > 8) recent.shift();
    seq.push((isNew ? 'N' : (c.phase === 'learn' ? 'L' : 'R')));
    now += 6000;
  }
  const s = seq.join(''); const maxRun = (ch) => Math.max(...(s.match(new RegExp(ch + '+', 'g')) || ['']).map((x) => x.length));
  console.log(name.padEnd(34), s.slice(0, 70), '| 연속 최대 N' + maxRun('N') + ' L' + maxRun('L') + ' R' + maxRun('R') + ' | 새 단어 ' + (s.match(/N/g) || []).length);
}
run({ name: 'A 복습 없음, 새 단어 전부 모름', nNew: 200, nRev: 0, pUnknownNew: 1, pRightLearn: 0, pRightRev: 0.9 });
run({ name: 'B 복습 없음, 70% 모름/학습 80% 정답', nNew: 200, nRev: 0, pUnknownNew: .7, pRightLearn: .8, pRightRev: .9 });
run({ name: 'C 복습 80개 + 전부 모름', nNew: 200, nRev: 80, pUnknownNew: 1, pRightLearn: 0, pRightRev: 0.85 });
run({ name: 'D 복습 80개 + 70% 모름', nNew: 200, nRev: 80, pUnknownNew: .7, pRightLearn: .8, pRightRev: 0.85 });
run({ name: 'E 복습 20개 + 70% 모름', nNew: 200, nRev: 20, pUnknownNew: .7, pRightLearn: .8, pRightRev: 0.85 });
