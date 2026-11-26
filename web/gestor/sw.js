// Service worker de la app del gestor.
// Guarda la app (no los datos) para que abra aunque no haya señal. Siempre intenta primero la red, así que una versión
// nueva se ve en cuanto hay conexión; la copia guardada solo se usa cuando la red falla.
// El API (/api) nunca se guarda: la última ruta vive en localStorage y las visitas sin enviar, en una cola.

// Al agregar o quitar archivos de la app se sube la versión, para que el teléfono guarde la lista nueva completa.
const CACHE = "qadra-gestor-v2";
const APP = ["/gestor/", "/gestor/gestor.css", "/gestor/gestor.js", "/estilos.css", "/comun.js", "/qr.js", "/reglas.js", "/vendor/qrcode-1.4.4.js", "/marca/icono.svg"];

self.addEventListener("install", (evento) => {
  // Cada archivo se guarda por separado: si uno falla (sin espacio, red a medias), los demás quedan guardados y el
  // service worker se instala de todos modos; lo que falte se guarda la próxima vez que se pida con señal.
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(APP.map((ruta) => cache.add(ruta))))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((llaves) => Promise.all(llaves.filter((l) => l !== CACHE).map((l) => caches.delete(l))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const solicitud = evento.request;
  const url = new URL(solicitud.url);
  if (solicitud.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const esDeLaApp = APP.includes(url.pathname);
  if (!esDeLaApp) return;

  evento.respondWith(
    fetch(solicitud)
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          // La copia se guarda aparte: si no se puede guardar, la respuesta que sí llegó se entrega igual.
          evento.waitUntil(
            caches
              .open(CACHE)
              .then((cache) => cache.put(solicitud, copia))
              .catch(() => {}),
          );
        }
        return respuesta;
      })
      .catch(() => caches.match(solicitud, { ignoreSearch: true }).then((guardada) => guardada ?? Response.error())),
  );
});
