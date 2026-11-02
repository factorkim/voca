import './style.css';
import { MIN, DAY, LEECH, startOfDay, blank, schedule, fmtDue } from './sched.js';
import * as S from './store.js';

const APP_VERSION = '0.1.0';
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const ROUTES = ['home', 'study', 'words', 'stats', 'backup'];
const DIRS = { en2ko: '영어 → 한국어', ko2en: '한국어 → 영어', mix: '섞어서' };
const PHASE_LABEL = { new: '새 단어', learn: '학습 중', young: '익히는 중', mature: '익숙함' };
const HLAB = { w: '틀', c: '비', r: '맞' };
const BOOT_AT = Date.now();

let USER = null;
let WORDS = new Map(), ORDER = [], CARDS = new Map(), DAILY = new Map();
let SET = { newPerDay: 10, dir: 'en2ko', consentedAt: null };
const ui = {
  route: 'home', stage: 'boot', offline: false, loadError: false,
  session: null, revealed: false, cur: null, curDir: 'en2ko', waiting: null,
  filter: 'all', q: '', nextMode: 'daily', confirmDelete: false,
  shownAt: 0, revealedAt: 0, hidden: false, speaks: 0
};

/* ---------- 날짜 도우미 ---------- */
function ymd(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayKey(off, now) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + off); return ymd(d.getTime()); }
function todayLog(now) { return Object.assign({ n: 0, w: 0, c: 0, r: 0, nw: 0 }, DAILY.get(ymd(now)) || {}); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }
function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
function deviceInfo() {
  return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1, standalone: isStandalone(), lang: navigator.language, touch: navigator.maxTouchPoints > 0, ua: navigator.userAgent.slice(0, 180) };
}

/* ---------- 데이터 적용 / 캐시 ---------- */
function resetData() { WORDS = new Map(); ORDER = []; CARDS = new Map(); DAILY = new Map(); SET = { newPerDay: 10, dir: 'en2ko', consentedAt: null }; ui.session = null; }
function applyData(d) {
  WORDS = new Map(d.words.map((w) => [w.id, w]));
  ORDER = d.words.map((w) => w.id);
  const m = new Map(Object.entries(d.cards || {}));
  const po = S.pendingCards();
  Object.keys(po).forEach((k) => m.set(k, S.rowToCard(po[k])));   // 아직 서버에 못 보낸 내 기록이 항상 최신이에요
  CARDS = m;
  const dm = new Map(Object.entries(d.daily || {}));
  const pl = S.pendingLogDates();
  Object.keys(pl).forEach((k) => {
    const base = Object.assign({ n: 0, w: 0, c: 0, r: 0, nw: 0 }, dm.get(k) || {});
    ['n', 'w', 'c', 'r', 'nw'].forEach((f) => { base[f] += pl[k][f]; });
    dm.set(k, base);
  });
  DAILY = dm;
  if (d.settings) SET = Object.assign({ consentedAt: null }, d.settings);
  const ps = S.pendingSettings();
  if (ps) SET = { newPerDay: ps.new_per_day, dir: ps.direction, consentedAt: ps.consented_at ? Date.parse(ps.consented_at) : null };
}
function persistCache() {
  if (!USER) return;
  S.writeCache(USER.id, { words: ORDER.map((id) => WORDS.get(id)), cards: Object.fromEntries(CARDS), daily: Object.fromEntries(DAILY), settings: SET });
}
function queueSettingsRow() {
  S.queueSettings({ user_id: USER.id, new_per_day: SET.newPerDay, direction: SET.dir, consented_at: SET.consentedAt ? new Date(SET.consentedAt).toISOString() : null, updated_at: new Date().toISOString() });
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
  const used = todayLog(now).nw || 0;
  const newAvail = Math.min(n.new, Math.max(0, SET.newPerDay - used));
  return { n, dueReview, dueLearn, soon, leech, newAvail, total: ORDER.length, left: dueReview + dueLearn + newAvail };
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
    a.push({ l: DAILY.get(ymd(d.getTime())) || { n: 0, w: 0, c: 0, r: 0 }, dow: i === 0 ? '오늘' : '일월화수목금토'.charAt(d.getDay()) });
  }
  return a;
}
function nextInfo(now) {
  const f = forecast(now);
  for (let i = 1; i < 7; i++) { if (f[i]) return '다음 복습: ' + (i === 1 ? '내일' : i + '일 뒤') + ' ' + f[i] + '장'; }
  return '';
}

