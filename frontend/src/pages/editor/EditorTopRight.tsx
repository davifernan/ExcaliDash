/**
 * Version history, sharing and export.
 *
 * These three used to live in a bar of ours stacked above Excalidraw's own
 * top-right cluster, which meant two competing sets of controls in one corner —
 * and, worse, two rows of collaborator avatars showing the same people, of which
 * ours were the decorative ones: follow mode listens to Excalidraw's avatars.
 *
 * Version history joined export in the main menu for the same reason, once the
 * timer and the invite button wanted room here too: three of us competing for a
 * column this narrow is a fight the avatars lose. What stays visible is what a
 * live session needs -- who is here, and how to bring someone in.
 *
 * Export moved into the main menu, and that was not tidying. Excalidraw's top
 * row is a grid whose right column is capped at roughly 275px, and the avatar
 * list shrinks to fit whatever is left: at 71px it decided it had room for zero
 * faces and collapsed a present colleague into a "+1" chip. Two buttons leave it
 * room for a face. Export is a once-in-a-while action and reads better next to
 * "Save as image" anyway.
 *
 * `renderTopRightUI` is the slot Excalidraw offers for exactly this, and it was
 * sitting unused. Rendering here puts our buttons between the avatar list and
 * the library trigger, and hands us three behaviours we would otherwise have to
 * build: the cluster slides away in zen mode, it goes click-through while a
 * gesture is in progress, and we are told when the layout is mobile.
 */
import React from "react";
import { LocateFixed, Share2 } from "lucide-react";
import type { WorkshopTimerController } from "./workshopTimer";
import { WorkshopTimerWidget } from "./WorkshopTimerWidget";
import type { InviteHereUiState } from "./InviteHereOverlay";

type EditorTopRightProps = {
  isMobile: boolean;
  canEdit: boolean;
  followerNotice: string | null;
  showInvite: boolean;
  inviteHere: InviteHereUiState;
  timer: WorkshopTimerController;
  showShare: boolean;
  onShareOpen: () => void;
};

const island: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.15rem",
  height: "2.25rem",
  padding: "0 0.25rem",
  borderRadius: "var(--border-radius-lg, 0.5rem)",
  background: "var(--island-bg-color, #fff)",
  boxShadow: "var(--shadow-island, 0 1px 4px rgba(0,0,0,.15))",
  color: "var(--text-primary-color, #1b1b1f)",
};

const iconButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  border: "none",
  borderRadius: "var(--border-radius-md, 0.375rem)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

export const EditorTopRight: React.FC<EditorTopRightProps> = ({
  isMobile,
  canEdit,
  followerNotice,
  showInvite,
  inviteHere,
  timer,
  showShare,
  onShareOpen,
}) => {
  return (
    <div style={island} data-testid="editor-top-right">
      {/*
        On the mobile layout Excalidraw does not render the Footer at all, so
        the timer would simply not exist. It comes along here instead -- which
        is also the only place sharing and inviting can live on a phone, since
        the left island stands down there to keep off the tool row.
      */}
      {isMobile ? <WorkshopTimerWidget timer={timer} canEdit={canEdit} /> : null}
      {followerNotice ? (
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            padding: "0.1rem 0.4rem",
            marginInlineEnd: "0.15rem",
            borderRadius: "999px",
            background: "var(--color-primary-light, #e3e2fe)",
            color: "var(--color-primary-darker, #4a47b1)",
            whiteSpace: "nowrap",
            // A display name may be long; this column is narrow, and the
            // avatars are what lose when it overflows.
            maxWidth: "9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          data-testid="editor-follower-notice"
          title={followerNotice}
        >
          {followerNotice}
        </span>
      ) : null}
      {showInvite ? (
        <button
          onClick={inviteHere.invite}
          style={iconButton}
          title="Invite everyone here"
          aria-label={
            inviteHere.status
              ? `Invite everyone here; ${inviteHere.status.arrivedCount} arrived`
              : "Invite everyone here"
          }
          data-testid="editor-invite"
        >
          <LocateFixed size={16} />
          {inviteHere.status ? (
            <span style={{ fontSize: "0.625rem", fontWeight: 700, marginInlineStart: "0.15rem" }}>
              {inviteHere.status.arrivedCount}
            </span>
          ) : null}
        </button>
      ) : null}
      {showShare ? (
        <button
          onClick={onShareOpen}
          style={iconButton}
          title="Share"
          aria-label="Share"
          data-testid="editor-share"
        >
          <Share2 size={16} />
        </button>
      ) : null}
    </div>
  );
};
