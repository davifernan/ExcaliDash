/**
 * The sticky note feature, as one thing the editor can switch on.
 *
 * The editor page is already long and its job is wiring, not notes. It gets one
 * node to render inside the canvas container and one change handler, and needs
 * to know nothing else about how a note is put together.
 */
import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { StickyHandles } from "./StickyHandles";
import { StickyPalette } from "./StickyPalette";
import { StickyToolbarButton } from "./StickyToolbarButton";
import { useStickyKeys } from "./useStickyKeys";
import { useStickyNotes } from "./useStickyNotes";
import { useStickyUpkeep } from "./useStickyUpkeep";
import { useToolbarElement } from "./useToolbarElement";

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
  const toolbar = useToolbarElement(containerRef);

  const handleCanvasChange = useCallback(
    (elements: readonly any[], appState: any, files?: Record<string, any>) => {
      onSceneChange(elements, appState);
      onCanvasChange(elements, appState, files);
    },
    [onCanvasChange, onSceneChange],
  );

  const stickyOverlay = canEdit ? (
    <>
      <StickyToolbarButton
        containerRef={containerRef}
        armed={armed}
        color={color}
        onArm={arm}
      />
      {armed && <StickyPalette toolbar={toolbar} color={color} onPick={setColor} />}
      <StickyHandles
        excalidrawAPI={excalidrawAPI}
        containerRef={containerRef}
        canEdit={canEdit}
      />
    </>
  ) : null;

  return { stickyOverlay, onCanvasChange: handleCanvasChange };
}
