/**
 * The sticky note feature, as one thing the editor can switch on.
 *
 * The editor page is already long and its job is wiring, not notes. It gets one
 * node to render inside the canvas container and one change handler, and needs
 * to know nothing else about how a note is put together.
 */
import React, { useCallback, useRef, useState } from "react";
import { StickyHandles } from "./StickyHandles";
import { StickyPalette } from "./StickyPalette";
import { StickyPreview } from "./StickyPreview";
import { StickyToolbarButton } from "./StickyToolbarButton";
import { useStickyHint } from "./useStickyHint";
import { useStickyKeys } from "./useStickyKeys";
import { useStickyNotes } from "./useStickyNotes";
import { useStickyUpkeep } from "./useStickyUpkeep";
import { useToolbarElement } from "./useToolbarElement";

type Options = {
  excalidrawAPI: { current: any };
  containerRef: React.RefObject<HTMLElement>;
  canEdit: boolean;
  /** The editor's own change handler, which still has to run. */
  onCanvasChange: (elements: readonly any[], appState: any, files?: Record<string, any>) => void;
};

export function useStickyNotesFeature({
  excalidrawAPI,
  containerRef,
  canEdit,
  onCanvasChange,
}: Options) {
  // The editor hands its API over after the first render, so anything that
  // needs to subscribe has to wait for a sign of life. The first change event
  // is that sign.
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  const { armed, color, arm, setColor } = useStickyNotes({
    excalidrawAPI,
    containerRef,
    canEdit,
  });

  useStickyKeys({ excalidrawAPI, containerRef, canEdit });
  useStickyHint({ excalidrawAPI, containerRef, canEdit, ready });
  const { onSceneChange } = useStickyUpkeep({ excalidrawAPI, canEdit });
  const toolbar = useToolbarElement(containerRef);

  const handleCanvasChange = useCallback(
    (elements: readonly any[], appState: any, files?: Record<string, any>) => {
      if (!readyRef.current) {
        readyRef.current = true;
        setReady(true);
      }
      onSceneChange(elements, appState);
      onCanvasChange(elements, appState, files);
    },
    [onCanvasChange, onSceneChange],
  );

  const stickyOverlay = canEdit ? (
    <>
      <StickyToolbarButton containerRef={containerRef} armed={armed} color={color} onArm={arm} />
      {armed && <StickyPalette toolbar={toolbar} color={color} onPick={setColor} />}
      {armed && (
        <StickyPreview excalidrawAPI={excalidrawAPI} containerRef={containerRef} color={color} />
      )}
      <StickyHandles excalidrawAPI={excalidrawAPI} containerRef={containerRef} canEdit={canEdit} />
    </>
  ) : null;

  return { stickyOverlay, onCanvasChange: handleCanvasChange };
}
