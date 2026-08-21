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
import { Share2 } from "lucide-react";

type EditorTopRightProps = {
  isMobile: boolean;
  canEdit: boolean;
  followerNotice: string | null;
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
  followerNotice,
  showShare,
  onShareOpen,
}) => {
  // On a phone the top row is already crowded by Excalidraw's own controls, and
  // these three all have a home in the main menu. Better nothing than a squeeze.
  if (isMobile) return null;

  return (
    <div style={island} data-testid="editor-top-right">
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
          }}
          data-testid="editor-follower-notice"
        >
          {followerNotice}
        </span>
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
