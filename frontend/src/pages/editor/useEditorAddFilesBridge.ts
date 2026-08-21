import { useCallback, useRef, type MutableRefObject } from "react";
import { getFilesDelta } from "./shared";

type UseEditorAddFilesBridgeInput = {
  drawingId?: string;
  debouncedSaveRef: MutableRefObject<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files?: Record<string, any>,
      ) => void)
    | null
  >;
  excalidrawAPIRef: MutableRefObject<any>;
  hasSceneChangesSinceLoadRef: MutableRefObject<boolean>;
  isHistoryPreviewingRef: MutableRefObject<boolean>;
  isSyncingRef: MutableRefObject<boolean>;
  latestAppStateRef: MutableRefObject<any>;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestFilesRef: MutableRefObject<any>;
  setIsReady: (ready: boolean) => void;
  socketRef: { current: any };
  lastSyncedFilesRef: { current: Record<string, any> };
};

/**
 * Bridges files added through Excalidraw's imperative API back into the same
 * collaboration and persistence path as canvas changes. Keeping the patch here
 * makes its one-time-per-API lifetime explicit and keeps Editor focused on
 * composing the feature hooks.
 */
export const useEditorAddFilesBridge = ({
  drawingId,
  debouncedSaveRef,
  excalidrawAPIRef,
  hasSceneChangesSinceLoadRef,
  isHistoryPreviewingRef,
  isSyncingRef,
  latestAppStateRef,
  latestElementsRef,
  latestFilesRef,
  setIsReady,
  socketRef,
  lastSyncedFilesRef,
}: UseEditorAddFilesBridgeInput) => {
  const patchedApisRef = useRef<WeakSet<object>>(new WeakSet());
  // Sends only what the other side has not got yet. Kept here rather than in
  // the broadcast hook because it belongs to the addFiles path: Excalidraw adds
  // an image's bytes before the element that shows it, and the bytes have to be
  // on their way first or peers render a hole.
  const emitFilesDeltaIfNeeded = useCallback(
    (nextFiles: Record<string, any>) => {
      latestFilesRef.current = nextFiles;
      if (!socketRef.current || !drawingId) return false;
      const filesDelta = getFilesDelta(lastSyncedFilesRef.current, nextFiles || {});
      if (Object.keys(filesDelta).length === 0) return false;
      lastSyncedFilesRef.current = nextFiles;
      socketRef.current.emit("element-update", {
        drawingId,
        elements: [],
        files: filesDelta,
      });
      return true;
    },
    [drawingId, lastSyncedFilesRef, latestFilesRef, socketRef],
  );
  const setExcalidrawAPI = useCallback(
    (api: any) => {
      excalidrawAPIRef.current = api;
      if (import.meta.env.DEV) {
        (window as any).__EXCALIDASH_EXCALIDRAW_API__ = api;
      }
      if (api && typeof api.addFiles === "function" && !patchedApisRef.current.has(api as object)) {
        patchedApisRef.current.add(api as object);
        const originalAddFiles = api.addFiles.bind(api);
        api.addFiles = (filesInput: Record<string, any> | any[]) => {
          const normalizedFiles = Array.isArray(filesInput)
            ? filesInput
            : Object.values(filesInput || {});
          originalAddFiles(normalizedFiles);
          if (isSyncingRef.current || isHistoryPreviewingRef.current) return;
          const nextFiles = api.getFiles?.() || {};
          const didEmit = emitFilesDeltaIfNeeded(nextFiles);
          if (didEmit && drawingId && latestAppStateRef.current && debouncedSaveRef.current) {
            hasSceneChangesSinceLoadRef.current = true;
            debouncedSaveRef.current(
              drawingId,
              latestElementsRef.current,
              latestAppStateRef.current,
              latestFilesRef.current || {},
            );
          }
        };
      }
      setIsReady(true);
    },
    [
      debouncedSaveRef,
      drawingId,
      emitFilesDeltaIfNeeded,
      excalidrawAPIRef,
      hasSceneChangesSinceLoadRef,
      isHistoryPreviewingRef,
      isSyncingRef,
      latestAppStateRef,
      latestElementsRef,
      latestFilesRef,
      setIsReady,
    ],
  );

  return { emitFilesDeltaIfNeeded, setExcalidrawAPI };
};
