import './style.css';
import { MIN, DAY, LEECH, RATINGS, LETTER, startOfDay, blank, schedule, fmtDue, newBudget, chooseNext, shuffleWithinGroups, DEFAULT_CAP, CAP_CHOICES, STRENGTH, DEFAULT_SCALE } from './sched.js';
import * as S from './store.js';

const APP_VERSION = '0.1.0';
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const ROUTES = ['home', 'study', 'words', 'stats', 'backup'];
const DIRS = { en2ko: '영어 → 한국어', ko2en: '한국어 → 영어', mix: '섞어서' };
const PHASE_LABEL = { new: '새 단어', learn: '학습 중', young: '익히는 중', mature: '익숙함' };
const HLAB = { u: '몰', w: '틀', c: '비', r: '맞', k: '알' };
const NEW_PER_DAY_DEFAULT = 60;
const NEW_PER_DAY_CHOICES = [10, 20, 30, 40, 60, 80, 100, 150, 200];
const emptyDay = () => ({ n: 0, w: 0, c: 0, r: 0, u: 0, k: 0, nw: 0, rn: 0, rk: 0, fn: 0 });
const defaultSettings = () => ({ newPerDay: NEW_PER_DAY_DEFAULT, dir: 'en2ko', sets: null, shuffle: true, cap: DEFAULT_CAP, scale: DEFAULT_SCALE, consentedAt: null });
const BOOT_AT = Date.now();

let USER = null;
let WORDS = new Map(), ALL = [], ORDER = [], STUDY = [], SETS = [], CARDS = new Map(), DAILY = new Map();   // ALL: 모든 단어, ORDER: 선택한 단어장의 단어
let SET = defaultSettings();
const ui = {
  route: 'home', stage: 'boot', offline: false, loadError: false,
  session: null, backlog: null, revealed: false, cur: null, curDir: 'en2ko',
  filter: 'all', q: '', nextMode: 'daily', confirmDelete: false,
  shownAt: 0, revealedAt: 0, hidden: false, speaks: 0,
  quiz: 'read', curQuiz: 'read', held: false, wtext: '', wres: null   // quiz: 퀴즈 종류(읽기/쓰기), curQuiz: 지금 카드의 방식, held: 쓰기 결과 화면, wtext/wres: 입력한 글자/채점 결과
};
try { { const q = localStorage.getItem('voca.quiz'); if (q === 'write' || q === 'mix') ui.quiz = q; } } catch (e) { /* 무시 */ }

/* ---------- 날짜 도우미 ---------- */
function ymd(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayKey(off, now) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + off); return ymd(d.getTime()); }
function todayLog(now) { return Object.assign(emptyDay(), DAILY.get(ymd(now)) || {}); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }
function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
function deviceInfo() {
  return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1, standalone: isStandalone(), lang: navigator.language, touch: navigator.maxTouchPoints > 0, ua: navigator.userAgent.slice(0, 180) };
}

/* ---------- 데이터 적용 / 캐시 ---------- */
function resetData() { WORDS = new Map(); ALL = []; ORDER = []; STUDY = []; SETS = []; CARDS = new Map(); DAILY = new Map(); SET = defaultSettings(); ui.session = null; ui.backlog = null; }
// 선택한 단어장의 단어만 ORDER 에 담아요 (단어장 순서 → 단어 순서). 선택이 없으면(null) 전체예요.
function activeSetIds() {
  if (!SETS.length) return null;
  const ids = SETS.map((x) => x.id);
  const pick = SET.sets ? SET.sets.filter((id) => ids.indexOf(id) >= 0) : ids;
  return new Set(pick.length ? pick : ids);
}
function rebuildOrder() {
  const act = activeSetIds(), rank = {};
  SETS.forEach((x, i) => { rank[x.id] = i; });
  ORDER = ALL.filter((id) => { const w = WORDS.get(id); return !act || !w.setId || act.has(w.setId); });
  ORDER = ORDER.map((id, i) => [id, i]).sort((a, b) => ((rank[WORDS.get(a[0]).setId] || 0) - (rank[WORDS.get(b[0]).setId] || 0)) || (a[1] - b[1])).map((x) => x[0]);
  buildStudyOrder();
}
// 새 단어가 나오는 순서(STUDY). Day 안에서 섞기가 켜져 있으면 같은 Day의 단어끼리만 섞고, 순서는 계정마다 고정이에요. 단어 목록(ORDER)은 원래 순서 그대로예요.
function buildStudyOrder() {
  STUDY = SET.shuffle ? shuffleWithinGroups(ORDER, (id) => { const w = WORDS.get(id); return w && w.page ? w.setId + '|' + w.page : null; }, USER ? USER.id : 'anon') : ORDER.slice();
}
function setLabel() {
  const act = activeSetIds(); if (!act) return '';
  const names = SETS.filter((x) => act.has(x.id)).map((x) => x.name);
  return names.length <= 2 ? names.join(', ') : names.length + '개 단어장';
}
function applyData(d) {
  WORDS = new Map(d.words.map((w) => [w.id, w]));
  ALL = d.words.map((w) => w.id);
  SETS = d.sets || [];
  const m = new Map(Object.entries(d.cards || {}));
  const po = S.pendingCards();
  Object.keys(po).forEach((k) => m.set(k, S.rowToCard(po[k])));   // 아직 서버에 못 보낸 내 기록이 항상 최신이에요
  CARDS = m;
  const dm = new Map(Object.entries(d.daily || {}));
  const pl = S.pendingLogDates();
  Object.keys(pl).forEach((k) => {
    const base = Object.assign(emptyDay(), dm.get(k) || {});
    ['n', 'w', 'c', 'r', 'u', 'k', 'nw'].forEach((f) => { base[f] += pl[k][f]; });
    dm.set(k, base);
  });
  DAILY = dm;
  SET = defaultSettings();
  if (d.settings) SET = Object.assign(SET, d.settings);
  const ps = S.pendingSettings();
  if (ps) SET = { newPerDay: ps.new_per_day, dir: ps.direction, sets: Array.isArray(ps.active_sets) ? ps.active_sets : null, shuffle: ps.shuffle_new !== false, cap: Number.isFinite(ps.daily_cap) ? ps.daily_cap : DEFAULT_CAP, scale: Number.isFinite(ps.interval_scale) ? ps.interval_scale : DEFAULT_SCALE, consentedAt: ps.consented_at ? Date.parse(ps.consented_at) : null };
  rebuildOrder();   // 저장된 설정(단어장 선택, 섞기)을 모두 읽은 뒤에 단어 순서를 만들어요
  ui.backlog = null;
}
function persistCache() {
  if (!USER) return;
  S.writeCache(USER.id, { words: ALL.map((id) => WORDS.get(id)), sets: SETS, cards: Object.fromEntries(CARDS), daily: Object.fromEntries(DAILY), settings: SET });
}
function queueSettingsRow() {
  S.queueSettings({ user_id: USER.id, new_per_day: SET.newPerDay, direction: SET.dir, active_sets: SET.sets, shuffle_new: SET.shuffle, daily_cap: SET.cap, interval_scale: SET.scale, consented_at: SET.consentedAt ? new Date(SET.consentedAt).toISOString() : null, updated_at: new Date().toISOString() });
  scheduleFlush();
}
let flushTimer = 0;
function scheduleFlush(delay) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => { const ok = await S.flush(); if (ok) persistCache(); updateSync(); }, delay == null ? 1200 : delay);
}
function updateSync() {
  const el = $('#sync'); if (!el) return;
  const n = USER ? S.pendingCount() : 0;
  if (USER && !navigator.onLine) { el.textContent = '오프라인' + (n ? ' · 대기 ' + n : ''); el.hidden = false; }
  else if (n > 0) { el.textContent = '동기화 대기 ' + n; el.hidden = false; }
  else el.hidden = true;
}

/* ---------- 부팅 / 로그인 ---------- */
async function boot() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
  if (!S.configured) { ui.stage = 'noconfig'; render(); return; }
  // Supabase 안내대로 콜백 안에서는 바로 다른 Supabase 호출을 하지 않고 한 박자 뒤로 미뤄요(잠금 대기 방지).
  S.onAuth((ev, user) => setTimeout(() => {
    if (ev === 'SIGNED_OUT') { USER = null; resetData(); ui.stage = 'login'; render(); }
    else if (user && (!USER || USER.id !== user.id)) { USER = user; ui.loginMsg = ''; startLoad(); }
    else if (user && USER && USER.id === user.id && !USER.email) USER = user;   // 오프라인으로 시작했다가 다시 연결되면 계정 정보를 채워요
  }, 0));
  let user = null;
  try { user = await S.currentUser(); } catch (e) { /* 아래에서 처리 */ }
  if (!user) {
    const uid = S.lastUid();
    if (uid && !navigator.onLine && S.readCache(uid)) { USER = { id: uid, email: '' }; ui.offline = true; startLoad(); return; }
    if (!USER) { ui.stage = 'login'; render(); }
    return;
  }
  if (!USER) { USER = user; startLoad(); }
}
async function startLoad() {
  ui.stage = 'loading'; ui.loadError = false; render();
  S.loadOutbox(USER.id);
  const cache = S.readCache(USER.id);
  if (cache) { applyData(cache); ui.stage = 'ready'; render(); }
  try {
    const d = await S.loadAll(USER.id, dayKey(-400, Date.now()));
    applyData(d);
    persistCache();
    ui.offline = false;
  } catch (e) {
    if (!cache) ui.loadError = true; else ui.offline = true;
  }
  ui.stage = 'ready'; render();
  scheduleFlush(300);
}

