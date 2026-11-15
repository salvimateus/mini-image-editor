export type TrackParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Sends a usage event through the tag manager's `gtag`. Does nothing when no tag manager is on the page (dev, desktop). */
export function track(event: string, params?: TrackParams): void {
  try {
    window.gtag?.('event', event, params ?? {});
  } catch {
    // Tracking must never break the app.
  }
}
