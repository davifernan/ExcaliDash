/**
 * Somewhere for the timer to live on a phone.
 *
 * Excalidraw renders no Footer on the mobile layout, so the countdown would
 * simply not exist there. The top row is not an option either: it is already
 * full, and adding the widget pushed four tools off the screen. This puts it in
 * the lower-left corner, clear of Excalidraw's own bottom bar, and inside the
 * editor root so it inherits the same colours and click-through behaviour as
 * the rest of our chrome.
 */
import React from "react";
import { createPortal } from "react-dom";

export const MobileTimerCorner: React.FC<{
  container: HTMLElement | null;
  children: React.ReactNode;
}> = ({ container, children }) =>
  container
    ? createPortal(
        <div
          data-testid="mobile-timer-corner"
          style={{
            position: "absolute",
            insetInlineStart: "var(--editor-container-padding, 1rem)",
            bottom: "4.5rem",
            zIndex: 4,
            pointerEvents: "var(--ui-pointerEvents)" as React.CSSProperties["pointerEvents"],
          }}
        >
          {children}
        </div>,
        container,
      )
    : null;
