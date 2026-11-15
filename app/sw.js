/* Footballs AI 离线缓存 (安装到主屏幕后可离线使用)
   策略: 核心资源网络优先 (在线时拿最新版), 失败回退缓存 (离线可用) */
const CACHE = "footballai-v2";
const ASSETS = [
  "./", "./index.html", "./css/style.css",
  "./js/data.js", "./js/engine.js", "./js/sporttery.js", "./js/ai.js", "./js/oddsapi.js", "./js/app.js", "./js/version.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match("./index.html"))
    )
  );
});
