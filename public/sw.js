/* Installability only. Recipes and private API responses are never cached offline. */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>event.respondWith(fetch(event.request)));
