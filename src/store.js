// 데이터 계층: Supabase 연동 + 오프라인 보관함(outbox) + 로컬 캐시
import { createClient } from '@supabase/supabase-js';
import { LETTER, DEFAULT_CAP, DEFAULT_SCALE } from './sched.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(URL_ && KEY);
export const sb = configured ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const FAST_MS = 1000;   // 이 시간 안에 답을 확인했으면 '빠른 확인'으로 세요
const iso = (t) => (t ? new Date(t).toISOString() : null);
const ms = (s) => (s ? Date.parse(s) : 0);

/* ---------- 로그인 ---------- */
export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.user : null;
}
export function onAuth(cb) { return sb.auth.onAuthStateChange((ev, sess) => cb(ev, sess ? sess.user : null)); }
// 아이디를 내부용 이메일 형태로 바꿔서 Supabase 이메일/비밀번호 로그인에 씀 (실제 메일은 발송되지 않아요)
const DOMAIN = '@voca-user.com';
export function normId(id) { return String(id || '').trim().toLowerCase(); }
// 점(.)은 맨 앞/맨 뒤에 오거나 연달아 쓰면 이메일 형식이 깨져서 가입이 안 되므로 미리 막아요.
export function validId(id) { return /^[a-z0-9._-]{3,20}$/.test(id) && !/^\.|\.$|\.\./.test(id); }
export function displayId(email) { return email && email.endsWith(DOMAIN) ? email.slice(0, -DOMAIN.length) : (email || ''); }
export function signInId(id, pw) { return sb.auth.signInWithPassword({ email: normId(id) + DOMAIN, password: pw }); }
export function signUpId(id, pw) { return sb.auth.signUp({ email: normId(id) + DOMAIN, password: pw }); }
export function signOut() { return sb.auth.signOut(); }

/* ---------- 변환 ---------- */
export function rowToWord(r) {
  return {
    id: r.id, order: r.ord || 0, en: r.en, ko: r.ko, pos: r.pos || '', ipa: r.ipa || '', setId: r.set_id || '', ex: r.example || '', exKo: r.example_ko || '',
    syn: Array.isArray(r.synonyms) ? r.synonyms : [], src: r.source, ai: !!r.ai_generated, page: r.page
  };
}
export function rowToSet(r) { return { id: r.id, name: r.name, desc: r.description || '', order: r.ord || 0 }; }
export function rowToCard(r) {
  return {
    phase: r.phase, ease: r.ease, ivl: r.ivl, step: r.step, reps: r.reps, lapses: r.lapses, pend: r.pend || 0,
    due: ms(r.due), last: ms(r.last_review), first: ms(r.first_seen_at), n: r.total_reviews || 0,
    hist: Array.isArray(r.hist) ? r.hist : []
  };
}
export function cardToRow(uid, wid, c) {
  return {
    user_id: uid, word_id: wid, phase: c.phase, ease: c.ease, ivl: c.ivl, step: c.step, reps: c.reps, lapses: c.lapses,
    pend: c.pend || 0, due: c.phase === 'new' ? null : iso(c.due), last_review: iso(c.last), first_seen_at: iso(c.first),
    total_reviews: c.n || 0, hist: c.hist || [], updated_at: new Date().toISOString()
  };
}