/* ---------- 계산 ---------- */
function bucket(c) { if (!c || c.phase === 'new') return 'new'; if (c.phase === 'learn') return 'learn'; return c.ivl >= 21 ? 'mature' : 'young'; }
// 그날 처음 센 '예정된 복습 수'를 기기에 저장해 둬요. 복습을 하다가 앱을 다시 열어도 새 단어 수가 다시 늘어나지 않게 하려는 거예요.
function dayBacklog(day, current) {
  const key = 'voca.backlog.' + (USER ? USER.id : '');
  try { const o = JSON.parse(localStorage.getItem(key) || 'null'); if (o && o.day === day && Number.isFinite(o.n)) return o.n; } catch (e) { /* 무시 */ }
  try { localStorage.setItem(key, JSON.stringify({ day, n: current })); } catch (e) { /* 무시 */ }
  return current;
}
function counts(now) {
  const n = { new: 0, learn: 0, young: 0, mature: 0 }; let dueReview = 0, dueLearn = 0, soon = 0; const leech = [];
  ORDER.forEach((id) => {
    const c = CARDS.get(id), b = bucket(c); n[b]++;
    if (b === 'new') return;
    if (c.due <= now) { if (c.phase === 'learn') dueLearn++; else dueReview++; }
    else if (c.phase === 'learn' && c.due - now <= 30 * MIN) soon++;
    if ((c.lapses || 0) >= LEECH) leech.push(id);
  });
  leech.sort((a, b) => CARDS.get(b).lapses - CARDS.get(a).lapses);
  const used = todayLog(now).nw || 0, day = ymd(now);
  if ((!ui.backlog || ui.backlog.day !== day) && ORDER.length) ui.backlog = { day, n: dayBacklog(day, dueReview + dueLearn) };   // 하루 시작 때의 예정된 복습 수 (하루 동안 고정)
  const base = ui.backlog ? ui.backlog.n : dueReview + dueLearn;
  const want = Math.max(0, SET.newPerDay - used), budget = newBudget(SET.newPerDay, used, base, SET.cap);
  const newAvail = Math.min(n.new, budget);
  return { n, dueReview, dueLearn, soon, leech, newAvail, throttled: budget < want && n.new > newAvail, total: ORDER.length, left: dueReview + dueLearn + newAvail };
}
function streak(now) {
  let off = (DAILY.get(dayKey(0, now)) || {}).n ? 0 : -1, s = 0;
  while ((DAILY.get(dayKey(off, now)) || {}).n) { s++; off--; }
  return s;
}
function forecast(now) {
  const out = [0, 0, 0, 0, 0, 0, 0], sod = startOfDay(now);
  ORDER.forEach((id) => {
    const c = CARDS.get(id); if (!c || c.phase === 'new') return;
    let d = Math.floor((c.due - sod) / DAY); if (d < 0) d = 0; if (d < 7) out[d]++;
  });
  return out;
}
function lastDays(n, now) {
  const a = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    a.push({ l: DAILY.get(ymd(d.getTime())) || emptyDay(), dow: i === 0 ? '오늘' : '일월화수목금토'.charAt(d.getDay()) });
  }
  return a;
}
function nextInfo(now) {
  const f = forecast(now);
  for (let i = 1; i < 7; i++) { if (f[i]) return '다음 복습: ' + (i === 1 ? '내일' : i + '일 뒤') + ' ' + f[i] + '장'; }
  return '';
}

