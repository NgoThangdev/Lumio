const CACHE_PREFIX = 'lumio-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const SHELL_FILES = ['/', '/manifest.webmanifest', '/lumio-icon.svg'];

function approvedAppUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password)
      return null;
    if (url.pathname === '/attention') return url.href;
    const household = '/households/[A-Za-z0-9-]+';
    const itemPath = new RegExp(`^${household}/inventory/[A-Za-z0-9-]+/?$`);
    const tripPath = new RegExp(`^${household}/shopping/[A-Za-z0-9-]+/?$`);
    if (!itemPath.test(url.pathname) && !tripPath.test(url.pathname))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  const url = approvedAppUrl(payload?.url);
  if (!url) return;
  const isTrip = new URL(url).pathname.includes('/shopping/');
  event.waitUntil(
    self.registration.showNotification('Lumio', {
      body: isTrip
        ? 'There’s a shopping trip to review.'
        : 'There’s a household item to review.',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = approvedAppUrl(event.notification.data?.url);
  if (!target) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windows) => {
        for (const client of windows) {
          if (new URL(client.url).origin !== self.location.origin) continue;
          if (client.navigate) await client.navigate(target);
          return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});

function versionedAsset(path) {
  const url = new URL(path, self.location.origin);
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith('/assets/') &&
    /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2|svg|png|webp)$/.test(url.pathname)
  );
}

function findVersionedAssets(source) {
  const found = new Set();
  const references = source.match(/\/assets\/[^\s`"'()<>]+/g) ?? [];
  for (const reference of references) {
    const path = reference.replace(/[),;]+$/, '');
    if (versionedAsset(path)) found.add(path);
  }
  return [...found];
}

async function precacheApp() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(SHELL_FILES);
  const shell = await (await fetch('/')).text();
  const htmlAssets = [...shell.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter(versionedAsset);
  const pending = [...new Set(htmlAssets)];
  const cached = new Set();
  while (pending.length) {
    const path = pending.shift();
    if (!path || cached.has(path)) continue;
    cached.add(path);
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not cache app asset ${path}`);
    const source = /\.(?:js|css)$/i.test(
      new URL(path, self.location.origin).pathname,
    )
      ? await response.clone().text()
      : '';
    await cache.put(path, response);
    for (const asset of findVersionedAssets(source)) {
      if (!cached.has(asset)) pending.push(asset);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheApp().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  // Authenticated API data and mutations always go to the network. Never cache or queue them.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  const isNavigation = request.mode === 'navigate';
  const isVersionedAsset = versionedAsset(url.pathname);
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok)
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put('/', response.clone()));
          return response;
        })
        .catch(async () => await caches.match('/')),
    );
    return;
  }
  if (isVersionedAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok)
              void caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});
