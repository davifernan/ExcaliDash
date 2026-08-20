import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { exportToSvg } from "@excalidraw/excalidraw";
import debounce from "lodash/debounce";
import { toast } from "sonner";
import * as api from "../../api";
import { compressExcalidrawFiles } from "../../utils/imageCompression";
import { reconcileElements } from "../../utils/sync";
import {
  CAPTURE_UPDATE_NEVER,
  getFilesDelta,
  getPersistedAppState,
  hasRenderableElements,
} from "./shared";

class DrawingSaveConflictError extends Error {
  constructor(message = "Drawing version conflict") {
    super(message);
    this.name = "DrawingSaveConflictError";
  }
}

type PersistenceRefs = {
  currentDrawingVersion: MutableRefObject<number | null>;
  debouncedSave: MutableRefObject<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files?: Record<string, any>,
      ) => void)
    | null
  >;
  excalidrawAPI: MutableRefObject<any>;
  isSyncing: MutableRefObject<boolean>;
  isUnmounting: MutableRefObject<boolean>;
  lastLocalChangeAt: MutableRefObject<number>;
  lastPersistedElements: MutableRefObject<readonly any[]>;
  lastPersistedFiles: MutableRefObject<Record<string, any>>;
  lastSyncedFiles: MutableRefObject<Record<string, any>>;
  latestAppState: MutableRefObject<any>;
  latestElements: MutableRefObject<readonly any[]>;
  latestFiles: MutableRefObject<any>;
  saveQueue: MutableRefObject<Promise<void>>;
  suspiciousBlankLoad: MutableRefObject<boolean>;
};

type UseEditorPersistenceParams = {
  refs: PersistenceRefs;
  user: unknown;
  normalizeImageElementStatus: (
    elements?: readonly any[],
    files?: Record<string, any> | null,
  ) => readonly any[];
  resolveSafeSnapshot: (candidateSnapshot?: readonly any[]) => {
    snapshot: readonly any[];
    prevented: boolean;
    staleEmptySnapshot: boolean;
    staleNonRenderableSnapshot: boolean;
  };
};

