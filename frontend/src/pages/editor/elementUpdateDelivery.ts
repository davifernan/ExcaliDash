import type { MutableRefObject } from "react";
import type { ElementVersionInfo } from "./shared";

export const LIVE_UPDATE_MAX_BYTES = 11 * 1024 * 1024;
export const LIVE_UPDATE_MAX_FILES = 1_000;
export const LIVE_UPDATE_MAX_ATTEMPTS = 3;
export const LIVE_UPDATE_REFUSAL_SETTLE_MS = 500;
export const LIVE_UPDATE_RETRY_MS = 500;

type ElementUpdatePayload = {
  drawingId: string;
  elements: readonly any[];
  files?: Record<string, any>;
  elementOrder?: string[];
};

type MarkerTransaction = {
  apply: () => void;
  rollback: () => void;
};

export type ElementUpdatePacket = {
  payload: ElementUpdatePayload;
  marker?: MarkerTransaction;
};

const payloadBytes = (payload: ElementUpdatePayload) =>
  new TextEncoder().encode(JSON.stringify(payload)).byteLength;

/**
 * Keeps file-only events below the smallest production transport envelope.
 * Server validation remains authoritative; this only avoids creating packets
 * that a legitimate guest can never relay.
 */
export const splitFilesIntoUpdatePayloads = ({
  drawingId,
  files,
  maxBytes = LIVE_UPDATE_MAX_BYTES,
  maxFiles = LIVE_UPDATE_MAX_FILES,
}: {
  drawingId: string;
  files: Record<string, any>;
  maxBytes?: number;
  maxFiles?: number;
}): ElementUpdatePayload[] => {
  const payloads: ElementUpdatePayload[] = [];
  let batch: Record<string, any> = {};
  for (const [id, file] of Object.entries(files)) {
    const candidate = { ...batch, [id]: file };
    const candidatePayload = { drawingId, elements: [], files: candidate };
    if (
      Object.keys(batch).length > 0 &&
      (Object.keys(candidate).length > maxFiles || payloadBytes(candidatePayload) > maxBytes)
    ) {
      payloads.push({ drawingId, elements: [], files: batch });
      batch = { [id]: file };
    } else {
      batch = candidate;
    }
  }
  if (Object.keys(batch).length > 0) {
    payloads.push({ drawingId, elements: [], files: batch });
  }
  return payloads;
};

export const createFileMarkerTransaction = ({
  files,
  lastSyncedFilesRef,
}: {
  files: Record<string, any>;
  lastSyncedFilesRef: MutableRefObject<Record<string, any>>;
}): MarkerTransaction => {
  const previous = new Map(
    Object.keys(files).map((id) => [
      id,
      Object.prototype.hasOwnProperty.call(lastSyncedFilesRef.current, id)
        ? { present: true, value: lastSyncedFilesRef.current[id] }
        : { present: false, value: undefined },
    ]),
  );
  return {
    apply: () => {
      lastSyncedFilesRef.current = { ...lastSyncedFilesRef.current, ...files };
    },
    rollback: () => {
      const restored = { ...lastSyncedFilesRef.current };
      for (const [id, file] of Object.entries(files)) {
        if (restored[id] !== file) continue;
        const prior = previous.get(id)!;
        if (prior.present) restored[id] = prior.value;
        else delete restored[id];
      }
      lastSyncedFilesRef.current = restored;
    },
  };
};

export const createElementMarkerTransaction = ({
  elements,
  elementVersionMap,
  lastSyncedElementOrderSigRef,
  nextOrderSig,
  recordElementVersion,
}: {
  elements: readonly any[];
  elementVersionMap: MutableRefObject<Map<string, ElementVersionInfo>>;
  lastSyncedElementOrderSigRef: MutableRefObject<string>;
  nextOrderSig?: string;
  recordElementVersion: (element: any) => void;
}): MarkerTransaction => {
  const previousVersions = new Map(
    elements.map((element) => [element.id, elementVersionMap.current.get(element.id)]),
  );
  const previousOrderSig = lastSyncedElementOrderSigRef.current;
  const appliedVersions = new Map<string, ElementVersionInfo>();
  return {
    apply: () => {
      if (nextOrderSig !== undefined) lastSyncedElementOrderSigRef.current = nextOrderSig;
      for (const element of elements) {
        recordElementVersion(element);
        const recorded = elementVersionMap.current.get(element.id);
        if (recorded) appliedVersions.set(element.id, recorded);
      }
    },
    rollback: () => {
      if (nextOrderSig !== undefined && lastSyncedElementOrderSigRef.current === nextOrderSig) {
        lastSyncedElementOrderSigRef.current = previousOrderSig;
      }
      for (const element of elements) {
        if (elementVersionMap.current.get(element.id) !== appliedVersions.get(element.id)) continue;
        const previous = previousVersions.get(element.id);
        if (previous) elementVersionMap.current.set(element.id, previous);
        else elementVersionMap.current.delete(element.id);
      }
    },
  };
};

const packetSignature = (packet: ElementUpdatePacket) => {
  let hash = 2166136261;
  const serialized = JSON.stringify(packet.payload);
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${serialized.length}:${(hash >>> 0).toString(16)}`;
};

export const createElementUpdateDelivery = ({
  emit,
  maxAttempts = LIVE_UPDATE_MAX_ATTEMPTS,
  settleMs = LIVE_UPDATE_REFUSAL_SETTLE_MS,
  retryMs = LIVE_UPDATE_RETRY_MS,
  onGiveUp,
}: {
  emit: (payload: ElementUpdatePayload) => void;
  maxAttempts?: number;
  settleMs?: number;
  retryMs?: number;
  onGiveUp?: () => void;
}) => {
  let activeRefusal: (() => void) | null = null;
  let failedPacketSignature: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  const waitForOutcome = (payload: ElementUpdatePayload) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (refused: boolean) => {
        if (settled) return;
        settled = true;
        activeRefusal = null;
        window.clearTimeout(timer);
        resolve(refused);
      };
      const timer = window.setTimeout(() => finish(false), settleMs);
      activeRefusal = () => finish(true);
      emit(payload);
    });

  const retryDelay = () => new Promise<void>((resolve) => window.setTimeout(resolve, retryMs));

  const run = async (packets: readonly ElementUpdatePacket[]) => {
    for (const packet of packets) {
      const signature = packetSignature(packet);
      if (signature === failedPacketSignature) return false;
      let accepted = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        packet.marker?.apply();
        const refused = await waitForOutcome(packet.payload);
        if (!refused) {
          accepted = true;
          break;
        }
        packet.marker?.rollback();
        if (attempt < maxAttempts) await retryDelay();
      }
      if (!accepted) {
        failedPacketSignature = signature;
        onGiveUp?.();
        return false;
      }
    }
    failedPacketSignature = null;
    return true;
  };

  return {
    deliver: (packets: readonly ElementUpdatePacket[]) => {
      const result = tail.then(() => run(packets));
      tail = result.catch(() => false);
      return result;
    },
    refuseActive: () => activeRefusal?.(),
  };
};
