/**
 * Service Worker for Disney World & Disneyland Wait Times Tracker
 * Enables true OS-level lock screen notifications, push alerts, vibration, and background handling.
 */

const CACHE_NAME = 'disney-waits-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle notification click: focus app or open URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window open with the app
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // If not open, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Listen for messages from the main window thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const title = event.data.title || '🏰 Disney Wait Alert';
    const options = event.data.options || {};
    
    self.registration.showNotification(title, {
      body: options.body || '',
      icon: options.icon || 'https://emojicdn.elk.sh/🏰',
      badge: options.badge || 'https://emojicdn.elk.sh/🔔',
      vibrate: options.vibrate || [300, 150, 300],
      tag: options.tag || `disney-alert-${Date.now()}`,
      renotify: true,
      requireInteraction: true,
      data: options.data || { url: self.location.origin },
    });
  }
});

// Handle periodic background sync (Android PWA background polling)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'disney-waits-poll') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: 'POLL_NOW' });
        });
      })
    );
  }
});

