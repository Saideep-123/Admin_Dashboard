self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};

  const title = data.title || "New Order";
  const options = {
    body: data.body || "A new order has been placed",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: data.url || "/"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
