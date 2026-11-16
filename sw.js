const CACHE = "fura-fura-v8";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  // só os scripts das bibliotecas ficam guardados; APIs (GitHub, Mercado Pago, clima, câmbio) são sempre da internet
  if (u.origin !== self.location.origin && !["cdn.tailwindcss.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"].includes(u.hostname)) return;
  if (/\/(status\?|ping)/.test(req.url)) return;
  const keep = (res) => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } return res; };
  if (req.mode === "navigate" || new URL(req.url).origin === self.location.origin) {
    // página: tenta a internet primeiro (pega atualizações) e usa o cache se estiver sem rede
    e.respondWith(fetch(req, { cache: "no-cache" }).then(keep).catch(() => caches.match(req).then((h) => h || caches.match("./index.html"))));
    return;
  }
  // scripts, ícones etc.: usa o cache primeiro
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
});
