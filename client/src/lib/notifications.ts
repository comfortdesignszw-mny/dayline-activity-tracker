// Browser notification plumbing: permission, service-worker registration, and
// the "show it" call. Everything degrades to a no-op when the API is missing,
// so the in-app banner fallback is the only thing the caller has to think about.

export type NotificationSupport = "unsupported" | "default" | "granted" | "denied";

export function notificationSupport(): NotificationSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  if (!("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission as NotificationSupport;
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registers the service worker once per page load. Returns null when the
 * browser has no service-worker support or registration fails — the caller
 * then relies on the in-app banner.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => reg)
      .catch(() => null);
  }
  return registrationPromise;
}

/** Asks for permission. Must be called from a user gesture. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (notificationSupport() === "unsupported") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    return result as NotificationSupport;
  } catch {
    return "denied";
  }
}

/**
 * Shows a reminder. Prefers the service worker (so it works when the tab is
 * backgrounded and the PWA is installed); falls back to a page-level
 * Notification, and reports false when neither is possible.
 */
export async function showReminderNotification(input: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  reminderId?: string;
}): Promise<boolean> {
  if (notificationSupport() !== "granted") return false;

  const reg = await registerServiceWorker();
  if (reg) {
    // Wait for an active worker so postMessage is not dropped on first load.
    const active = reg.active ?? (await navigator.serviceWorker.ready).active;
    if (active) {
      active.postMessage({
        type: "SHOW_REMINDER",
        title: input.title,
        body: input.body,
        tag: input.tag,
        url: input.url,
        reminderId: input.reminderId,
      });
      return true;
    }
  }

  try {
    new Notification(input.title, {
      body: input.body,
      icon: "/icons/icon-192.png",
      tag: input.tag,
    });
    return true;
  } catch {
    return false;
  }
}

/** True when the app is running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag instead.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
