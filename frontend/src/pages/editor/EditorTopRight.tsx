import { useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
import type { InviteHereStatus, ViewportInvitation } from "./inviteHere";
import "./inviteHere.css";

export type InviteHereUiState = {
  invitation: ViewportInvitation | null;
  status: InviteHereStatus | null;
  invite: () => void;
  accept: () => void;
  decline: () => void;
};

const InvitationOverlay = ({
  invitation,
  onAccept,
  onDecline,
}: {
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

  return (
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
    </section>
  );
};

export const EditorTopRight = ({
  canInvite,
  isMobile,
  inviteHere,
}: {
  canInvite: boolean;
  isMobile: boolean;
  inviteHere: InviteHereUiState;
}) => (
  <>
    {canInvite ? (
      <div className="invite-here-trigger-island">
        <button
          type="button"
          className="invite-here-trigger"
          onClick={inviteHere.invite}
          title="Invite everyone here"
          aria-label={`Invite everyone here${
            inviteHere.status ? `; ${inviteHere.status.arrivedCount} arrived` : ""
          }`}
        >
          <LocateFixed aria-hidden="true" />
          {inviteHere.status ? (
            <span className="invite-here-trigger__count" aria-hidden="true">
              {inviteHere.status.arrivedCount}
            </span>
          ) : null}
          {isMobile ? <span className="sr-only">Invite here</span> : null}
        </button>
      </div>
    ) : null}
    {inviteHere.invitation ? (
      <InvitationOverlay
        key={inviteHere.invitation.invitationId}
        invitation={inviteHere.invitation}
        onAccept={inviteHere.accept}
        onDecline={inviteHere.decline}
      />
    ) : null}
  </>
);
