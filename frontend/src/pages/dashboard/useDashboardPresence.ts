import { useEffect, useState } from "react";
import * as api from "../../api";

/** The server accepts no more; asking about more boards than fit a screen is
 * not a thing the dashboard needs to do. */
const MAX_WATCHED = 50;
const POLL_INTERVAL_MS = 10_000;

export type PresenceByDrawing = Map<string, { keys: ReadonlySet<string>; guestCount: number }>;

/**
 * Who is on the boards currently listed.
 *
 * Polled rather than pushed: a dashboard does not need to know within a second,
 * and a socket subscription would need its own revocation, reconnect and
 * fan-out rules for an answer that is a few seconds fresher.
 */
export const useDashboardPresence = (drawingIds: readonly string[]): PresenceByDrawing | null => {
  const [presence, setPresence] = useState<PresenceByDrawing | null>(null);
  const watched = drawingIds.slice(0, MAX_WATCHED);
  // A stable key so the effect follows the set of boards, not the array identity.
  const watchKey = watched.join(",");

  useEffect(() => {
    const ids = watchKey ? watchKey.split(",") : [];
    if (ids.length === 0) {
      setPresence(null);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const results = await api.getDashboardPresence(ids);
        // A slow answer about a screen that has moved on is worse than no answer;
        // changing the watched set tears this effect down and sets the flag.
        if (cancelled) return;
        setPresence(
          new Map(
            results.map((result) => [
              result.drawingId,
              { keys: new Set(result.connectedMemberKeys), guestCount: result.guestCount },
            ]),
          ),
        );
      } catch {
        // Presence is decoration: a failed poll leaves the last answer standing
        // rather than blanking the page.
      }
    };

    void poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [watchKey]);

  return presence;
};
