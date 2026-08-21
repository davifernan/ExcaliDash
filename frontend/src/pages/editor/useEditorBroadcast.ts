import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  createElementMarkerTransaction,
  createElementUpdateDelivery,
  createFileMarkerTransaction,
  splitFilesIntoUpdatePayloads,
  type ElementUpdatePacket,
} from "./elementUpdateDelivery";
import { getFilesDelta, type ElementVersionInfo } from "./shared";

type UseEditorBroadcastParams = {
  drawingId: string | undefined;
  elementUpdateRefusalHandlerRef: MutableRefObject<(() => void) | null>;
  elementVersionMap: MutableRefObject<Map<string, ElementVersionInfo>>;
  excalidrawAPI: MutableRefObject<any>;
  lastLocalChangeAtRef: MutableRefObject<number>;
  lastSyncedElementOrderSigRef: MutableRefObject<string>;
  lastSyncedFilesRef: MutableRefObject<Record<string, any>>;
  latestAppStateRef: MutableRefObject<any>;
  latestFilesRef: MutableRefObject<any>;
  socketRef: MutableRefObject<any>;
  debouncedSave: (
    drawingId: string,
    elements: readonly any[],
    appState: any,
    files?: Record<string, any>,
  ) => void;
  debouncedSavePreview: (drawingId: string) => void;
  computeElementOrderSig: (elements: readonly any[]) => string;
  hasElementChanged: (element: any) => boolean;
  normalizeImageElementStatus: (
    elements?: readonly any[],
    files?: Record<string, any> | null,
  ) => readonly any[];
  recordElementVersion: (element: any) => void;
  setHasSceneChangesSinceLoad: () => void;
};

type PendingUpdate = {
  elements: readonly any[];
  files?: Record<string, any>;
  filesOnly: boolean;
};