/* ---------- 학습 세션 ---------- */
function byDue(a, b) { return CARDS.get(a).due - CARDS.get(b).due; }
function startSession(mode) {
  ui.session = { id: uuid(), mode: mode || 'daily', startedAt: Date.now(), done: 0, w: 0, c: 0, r: 0, nw: 0, q: null, finished: false, forced: false };
  if (ui.session.mode === 'leech') ui.session.q = counts(Date.now()).leech.slice();
  pick();
}
function resetTimers() { ui.shownAt = performance.now(); ui.revealedAt = 0; ui.hidden = false; ui.speaks = 0; }
function pick() {
  const s = ui.session, now = Date.now();
  ui.revealed = false; ui.waiting = null; ui.cur = null;
  ui.curDir = SET.dir === 'mix' ? (Math.random() < 0.5 ? 'en2ko' : 'ko2en') : SET.dir;
  resetTimers();
  if (s.mode === 'leech') {
    while (s.q.length && !WORDS.has(s.q[0])) s.q.shift();
    if (s.q.length) ui.cur = s.q.shift(); else s.finished = true;
    return;
  }
  const learn = [], rev = [], news = []; let wait = null;
  ORDER.forEach((id) => {
    const c = CARDS.get(id);
    if (!c || c.phase === 'new') { news.push(id); return; }
    if (c.due <= now) { (c.phase === 'learn' ? learn : rev).push(id); }
    else if (c.phase === 'learn' && c.due - now <= 30 * MIN) { if (!wait || c.due < CARDS.get(wait).due) wait = id; }
  });
  learn.sort(byDue); rev.sort(byDue);
  const limit = Math.max(0, SET.newPerDay - (todayLog(now).nw || 0));
  if (learn.length) { ui.cur = learn[0]; return; }
  if (rev.length) { ui.cur = rev[0]; return; }
  if (news.length && limit > 0) { ui.cur = news[0]; return; }
  if (wait) { if (s.forced) { ui.cur = wait; s.forced = false; } else ui.waiting = wait; return; }
  s.finished = true;
}
function reveal() { if (ui.cur && !ui.revealed) { ui.revealed = true; ui.revealedAt = performance.now(); render(); } }
function rate(r) {
  const id = ui.cur; if (!id || !ui.revealed || !ui.session) return;
  const t = Date.now(), perf = performance.now(), s = ui.session;
  const prev = CARDS.get(id), wasNew = !prev || prev.phase === 'new', p = prev || blank();
  const left = counts(t).left;
  const next = schedule(prev, r, t);
  CARDS.set(id, next);
  S.queueCard(USER.id, id, next);

  const iso = (x) => (x ? new Date(x).toISOString() : null);
  S.queueLog({
    user_id: USER.id, client_id: uuid(), word_id: id, reviewed_at: iso(t), local_date: ymd(t), local_hour: new Date(t).getHours(),
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

  s.done++; s[r.charAt(0)]++; if (wasNew) s.nw++;
  S.queueSession({
    id: s.id, user_id: USER.id, started_at: iso(s.startedAt), last_activity_at: iso(t), mode: s.mode, cards_done: s.done,
    n_wrong: s.w, n_close: s.c, n_right: s.r, n_new: s.nw, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, device: deviceInfo(), app_version: APP_VERSION
  });
  const k = ymd(t), dd = Object.assign({ n: 0, w: 0, c: 0, r: 0, nw: 0 }, DAILY.get(k));
  dd.n++; dd[r.charAt(0)]++; if (wasNew) dd.nw++; DAILY.set(k, dd);

  scheduleFlush();
  pick(); render();
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) { /* 무시 */ }
}

/* ---------- 화면 ---------- */
const SPEAKER = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
function speakBtn() { return ('speechSynthesis' in window) ? '<button class="speak" data-act="speak" aria-label="발음 듣기" title="발음 듣기">' + SPEAKER + '</button>' : ''; }

function viewLoading() { return '<div class="state"><div class="spin" aria-hidden="true"></div><p>단어와 학습 기록을 불러오는 중이에요.</p></div>'; }
function viewNoConfig() {
  return '<div class="state"><h2>앱 설정이 아직 끝나지 않았어요</h2><p>배포할 때 환경 변수 VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 를 넣어야 해요. README의 3단계를 확인해 주세요.</p></div>';
}
function viewLoadError() {
  return '<div class="state"><h2>불러오지 못했어요</h2><p>인터넷 연결을 확인하고 다시 시도해 주세요.</p><button class="btn primary" data-act="retry">다시 시도</button></div>';
}
function viewLogin() {
  return '<section class="hello"><h1>단어 복습장</h1><p>맞힌 정도에 따라 복습 간격을 조절해서, 잊어버릴 때쯤 다시 보여 주는 영어 단어 암기 앱이에요.</p>' +
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
  const week = lastDays(7, now); let wn = 0, wr = 0; week.forEach((d) => { wn += d.l.n || 0; wr += d.l.r || 0; });
  const can = c.left > 0 || c.soon > 0;
  const info = c.left > 0 ? '' : (c.soon > 0 ? '곧 볼 카드가 ' + c.soon + '개 있어요.' : (nextInfo(now) || '오늘 분량을 모두 마쳤어요.'));
  let h = '<section class="hero"><p class="eyebrow">오늘 남은 카드</p><p class="big">' + c.left + '</p>' +
    '<dl class="trio"><div><dt>복습</dt><dd>' + c.dueReview + '</dd></div><div><dt>학습 중</dt><dd>' + c.dueLearn + '</dd></div><div><dt>새 단어</dt><dd>' + c.newAvail + '</dd></div></dl>' +
    '<button class="btn primary block" data-act="start"' + (can ? '' : ' disabled') + '>' + (c.left > 0 ? '학습 시작' : (c.soon > 0 ? '곧 볼 카드 시작' : '오늘은 끝났어요')) + '</button>' +
    (info ? '<p class="after">' + esc(info) + '</p>' : '') + '</section>';
  h += '<div class="strip"><div><b>' + streak(now) + '일</b><span>연속 학습</span></div><div><b>' + (t.n || 0) + '장</b><span>오늘 학습</span></div><div><b>' + (wn ? Math.round(wr / wn * 100) + '%' : '–') + '</b><span>최근 7일 정답률</span></div></div>';
  h += '<section class="block"><div class="block-h"><h2>익힌 정도</h2><span class="muted">단어 ' + c.total + '개</span></div>' + masteryBar(c) + '</section>';
  if (c.leech.length) {
    h += '<section class="block"><div class="block-h"><h2>자주 틀리는 단어</h2><span class="muted">' + c.leech.length + '개</span></div><ul class="mini">' +
      c.leech.slice(0, 5).map((id) => { const w = WORDS.get(id); return '<li><span class="serif">' + esc(w.en) + '</span><span class="k">' + esc(w.ko) + '</span><span class="n">틀림 ' + CARDS.get(id).lapses + '</span></li>'; }).join('') +
      '</ul><button class="btn block" data-act="leech">이 단어만 집중 복습</button></section>';
  }
  const sn = sampleNote();
  return h + (sn ? sn.replace('<p class="note">', '<p class="note" style="margin-top:22px">') : '');
}

function viewStudy() {
  const s = ui.session; if (!s) return viewLoading();
  const now = Date.now();
  const left = s.mode === 'leech' ? (s.q.length + (ui.cur ? 1 : 0)) : counts(now).left;
  const bar = '<div class="studybar"><button class="btn ghost" data-act="go" data-r="home">← 나가기</button><span class="prog">오늘 ' + s.done + '장 · 남은 ' + left + '장</span></div>';
  if (ui.waiting) {
    const c = CARDS.get(ui.waiting);
    return bar + '<div class="state"><h2>잠깐 쉬어 가요</h2><p>다음 카드는 ' + esc(fmtDue(c, now)) + '에 나와요.</p><button class="btn primary" data-act="now">지금 바로 보기</button></div>';
  }
  if (!ui.cur) {
    const tot = s.w + s.c + s.r;
    return bar + '<div class="state"><h2>' + (tot ? '수고했어요' : '지금 볼 카드가 없어요') + '</h2>' +
      (tot ? '<p>' + tot + '장을 학습했어요. 정답률 ' + Math.round(s.r / tot * 100) + '%</p><div class="sum"><div class="w"><b>' + s.w + '</b><span>틀렸습니다</span></div><div class="c"><b>' + s.c + '</b><span>비슷합니다</span></div><div class="r"><b>' + s.r + '</b><span>맞았습니다</span></div></div>' : '<p>' + (nextInfo(now) || '새 카드가 생기면 다시 알려 드릴게요.') + '</p>') +
      '<button class="btn primary block" data-act="go" data-r="home" style="margin-top:8px">홈으로</button></div>';
  }
  const w = WORDS.get(ui.cur), c = CARDS.get(ui.cur) || blank(), e2k = ui.curDir === 'en2ko', b = bucket(c);
  const tags = '<div class="tags"><span class="tag">' + (b === 'new' ? '새 단어' : (b === 'learn' ? '학습 중' : '복습')) + '</span>' + ((c.lapses || 0) >= LEECH ? '<span class="tag warn">자주 틀림 · ' + c.lapses + '회</span>' : '') + '</div>';
  let front = e2k ? '<h1 class="head">' + esc(w.en) + '</h1>' : '<h1 class="head-ko">' + esc(w.ko) + '</h1>';
  front += w.pos ? '<p class="pos">' + esc(w.pos) + '</p>' : '';
  if (e2k) front += speakBtn();
  let ans = '';
  if (ui.revealed) {
    ans = '<div class="answer">' + (e2k ? '<p class="ans-ko">' + esc(w.ko) + '</p>' : '<div><p class="ans-en">' + esc(w.en) + '</p>' + speakBtn() + '</div>');
    if (w.ex) ans += '<div><p class="ex">' + esc(w.ex) + '</p>' + (w.exKo ? '<p class="ex-ko">' + esc(w.exKo) + '</p>' : '') + '</div>';
    if (w.syn && w.syn.length) ans += '<ul class="syn">' + w.syn.map((x) => '<li><b>' + esc(x.w) + '</b><span>' + esc(x.n || '') + '</span></li>').join('') + '</ul>';
    if (c.hist && c.hist.length) ans += '<div class="hist"><span>최근 기록</span>' + c.hist.slice(-8).map((x) => '<i class="' + esc(x[1]) + '">' + esc(HLAB[x[1]] || '') + '</i>').join('') + '</div>';
    if (w.ai) ans += '<p class="ai">예문과 유의어는 AI가 만들었어요.</p>';
    ans += '</div>';
  }
  return bar + '<section class="card">' + tags + front + ans + '</section>';
}
function viewDock() {
  if (ui.route !== 'study' || !ui.session || !ui.cur || ui.waiting) return '';
  if (!ui.revealed) return '<button class="btn primary block" data-act="reveal">정답 보기</button><p class="keys">스페이스 키로도 볼 수 있어요</p>';
  const now = Date.now(), c = CARDS.get(ui.cur) || blank();
  const defs = [['wrong', '틀렸습니다'], ['close', '비슷합니다'], ['right', '맞았습니다']];
  return '<div class="rates">' + defs.map((d) => '<button class="rate ' + d[0] + '" data-act="rate" data-r="' + d[0] + '"><span class="rl">' + d[1] + '</span><span class="rv">' + esc(fmtDue(schedule(c, d[0], now), now)) + '</span></button>').join('') + '</div><p class="keys">키보드 1 · 2 · 3</p>';
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
    return '<details class="row"><summary><span class="r-en serif">' + esc(w.en) + '</span><span class="pill ' + b + '">' + PHASE_LABEL[b] + '</span><span class="r-ko">' + (w.pos ? esc(w.pos) + ' · ' : '') + esc(w.ko) + '</span></summary><div class="r-body">' +
      (w.ex ? '<div><p class="ex">' + esc(w.ex) + '</p>' + (w.exKo ? '<p class="ex-ko">' + esc(w.exKo) + '</p>' : '') + '</div>' : '') +
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
    (n ? '<div class="stack" style="height:' + px + 'px"><i class="s-r" style="flex:' + (l.r || 0) + '"></i><i class="s-c" style="flex:' + (l.c || 0) + '"></i><i class="s-w" style="flex:' + (l.w || 0) + '"></i></div>' : '<div class="stack nil"></div>') +
    '<span class="l">' + d.dow + '</span></div>';
}
function viewStats() {
  const now = Date.now(), c = counts(now), days = lastDays(14, now);
  let max = 1; days.forEach((d) => { if ((d.l.n || 0) > max) max = d.l.n; });
  const f = forecast(now); let fmax = 1; f.forEach((v) => { if (v > fmax) fmax = v; });
  const fl = f.map((_, i) => (i === 0 ? '오늘' : i === 1 ? '내일' : '일월화수목금토'.charAt(new Date(now + i * DAY).getDay())));
  let wn = 0, ww = 0, wr = 0; days.slice(7).forEach((d) => { wn += d.l.n || 0; ww += d.l.w || 0; wr += d.l.r || 0; });
  let total = 0; DAILY.forEach((l) => { total += l.n || 0; });
  let h = '<section class="block" style="margin-top:0"><div class="block-h"><h2>최근 14일 학습량</h2><span class="muted">장</span></div>' +
    '<div class="chart" role="img" aria-label="최근 14일 하루 학습량 막대 그래프">' + days.map((d) => stackCol(d, max)).join('') + '</div>' +
    '<ul class="legend"><li><i style="background:var(--mk-r)"></i>맞았습니다</li><li><i style="background:var(--mk-c)"></i>비슷합니다</li><li><i style="background:var(--mk-w)"></i>틀렸습니다</li></ul></section>';
  h += '<section class="block"><div class="block-h"><h2>앞으로 7일 복습 예정</h2><span class="muted">장</span></div>' +
    '<div class="chart" role="img" aria-label="앞으로 7일 복습 예정 막대 그래프">' + f.map((v, i) => { const px = v ? Math.max(4, Math.round(v / fmax * 100)) : 0; return '<div class="col"><span class="v">' + (v || '') + '</span>' + (v ? '<div class="stack one" style="height:' + px + 'px"></div>' : '<div class="stack nil"></div>') + '<span class="l">' + fl[i] + '</span></div>'; }).join('') + '</div></section>';
  h += '<section class="block"><div class="block-h"><h2>익힌 정도</h2></div>' + masteryBar(c) + '</section>';
  h += '<section class="block"><h2>요약</h2><dl class="kv"><dt>누적 학습 횟수</dt><dd>' + total + '회</dd><dt>연속 학습</dt><dd>' + streak(now) + '일</dd><dt>최근 7일 학습</dt><dd>' + wn + '장</dd><dt>최근 7일 정답률</dt><dd>' + (wn ? Math.round(wr / wn * 100) + '%' : '–') + '</dd><dt>최근 7일 틀린 횟수</dt><dd>' + ww + '회</dd><dt>자주 틀리는 단어</dt><dd>' + c.leech.length + '개</dd></dl></section>';
  return h;
}
function viewBackup() {
  const np = [5, 10, 15, 20, 30, 50].map((n) => '<option value="' + n + '"' + (SET.newPerDay === n ? ' selected' : '') + '>' + n + '개</option>').join('');
  const dr = Object.keys(DIRS).map((k) => '<option value="' + k + '"' + (SET.dir === k ? ' selected' : '') + '>' + DIRS[k] + '</option>').join('');
  const del = ui.confirmDelete
    ? '<p class="muted">복습 기록, 단어별 학습 상태, 학습 세션 기록이 모두 지워지고 되돌릴 수 없어요. 먼저 파일로 받아 두는 것을 권해요.</p><div class="btnrow"><button class="btn danger" data-act="deleteYes">모두 삭제하기</button><button class="btn" data-act="deleteNo">취소</button></div>'
    : '<button class="btn danger" data-act="deleteAsk">내 학습 기록 삭제</button>';
  return '<section class="block" style="margin-top:0"><h2>학습 설정</h2>' +
    '<label class="field" for="newPerDay"><span>하루 새 단어 수</span><select id="newPerDay">' + np + '</select></label>' +
    '<label class="field" for="dirSel"><span>출제 방향</span><select id="dirSel">' + dr + '</select></label></section>' +
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
  updateSync();
}
function onRoute() {
  const h = (location.hash || '#home').slice(1);
  const r = ROUTES.indexOf(h) >= 0 ? h : 'home';
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
  const rows = [['id', 'en', 'ko', 'pos', 'example', 'example_ko', 'synonyms']];
  ORDER.forEach((id) => { const w = WORDS.get(id); rows.push([id, w.en, w.ko, w.pos, w.ex, w.exKo, (w.syn || []).map((s) => s.w).join('; ')]); });
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
  o.hist = Array.isArray(c.hist) ? c.hist.filter((x) => Array.isArray(x) && typeof x[0] === 'number' && /^[wcr]$/.test(x[1])).slice(-24) : [];
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
  else if (a === 'start') go('study', 'daily');
  else if (a === 'leech') go('study', 'leech');
  else if (a === 'reveal') reveal();
  else if (a === 'rate') rate(b.getAttribute('data-r'));
  else if (a === 'now') { if (ui.session) { ui.session.forced = true; pick(); render(); } }
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
  if (e.target.id === 'q') { ui.q = e.target.value; const l = $('#wlist'); if (l) l.innerHTML = wordRows(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'newPerDay') { SET.newPerDay = +t.value; queueSettingsRow(); toast('하루 새 단어 수를 바꿨어요.'); }
  else if (t.id === 'dirSel') { SET.dir = t.value; queueSettingsRow(); toast('출제 방향을 바꿨어요.'); }
  else if (t.id === 'imp' && t.files && t.files[0]) { importBackup(t.files[0]); t.value = ''; }
});
document.addEventListener('keydown', (e) => {
  if (ui.route !== 'study' || !ui.cur || ui.waiting || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target, tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!ui.revealed) { if ((e.key === ' ' || e.key === 'Enter') && tag !== 'BUTTON') { e.preventDefault(); reveal(); } }
  else { const m = { '1': 'wrong', '2': 'close', '3': 'right' }; if (m[e.key]) { e.preventDefault(); rate(m[e.key]); } }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ui.hidden = true; persistCache(); return; }
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
  else if (ui.route === 'study' && ui.waiting) { pick(); render(); }
}, 30000);

(function () { const h = (location.hash || '#home').slice(1); ui.route = ROUTES.indexOf(h) >= 0 ? h : 'home'; })();
boot();
