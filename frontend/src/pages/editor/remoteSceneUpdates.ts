import type { MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import { buildRemoteSceneUpdate, heldElementIds } from "./shared";

type RemoteSceneUpdateBindingInput = {
  socket: Socket;
  excalidrawAPI: MutableRefObject<any>;
  isSyncingRef: MutableRefObject<boolean>;
  lastSyncedFilesRef: MutableRefObject<Record<string, any>>;
  lastSyncedElementOrderSigRef: MutableRefObject<string>;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestFilesRef: MutableRefObject<any>;
  computeElementOrderSig: (elements: readonly any[]) => string;
  recordElementVersion: (element: any) => void;
};

/**
 * Batches incoming collaboration deltas into one scene update per animation
 * frame. The queue belongs to a socket binding, so disconnect and room-reset
 * cleanup can discard it atomically instead of leaving hook-level refs behind.
 */
export const bindRemoteSceneUpdates = ({
  socket,
  excalidrawAPI,
  isSyncingRef,
  lastSyncedFilesRef,
  lastSyncedElementOrderSigRef,
  latestElementsRef,
  latestFilesRef,
  computeElementOrderSig,
  recordElementVersion,
}: RemoteSceneUpdateBindingInput) => {
  const pendingElements = new Map<string, any>();
  let pendingFiles: Record<string, any> = {};
  let pendingElementOrder: string[] | null = null;
  let flushScheduled = false;
  let flushRafId: number | null = null;
  const hasNonEmptyArray = (value: unknown): value is any[] =>
    Array.isArray(value) && value.length > 0;

  const flushRemoteUpdates = () => {
    flushScheduled = false;
    flushRafId = null;
    if (!excalidrawAPI.current) return;
    const hasPendingElements = pendingElements.size > 0;
    const hasPendingFiles = Object.keys(pendingFiles || {}).length > 0;
    const pendingOrderRaw = pendingElementOrder;
    const hasPendingOrder = hasNonEmptyArray(pendingOrderRaw);
    if (!hasPendingElements && !hasPendingFiles && !hasPendingOrder) return;
    isSyncingRef.current = true;
    try {
      const elements = Array.from(pendingElements.values());
      pendingElements.clear();
      const incomingFiles = pendingFiles || {};
      pendingFiles = {};
      const elementOrder = hasPendingOrder ? pendingOrderRaw : null;
      pendingElementOrder = null;
      const { sceneUpdate, mergedElements, nextFiles, shouldUpdateFiles } = buildRemoteSceneUpdate({
        localElements: excalidrawAPI.current.getSceneElementsIncludingDeleted(),
        pendingElements: elements,
        elementOrder,
        lastSyncedFiles: lastSyncedFilesRef.current,
        incomingFiles,
        protectedIds: heldElementIds(excalidrawAPI.current.getAppState?.()),
      });
      if (shouldUpdateFiles && typeof excalidrawAPI.current.addFiles === "function") {
        excalidrawAPI.current.addFiles(Object.values(incomingFiles));
      }
      if (mergedElements) {
        if (elementOrder) {
          lastSyncedElementOrderSigRef.current = computeElementOrderSig(mergedElements);
        }
        elements.forEach((element: any) => recordElementVersion(element));
        if (sceneUpdate) excalidrawAPI.current.updateScene(sceneUpdate);
        latestElementsRef.current = mergedElements;
      } else if (sceneUpdate) {
        excalidrawAPI.current.updateScene(sceneUpdate);
      }
      if (shouldUpdateFiles) {
        latestFilesRef.current = nextFiles;
        lastSyncedFilesRef.current = nextFiles;
      }
    } finally {
      isSyncingRef.current = false;
    }
    const moreElements = pendingElements.size > 0;
    const moreFiles = Object.keys(pendingFiles || {}).length > 0;
    const moreOrder = hasNonEmptyArray(pendingElementOrder);
    if ((moreElements || moreFiles || moreOrder) && !flushScheduled) {
      flushScheduled = true;
      flushRafId = requestAnimationFrame(flushRemoteUpdates);
    }
  };
  const scheduleRemoteFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    flushRafId = requestAnimationFrame(flushRemoteUpdates);
  };
  const handleElementUpdate = ({
    elements,
    files,
    elementOrder,
  }: {
    elements: any[];
    files?: Record<string, any>;
    elementOrder?: string[];
  }) => {
    if (Array.isArray(elements)) {
      for (const element of elements) {
        const id = element?.id;
        if (typeof id === "string" && id.length > 0) pendingElements.set(id, element);
      }
    }
    if (files && typeof files === "object") pendingFiles = { ...pendingFiles, ...files };
    if (Array.isArray(elementOrder) && elementOrder.length > 0) {
      pendingElementOrder = elementOrder;
    }
    scheduleRemoteFlush();
  };
  const reset = () => {
    pendingElements.clear();
    pendingFiles = {};
    pendingElementOrder = null;
    if (flushRafId !== null) cancelAnimationFrame(flushRafId);
    flushRafId = null;
    flushScheduled = false;
  };

  socket.on("element-update", handleElementUpdate);
  return { reset, unbind: () => socket.off("element-update") };
};