export const useEditorBroadcast = ({
  drawingId,
  elementUpdateRefusalHandlerRef,
  elementVersionMap,
  excalidrawAPI,
  lastLocalChangeAtRef,
  lastSyncedElementOrderSigRef,
  lastSyncedFilesRef,
  latestAppStateRef,
  latestFilesRef,
  socketRef,
  debouncedSave,
  debouncedSavePreview,
  computeElementOrderSig,
  hasElementChanged,
  normalizeImageElementStatus,
  recordElementVersion,
  setHasSceneChangesSinceLoad,
}: UseEditorBroadcastParams) => {
  const timeoutRef = useRef<number | null>(null);
  const lastRunAtRef = useRef(0);
  const trailingArgsRef = useRef<[readonly any[], Record<string, any> | undefined] | null>(null);
  const pendingUpdateRef = useRef<PendingUpdate | null>(null);
  const sendingRef = useRef(false);
  const flushPendingRef = useRef<((update: PendingUpdate) => void) | null>(null);
  const deliveryRef = useRef<ReturnType<typeof createElementUpdateDelivery> | null>(null);

  useEffect(() => {
    const delivery = createElementUpdateDelivery({
      emit: (payload) => socketRef.current?.emit("element-update", payload),
    });
    deliveryRef.current = delivery;
    const refuseActive = () => delivery.refuseActive();
    elementUpdateRefusalHandlerRef.current = refuseActive;
    return () => {
      if (deliveryRef.current === delivery) deliveryRef.current = null;
      if (elementUpdateRefusalHandlerRef.current === refuseActive) {
        elementUpdateRefusalHandlerRef.current = null;
      }
    };
  }, [drawingId, elementUpdateRefusalHandlerRef, socketRef]);

  const queueUpdate = useCallback(
    (elements: readonly any[], currentFiles?: Record<string, any>, filesOnly = false) => {
      if (!socketRef.current || !drawingId) return false;
      const delivery = deliveryRef.current;
      if (!delivery) return false;
      const nextFiles = currentFiles || excalidrawAPI.current?.getFiles() || {};
      const filesDelta = getFilesDelta(lastSyncedFilesRef.current, nextFiles);
      const hasFiles = Object.keys(filesDelta).length > 0;
      if (Object.keys(nextFiles).length > 0) latestFilesRef.current = nextFiles;

      if (sendingRef.current) {
        const pending = pendingUpdateRef.current;
        pendingUpdateRef.current =
          pending && !pending.filesOnly && filesOnly
            ? { ...pending, files: nextFiles }
            : { elements, files: nextFiles, filesOnly };
        return hasFiles;
      }

      const normalizedElements = filesOnly
        ? elements
        : normalizeImageElementStatus(elements, nextFiles);
      const changes = filesOnly
        ? []
        : normalizedElements.filter((element) => hasElementChanged(element));
      const nextOrderSig = filesOnly ? undefined : computeElementOrderSig(normalizedElements);
      const shouldSyncOrder =
        nextOrderSig !== undefined && nextOrderSig !== lastSyncedElementOrderSigRef.current;
      const packets: ElementUpdatePacket[] = splitFilesIntoUpdatePayloads({
        drawingId,
        files: filesDelta,
      }).map((payload) => ({
        payload,
        marker: createFileMarkerTransaction({
          files: payload.files!,
          lastSyncedFilesRef,
        }),
      }));

      if (changes.length > 0 || shouldSyncOrder) {
        packets.push({
          payload: {
            drawingId,
            elements: changes,
            elementOrder: shouldSyncOrder
              ? normalizedElements.map((element: any) => element?.id).filter(Boolean)
              : undefined,
          },
          marker: createElementMarkerTransaction({
            elements: changes,
            elementVersionMap,
            lastSyncedElementOrderSigRef,
            nextOrderSig: shouldSyncOrder ? nextOrderSig : undefined,
            recordElementVersion,
          }),
        });
      }
      if (packets.length === 0) return false;

      setHasSceneChangesSinceLoad();
      lastLocalChangeAtRef.current = Date.now();
      const appState = latestAppStateRef.current;
      if (appState) {
        debouncedSave(drawingId, normalizedElements, appState, nextFiles);
        debouncedSavePreview(drawingId);
      }
      sendingRef.current = true;
      void delivery.deliver(packets).finally(() => {
        sendingRef.current = false;
        const pending = pendingUpdateRef.current;
        pendingUpdateRef.current = null;
        if (pending) flushPendingRef.current?.(pending);
      });
      return true;
    },
    [
      computeElementOrderSig,
      debouncedSave,
      debouncedSavePreview,
      drawingId,
      elementVersionMap,
      excalidrawAPI,
      hasElementChanged,
      lastLocalChangeAtRef,
      lastSyncedElementOrderSigRef,
      lastSyncedFilesRef,
      latestAppStateRef,
      latestFilesRef,
      normalizeImageElementStatus,
      recordElementVersion,
      setHasSceneChangesSinceLoad,
      socketRef,
    ],
  );
  useEffect(() => {
    flushPendingRef.current = (update) =>
      queueUpdate(update.elements, update.files, update.filesOnly);
    return () => {
      flushPendingRef.current = null;
    };
  }, [queueUpdate]);

  const emitChanges = useCallback(
    (elements: readonly any[], currentFiles?: Record<string, any>) => {
      queueUpdate(elements, currentFiles);
    },
    [queueUpdate],
  );

  const broadcastChanges = useCallback(
    (elements: readonly any[], currentFiles?: Record<string, any>) => {
      const now = Date.now();
      const elapsed = now - lastRunAtRef.current;
      if (elapsed >= 100) {
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
          trailingArgsRef.current = null;
        }
        lastRunAtRef.current = now;
        emitChanges(elements, currentFiles);
        return;
      }
      trailingArgsRef.current = [elements, currentFiles];
      if (timeoutRef.current) return;
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        const args = trailingArgsRef.current;
        trailingArgsRef.current = null;
        if (!args) return;
        lastRunAtRef.current = Date.now();
        emitChanges(...args);
      }, 100 - elapsed);
    },
    [emitChanges],
  );

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return {
    broadcastChanges,
    broadcastFiles: (files: Record<string, any>) => queueUpdate([], files, true),
  };
};
