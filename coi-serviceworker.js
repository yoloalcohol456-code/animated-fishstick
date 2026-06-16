/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT + Offline Caching Patches */
let coepCredentialless = false;
const CACHE_NAME = "gba-cloud-offline-cache";

// Helper to inject isolation security headers into any response stream
function injectSecurityHeaders(response) {
    if (response.status === 0) return response;

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
    if (!coepCredentialless) {
        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
    }
    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}

if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) return;
        if (ev.data.type === "deregister") {
            self.registration.unregister().then(() => self.clients.matchAll()).then(clients => {
                clients.forEach((client) => client.navigate(client.url));
            });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;

        // OPTIMIZATION PATCH: Do not intercept or process local blob addresses/non-HTTP protocols 
        // This stops massive memory leaks and crashes when assembling large PSP ISOs via your chunking strategy
        if (!r.url.startsWith('http')) return;

        if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

        event.respondWith(
            caches.match(r).then((cachedResponse) => {
                // Network-first approach with graceful cache fallback for continuous offline gameplay
                return fetch(r)
                    .then((networkResponse) => {
                        if (networkResponse && networkResponse.status === 200) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(r, responseToCache);
                            });
                        }
                        return injectSecurityHeaders(networkResponse);
                    })
                    .catch(() => {
                        if (cachedResponse) {
                            return injectSecurityHeaders(cachedResponse);
                        }
                    });
            })
        );
    });

} else {
    (() => {
        const coi = {
            shouldRegister: () => true,
            shouldDeregister: () => false,
            coepCredentialless: () => false,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        if (n.serviceWorker && n.serviceWorker.controller) {
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: coi.coepCredentialless(),
            });
            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;
        if (!window.isSecureContext) return;
        if (!n.serviceWorker) return;

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                registration.addEventListener("updatefound", () => {
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });
                if (registration.active && !n.serviceWorker.controller) {
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => { !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err); }
        );
    })();
}
