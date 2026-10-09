/**
 * Europa 2026 - Service Worker (Offline Cache-First)
 * ==================================================
 * Garante disponibilidade total de todos os assets, dados e
 * blobs criptografados no modo avião / sem sinal.
 */

const CACHE_NAME = "europa-vault-v2";

const STATIC_ASSETS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/crypto-format.js",
  "js/vault-client.js",
  "js/time.js",
  "manifest.webmanifest",
  "data/public-timeline.json",
  "vault/key-envelope.json",
  "vault/asset-manifest.json",
  "vault/index.enc"
];

// Instalação do Service Worker e pré-cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pré-cacheando casca do aplicativo e cofre...");
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Ativação e limpeza de versões antigas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Removendo cache obsoleto:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estratégia Cache-First com fallback de rede
self.addEventListener("fetch", (event) => {
  // Ignorar requisições não-GET
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Armazenar dinamicamente respostas válidas no cache
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        console.warn("[SW] Falha de rede para:", event.request.url, err);
        return cachedResponse;
      });
    })
  );
});
