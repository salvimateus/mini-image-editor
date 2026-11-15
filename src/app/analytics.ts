export type TrackParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Sends a usage event to the tag manager. Does nothing when no tag manager is on the page (dev, desktop). */
export function track(event: string, params?: TrackParams): void {
  try {
    window.dataLayer?.push({ event, ...params });
  } catch {
    // Tracking must never break the app.
  }
}
