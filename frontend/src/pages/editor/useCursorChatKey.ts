/**
 * The one key cursor chat needs, claimed as carefully as possible.
 *
 * "/" is what every other whiteboard uses, and it is also an ordinary character
 * somebody may be trying to write. So the listener sits in the capture phase --
 * ahead of Excalidraw's own shortcut handling -- but hands the key straight back
 * whenever anything is being typed into.
 */
import { useEffect } from "react";
import type React from "react";
import { shouldOpenCursorChat } from "./cursorChat";

export const useCursorChatKey = ({
  containerRef,
  enabled,
  onOpen,
}: {
  containerRef: React.RefObject<HTMLElement>;
  enabled: boolean;
  onOpen: () => void;
}) => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldOpenCursorChat(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpen();
    };

    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }, [containerRef, enabled, onOpen]);
};
