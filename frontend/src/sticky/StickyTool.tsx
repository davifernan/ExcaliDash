/**
 * The note button, and the six colours under it.
 *
 * Excalidraw has no way to add an entry to its own shape toolbar, so this sits
 * in `renderTopRightUI`, the slot the library provides for exactly this. It
 * deliberately does not borrow Excalidraw's CSS class names: those are internal
 * and a patch release may rename them, whereas the handful of visual values
 * copied here — island surface, radius, shadow — change far less often and fail
 * visibly rather than silently when they do.
 */
import React from "react";
import clsx from "clsx";
import { STICKY_COLORS, type StickyColor } from "./stickyNote";

type StickyToolProps = {
  armed: boolean;
  color: StickyColor;
  onArm: () => void;
  onPickColor: (color: StickyColor) => void;
};

const islandStyle: React.CSSProperties = {
  borderRadius: 10,
  boxShadow: "0 0 0 1px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.08)",
};

/** A small square of paper — the same thing the click will put on the board. */
const Swatch = ({ color, size }: { color: StickyColor; size: number }) => (
  <span
    aria-hidden
    style={{
      width: size,
      height: size,
      backgroundColor: color.fill,
      border: `1px solid ${color.edge}`,
      borderRadius: 2,
      display: "block",
    }}
  />
);

export const StickyTool: React.FC<StickyToolProps> = ({
  armed,
  color,
  onArm,
  onPickColor,
}) => (
  <div className="flex flex-col items-end gap-1.5">
    <button
      type="button"
      onClick={onArm}
      aria-pressed={armed}
      title="Sticky note — click the board to place one"
      className={clsx(
        "h-9 w-9 flex items-center justify-center transition-colors",
        "bg-white dark:bg-neutral-800",
        armed
          ? "outline outline-2 outline-indigo-500 dark:outline-indigo-400"
          : "hover:bg-gray-50 dark:hover:bg-neutral-700",
      )}
      // An outline rather than a ring: Tailwind draws rings with box-shadow,
      // and the island shadow below is a box-shadow too, so the ring would be
      // overwritten and the armed state would show nothing at all.
      style={islandStyle}
    >
      <Swatch color={color} size={18} />
      <span className="sr-only">Sticky note</span>
    </button>

    {armed && (
      <div
        className="flex gap-1 p-1.5 bg-white dark:bg-neutral-800"
        style={islandStyle}
        role="group"
        aria-label="Note colour"
      >
        {STICKY_COLORS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPickColor(option)}
            aria-pressed={option.id === color.id}
            title={option.label}
            className={clsx(
              "h-6 w-6 flex items-center justify-center rounded transition-transform",
              option.id === color.id
                ? "ring-2 ring-indigo-500 dark:ring-indigo-400"
                : "hover:scale-110",
            )}
          >
            <Swatch color={option} size={16} />
            <span className="sr-only">{option.label}</span>
          </button>
        ))}
      </div>
    )}
  </div>
);
