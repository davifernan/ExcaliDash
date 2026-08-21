/**
 * Saying so when the server will not pass a change on.
 *
 * The change itself is not lost: drawings are saved over HTTP, on a separate
 * path with its own much larger ceiling. What is lost is the live sharing --
 * everyone else stops seeing the board move. Silently, until somebody reloads
 * and wonders how they got so far apart.
 *
 * Said once, not once per event. A board that is over the limit is over it for
 * every change that follows, and a message per change would be its own kind of
 * broken.
 */
export const ELEMENT_UPDATE_REFUSED_EVENT = "element-update-refused";

/** Long enough that a burst is one message; short enough to say it again later. */
export const REFUSAL_QUIET_MS = 60_000;

export const bindElementUpdateRefusals = ({
  socket,
  notify,
  onRefused: rollbackRefusedUpdate,
  now = () => Date.now(),
}: {
  socket: {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
  notify: (message: string) => void;
  onRefused?: () => void;
  now?: () => number;
}) => {
  let lastSaid = 0;

  const onRefused = () => {
    rollbackRefusedUpdate?.();
    const at = now();
    if (lastSaid && at - lastSaid < REFUSAL_QUIET_MS) return;
    lastSaid = at;
    notify(
      "This change was too large to share live. It is still saved; live sharing will retry briefly, then you can reload to bring everyone back in step.",
    );
  };

  socket.on(ELEMENT_UPDATE_REFUSED_EVENT, onRefused);
  return {
    dispose: () => socket.off(ELEMENT_UPDATE_REFUSED_EVENT, onRefused),
    reset: () => {
      lastSaid = 0;
    },
  };
};