/* ---------- 학습 세션 ---------- */
function startSession(mode) {
  ui.session = { id: uuid(), mode: mode || 'daily', startedAt: Date.now(), done: 0, w: 0, c: 0, r: 0, u: 0, k: 0, nw: 0, sinceNew: 0, lastId: null, goalShown: false, q: null, finished: false };
  if (ui.session.mode === 'leech') ui.session.q = counts(Date.now()).leech.slice();
  pick();
}
function resetTimers() { ui.shownAt = performance.now(); ui.revealedAt = 0; ui.hidden = false; ui.speaks = 0; }
// 카드가 정해진 뒤: 쓰기 퀴즈면 영어가 보이지 않게 방향을 뜻→영어로 고정하고(발음·자동 공개도 쓰지 않아요), 아니면 자동 발음/공개를 예약해요.
function afterPick() {
  const id = ui.cur, w = WORDS.get(id);
  ui.held = false; ui.wtext = ''; ui.wres = null;
  prefetchWords(id);
  // 섞기: 처음 보는 단어는 읽기로 먼저 익히고, 이미 본 단어는 읽기/쓰기를 반반 섞어요
  const c = CARDS.get(id), seen = c && c.phase !== 'new';
  const wantWrite = ui.quiz === 'write' || (ui.quiz === 'mix' && seen && Math.random() < 0.5);
  ui.curQuiz = wantWrite && w && writeInfo(w) ? 'write' : 'read';
  if (ui.curQuiz === 'write') { ui.curDir = 'ko2en'; clearTimeout(revealTimer); ui.revealEnd = 0; return; }
  armAutoReveal(id);
  if (ui.curDir === 'en2ko') autoSpeak(id);
}
function pick() {
  const s = ui.session, now = Date.now();
  ui.revealed = false; ui.cur = null;
  ui.curDir = SET.dir === 'mix' ? (Math.random() < 0.5 ? 'en2ko' : 'ko2en') : SET.dir;
  resetTimers();
  if (s.mode === 'leech') {
    while (s.q.length && !WORDS.has(s.q[0])) s.q.shift();
    if (s.q.length) { ui.cur = s.q.shift(); ui.curKind = 'learn'; afterPick(); return; }
    s.mode = 'daily';   // 집중 복습을 마치면 멈추지 않고 오늘의 학습으로 이어가요
  }
  // 세션은 멈추지 않아요. 오늘 할 일을 모두 마쳐도 다음 새 단어 → 곧 볼 카드 → 앞당긴 복습 순으로 계속 이어져요. (규칙은 sched.js 의 chooseNext)
  const r = chooseNext({ order: STUDY, cards: CARDS, now, newLeft: counts(now).newAvail, sinceNew: s.sinceNew, lastId: s.lastId, recent: s.recent || [], groupOf: (id) => { const w = WORDS.get(id); return w ? (w.setId || '') + '|' + (w.page == null ? '' : w.page) : ''; } });
  if (!r) { s.finished = true; return; }
  ui.cur = r.id; ui.curKind = r.kind;
  (s.recent = s.recent || []).push({ id: r.id, kind: r.kind }); if (s.recent.length > 8) s.recent.shift();
  afterPick();
  if (r.kind.indexOf('bonus') === 0 && s.done > 0 && !s.goalShown && counts(now).left <= 0) { s.goalShown = true; toast('오늘 목표를 다 채웠어요! 이어서 계속할게요.'); }
}
// 이전 단어로 돌아가기: 마지막 평가를 취소하고(카드 상태, 복습 기록, 오늘/세션 집계를 되돌려요) 그 단어를 다시 보여 줘요.
function undo() {
  const s = ui.session; if (!s || !s.stack || !s.stack.length || !USER) return;
  const u = s.stack.pop();
  clearTimeout(revealTimer);
  if (s.mode === 'leech' && ui.cur && ui.cur !== u.id) s.q.unshift(ui.cur);   // 집중 복습 중이면 아직 안 푼 현재 카드를 목록 맨 앞에 되돌려 놔요
  if (s.recent) { s.recent.pop(); if (ui.cur !== u.id) s.recent.pop(); s.recent.push({ id: u.id, kind: u.kind }); }   // 최근에 나온 카드 목록도 되돌려요
  if (u.prev) CARDS.set(u.id, u.prev); else CARDS.delete(u.id);
  S.queueCard(USER.id, u.id, u.prev || blank());
  S.dropLog(u.logId);
  DAILY.set(u.dayKey, u.dd);
  Object.assign(s, u.ses); s.finished = false;
  S.queueSession({
    id: s.id, user_id: USER.id, started_at: new Date(s.startedAt).toISOString(), last_activity_at: new Date().toISOString(), mode: s.mode, cards_done: s.done,
    n_wrong: s.w, n_close: s.c, n_right: s.r, n_unknown: s.u, n_known: s.k, n_new: s.nw, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, device: deviceInfo(), app_version: APP_VERSION
  });
  ui.cur = u.id; ui.curDir = u.dir; ui.curQuiz = u.quiz; ui.revealed = false; ui.held = false; ui.wtext = ''; ui.wres = null;
  resetTimers();
  if (ui.curQuiz === 'read') { armAutoReveal(u.id); if (ui.curDir === 'en2ko') autoSpeak(u.id); }
  scheduleFlush(); persistCache(); toast('이전 단어로 돌아왔어요. 방금 한 평가는 취소됐어요.'); render();
}
function reveal() { if (ui.cur && !ui.revealed) { clearTimeout(revealTimer); ui.revealEnd = 0; ui.revealed = true; ui.revealedAt = performance.now(); if (ui.curDir === 'ko2en') autoSpeak(ui.cur); render(); } }
function rate(r, hold) {
  const id = ui.cur; if (!id || !ui.revealed || !ui.session) return;
  const t = Date.now(), perf = performance.now(), s = ui.session;
  const prev = CARDS.get(id), wasNew = !prev || prev.phase === 'new', p = prev || blank();
  const left = counts(t).left;
  // 되돌리기용 스냅샷: 평가 전의 카드, 오늘 집계, 세션 집계를 보관해요
  const logId = uuid(), dayKey = ymd(t);
  s.stack = s.stack || [];
  s.stack.push({ id, prev, logId, dayKey, dd: Object.assign(emptyDay(), DAILY.get(dayKey)), dir: ui.curDir, quiz: ui.curQuiz, kind: ui.curKind || 'review',
    ses: { done: s.done, w: s.w, c: s.c, r: s.r, u: s.u, k: s.k, nw: s.nw, sinceNew: s.sinceNew, lastId: s.lastId } });
  if (s.stack.length > 30) s.stack.shift();
  const next = schedule(prev, r, t, { scale: SET.scale });
  CARDS.set(id, next);
  S.queueCard(USER.id, id, next);

  const iso = (x) => (x ? new Date(x).toISOString() : null);
  S.queueLog({
    user_id: USER.id, client_id: logId, word_id: id, reviewed_at: iso(t), local_date: ymd(t), local_hour: new Date(t).getHours(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone, rating: r, direction: ui.curDir, mode: s.mode, is_new: wasNew,
    phase_before: p.phase, phase_after: next.phase, ivl_before: p.ivl, ivl_after: next.ivl, ease_before: p.ease, ease_after: next.ease,
    reps_before: p.reps, reps_after: next.reps, lapses_before: p.lapses, lapses_after: next.lapses, step_before: p.step,
    due_before: wasNew ? null : iso(p.due), due_after: iso(next.due),
    overdue_days: wasNew ? null : Math.round(Math.max(0, (t - p.due) / DAY) * 1000) / 1000,
    reveal_ms: ui.shownAt && ui.revealedAt ? Math.round(ui.revealedAt - ui.shownAt) : null,
    rate_ms: ui.revealedAt ? Math.round(perf - ui.revealedAt) : null,
    was_hidden: ui.hidden, speak_count: ui.speaks, session_id: s.id, card_index: s.done + 1, queue_left: left,
    device: deviceInfo(), app_version: APP_VERSION
  });

  s.lastId = id; s.done++; s[LETTER[r]]++; if (wasNew) { s.nw++; s.sinceNew = 0; } else s.sinceNew++;
  S.queueSession({
    id: s.id, user_id: USER.id, started_at: iso(s.startedAt), last_activity_at: iso(t), mode: s.mode, cards_done: s.done,
    n_wrong: s.w, n_close: s.c, n_right: s.r, n_unknown: s.u, n_known: s.k, n_new: s.nw, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, device: deviceInfo(), app_version: APP_VERSION
  });
  const k = ymd(t), dd = Object.assign(emptyDay(), DAILY.get(k));
  dd.n++; dd[LETTER[r]]++; if (wasNew) dd.nw++;
  if (p.phase === 'review') { dd.rn++; if (r === 'right' || r === 'known') dd.rk++; }
  if (ui.curQuiz !== 'write' && ui.shownAt && ui.revealedAt && ui.revealedAt - ui.shownAt < S.FAST_MS) dd.fn++;
  DAILY.set(k, dd);

  scheduleFlush();
  if (hold) { ui.held = true; render(); } else { pick(); render(); }
}
function wFinish(r, hold) {
  if (!ui.cur || ui.held || ui.curQuiz !== 'write') return;
  const id = ui.cur;
  ui.revealed = true; ui.revealedAt = performance.now();
  rate(r, hold);
  if (hold && autoOn() && canSpeak()) { const w = WORDS.get(id); if (w) speak(w.en); }   // 정답을 확인하면(몰랐음 포함) 발음을 들려줘요
}
function wCheck() {
  if (ui.curQuiz !== 'write' || ui.held || !ui.cur) return;
  const info = writeInfo(WORDS.get(ui.cur)), typed = String(ui.wtext || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!typed) { toast('빈칸에 글자를 입력해 주세요. 모르면 \'몰랐음\'을 눌러요.'); return; }
  ui.wres = gradeWrite(info, typed);
  wFinish(ui.wres.rating, true);
}
function wNext() { if (ui.held) { pick(); render(); } }
// 발음 재생. 앞부분이 잘리지 않도록:
// (1) '학습 시작'을 누를 때 소리 없는 문장으로 음성 엔진을 깨워 두고,
// (2) 단어 앞에 쉼표를 붙여 짧은 쉼으로 시작해요. 기기가 소리 출력을 여는 동안 단어 앞부분이 아니라 이 쉼이 잘려요.
// (3) 읽는 중이 아니면 터치/키 입력 안에서 바로 재생해요. 일부 브라우저(iOS 등)는 입력 직후가 아니면 소리를 막아요.
// (4) 영어(미국) 목소리를 직접 고르고, 재생 중인 객체를 변수에 잡아 둬서 중간에 사라지지 않게 해요.
let speakTimer = 0, warmed = false, curUtter = null, enVoice = null;
const canSpeak = () => 'speechSynthesis' in window;
function pickVoice() {
  try { const v = window.speechSynthesis.getVoices(); enVoice = v.find((x) => x.lang === 'en-US' && x.localService) || v.find((x) => x.lang === 'en-US') || v.find((x) => /^en/i.test(x.lang)) || null; } catch (e) { /* 무시 */ }
}
if (canSpeak()) { pickVoice(); try { window.speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (e) { /* 무시 */ } }
function warmUp() {
  if (warmed || !canSpeak()) return; warmed = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'en-US'; window.speechSynthesis.speak(u); } catch (e) { /* 무시 */ }
}
function speakNow(text) {
  const u = new SpeechSynthesisUtterance(', ' + text); u.lang = 'en-US'; u.rate = 0.9; if (enVoice) u.voice = enVoice;
  curUtter = u; u.onend = u.onerror = () => { if (curUtter === u) curUtter = null; };
  window.speechSynthesis.speak(u);
}
// 안드로이드는 기기 음성 엔진이 시작할 때 앞부분이 잘리는 경우가 많아요. 그래서 기본은 사전의 녹음된 발음(mp3)을 쓰고,
// 음원이 없는 단어나 인터넷이 안 될 때만 기기 음성으로 읽어요. 음원 주소는 기기에 저장하고, 곧 나올 단어는 미리 받아 둬요.
const audioSrc = () => { try { return localStorage.getItem('voca.audiosrc') === 'tts' ? 'tts' : 'dict'; } catch (e) { return 'dict'; } };
const audioUrls = new Map();   // 단어 -> 주소('' = 음원 없음) 또는 확인 중인 Promise
const audioEls = new Map();    // 단어 -> Audio (최근 16개)
let curAudio = null, speakToken = 0;
function resolveAudio(word) {
  const key = String(word).toLowerCase();
  if (audioUrls.has(key)) { const v = audioUrls.get(key); return typeof v === 'string' ? Promise.resolve(v) : v; }
  try { const c = localStorage.getItem('voca.au.' + key); if (c !== null) { const u = c === '-' ? '' : c; audioUrls.set(key, u); return Promise.resolve(u); } } catch (e) { /* 무시 */ }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null, to = setTimeout(() => { if (ctl) ctl.abort(); }, 4500);
  const p = fetch('https://api.dictionaryapi.dev/v2/entries/en/' + encodeURIComponent(key), ctl ? { signal: ctl.signal } : undefined)
    .then(async (r) => {
      if (r.status === 404) return { url: '', keep: true };
      if (!r.ok) throw new Error('http');
      const j = await r.json(); let best = '';
      if (Array.isArray(j)) outer: for (const e of j) for (const ph of (e.phonetics || [])) { const u = ph && ph.audio; if (u && /^https:\/\//.test(u)) { if (/-us\.mp3$/.test(u)) { best = u; break outer; } if (!best) best = u; } }
      return { url: best, keep: true };
    })
    .catch(() => ({ url: '', keep: false }))   // 인터넷 오류는 저장하지 않고 다음에 다시 시도해요
    .then((o) => {
      clearTimeout(to);
      if (o.keep) { audioUrls.set(key, o.url); try { localStorage.setItem('voca.au.' + key, o.url || '-'); } catch (e) { /* 무시 */ } } else audioUrls.delete(key);
      return o.url;
    });
  audioUrls.set(key, p);
  return p;
}
function audioFor(key, url) {
  let a = audioEls.get(key);
  if (!a || a.__url !== url) { a = new Audio(); a.preload = 'auto'; a.__url = url; a.src = url; audioEls.delete(key); audioEls.set(key, a); if (audioEls.size > 16) audioEls.delete(audioEls.keys().next().value); }
  return a;
}
function prefetchAudio(words) {
  if (audioSrc() !== 'dict') return;
  words.forEach((w, i) => setTimeout(() => { const k = String(w).toLowerCase(); resolveAudio(w).then((u) => { if (u) loadBuffer(k, u).catch(() => { audioFor(k, u); }); }); }, 250 * i));
}
// 웹 오디오로 재생해요: 소리 출력을 미리 열어 두고, 재생 시작을 0.15초 늦춰서 그 사이(무음)에 기기가 깨어나게 해요. 앞부분이 잘리지 않아요.
// (음원 서버가 다른 출처 접근을 막아 못 받으면 일반 재생기로, 그것도 안 되면 기기 음성으로 넘어가요)
const LEAD = 0.3;
let actx = null, curSrc = null, lastSpeak = '', keepNode = null;
const noteOn = () => { try { return localStorage.getItem('voca.speaknote') !== '0'; } catch (e) { return true; } };
function setLast(msg) {   // 어떤 방식으로 재생됐는지 기록하고, 켜 두었으면 스피커 버튼 아래에 작게 보여 줘요
  lastSpeak = msg;
  const el = typeof document !== 'undefined' ? document.getElementById('speakNote') : null;
  if (el) el.textContent = noteOn() ? '▶ ' + msg : '';
}
// 소리 출력이 쉬는 동안 꺼졌다 켜지며 앞부분이 잘리는 기기(특히 블루투스)를 위해, 학습 중에는 들리지 않을 만큼 작은 소리를 계속 내보내 출력을 열어 둬요.
function keepAlive(on) {
  try {
    if (!on) { if (keepNode) { keepNode.osc.stop(); keepNode.osc.disconnect(); keepNode.g.disconnect(); keepNode = null; } return; }
    const c = audioCtx(); if (!c || keepNode) return;
    const osc = c.createOscillator(), g = c.createGain(); osc.frequency.value = 30; g.gain.value = 0.0003;
    osc.connect(g); g.connect(c.destination); osc.start(); keepNode = { osc, g };
  } catch (e) { keepNode = null; }
}
const bufCache = new Map();
function audioCtx() {
  try {
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  } catch (e) { actx = null; }
  return actx;
}
async function loadBuffer(key, url) {
  if (bufCache.has(key)) return bufCache.get(key);
  const c = audioCtx(); if (!c) throw new Error('오디오 장치를 열 수 없어요');
  const r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw new Error('음원 받기 실패 ' + r.status);
  const ab = await r.arrayBuffer();
  const buf = await new Promise((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  bufCache.set(key, buf); if (bufCache.size > 24) bufCache.delete(bufCache.keys().next().value);
  return buf;
}
function playBuffer(buf) {
  const c = audioCtx(); if (!c) return false;
  try { if (curSrc) { curSrc.onended = null; curSrc.stop(); } } catch (e) { /* 무시 */ }
  const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); curSrc = src;
  src.start(c.currentTime + LEAD);
  return true;
}
function prefetchWords(id) {   // 지금 단어와 곧 나올 새 단어 몇 개의 발음을 미리 받아 둬요
  if (audioSrc() !== 'dict') return;
  const list = [], w = WORDS.get(id); if (w) list.push(w.en);
  let n = 0;
  for (const x of STUDY) { if (x === id) continue; const c = CARDS.get(x); if (!c || c.phase === 'new') { const ww = WORDS.get(x); if (ww) { list.push(ww.en); if (++n >= 5) break; } } }
  prefetchAudio(list);
}
function stopAudio() { try { if (curAudio) { curAudio.pause(); curAudio = null; } } catch (e) { /* 무시 */ } try { if (curSrc) { curSrc.onended = null; curSrc.stop(); curSrc = null; } } catch (e) { /* 무시 */ } }
function playUrl(key, url) {
  const a = audioFor(key, url);
  try { a.currentTime = 0; } catch (e) { /* 아직 불러오는 중이면 무시 */ }
  curAudio = a;
  const pr = a.play();
  return pr && typeof pr.then === 'function' ? pr.then(() => true, () => false) : Promise.resolve(true);
}
function ttsSpeak(text) {
  try {
    if (!canSpeak()) return;
    warmUp();
    clearTimeout(speakTimer);
    const synth = window.speechSynthesis;
    if (curUtter || synth.speaking || synth.pending) {   // 읽는 중이면 끊고, 취소가 끝나길 잠깐 기다렸다가 재생해요
      synth.cancel(); curUtter = null;
      speakTimer = setTimeout(() => { try { speakNow(text); } catch (e) { /* 무시 */ } }, 90);
    } else { try { synth.resume(); } catch (e) { /* 무시 */ } speakNow(text); }
  } catch (e) { /* 무시 */ }
}
function speak(text) {
  const tok = ++speakToken; stopAudio();
  try { if (canSpeak()) { window.speechSynthesis.cancel(); curUtter = null; clearTimeout(speakTimer); } } catch (e) { /* 무시 */ }
  if (audioSrc() !== 'dict' || typeof Audio === 'undefined') { setLast('기기 음성 (설정)'); ttsSpeak(text); return; }
  const key = String(text).toLowerCase(), known = audioUrls.get(key);
  const tts = (why) => { if (tok !== speakToken) return; setLast('기기 음성 — ' + why); ttsSpeak(text); };
  const viaElement = (url, why) => { playUrl(key, url).then((ok) => { if (tok !== speakToken) return; if (ok) setLast('사전 녹음 (일반 재생기' + (why ? ': ' + why : '') + ')'); else tts('재생이 막혔어요'); }); };
  const go = (url) => {
    if (tok !== speakToken) return;
    if (!url) { tts(audioUrls.get(key) === '' ? '사전에 이 단어의 녹음이 없어요' : '사전에 연결하지 못했어요'); return; }
    const buf = bufCache.get(key);
    if (buf && playBuffer(buf)) { setLast('사전 녹음 (웹 오디오)'); return; }   // 이미 받은 음원은 입력 이벤트 안에서 바로 재생
    audioCtx();
    loadBuffer(key, url).then((b) => { if (tok !== speakToken) return; if (playBuffer(b)) setLast('사전 녹음 (웹 오디오)'); else viaElement(url, '웹 오디오 사용 불가'); })
      .catch((e) => { if (tok === speakToken) viaElement(url, String(e && e.message || e).slice(0, 40)); });
  };
  if (typeof known === 'string') { go(known); return; }
  Promise.race([resolveAudio(text), new Promise((r) => setTimeout(() => r(''), 1500))]).then(go);   // 처음 보는 단어는 주소를 확인하고 재생, 늦으면 기기 음성
}
// 자동 발음: 켜기(모든 카드) / 새 단어만 / 끄기. 영어가 화면에 나타날 때 들려줘요. 기기마다 설정에서 바꿔요.
const autoMode = () => { try { const v = localStorage.getItem('voca.autospeak'); return v === '0' ? 'off' : (v === 'new' ? 'new' : 'all'); } catch (e) { return 'all'; } };
const autoOn = () => autoMode() !== 'off';
function autoSpeak(id) {
  const m = autoMode(); if (m === 'off' || !canSpeak()) return;
  const w = WORDS.get(id), c = CARDS.get(id);
  if (w && (m === 'all' || !c || c.phase === 'new')) speak(w.en);
}

// 예문 속 해당 단어(-s, -ed, -ing 같은 활용형 포함)를 굵게 보여 줘요. 못 찾으면 그대로 둬요.
function exHtml(ex, en) {
  const text = String(ex || ''), word = String(en || '').trim().toLowerCase();
  if (!word) return esc(text);
  const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = (t) => {
    const a = [t];
    if (t.length > 3 && t.endsWith('e')) a.push(t.slice(0, -1));
    if (t.length > 3 && t.endsWith('y')) a.push(t.slice(0, -1) + 'i');
    if (t.length > 3 && /[bdgmnprt]$/.test(t) && !/[aeiou]{2}[bdgmnprt]$/.test(t)) a.push(t + t.slice(-1));
    return a.map(rx).join('|');
  };
  const pat = word.split(/[\s-]+/).filter(Boolean).map((p) => '(?:' + forms(p) + ')[a-z]{0,4}').join('[\\s-]+');
  let m = null;
  try { m = new RegExp('(^|[^A-Za-z])(' + pat + ')(?![A-Za-z])', 'i').exec(text); } catch (e) { m = null; }
  if (!m) return esc(text);
  const a = m.index + m[1].length, b = a + m[2].length;
  return esc(text.slice(0, a)) + '<b class="hl">' + esc(text.slice(a, b)) + '</b>' + esc(text.slice(b));
}

/* ---------- 쓰기 퀴즈 ---------- */
// 뜻을 보고 영어 단어를 써요. 마지막 두 글자(4글자 이하면 마지막 한 글자)를 알려 주고, 나머지 앞 글자들을 입력해요. 시간 제한은 없어요.
function writeInfo(w) {
  const chars = String(w.en || '').trim().split('');
  const li = []; chars.forEach((ch, i) => { if (/[A-Za-z]/.test(ch)) li.push(i); });
  if (li.length < 2) return null;
  const shown = new Set([li[li.length - 1]]); if (li.length > 4) shown.add(li[li.length - 2]);
  const hidden = li.filter((i) => !shown.has(i));
  if (!hidden.length) return null;
  return { chars, hidden, shown, exp: hidden.map((i) => chars[i].toLowerCase()).join(''), n: hidden.length, two: li.length > 4, plain: li.length === chars.length };
}
// 맞은 글자 수로 채점해요: 전부 맞으면 맞았음, 절반 이상 맞으면 비슷함, 그보다 적으면 틀림
function gradeWrite(info, typed) {
  let c = 0; for (let i = 0; i < info.n; i++) if (typed[i] === info.exp[i]) c++;
  return { c, n: info.n, typed, rating: c === info.n ? 'right' : (c / info.n >= 0.5 ? 'close' : 'wrong') };
}
function patternHtml(info, res, typed) {
  let k = 0; const cur = typed ? typed.length : 0;
  return info.chars.map((ch, i) => {
    if (ch === ' ') return '<span class="gap"></span>';
    if (!/[A-Za-z]/.test(ch) || info.shown.has(i)) return '<span class="lt fix">' + esc(ch) + '</span>';
    const j = k++;
    if (res) return '<span class="lt ' + (res.typed[j] === info.exp[j] ? 'ok' : 'no') + '">' + esc(ch) + '</span>';
    if (typed && typed[j]) return '<span class="lt filled">' + esc(typed[j]) + '</span>';
    return '<span class="lt blank' + (j === cur ? ' cur' : '') + '"></span>';
  }).join('');
}

// 자동 정답 공개: 설정한 초가 지나면 정답을 보여 줘요(평가는 여전히 내가 해요). 기기별 저장, 기본은 3초.
const AUTO_REVEAL = [{ v: 0, label: '끄기' }, { v: 3, label: '3초 뒤' }, { v: 5, label: '5초 뒤' }, { v: 10, label: '10초 뒤' }];
const AUTO_REVEAL_DEFAULT = 3;
const autoRevealSec = () => { try { const raw = localStorage.getItem('voca.autoreveal'); if (raw === null) return AUTO_REVEAL_DEFAULT; const n = +raw; return AUTO_REVEAL.some((x) => x.v === n) ? n : AUTO_REVEAL_DEFAULT; } catch (e) { return AUTO_REVEAL_DEFAULT; } };
let revealTimer = 0;
function armAutoReveal(id) {
  clearTimeout(revealTimer);
  const sec = autoRevealSec();
  ui.revealEnd = sec ? performance.now() + sec * 1000 : 0;   // 남은 시간 막대를 그릴 기준 시각
  if (!sec) return;
  revealTimer = setTimeout(() => { if (ui.route === 'study' && ui.session && ui.cur === id && !ui.revealed && !document.hidden) reveal(); }, sec * 1000);
}

/* ---------- 화면 ---------- */
const SPEAKER = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
function ipaHtml(w) { const v = w && w.ipa ? String(w.ipa).replace(/^\/+|\/+$/g, '') : ''; return v ? '<p class="ipa" lang="en-fonipa">/' + esc(v) + '/</p>' : ''; }
const good = (l) => (l.r || 0) + (l.k || 0);   // 정답으로 치는 평가: 맞았음 + 알고 있음
function speakBtn() { return canSpeak() ? '<span class="spk"><button class="speak" data-act="speak" aria-label="발음 듣기" title="발음 듣기">' + SPEAKER + '</button><span class="srcnote" id="speakNote" aria-live="polite">' + (noteOn() && lastSpeak ? '▶ ' + esc(lastSpeak) : '') + '</span></span>' : ''; }

function viewLoading() { return '<div class="state"><div class="spin" aria-hidden="true"></div><p>단어와 학습 기록을 불러오는 중이에요.</p></div>'; }
function viewNoConfig() {
  return '<div class="state"><h2>앱 설정이 아직 끝나지 않았어요</h2><p>배포할 때 환경 변수 VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 를 넣어야 해요. README의 3단계를 확인해 주세요.</p></div>';
}
function viewLoadError() {
  return '<div class="state"><h2>불러오지 못했어요</h2><p>인터넷 연결을 확인하고 다시 시도해 주세요.</p><button class="btn primary" data-act="retry">다시 시도</button></div>';
}
function viewLogin() {
  return '<section class="hello"><img class="mark" src="/icon.svg" alt="" width="52" height="52"><h1>단어 복습장</h1><p>맞힌 정도에 따라 복습 간격을 조절해서, 잊어버릴 때쯤 다시 보여 주는 영어 단어 암기 앱이에요.</p>' +
    '<ul class="points"><li>틀렸습니다 / 비슷합니다 / 맞았습니다를 직접 골라요</li><li>기기를 바꿔도 내 학습 기록이 이어져요</li><li>한 번 로그인하면 계속 유지돼요</li></ul>' +
    '<div class="loginbox"><label class="fld">아이디<input id="uid" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="영문 소문자, 숫자 3~20자"></label>' +
    '<label class="fld">비밀번호<input id="upw" type="password" autocomplete="current-password" placeholder="6자 이상"></label>' +
    '<p class="loginmsg" id="loginmsg" role="alert">' + esc(ui.loginMsg || '') + '</p>' +
    '<button class="btn primary block" data-act="login">로그인</button>' +
    '<button class="btn block" data-act="signup">처음이에요 (가입하기)</button></div></section>';
}
function viewConsent() {
  return '<section class="hello"><h1>시작하기 전에</h1><p>더 잘 외울 수 있도록, 학습 기록이 저장돼요.</p>' +
    '<ul class="points"><li>저장하는 것: 어떤 단어를 언제 봤는지, 어떻게 답했는지, 답하기까지 걸린 시간, 사용 기기 종류</li>' +
    '<li>계정에는 로그인에 쓴 이메일만 보관되고, 이름이나 연락처는 따로 저장하지 않아요</li>' +
    '<li>기록은 앱을 만든 사람이 학습 기능을 개선하는 데 쓰고, 다른 사용자에게는 보이지 않아요</li>' +
    '<li>설정 화면에서 언제든 내 기록을 파일로 받거나 삭제할 수 있어요</li></ul>' +
    '<button class="btn primary block" data-act="consent">동의하고 시작하기</button>' +
    '<button class="btn ghost block" data-act="logout">동의하지 않고 로그아웃</button></section>';
}
function viewNoWords() { return '<div class="state"><h2>아직 단어가 없어요</h2><p>단어가 추가되면 이곳에 나타나요.</p></div>'; }
function sampleNote() {
  if (!ORDER.length) return '';
  const all = ORDER.every((id) => WORDS.get(id).src === 'sample');
  return all ? '<p class="note">지금은 임시 샘플 단어 ' + ORDER.length + '개로 동작을 확인하는 중이에요.</p>' : '';
}
function masteryBar(c) {
  const seg = [['new', 'm0'], ['learn', 'm1'], ['young', 'm2'], ['mature', 'm3']];
  const label = seg.map((x) => PHASE_LABEL[x[0]] + ' ' + c.n[x[0]]).join(', ');
  return '<div class="mbar" role="img" aria-label="' + esc(label) + '">' + seg.map((x) => c.n[x[0]] ? '<i style="flex:' + c.n[x[0]] + ';background:var(--' + x[1] + ')"></i>' : '').join('') + '</div>' +
    '<ul class="legend">' + seg.map((x) => '<li><i style="background:var(--' + x[1] + ')"></i>' + PHASE_LABEL[x[0]] + ' <b>' + c.n[x[0]] + '</b></li>').join('') + '</ul>';
}

function viewHome() {
  const now = Date.now(), c = counts(now), t = todayLog(now);
  const week = lastDays(7, now); let wn = 0, wr = 0; week.forEach((d) => { wn += d.l.n || 0; wr += good(d.l); });
  const can = ORDER.length > 0;   // 오늘 목표를 채워도 이어서 더 할 수 있어요
  const throttleNote = c.throttled ? '오늘은 예정된 복습이 많아서 새 단어를 ' + c.newAvail + '개로 줄였어요. (하루 복습 상한 ' + SET.cap + '번 기준) 복습부터 끝내면 내일 더 넣을 수 있어요.' : '';
  const info = c.left > 0 ? throttleNote : ('오늘 목표를 모두 채웠어요!' + (nextInfo(now) ? ' ' + nextInfo(now) + '.' : '') + ' 더 하고 싶다면 이어서 계속할 수 있어요.');
  let h = '<section class="hero"><p class="eyebrow">오늘 남은 카드</p><p class="big">' + c.left + '</p>' +
    '<dl class="trio"><div><dt>복습</dt><dd>' + c.dueReview + '</dd></div><div><dt>학습 중</dt><dd>' + c.dueLearn + '</dd></div><div><dt>새 단어</dt><dd>' + c.newAvail + '</dd></div></dl>' +
    '<div class="seg" role="group" aria-label="퀴즈 종류">' + [['read', '읽기 퀴즈', '뜻 떠올리기'], ['write', '쓰기 퀴즈', '철자 쓰기'], ['mix', '섞어서', '읽기 + 쓰기']].map((q) => '<button class="segb' + (ui.quiz === q[0] ? ' on' : '') + '" data-act="quiz" data-q="' + q[0] + '" aria-pressed="' + (ui.quiz === q[0]) + '">' + q[1] + '<small>' + q[2] + '</small></button>').join('') + '</div>' +
    '<button class="btn primary block" data-act="start"' + (can ? '' : ' disabled') + '>' + (c.left > 0 ? '학습 시작' : '이어서 더 학습하기') + '</button>' +
    (info ? '<p class="after">' + esc(info) + '</p>' : '') + '</section>';
  h += '<div class="strip"><div><b>' + streak(now) + '일</b><span>연속 학습</span></div><div><b>' + (t.n || 0) + '장</b><span>오늘 학습</span></div><div><b>' + (wn ? Math.round(wr / wn * 100) + '%' : '–') + '</b><span>최근 7일 정답률</span></div></div>';
  h += '<section class="block"><div class="block-h"><h2>익힌 정도</h2><span class="muted">' + (setLabel() ? esc(setLabel()) + ' · ' : '') + '단어 ' + c.total + '개</span></div>' + masteryBar(c) + '</section>';
  if (c.leech.length) {
    h += '<section class="block"><div class="block-h"><h2>자주 틀리는 단어</h2><span class="muted">' + c.leech.length + '개</span></div><ul class="mini">' +
      c.leech.slice(0, 5).map((id) => { const w = WORDS.get(id); return '<li><span class="serif">' + esc(w.en) + '</span><span class="k">' + esc(w.ko) + '</span><span class="n">틀림 ' + CARDS.get(id).lapses + '</span></li>'; }).join('') +
      '</ul><button class="btn block" data-act="leech">이 단어만 집중 복습</button></section>';
  }
  const sn = sampleNote();
  return h + (sn ? sn.replace('<p class="note">', '<p class="note" style="margin-top:22px">') : '');
}

function answerExtras(w, c) {
  let a = '';
  if (w.ex) a += '<div><p class="ex">' + exHtml(w.ex, w.en) + '</p>' + (w.exKo ? '<p class="ex-ko">' + esc(w.exKo) + '</p>' : '') + '</div>';
  if (w.syn && w.syn.length) a += '<ul class="syn">' + w.syn.map((x) => '<li><b>' + esc(x.w) + '</b><span>' + esc(x.n || '') + '</span></li>').join('') + '</ul>';
  if (c && c.hist && c.hist.length) a += '<div class="hist"><span>최근 기록</span>' + c.hist.slice(-8).map((x) => '<i class="' + esc(x[1]) + '">' + esc(HLAB[x[1]] || '') + '</i>').join('') + '</div>';
  if (w.ai) a += '<p class="ai">예문과 유의어는 AI가 만들었어요.</p>';
  return a;
}
function writeCard(bar, w, c, tags) {
  const info = writeInfo(w), pos = w.pos ? '<p class="pos">' + esc(w.pos) + '</p>' : '';
  if (!ui.held) {
    const hint = (info.two ? '마지막 두 글자' : '마지막 글자') + '가 주어져요. 빈칸 ' + info.n + '글자를 키보드로 바로 써요.' + (info.plain ? '' : ' (띄어쓰기·하이픈은 빼고)') + ' 시간 제한은 없어요.';
    return bar + '<section class="card">' + tags + '<div class="front"><p class="eyebrow">뜻을 보고 영어로 써 보세요</p><h1 class="head-ko">' + esc(w.ko) + '</h1>' + pos +
      '<label class="pat" id="pat" for="wans" role="img" aria-label="' + esc('힌트: ' + info.chars.map((ch, i) => (info.shown.has(i) || !/[A-Za-z]/.test(ch) ? ch : '빈칸')).join(' ')) + '">' + patternHtml(info, null, ui.wtext) + '</label>' +
      '<input id="wans" class="wans" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="' + info.n + '" aria-label="빈칸에 들어갈 ' + info.n + '글자" value="' + esc(ui.wtext) + '">' +
      '<p class="muted small hint">' + esc(hint) + '</p></div></section>';
  }
  const res = ui.wres, now = Date.now();
  const lab = res ? RATINGS.filter((x) => x.key === res.rating)[0].label + ' · 맞은 글자 ' + res.c + ' / ' + res.n : '몰랐음';
  const cls = res ? res.rating : 'unknown';
  const word = res ? '<div class="pat big-pat" aria-label="' + esc(w.en) + '">' + patternHtml(info, res) + '</div>' : '<h1 class="head">' + esc(w.en) + '</h1>';
  const mine = res && res.c < res.n ? '<p class="muted small">내가 쓴 글자: <b class="typed">' + esc(res.typed) + '</b></p>' : '';
  return bar + '<section class="card open">' + tags + '<div class="front"><p class="wres ' + cls + '">' + esc(lab) + '</p>' + word + mine + ipaHtml(w) + speakBtn() + '</div>' +
    '<div class="answer"><p class="ans-ko">' + esc(w.ko) + '</p>' + answerExtras(w, c) + '<p class="muted small">다음 복습: ' + esc(fmtDue(c, now)) + '</p></div></section>';
}
function viewStudy() {
  const s = ui.session; if (!s) return viewLoading();
  const now = Date.now();
  const left = s.mode === 'leech' ? (s.q.length + (ui.cur ? 1 : 0)) : counts(now).left;
  const pct = s.done + left ? Math.round(s.done / (s.done + left) * 100) : 100;
  const prog = left > 0 ? '오늘 ' + s.done + '장 · 남은 ' + left + '장' : '오늘 ' + s.done + '장 · 목표 달성';
  const bar = '<div class="studybar"><span class="sb-l"><button class="btn ghost" data-act="go" data-r="home">← 나가기</button>' + (s.stack && s.stack.length ? '<button class="btn ghost" data-act="undo" title="마지막 평가를 취소하고 이전 단어로 돌아가요">↶ 이전 단어</button>' : '') + '</span><span class="prog">' + esc(prog) + '</span></div>' +
    '<div class="track" role="progressbar" aria-label="이번 학습 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>';
  if (!ui.cur) {
    const tot = s.u + s.w + s.c + s.r + s.k;
    return bar + '<div class="state"><h2>' + (tot ? '수고했어요' : '지금 볼 카드가 없어요') + '</h2>' +
      (tot ? '<p>' + tot + '장을 학습했어요. 정답률 ' + Math.round((s.r + s.k) / tot * 100) + '%</p><div class="sum">' + RATINGS.map((x) => '<div class="' + x.letter + '"><b>' + s[x.letter] + '</b><span>' + x.label + '</span></div>').join('') + '</div>' : '<p>' + (nextInfo(now) || '새 카드가 생기면 다시 알려 드릴게요.') + '</p>') +
      '<button class="btn primary block" data-act="go" data-r="home" style="margin-top:8px">홈으로</button></div>';
  }
  const w = WORDS.get(ui.cur), c = CARDS.get(ui.cur) || blank(), e2k = ui.curDir === 'en2ko', b = bucket(c);
  const tags = '<div class="tags"><span class="tag">' + (b === 'new' ? '새 단어' : (b === 'learn' ? '학습 중' : '복습')) + '</span>' + ((c.lapses || 0) >= LEECH ? '<span class="tag warn">자주 틀림 · ' + c.lapses + '회</span>' : '') + '</div>';
  if (ui.curQuiz === 'write') return writeCard(bar, w, c, tags);
  let front = '<div class="front">' + (e2k ? '<h1 class="head">' + esc(w.en) + '</h1>' : '<h1 class="head-ko">' + esc(w.ko) + '</h1>');
  front += w.pos ? '<p class="pos">' + esc(w.pos) + '</p>' : '';
  if (e2k) front += ipaHtml(w) + speakBtn();
  front += '</div>';
  let ans = '';
  if (ui.revealed) {
    ans = '<div class="answer">' + (e2k ? '<p class="ans-ko">' + esc(w.ko) + '</p>' : '<div class="en-row"><div><p class="ans-en">' + esc(w.en) + '</p>' + ipaHtml(w) + '</div>' + speakBtn() + '</div>');
    ans += answerExtras(w, c);
    ans += '</div>';
  }
  let cd = '';
  if (!ui.revealed && ui.revealEnd) {   // 자동 정답 공개까지 남은 시간 막대 (다시 그려도 이어서 줄어들도록 지난 시간만큼 앞당겨 시작해요)
    const sec = autoRevealSec(), left = Math.max(0, (ui.revealEnd - performance.now()) / 1000);
    if (sec && left > 0) cd = '<div class="rbar" aria-hidden="true"><i style="animation-duration:' + sec + 's;animation-delay:-' + (sec - left).toFixed(2) + 's"></i></div>';
  }
  return bar + '<section class="card' + (ui.revealed ? ' open' : '') + '">' + tags + cd + front + ans + '</section>';
}
function viewDock() {
  if (ui.route !== 'study' || !ui.session || !ui.cur) return '';
  if (ui.curQuiz === 'write') {
    if (ui.held) return '<button class="btn primary block" data-act="wNext">다음</button><p class="keys">Enter 키나 스페이스로도 넘어가요</p>';
    return '<div class="wdock"><button class="btn" data-act="wUnknown">몰랐음</button><button class="btn" data-act="wKnown">알고 있음</button></div><button class="btn primary block" data-act="wCheck">정답 확인</button><p class="keys">입력한 뒤 Enter 키로도 확인해요</p>';
  }
  if (!ui.revealed) return '<button class="btn primary block" data-act="reveal">정답 보기</button><p class="keys">스페이스 키로도 볼 수 있어요</p>';
  const now = Date.now(), c = CARDS.get(ui.cur) || blank();
  return '<div class="rates" role="group" aria-label="얼마나 알았는지 골라요">' + RATINGS.map((d) => '<button class="rate ' + d.key + '" data-act="rate" data-r="' + d.key + '"><span class="rl">' + d.label + '</span><span class="rv">' + esc(fmtDue(schedule(c, d.key, now, { scale: SET.scale }), now)) + '</span></button>').join('') + '</div><p class="keys">키보드 1 · 2 · 3 · 4 · 5</p>';
}

function matchWord(id) {
  const w = WORDS.get(id), c = CARDS.get(id), b = bucket(c);
  if (ui.filter === 'new' && b !== 'new') return false;
  if (ui.filter === 'learn' && b !== 'learn' && b !== 'young') return false;
  if (ui.filter === 'known' && b !== 'mature') return false;
  if (ui.filter === 'leech' && !(((c && c.lapses) || 0) >= LEECH)) return false;
  const q = ui.q.trim().toLowerCase();
  if (q && (w.en || '').toLowerCase().indexOf(q) < 0 && (w.ko || '').toLowerCase().indexOf(q) < 0) return false;
  return true;
}
function wordRows() {
  const now = Date.now(), ids = ORDER.filter(matchWord);
  if (!ids.length) return '<p class="empty">조건에 맞는 단어가 없어요.</p>';
  return '<div class="rows">' + ids.map((id) => {
    const w = WORDS.get(id), c = CARDS.get(id), b = bucket(c);
    const facts = (c && c.phase !== 'new')
      ? '<span>다음 복습 ' + esc(fmtDue(c, now)) + '</span><span>간격 ' + (c.ivl || 0) + '일</span><span>난이도 계수 ' + (c.ease || 2.3) + '</span><span>틀린 횟수 ' + (c.lapses || 0) + '</span><span>복습 ' + (c.n || 0) + '회</span>'
      : '<span>아직 학습 전이에요</span>';
    return '<details class="row"><summary><span class="r-en serif">' + esc(w.en) + '</span><span class="pill ' + b + '">' + PHASE_LABEL[b] + '</span><span class="r-ko">' + (w.pos ? esc(w.pos) + ' · ' : '') + esc(w.ko) + '</span></summary><div class="r-body">' + ipaHtml(w) +
      (w.ex ? '<div><p class="ex">' + exHtml(w.ex, w.en) + '</p>' + (w.exKo ? '<p class="ex-ko">' + esc(w.exKo) + '</p>' : '') + '</div>' : '') +
      (w.syn && w.syn.length ? '<ul class="syn">' + w.syn.map((x) => '<li><b>' + esc(x.w) + '</b><span>' + esc(x.n || '') + '</span></li>').join('') + '</ul>' : '') +
      '<div class="facts">' + facts + '</div>' + (w.ai ? '<p class="ai">예문과 유의어는 AI가 만들었어요.</p>' : '') + '</div></details>';
  }).join('') + '</div>';
}
function viewWords() {
  const f = [['all', '전체'], ['new', '새 단어'], ['learn', '학습 중'], ['known', '익숙함'], ['leech', '자주 틀림']];
  return sampleNote() + '<section class="block" style="margin-top:0"><input id="q" class="search" type="search" placeholder="단어나 뜻으로 찾기" value="' + esc(ui.q) + '" autocomplete="off">' +
    '<div class="chips">' + f.map((x) => '<button class="chip" data-act="filter" data-f="' + x[0] + '" aria-pressed="' + (ui.filter === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
    '<div id="wlist">' + wordRows() + '</div></section>';
}

function stackCol(d, max) {
  const l = d.l, n = l.n || 0, px = n ? Math.max(4, Math.round(n / max * 100)) : 0;
  return '<div class="col"><span class="v">' + (n || '') + '</span>' +
    (n ? '<div class="stack" style="height:' + px + 'px"><i class="s-k" style="flex:' + (l.k || 0) + '"></i><i class="s-r" style="flex:' + (l.r || 0) + '"></i><i class="s-c" style="flex:' + (l.c || 0) + '"></i><i class="s-w" style="flex:' + (l.w || 0) + '"></i><i class="s-u" style="flex:' + (l.u || 0) + '"></i></div>' : '<div class="stack nil"></div>') +
    '<span class="l">' + d.dow + '</span></div>';
}
function memoryCheck(days) {
  let rn = 0, rk = 0, n = 0, fn = 0;
  days.forEach((d) => { rn += d.l.rn || 0; rk += d.l.rk || 0; n += d.l.n || 0; fn += d.l.fn || 0; });
  let tip;
  if (rn < 30) tip = '복습한 단어가 아직 적어서 판단하기 일러요. 조금 더 모이면 알려 드릴게요.';
  else {
    const p = rk / rn;
    tip = p < 0.85 ? '복습에서 잊는 단어가 꽤 있어요. 설정에서 기억 강도를 한 단계 높여 보세요.'
      : p > 0.97 ? '거의 다 기억하고 있어요. 복습이 부담되면 기억 강도를 한 단계 낮춰도 괜찮아요.' : '기억이 잘 유지되고 있어요. 지금 설정이 잘 맞아요.';
  }
  return '<section class="block"><div class="block-h"><h2>기억 점검</h2><span class="muted">최근 14일</span></div><dl class="kv">' +
    '<dt>복습에서 기억해 낸 비율</dt><dd>' + (rn ? Math.round(rk / rn * 100) + '% (' + rk + '/' + rn + ')' : '–') + '</dd>' +
    '<dt>바로 떠오른 비율 (1초 안에 확인)</dt><dd>' + (n ? Math.round(fn / n * 100) + '%' : '–') + '</dd></dl>' +
    '<p class="muted small">\'맞았음·알고 있음\'을 고른 비율이에요. 스스로 매긴 점수라, 헷갈릴 땐 솔직하게 \'비슷함\'을 골라야 정확해요. ' + tip + '</p></section>';
}
function viewStats() {
  const now = Date.now(), c = counts(now), days = lastDays(14, now);
  let max = 1; days.forEach((d) => { if ((d.l.n || 0) > max) max = d.l.n; });
  const f = forecast(now); let fmax = 1; f.forEach((v) => { if (v > fmax) fmax = v; });
  const fl = f.map((_, i) => (i === 0 ? '오늘' : i === 1 ? '내일' : '일월화수목금토'.charAt(new Date(now + i * DAY).getDay())));
  let wn = 0, ww = 0, wr = 0; days.slice(7).forEach((d) => { wn += d.l.n || 0; ww += (d.l.w || 0) + (d.l.u || 0); wr += good(d.l); });
  let total = 0; DAILY.forEach((l) => { total += l.n || 0; });
  let h = '<section class="block" style="margin-top:0"><div class="block-h"><h2>최근 14일 학습량</h2><span class="muted">장</span></div>' +
    '<div class="chart" role="img" aria-label="최근 14일 하루 학습량 막대 그래프">' + days.map((d) => stackCol(d, max)).join('') + '</div>' +
    '<ul class="legend"><li><i style="background:var(--mk-k)"></i>알고 있음</li><li><i style="background:var(--mk-r)"></i>맞았음</li><li><i style="background:var(--mk-c)"></i>비슷함</li><li><i style="background:var(--mk-w)"></i>틀림</li><li><i style="background:var(--mk-u)"></i>몰랐음</li></ul></section>';
  h += '<section class="block"><div class="block-h"><h2>앞으로 7일 복습 예정</h2><span class="muted">장</span></div>' +
    '<div class="chart" role="img" aria-label="앞으로 7일 복습 예정 막대 그래프">' + f.map((v, i) => { const px = v ? Math.max(4, Math.round(v / fmax * 100)) : 0; return '<div class="col"><span class="v">' + (v || '') + '</span>' + (v ? '<div class="stack one" style="height:' + px + 'px"></div>' : '<div class="stack nil"></div>') + '<span class="l">' + fl[i] + '</span></div>'; }).join('') + '</div></section>';
  h += '<section class="block"><div class="block-h"><h2>익힌 정도</h2></div>' + masteryBar(c) + '</section>';
  h += memoryCheck(days);
  h += '<section class="block"><h2>요약</h2><dl class="kv"><dt>누적 학습 횟수</dt><dd>' + total + '회</dd><dt>연속 학습</dt><dd>' + streak(now) + '일</dd><dt>최근 7일 학습</dt><dd>' + wn + '장</dd><dt>최근 7일 정답률</dt><dd>' + (wn ? Math.round(wr / wn * 100) + '%' : '–') + '</dd><dt>최근 7일 틀림·몰랐음</dt><dd>' + ww + '회</dd><dt>자주 틀리는 단어</dt><dd>' + c.leech.length + '개</dd></dl></section>';
  return h;
}
function viewSets() {
  if (SETS.length < 1) return '';
  const act = activeSetIds();
  return '<section class="block"><h2>단어장 선택</h2><p class="muted">공부할 단어장을 골라요. 여러 개를 함께 고를 수 있고, 단어장을 바꿔도 학습 기록은 그대로 남아요.</p><ul class="sets">' +
    SETS.map((x) => {
      let total = 0, done = 0;
      ALL.forEach((id) => { if (WORDS.get(id).setId === x.id) { total++; const c = CARDS.get(id); if (c && c.phase !== 'new') done++; } });
      return '<li><label class="setrow"><input type="checkbox" class="setchk" data-set="' + esc(x.id) + '"' + (act && act.has(x.id) ? ' checked' : '') + '><span class="sname">' + esc(x.name) + (x.desc ? '<small>' + esc(x.desc) + '</small>' : '') + '</span><span class="scount">익힌 ' + done + ' / ' + total + '</span></label></li>';
    }).join('') + '</ul></section>';
}
function viewBackup() {
  const npList = NEW_PER_DAY_CHOICES.indexOf(SET.newPerDay) >= 0 ? NEW_PER_DAY_CHOICES : NEW_PER_DAY_CHOICES.concat(SET.newPerDay).sort((a, b) => a - b);
  const np = npList.map((n) => '<option value="' + n + '"' + (SET.newPerDay === n ? ' selected' : '') + '>' + n + '개</option>').join('');
  const dr = Object.keys(DIRS).map((k) => '<option value="' + k + '"' + (SET.dir === k ? ' selected' : '') + '>' + DIRS[k] + '</option>').join('');
  const del = ui.confirmDelete
    ? '<p class="muted">복습 기록, 단어별 학습 상태, 학습 세션 기록이 모두 지워지고 되돌릴 수 없어요. 먼저 파일로 받아 두는 것을 권해요.</p><div class="btnrow"><button class="btn danger" data-act="deleteYes">모두 삭제하기</button><button class="btn" data-act="deleteNo">취소</button></div>'
    : '<button class="btn danger" data-act="deleteAsk">내 학습 기록 삭제</button>';
  return '<section class="block" style="margin-top:0"><h2>학습 설정</h2>' +
    '<label class="field" for="newPerDay"><span>하루 새 단어 수</span><select id="newPerDay">' + np + '</select></label>' +
    '<label class="field" for="dirSel"><span>출제 방향</span><select id="dirSel">' + dr + '</select></label>' +
    (canSpeak() ? '<label class="field" for="autoSel"><span>자동 발음</span><select id="autoSel">' + [['1', '모든 카드'], ['new', '새 단어만'], ['0', '끄기']].map((o) => '<option value="' + o[0] + '"' + ((autoMode() === 'all' && o[0] === '1') || autoMode() === o[0] || (autoMode() === 'off' && o[0] === '0') ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' : '') +
    (canSpeak() ? '<label class="field" for="srcSel"><span>발음 음원</span><select id="srcSel"><option value="dict"' + (audioSrc() === 'dict' ? ' selected' : '') + '>사전 녹음 (권장)</option><option value="tts"' + (audioSrc() === 'tts' ? ' selected' : '') + '>기기 음성</option></select></label><p class="muted small">사전 녹음은 앞부분이 잘리지 않아요. 음원이 없는 단어나 인터넷이 안 될 때는 기기 음성으로 읽어요.</p><div class="btnrow"><button class="btn" data-act="speakTest">발음 확인 (abandon)</button></div><p class="muted small" id="speakInfo" aria-live="polite"></p><label class="field" for="noteSel"><span>재생 방식 표시</span><select id="noteSel"><option value="1"' + (noteOn() ? ' selected' : '') + '>켜기</option><option value="0"' + (noteOn() ? '' : ' selected') + '>끄기</option></select></label>' : '') +
    '<label class="field" for="revealSel"><span>자동 정답 공개</span><select id="revealSel">' + AUTO_REVEAL.map((x) => '<option value="' + x.v + '"' + (autoRevealSec() === x.v ? ' selected' : '') + '>' + x.label + '</option>').join('') + '</select></label>' +
    '<label class="field" for="shuffleSel"><span>새 단어 순서</span><select id="shuffleSel"><option value="1"' + (SET.shuffle ? ' selected' : '') + '>Day 안에서 섞기</option><option value="0"' + (SET.shuffle ? '' : ' selected') + '>단어장 순서 그대로</option></select></label>' +
    '<label class="field" for="capSel"><span>하루 복습 상한</span><select id="capSel">' + CAP_CHOICES.map((n) => '<option value="' + n + '"' + (SET.cap === n ? ' selected' : '') + '>' + (n ? n + '번' : '제한 없음') + '</option>').join('') + '</select></label>' +
    '<label class="field" for="scaleSel"><span>기억 강도</span><select id="scaleSel">' + STRENGTH.map((x) => '<option value="' + x.scale + '"' + (Math.abs(SET.scale - x.scale) < 0.01 ? ' selected' : '') + '>' + x.label + '</option>').join('') + '</select></label>' +
    '<p class="muted small">복습 간격을 얼마나 촘촘하게 할지 정해요. <b>강화</b>는 표준보다 복습이 약 9% 늘고, 잊어버리는 단어가 절반쯤으로 줄어요. <b>최대</b>는 복습이 약 18% 늘어요. (모의 실험 기준이라, 아래 \'기억 점검\'에서 내 실제 기억률을 확인해 보세요.)</p>' +
    '<p class="muted small">오늘 예정된 복습이 많으면, 하루 복습이 이 정도를 넘지 않게 새 단어를 자동으로 줄여요. 예정된 복습은 줄이지 않고, 새 단어를 천천히 넣어도 기억률은 거의 같아요.</p></section>' + viewSets() +
    '<section class="block"><h2>내 기록 받기</h2><p class="muted">학습 기록은 내 계정에 저장돼요. 파일로도 받아 둘 수 있어요.</p>' +
    '<div class="btnrow"><button class="btn" data-act="exportJson">학습 상태 (JSON)</button><button class="btn" data-act="exportLog">복습 로그 (CSV)</button></div>' +
    '<div class="btnrow"><button class="btn" data-act="exportCsv">단어 목록 (CSV)</button><label class="btn" for="imp">이전 백업 가져오기</label></div>' +
    '<input id="imp" type="file" accept=".json,application/json" hidden></section>' +
    '<section class="block"><h2>계정</h2><p class="muted">' + esc((USER && S.displayId(USER.email)) || '로그인됨') + '</p>' +
    '<button class="btn" data-act="logout">로그아웃</button>' + del + '</section>' +
    '<p class="muted" style="margin-top:22px;font-size:12px">버전 ' + APP_VERSION + '</p>';
}

function render() {
  const app = $('#app'), now = Date.now();
  const stage = ui.stage;
  const consent = stage === 'ready' && USER && !SET.consentedAt && !ui.loadError;
  const showNav = stage === 'ready' && !ui.loadError && !consent;
  document.body.classList.toggle('is-study', ui.route === 'study' && showNav);
  document.body.classList.toggle('no-nav', !showNav);
  $('#date').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  document.querySelectorAll('.tab').forEach((t) => { if (t.getAttribute('data-r') === ui.route) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  let html;
  if (stage === 'noconfig') html = viewNoConfig();
  else if (stage === 'login') html = viewLogin();
  else if (stage === 'boot' || stage === 'loading') html = viewLoading();
  else if (ui.loadError) html = viewLoadError();
  else if (consent) html = viewConsent();
  else if (ui.route === 'backup') html = viewBackup();
  else if (!ORDER.length) html = viewNoWords();
  else if (ui.route === 'study') { if (!ui.session) startSession(ui.nextMode); html = viewStudy(); }
  else if (ui.route === 'words') html = viewWords();
  else if (ui.route === 'stats') html = viewStats();
  else html = viewHome();
  app.innerHTML = html;
  const dockHtml = showNav && ORDER.length ? viewDock() : '';
  $('#dockin').innerHTML = dockHtml;
  $('#dock').hidden = !dockHtml;
  const wi = ui.route === 'study' ? $('#wans') : null;
  if (wi) { wi.focus({ preventScroll: true }); try { wi.setSelectionRange(wi.value.length, wi.value.length); } catch (e) { /* 무시 */ } }
  updateSync();
}
function onRoute() {
  const h = (location.hash || '#home').slice(1);
  const r = ROUTES.indexOf(h) >= 0 ? h : 'home';
  if (r !== 'study') keepAlive(false);
  if (r !== 'study' || ui.route !== 'study') ui.session = null;
  ui.route = r; ui.confirmDelete = false;
  render(); window.scrollTo(0, 0);
}
function go(r, mode) {
  ui.nextMode = mode || 'daily';
  if (location.hash === '#' + r) { if (r === 'study') ui.session = null; onRoute(); } else location.hash = r;
}

/* ---------- 파일 내보내기 / 가져오기 ---------- */
function saveFile(name, text, type) {
  const b = new Blob([text], { type }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function csvCell(v) {
  if (v && typeof v === 'object') v = JSON.stringify(v);
  v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows) { return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'); }
function exportJson() {
  saveFile('voca-backup-' + ymd(Date.now()) + '.json', JSON.stringify({ app: 'voca-srs', version: 2, exportedAt: new Date().toISOString(), settings: SET, cards: Object.fromEntries(CARDS) }), 'application/json');
  toast('학습 상태 파일을 저장했어요.');
}
function exportWords() {
  const rows = [['id', 'en', 'ipa', 'ko', 'pos', 'example', 'example_ko', 'synonyms']];
  ORDER.forEach((id) => { const w = WORDS.get(id); rows.push([id, w.en, w.ipa, w.ko, w.pos, w.ex, w.exKo, (w.syn || []).map((s) => s.w).join('; ')]); });
  saveFile('voca-words-' + ymd(Date.now()) + '.csv', toCsv(rows), 'text/csv');
}
async function exportLog() {
  toast('복습 로그를 모으는 중이에요.');
  try {
    const data = await S.fetchMyLog(USER.id);
    if (!data.length) { toast('아직 복습 기록이 없어요.'); return; }
    const cols = Object.keys(data[0]).filter((k) => k !== 'user_id');
    saveFile('voca-review-log-' + ymd(Date.now()) + '.csv', toCsv([cols].concat(data.map((r) => cols.map((k) => r[k])))), 'text/csv');
    toast('복습 로그 ' + data.length + '줄을 저장했어요.');
  } catch (e) { toast('복습 로그를 가져오지 못했어요. 연결을 확인해 주세요.'); }
}
function cleanCard(c) {
  const o = blank();
  if (['new', 'learn', 'review'].indexOf(c.phase) >= 0) o.phase = c.phase;
  ['ease', 'ivl', 'step', 'reps', 'lapses', 'pend', 'due', 'last', 'first', 'n'].forEach((k) => { if (typeof c[k] === 'number' && isFinite(c[k])) o[k] = c[k]; });
  o.ease = Math.min(3, Math.max(1.3, o.ease));
  o.hist = Array.isArray(c.hist) ? c.hist.filter((x) => Array.isArray(x) && typeof x[0] === 'number' && /^[wcrku]$/.test(x[1])).slice(-24) : [];
  return o;
}
async function importBackup(file) {
  let o;
  try { o = JSON.parse(await file.text()); } catch (e) { toast('파일을 읽지 못했어요.'); return; }
  if (!o || o.app !== 'voca-srs' || !o.cards || typeof o.cards !== 'object') { toast('이 앱의 백업 파일이 아니에요.'); return; }
  let n = 0;
  Object.keys(o.cards).forEach((id) => {
    const c = o.cards[id], cur = CARDS.get(id);
    if (!WORDS.has(id) || !c || typeof c !== 'object') return;
    if (!cur || (c.last || 0) > (cur.last || 0)) { const cc = cleanCard(c); CARDS.set(id, cc); S.queueCard(USER.id, id, cc); n++; }
  });
  scheduleFlush(0); render();
  toast(n ? '학습 상태 ' + n + '개를 불러왔어요.' : '새로 불러올 기록이 없었어요.');
}
async function deleteMine() {
  try {
    await S.deleteMyData(USER.id);
    S.clearOutbox(); CARDS = new Map(); DAILY = new Map(); ui.session = null; ui.confirmDelete = false;
    persistCache(); render(); toast('내 학습 기록을 모두 삭제했어요.');
  } catch (e) { toast('삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'); }
}

/* ---------- 아이디/비밀번호 로그인 ---------- */
let authBusy = false;
async function doAuth(isSignup) {
  if (authBusy) return;   // 버튼을 여러 번 눌러도 한 번만 요청해요
  const id = S.normId(document.getElementById('uid').value);
  const pw = document.getElementById('upw').value;
  const say = (m) => { ui.loginMsg = m; const el = document.getElementById('loginmsg'); if (el) el.textContent = m; };
  if (!S.validId(id)) return say('아이디는 영문 소문자, 숫자, . _ - 로 3~20자예요. (점은 맨 앞·맨 뒤나 연달아 쓸 수 없어요)');
  if (pw.length < 6) return say('비밀번호는 6자 이상이어야 해요.');
  say(isSignup ? '가입하는 중이에요…' : '로그인하는 중이에요…');
  authBusy = true;
  try {
    const r = isSignup ? await S.signUpId(id, pw) : await S.signInId(id, pw);
    if (r.error) {
      const m = (r.error.message || '').toLowerCase();
      if (m.includes('already')) say('이미 있는 아이디예요. 로그인을 눌러 주세요.');
      else if (m.includes('invalid login')) say('아이디나 비밀번호가 맞지 않아요. 처음이라면 가입하기를 눌러 주세요.');
      else if (m.includes('confirm')) say('가입은 됐지만 이메일 확인 설정이 켜져 있어요. README 2단계를 확인해 주세요.');
      else say('잠시 후 다시 시도해 주세요. (' + r.error.message + ')');
      return;
    }
    if (isSignup && !r.data.session) say('가입은 됐지만 이메일 확인 설정이 켜져 있어요. README 2단계를 확인해 주세요.');
  } catch (e) { say('연결을 확인하고 다시 시도해 주세요.'); }
  finally { authBusy = false; }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && (e.target.id === 'uid' || e.target.id === 'upw')) doAuth(false);
});

/* ---------- 이벤트 ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.getAttribute('data-act');
  if (a === 'go') go(b.getAttribute('data-r'));
  else if (a === 'start') { warmUp(); keepAlive(true); go('study', 'daily'); }
  else if (a === 'leech') go('study', 'leech');
  else if (a === 'quiz') { { const q = b.getAttribute('data-q'); ui.quiz = q === 'write' || q === 'mix' ? q : 'read'; } try { localStorage.setItem('voca.quiz', ui.quiz); } catch (e) { /* 무시 */ } render(); }
  else if (a === 'speakTest') { audioCtx(); speak('abandon'); setTimeout(() => { const el = $('#speakInfo'); if (el) el.textContent = '방금 재생: ' + (lastSpeak || '재생하지 못했어요'); }, 1800); }
  else if (a === 'undo') undo();
  else if (a === 'wCheck') wCheck();
  else if (a === 'wUnknown') wFinish('unknown', true);
  else if (a === 'wKnown') wFinish('known', false);
  else if (a === 'wNext') wNext();
  else if (a === 'reveal') reveal();
  else if (a === 'rate') rate(b.getAttribute('data-r'));
  else if (a === 'speak') { const w = WORDS.get(ui.cur); if (w) { ui.speaks++; speak(w.en); } }
  else if (a === 'filter') { ui.filter = b.getAttribute('data-f'); render(); }
  else if (a === 'login') doAuth(false);
  else if (a === 'signup') doAuth(true);
  else if (a === 'logout') { S.signOut(); }
  else if (a === 'consent') { SET.consentedAt = Date.now(); queueSettingsRow(); render(); }
  else if (a === 'retry') { startLoad(); }
  else if (a === 'exportJson') exportJson();
  else if (a === 'exportLog') exportLog();
  else if (a === 'exportCsv') exportWords();
  else if (a === 'deleteAsk') { ui.confirmDelete = true; render(); }
  else if (a === 'deleteNo') { ui.confirmDelete = false; render(); }
  else if (a === 'deleteYes') deleteMine();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'wans') { const v = e.target.value.replace(/[^A-Za-z]/g, ''); if (v !== e.target.value) e.target.value = v; ui.wtext = v; const w = WORDS.get(ui.cur), pt = $('#pat'); if (w && pt) { const inf = writeInfo(w); if (inf) pt.innerHTML = patternHtml(inf, null, v); } return; }
  if (e.target.id === 'q') { ui.q = e.target.value; const l = $('#wlist'); if (l) l.innerHTML = wordRows(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'newPerDay') { SET.newPerDay = +t.value; queueSettingsRow(); toast('하루 새 단어 수를 바꿨어요.'); }
  else if (t.classList && t.classList.contains('setchk')) {
    const checked = Array.prototype.map.call(document.querySelectorAll('.setchk:checked'), (el) => el.getAttribute('data-set'));
    if (!checked.length) { t.checked = true; toast('단어장을 하나 이상 골라 주세요.'); return; }
    SET.sets = checked.length === SETS.length ? null : checked;   // 전부 고르면 '전체'로 두어, 나중에 추가되는 단어장도 자동으로 포함돼요
    rebuildOrder(); ui.session = null; ui.backlog = null; queueSettingsRow(); persistCache(); render(); toast('단어장을 바꿨어요.');
  }
  else if (t.id === 'dirSel') { SET.dir = t.value; queueSettingsRow(); toast('출제 방향을 바꿨어요.'); }
  else if (t.id === 'autoSel') { try { localStorage.setItem('voca.autospeak', t.value); } catch (e) { /* 무시 */ } if (t.value !== '0') warmUp(); toast(t.value === '1' ? '영어 단어가 나올 때마다 발음을 들려줄게요. (쓰기 퀴즈는 정답을 확인하면)' : (t.value === 'new' ? '새 단어가 나올 때만 발음을 들려줄게요.' : '자동 발음을 껐어요.')); }
  else if (t.id === 'noteSel') { try { localStorage.setItem('voca.speaknote', t.value); } catch (e) { /* 무시 */ } toast(t.value === '1' ? '스피커 버튼 아래에 재생 방식을 작게 보여 줄게요.' : '재생 방식 표시를 껐어요.'); }
  else if (t.id === 'srcSel') { try { localStorage.setItem('voca.audiosrc', t.value); } catch (e) { /* 무시 */ } toast(t.value === 'dict' ? '사전에 녹음된 발음을 쓸게요.' : '기기 음성으로 읽을게요.'); }
  else if (t.id === 'revealSel') { try { localStorage.setItem('voca.autoreveal', t.value); } catch (e) { /* 무시 */ } toast(+t.value ? t.value + '초가 지나면 정답을 자동으로 보여 줄게요.' : '자동 정답 공개를 껐어요.'); }
  else if (t.id === 'scaleSel') { SET.scale = +t.value; queueSettingsRow(); persistCache(); render(); toast('기억 강도를 바꿨어요. 앞으로 복습하는 단어부터 적용돼요.'); }
  else if (t.id === 'capSel') { SET.cap = +t.value; ui.backlog = null; queueSettingsRow(); persistCache(); render(); toast(SET.cap ? '하루 복습 상한을 ' + SET.cap + '번으로 바꿨어요.' : '하루 복습 상한을 없앴어요.'); }
  else if (t.id === 'shuffleSel') { SET.shuffle = t.value === '1'; buildStudyOrder(); queueSettingsRow(); persistCache(); toast(SET.shuffle ? '새 단어를 Day 안에서 섞어서 보여 줄게요.' : '새 단어를 단어장 순서대로 보여 줄게요.'); }
  else if (t.id === 'imp' && t.files && t.files[0]) { importBackup(t.files[0]); t.value = ''; }
});
document.addEventListener('keydown', (e) => {
  if (ui.route !== 'study' || !ui.cur || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target, tag = t && t.tagName;
  if (ui.curQuiz === 'write') {
    if (ui.held) { if ((e.key === 'Enter' || e.key === ' ') && tag !== 'BUTTON') { e.preventDefault(); wNext(); } }
    else if (t && t.id === 'wans' && e.key === 'Enter') { e.preventDefault(); wCheck(); }
    return;
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!ui.revealed) { if ((e.key === ' ' || e.key === 'Enter') && tag !== 'BUTTON') { e.preventDefault(); reveal(); } }
  else { const m = { '1': 'unknown', '2': 'wrong', '3': 'close', '4': 'right', '5': 'known' }; if (m[e.key]) { e.preventDefault(); rate(m[e.key]); } }
});
// 모바일 키보드가 올라오면 하단 버튼 줄을 키보드 바로 위로 올려요 (키보드 높이 = 화면 높이 - 보이는 영역 높이)
function syncKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  const open = kb > 80;
  document.documentElement.style.setProperty('--kb', open ? kb + 'px' : '0px');
  document.body.classList.toggle('kb-open', open);
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', syncKeyboard); window.visualViewport.addEventListener('scroll', syncKeyboard); }
document.addEventListener('focusout', () => setTimeout(syncKeyboard, 100));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ui.hidden = true; persistCache(); keepAlive(false); return; }
  if (ui.route === 'study') keepAlive(true);
  if (USER) scheduleFlush(0);
  if (Date.now() - BOOT_AT > 6 * 3600 * 1000 && ui.route !== 'study') location.reload();   // 오래 켜 둔 앱은 새 버전을 받도록 다시 불러와요
});
window.addEventListener('online', () => { ui.offline = false; if (USER) scheduleFlush(0); updateSync(); });
window.addEventListener('offline', updateSync);
window.addEventListener('hashchange', onRoute);
setInterval(() => {
  if (!USER) return;
  if (S.pendingCount() > 0) scheduleFlush(0);
  if (document.hidden) return;
  if (ui.stage === 'ready' && ui.route === 'home') render();
}, 30000);

(function () { const h = (location.hash || '#home').slice(1); ui.route = ROUTES.indexOf(h) >= 0 ? h : 'home'; })();
boot();