/* ---------- 읽기 ---------- */
async function fetchAll(make) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await make(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

export async function loadAll(uid, sinceDate) {
  const [words, cards, daily, st, ws] = await Promise.all([
    fetchAll((a, b) => sb.from('words').select('*').order('ord').order('id').range(a, b)),
    fetchAll((a, b) => sb.from('card_state').select('*').eq('user_id', uid).order('word_id').range(a, b)),
    fetchAll((a, b) => sb.from('daily_stats').select('*').eq('user_id', uid).gte('local_date', sinceDate).order('local_date').range(a, b)),
    sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
    sb.from('word_sets').select('*').order('ord').order('id')
  ]);
  if (st.error) throw st.error;
  const sets = ws.error ? [] : ws.data.map(rowToSet);   // 단어장 표가 아직 없으면(마이그레이션 전) 전체를 한 묶음으로 봐요
  const cardMap = {}; cards.forEach((r) => { cardMap[r.word_id] = rowToCard(r); });
  const dailyMap = {}; daily.forEach((r) => { dailyMap[r.local_date] = { n: r.n, w: r.w, c: r.c, r: r.r, u: r.u || 0, k: r.k || 0, nw: r.nw, rn: r.rn || 0, rk: r.rk || 0, fn: r.fn || 0 }; });
  const s = st.data;
  return {
    words: words.map(rowToWord),
    sets,
    cards: cardMap,
    daily: dailyMap,
    settings: s ? { newPerDay: s.new_per_day, dir: s.direction, sets: Array.isArray(s.active_sets) ? s.active_sets : null, shuffle: s.shuffle_new !== false, cap: Number.isFinite(s.daily_cap) ? s.daily_cap : DEFAULT_CAP, scale: Number.isFinite(s.interval_scale) ? s.interval_scale : DEFAULT_SCALE, consentedAt: ms(s.consented_at) || null } : null
  };
}

export async function fetchMyLog(uid) {
  return fetchAll((a, b) => sb.from('review_log').select('*').eq('user_id', uid).order('reviewed_at').range(a, b));
}

export async function deleteMyData(uid) {
  for (const t of ['review_log', 'card_state', 'study_sessions']) {
    const { error } = await sb.from(t).delete().eq('user_id', uid);
    if (error) throw error;
  }
}

/* ---------- 로컬 캐시 (오프라인 시작용) ---------- */
export function readCache(uid) {
  try { return JSON.parse(localStorage.getItem('voca.cache.' + uid) || 'null'); } catch (e) { return null; }
}
export function writeCache(uid, data) {
  try { localStorage.setItem('voca.cache.' + uid, JSON.stringify(data)); localStorage.setItem('voca.lastUid', uid); } catch (e) { /* 용량 초과 등은 무시 */ }
}
export function lastUid() { try { return localStorage.getItem('voca.lastUid'); } catch (e) { return null; } }

/* ---------- 보관함(outbox): 저장 실패나 오프라인이어도 기록이 사라지지 않게 해요 ---------- */
let OUT = { cards: {}, logs: [], sessions: {}, settings: null, dels: [] };
let outUid = null;
let flushing = false;

function persistOut() { try { localStorage.setItem('voca.out.' + outUid, JSON.stringify(OUT)); } catch (e) { /* 무시 */ } }
export function loadOutbox(uid) {
  outUid = uid;
  try { OUT = Object.assign({ cards: {}, logs: [], sessions: {}, settings: null, dels: [] }, JSON.parse(localStorage.getItem('voca.out.' + uid) || '{}')); }
  catch (e) { OUT = { cards: {}, logs: [], sessions: {}, settings: null, dels: [] }; }
}
export function pendingCount() { return Object.keys(OUT.cards).length + OUT.logs.length + Object.keys(OUT.sessions).length + (OUT.settings ? 1 : 0) + OUT.dels.length; }
export function pendingCardIds() { return Object.keys(OUT.cards); }
export function pendingLogDates() {
  const m = {};
  OUT.logs.forEach((l) => { const d = (m[l.local_date] = m[l.local_date] || { n: 0, w: 0, c: 0, r: 0, u: 0, k: 0, nw: 0, rn: 0, rk: 0, fn: 0 }); d.n++; d[LETTER[l.rating]]++; if (l.is_new) d.nw++; if (l.phase_before === 'review') { d.rn++; if (l.rating === 'right' || l.rating === 'known') d.rk++; } if (l.reveal_ms != null && l.reveal_ms < FAST_MS) d.fn++; });
  return m;
}
export function pendingCards() { return OUT.cards; }
export function pendingSettings() { return OUT.settings; }
export function clearOutbox() { OUT = { cards: {}, logs: [], sessions: {}, settings: null, dels: [] }; persistOut(); }
export function queueCard(uid, wid, card) { OUT.cards[wid] = cardToRow(uid, wid, card); persistOut(); }
export function queueLog(row) { OUT.logs.push(row); persistOut(); }
export function queueSession(row) { OUT.sessions[row.id] = row; persistOut(); }
// 되돌리기: 아직 서버에 안 보낸 기록이면 보관함에서 빼고, 이미 보냈다면 삭제 요청을 보관함에 넣어요
export function dropLog(clientId) {
  const n = OUT.logs.length;
  OUT.logs = OUT.logs.filter((l) => l.client_id !== clientId);
  if (OUT.logs.length === n && OUT.dels.indexOf(clientId) < 0) OUT.dels.push(clientId);
  persistOut();
}
export function queueSettings(row) { OUT.settings = row; persistOut(); }

export async function flush() {
  if (flushing || !outUid || !sb || !navigator.onLine) return pendingCount() === 0;
  flushing = true;
  try {
    const snap = { cards: Object.entries(OUT.cards), logs: OUT.logs.slice(), sessions: Object.entries(OUT.sessions), settings: OUT.settings };
    if (snap.settings) {
      const { error } = await sb.from('user_settings').upsert(snap.settings);
      if (error) throw error;
      if (OUT.settings === snap.settings) OUT.settings = null;
    }
    if (snap.cards.length) {
      for (let i = 0; i < snap.cards.length; i += 200) {
        const part = snap.cards.slice(i, i + 200);
        const { error } = await sb.from('card_state').upsert(part.map((e) => e[1]));
        if (error) throw error;
        part.forEach(([k, row]) => { if (OUT.cards[k] === row) delete OUT.cards[k]; });
      }
    }
    if (snap.logs.length) {
      for (let i = 0; i < snap.logs.length; i += 200) {
        const part = snap.logs.slice(i, i + 200);
        const { error } = await sb.from('review_log').upsert(part, { onConflict: 'user_id,client_id', ignoreDuplicates: true });
        if (error) throw error;
        const done = new Set(part.map((l) => l.client_id));
        OUT.logs = OUT.logs.filter((l) => !done.has(l.client_id));
      }
    }
    if (OUT.dels.length) {
      const ids = OUT.dels.slice();
      const { error } = await sb.from('review_log').delete().eq('user_id', outUid).in('client_id', ids);
      if (error) throw error;
      OUT.dels = OUT.dels.filter((x) => ids.indexOf(x) < 0);
    }
    if (snap.sessions.length) {
      const { error } = await sb.from('study_sessions').upsert(snap.sessions.map((e) => e[1]));
      if (error) throw error;
      snap.sessions.forEach(([k, row]) => { if (OUT.sessions[k] === row) delete OUT.sessions[k]; });
    }
    persistOut();
    return pendingCount() === 0;
  } catch (e) {
    persistOut();
    return false;
  } finally {
    flushing = false;
  }
}
