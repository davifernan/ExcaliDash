/**
 * The one key cursor chat needs, claimed as carefully as possible.
 *
 * The listener sits in the capture phase, ahead of Excalidraw's own shortcut
 * handling, because otherwise the key is gone before we see it. It hands the
 * key straight back in every case where it is not ours -- see
 * shouldOpenCursorChat for what those are and why.
 */
import { useEffect } from "react";
import type React from "react";
import { shouldOpenCursorChat, type CursorChatController } from "./cursorChat";

export const useCursorChatKey = ({
  containerRef,
  enabled,
  excalidrawAPI,
  chatRef,
}: {
  containerRef: React.RefObject<HTMLElement>;
  enabled: boolean;
  excalidrawAPI: { current: { getAppState?: () => any } | null };
  chatRef: { current: CursorChatController | null };
}) => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Asked at the moment of the keystroke rather than captured in a render:
      // with something selected Enter is Excalidraw's, and that is also how a
      // freshly placed sticky note gets its label editor.
      const selected = excalidrawAPI.current?.getAppState?.()?.selectedElementIds ?? {};
      if (!shouldOpenCursorChat(event, { hasSelection: Object.keys(selected).length > 0 })) return;
      event.preventDefault();
      event.stopPropagation();
      chatRef.current?.open();
    };

    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }, [containerRef, enabled, excalidrawAPI, chatRef]);
};
