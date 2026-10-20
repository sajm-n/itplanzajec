/* Service worker: aplikacja działa offline. Sieć ma pierwszeństwo, więc nowe wersje trafiają
   do telefonu przy najbliższym otwarciu z internetem; pamięć podręczna jest tylko zapasem. */
const V = "plan-v7";
const SHELL = ["./", "./index.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return caches.open(V).then(cache => {
    const net = fetch(req, { cache: "no-cache" }).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000));
    return Promise.race([net, timeout]).catch(() =>
      cache.match(req, { ignoreSearch: true }).then(hit => hit || cache.match("./index.html")).then(hit => hit || net)
    );
  });
}

function staleWhileRevalidate(req) {
  return caches.open(V).then(cache =>
    cache.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(staleWhileRevalidate(req));
  }
});

/* Powiadomienie push (wysyłane przez GitHub Actions, także gdy aplikacja jest zamknięta) */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "eStudia", {
    body: d.body || "",
    tag: d.tag || undefined,
    lang: "pl",
    icon: "icon.png",
    badge: "icon.png",
    data: { url: d.url || "./" }
  }));
});

/* Stuknięcie w powiadomienie otwiera aplikację */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});
