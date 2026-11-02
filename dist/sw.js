// 서비스 워커: 앱 화면을 기기에 저장해서 오프라인에서도 열리게 하고, 새 버전은 다음에 열 때 자동으로 받아요.
// - 화면(HTML)은 항상 인터넷에서 먼저 받고, 안 되면 저장된 것을 보여줘요 => 배포하면 바로 최신 버전이 떠요.
// - 해시가 붙은 스크립트/스타일 파일은 저장된 것을 먼저 쓰고 뒤에서 갱신해요.
// - 데이터베이스(Supabase) 요청은 건드리지 않아요. 같은 출처(origin)의 GET 요청만 처리해요.
const CACHE = 'voca-shell-v1';
const MAX_ENTRIES = 80;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/index.html', res.clone());
        return res;
      } catch (e) {
        const hit = await caches.match('/index.html');
        return hit || new Response('오프라인이에요. 인터넷에 연결한 뒤 다시 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok) { cache.put(req, res.clone()); trim(cache); }
      return res;
    }).catch(() => hit);
    return hit || net;
  })());
});
