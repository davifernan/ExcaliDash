import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { InviteHereStatus, ViewportInvitation } from "./inviteHere";
import "./inviteHere.css";

export type InviteHereUiState = {
  invitation: ViewportInvitation | null;
  status: InviteHereStatus | null;
  invite: () => void;
  accept: () => void;
  decline: () => void;
};

/**
 * The invitation notice.
 *
 * Miro's equivalent drags everyone's viewport to the caller's with one click.
 * This does not: nothing moves on anyone's screen without their own click. The
 * fifteen seconds and the emptying bar are the mechanism rather than decoration
 * -- an invitation you accept three minutes later takes you somewhere the
 * conversation has already left, and a notice that merely vanishes leaves you
 * wondering what you missed.
 */
export const InviteHereOverlay = ({
  container,
  invitation,
  onAccept,
  onDecline,
}: {
  container: HTMLElement | null;
  invitation: ViewportInvitation;
  onAccept: () => void;
  onDecline: () => void;
}) => {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((invitation.expiresAt - Date.now()) / 1_000)),
  );
  const [durationMs] = useState(() => Math.max(0, invitation.expiresAt - Date.now()));
  useEffect(() => {
    const update = () =>
      setSecondsLeft(Math.max(0, Math.ceil((invitation.expiresAt - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [invitation.expiresAt]);

  if (!container) return null;

  return createPortal(
    <section className="invite-here-overlay" aria-live="polite" aria-atomic="true">
      <div className="invite-here-overlay__content">
        <div>
          <strong>{invitation.inviterName}</strong> invites you to their view
        </div>
        <span className="invite-here-overlay__seconds">{secondsLeft}s</span>
      </div>
      <div className="invite-here-overlay__actions">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onAccept}>
          Accept
        </button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onDecline}>
          Decline
        </button>
      </div>
      <div className="invite-here-overlay__track" aria-hidden="true">
        <div
          key={invitation.invitationId}
          className="invite-here-overlay__progress"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </section>,
    container,
  );
};