export const useEditorPersistence = ({
  refs,
  user,
  normalizeImageElementStatus,
  resolveSafeSnapshot,
}: UseEditorPersistenceParams) => {
  const saveDataRef = useRef<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files?: Record<string, any>,
      ) => Promise<void>)
    | null
  >(null);
  const savePreviewRef = useRef<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files: any,
      ) => Promise<void>)
    | null
  >(null);
  const saveLibraryRef = useRef<((items: any[]) => Promise<void>) | null>(null);

  saveDataRef.current = async (
    drawingId: string,
    elements: readonly any[],
    appState: any,
    files?: Record<string, any>,
  ) => {
    if (!drawingId) return;
    try {
      const persistableAppState = getPersistedAppState(appState);
      const candidateElements = Array.isArray(elements) ? elements : [];
      const {
        snapshot: safeElements,
        prevented,
        staleEmptySnapshot,
        staleNonRenderableSnapshot,
      } = resolveSafeSnapshot(candidateElements);
      const persistableElements = Array.from(safeElements);
      if (
        refs.suspiciousBlankLoad.current &&
        !hasRenderableElements(persistableElements)
      ) {
        console.warn(
          "[Editor] Blocking non-renderable save due to suspicious blank load",
          { drawingId, elementCount: persistableElements.length },
        );
        return;
      }
      if (staleEmptySnapshot || staleNonRenderableSnapshot) {
        console.warn("[Editor] Skipping stale snapshot save", {
          drawingId,
          candidateElementCount: candidateElements.length,
          fallbackElementCount: persistableElements.length,
          prevented,
          staleEmptySnapshot,
          staleNonRenderableSnapshot,
        });
        return;
      }
      let persistableFiles = files ?? refs.latestFiles.current ?? {};
      const compressedFilesResult =
        await compressExcalidrawFiles(persistableFiles);
      if (compressedFilesResult.changed) {
        persistableFiles = compressedFilesResult.files;
        if (
          refs.excalidrawAPI.current &&
          typeof refs.excalidrawAPI.current.addFiles === "function"
        ) {
          refs.isSyncing.current = true;
          try {
            refs.excalidrawAPI.current.addFiles(
              Object.values(persistableFiles),
            );
          } finally {
            refs.isSyncing.current = false;
          }
        }
        refs.latestFiles.current = persistableFiles;
        refs.lastSyncedFiles.current = persistableFiles;
      }
      const filesChangedSincePersist =
        Object.keys(
          getFilesDelta(
            refs.lastPersistedFiles.current || {},
            persistableFiles || {},
          ),
        ).length > 0;
      const normalizedElementsForSave = Array.from(
        normalizeImageElementStatus(persistableElements, persistableFiles),
      );
      const persistScene = async (
        elementsToSave: readonly any[],
        filesToSave: Record<string, any> | undefined,
        attempt: number,
      ): Promise<void> => {
        try {
          const updated = await api.updateDrawing(drawingId, {
            elements: Array.from(elementsToSave),
            appState: persistableAppState,
            ...(filesToSave ? { files: filesToSave } : {}),
            version: refs.currentDrawingVersion.current ?? undefined,
          });
          if (typeof updated.version === "number") {
            refs.currentDrawingVersion.current = updated.version;
          }
          refs.lastPersistedElements.current = elementsToSave;
          if (filesToSave) {
            refs.lastPersistedFiles.current = filesToSave;
          }
        } catch (err) {
          if (api.isAxiosError(err) && err.response?.status === 409) {
            // A version is a token for a particular scene. Taking the number
            // out of the conflict response and resending the same elements
            // claims to be based on a scene this editor never saw, and
            // overwrites whatever the other writer just saved. The live socket
            // is not a safety net here: it is a separate channel with its own
            // ordering, and an update can arrive after the payload was built,
            // or not at all after a reconnect.
            //
            // So load the scene behind that version, merge it in with the same
            // rule the live updates use, and save the result.
            if (attempt > 0) throw new DrawingSaveConflictError();

            const latest = await api.getDrawing(drawingId);
            const latestVersion = Number(latest?.version);
            if (!Number.isInteger(latestVersion)) {
              throw new DrawingSaveConflictError();
            }

            const merged = reconcileElements(
              elementsToSave,
              Array.isArray(latest?.elements) ? latest.elements : [],
            );
            const mergedFiles = filesToSave
              ? { ...(latest?.files || {}), ...filesToSave }
              : undefined;

            refs.currentDrawingVersion.current = latestVersion;
            // Show the merged scene. Without this the editor still holds the
            // pre-merge elements, and the next save would drop the other
            // writer's work all over again.
            refs.excalidrawAPI.current?.updateScene({
              elements: merged,
              captureUpdate: CAPTURE_UPDATE_NEVER,
            });
            refs.latestElements.current = merged;

            await persistScene(merged, mergedFiles, 1);
            return;
          }
          throw err;
        }
      };
      await persistScene(
        normalizedElementsForSave,
        filesChangedSincePersist ? persistableFiles : undefined,
        0,
      );
    } catch (err) {
      if (err instanceof DrawingSaveConflictError) {
        toast.error("Drawing changed in another tab. Refresh to load latest.");
        throw err;
      }
      console.error("Failed to save drawing", err);
      toast.error("Failed to save changes");
      throw err;
    }
  };

  const enqueueSceneSave = useCallback(
    (
      drawingId: string,
      elements: readonly any[],
      appState: any,
      files?: Record<string, any>,
      options?: { suppressErrors?: boolean },
    ) => {
      const suppressErrors = options?.suppressErrors ?? true;
      refs.saveQueue.current = refs.saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (!saveDataRef.current) return;
          if (suppressErrors) {
            try {
              await saveDataRef.current(drawingId, elements, appState, files);
            } catch {
              // Best-effort autosave errors are surfaced by explicit saves.
            }
            return;
          }
          await saveDataRef.current(drawingId, elements, appState, files);
        });
      return refs.saveQueue.current;
    },
    [refs],
  );

  savePreviewRef.current = async (
    drawingId: string,
    elements: readonly any[],
    appState: any,
    files: any,
  ) => {
    if (!drawingId) return;
    try {
      const snapshotFromArgs = Array.isArray(elements) ? elements : [];
      const snapshotFromRef = refs.latestElements.current ?? [];
      const candidateSnapshot =
        hasRenderableElements(snapshotFromArgs) ||
        !hasRenderableElements(snapshotFromRef)
          ? snapshotFromArgs
          : snapshotFromRef;
      const {
        snapshot: currentSnapshot,
        prevented: preventedPreviewOverwrite,
      } = resolveSafeSnapshot(candidateSnapshot);
      const currentFiles = refs.latestFiles.current ?? files;
      const normalizedSnapshot = normalizeImageElementStatus(
        currentSnapshot,
        currentFiles,
      );
      if (
        refs.suspiciousBlankLoad.current &&
        !hasRenderableElements(currentSnapshot)
      ) {
        return;
      }
      if (preventedPreviewOverwrite) {
        console.warn("[Editor] Prevented stale snapshot preview overwrite", {
          drawingId,
          fallbackElementCount: currentSnapshot.length,
        });
      }
      const svg = await exportToSvg({
        elements: normalizedSnapshot,
        appState: {
          ...appState,
          exportBackground: true,
          viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
        },
        files: currentFiles,
      });
      await api.updateDrawing(drawingId, { preview: svg.outerHTML });
    } catch (err) {
      console.error("Failed to save preview", err);
    }
  };

  saveLibraryRef.current = async (items: any[]) => {
    if (!user) return;
    try {
      await api.updateLibrary(items);
    } catch (err) {
      console.error("Failed to save library", err);
      if (api.isAxiosError(err) && err.response?.status === 401) return;
      toast.error("Failed to save library");
    }
  };

  const debouncedSave = useCallback(
    debounce((drawingId, elements, appState, files) => {
      enqueueSceneSave(drawingId, elements, appState, files);
    }, 1000),
    [enqueueSceneSave],
  );
  refs.debouncedSave.current = debouncedSave;

  const debouncedSavePreview = useCallback(
    debounce((drawingId: string) => {
      if (!savePreviewRef.current || !drawingId) return;
      if (refs.isUnmounting.current || refs.isSyncing.current) return;
      const expectedChangeAt = refs.lastLocalChangeAt.current;
      const run = () => {
        if (!savePreviewRef.current) return;
        if (refs.isUnmounting.current || refs.isSyncing.current) return;
        if (refs.lastLocalChangeAt.current !== expectedChangeAt) return;
        const appState = refs.latestAppState.current;
        if (!appState) return;
        void savePreviewRef.current(
          drawingId,
          refs.latestElements.current,
          appState,
          refs.latestFiles.current || {},
        );
      };
      const w = window as any;
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(run, { timeout: 2000 });
      } else {
        setTimeout(run, 0);
      }
    }, 30_000),
    [refs],
  );

  const debouncedSaveLibrary = useCallback(
    debounce((items: any[]) => {
      if (saveLibraryRef.current) saveLibraryRef.current(items);
    }, 1000),
    [],
  );

  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      debouncedSavePreview.cancel();
    };
  }, [debouncedSave, debouncedSavePreview]);

  return {
    debouncedSave,
    debouncedSaveLibrary,
    debouncedSavePreview,
    enqueueSceneSave,
    saveDataRef,
    savePreviewRef,
  };
};
