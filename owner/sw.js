const CACHE_NAME = "owner-inbox-v3";
const ASSETS = [
  "/owner/",
  "/owner/index.html",
  "/owner/styles.css",
  "/owner/app.js",
  "/owner/manifest.json",
  "/assets/img/invizible.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "DJ Invizible";
  const options = {
    body: data.body || "New booking request",
    data: { url: data.url || "/owner/" },
    icon: "/assets/img/invizible.png",
    badge: "/assets/img/invizible.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/owner/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/owner/")) {
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
