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

function openSettingsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lumio-app-settings', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLanguageSetting(setting) {
  const db = await openSettingsDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    transaction.objectStore('settings').put(setting, 'language');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

async function getLanguageSetting() {
  try {
    const db = await openSettingsDb();
    const value = await new Promise((resolve, reject) => {
      const request = db
        .transaction('settings')
        .objectStore('settings')
        .get('language');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (value?.explicit && (value.language === 'en' || value.language === 'vi'))
      return value.language;
  } catch {
    // Use the browser's language when the preference database is unavailable.
  }
  return self.navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (
    data?.type !== 'LUMIO_LANGUAGE' ||
    (data.language !== 'en' && data.language !== 'vi') ||
    typeof data.explicit !== 'boolean'
  )
    return;
  event.waitUntil(
    saveLanguageSetting({ language: data.language, explicit: data.explicit }),
  );
});

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
    getLanguageSetting().then((language) =>
      self.registration.showNotification('Lumio', {
        body:
          language === 'vi'
            ? isTrip
              ? 'C\u00f3 chuy\u1ebfn mua s\u1eafm c\u1ea7n xem l\u1ea1i.'
              : 'C\u00f3 m\u1eb7t h\u00e0ng trong gia \u0111\u00ecnh c\u1ea7n xem l\u1ea1i.'
            : isTrip
              ? 'There is a shopping trip to review.'
              : 'There is a household item to review.',
        data: { url },
      }),
    ),
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
