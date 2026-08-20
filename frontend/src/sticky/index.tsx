/**
 * The sticky note feature, as one thing the editor can switch on.
 *
 * The editor page is already long and its job is wiring, not notes. It gets a
 * render function for the button and a change handler for the upkeep, and needs
 * to know nothing else about how a note is put together.
 */
import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { StickyTool } from "./StickyTool";
import { useStickyKeys } from "./useStickyKeys";
import { useStickyNotes } from "./useStickyNotes";
import { useStickyUpkeep } from "./useStickyUpkeep";

type Options = {
  excalidrawAPI: { current: any };
  containerRef: React.RefObject<HTMLElement>;
  canEdit: boolean;
  /** The editor's own change handler, which still has to run. */
  onCanvasChange: (
    elements: readonly any[],
    appState: any,
    files?: Record<string, any>
  ) => void;
};

export function useStickyNotesFeature({
  excalidrawAPI,
  containerRef,
  canEdit,
  onCanvasChange,
}: Options) {
  const [hintShown, setHintShown] = useState(false);

  // Only worth saying once. Somebody on a device where the keyboard will not
  // rise by itself does not need telling on every note.
  const onTypingUnavailable = useCallback(() => {
    if (hintShown) return;
    setHintShown(true);
    toast("Note added — press Enter or double-click to type in it");
  }, [hintShown]);

  const { armed, color, arm, setColor } = useStickyNotes({
    excalidrawAPI,
    containerRef,
    canEdit,
    onTypingUnavailable,
  });

  useStickyKeys({ excalidrawAPI, containerRef, canEdit });
  const { onSceneChange } = useStickyUpkeep({ excalidrawAPI, canEdit });

  const renderTopRightUI = useCallback(
    (_isMobile: boolean, appState: any) => {
      // Excalidraw asks for this slot in view mode too, where there is nothing
      // to add a note to.
      if (!canEdit || appState?.viewModeEnabled) return null;
      return (
        <StickyTool armed={armed} color={color} onArm={arm} onPickColor={setColor} />
      );
    },
    [arm, armed, canEdit, color, setColor],
  );

  const handleCanvasChange = useCallback(
    (elements: readonly any[], appState: any, files?: Record<string, any>) => {
      onSceneChange(elements, appState);
      onCanvasChange(elements, appState, files);
    },
    [onCanvasChange, onSceneChange],
  );

  return { renderTopRightUI, onCanvasChange: handleCanvasChange };
}
