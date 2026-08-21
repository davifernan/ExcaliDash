export const SOCKET_LIMITS = {
  drawingIdLength: 200,
  coordinateAbs: 1_000_000_000,
  viewportSpan: 100_000_000,
  elementsPerUpdate: 10_000,
  filesPerUpdate: 1_000,
  elementOrderLength: 20_000,
} as const;

export const SOCKET_QUEUE_LIMITS = { joins: 8 } as const;

export type SceneBounds = [number, number, number, number];

export type { PresenceEntry as PresenceUser } from "./presenceRegistry";

export type CursorPayload = {
  drawingId: string;
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "up" | "down";
};

export type ElementUpdatePayload = {
  drawingId: string;
  elements: unknown[];
  files?: Record<string, unknown>;
  elementOrder?: string[];
};

export const parseDrawingId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const drawingId = value.trim();
  if (!drawingId || drawingId.length > SOCKET_LIMITS.drawingIdLength) return null;
  return drawingId;
};

const isWorldCoordinate = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= SOCKET_LIMITS.coordinateAbs;

export const parseSceneBounds = (value: unknown): SceneBounds | null => {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [x1, y1, x2, y2] = value;
  if (
    !isWorldCoordinate(x1) ||
    !isWorldCoordinate(y1) ||
    !isWorldCoordinate(x2) ||
    !isWorldCoordinate(y2)
  ) {
    return null;
  }
  const width = x2 - x1;
  const height = y2 - y1;
  if (
    width <= 0 ||
    height <= 0 ||
    width > SOCKET_LIMITS.viewportSpan ||
    height > SOCKET_LIMITS.viewportSpan
  ) {
    return null;
  }
  return [x1, y1, x2, y2];
};

export const parseCursorPayload = (value: unknown): CursorPayload | null => {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const drawingId = parseDrawingId(data.drawingId);
  const rawPointer = data.pointer;
  if (!drawingId || !rawPointer || typeof rawPointer !== "object") return null;
  const pointer = rawPointer as Record<string, unknown>;
  if (!isWorldCoordinate(pointer.x) || !isWorldCoordinate(pointer.y)) return null;
  if (pointer.tool !== "pointer" && pointer.tool !== "laser") return null;
  const button = data.button === "down" ? "down" : "up";
  return {
    drawingId,
    pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
    button,
  };
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseElementUpdatePayload = (value: unknown): ElementUpdatePayload | null => {
  if (!isPlainRecord(value)) return null;
  const drawingId = parseDrawingId(value.drawingId);
  if (!drawingId || !Array.isArray(value.elements)) return null;
  if (value.elements.length > SOCKET_LIMITS.elementsPerUpdate) return null;

  let files: Record<string, unknown> | undefined;
  if (value.files !== undefined) {
    if (!isPlainRecord(value.files)) return null;
    if (Object.keys(value.files).length > SOCKET_LIMITS.filesPerUpdate) return null;
    files = value.files;
  }

  let elementOrder: string[] | undefined;
  if (value.elementOrder !== undefined) {
    if (
      !Array.isArray(value.elementOrder) ||
      value.elementOrder.length > SOCKET_LIMITS.elementOrderLength ||
      !value.elementOrder.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)
    ) {
      return null;
    }
    elementOrder = value.elementOrder;
  }

  return { drawingId, elements: value.elements, files, elementOrder };
};

export const createRateLimiter = (limit: number, windowMs: number) => {
  let windowStartedAt = 0;
  let count = 0;
  return (now = Date.now()): boolean => {
    if (now - windowStartedAt >= windowMs) {
      windowStartedAt = now;
      count = 0;
    }
    count += 1;
    return count <= limit;
  };
};

export const createKeyedRateLimiter = (limit: number, windowMs: number, maxKeys = 10_000) => {
  const buckets = new Map<string, { windowStartedAt: number; count: number }>();
  return (key: string, now = Date.now()): boolean => {
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= windowMs) {
      if (!bucket && buckets.size >= maxKeys) {
        for (const [candidateKey, candidate] of buckets) {
          if (now - candidate.windowStartedAt >= windowMs) buckets.delete(candidateKey);
        }
        // Refusing a new bucket is safer than evicting a live one and letting
        // an attacker reset limits by cycling through disposable addresses.
        if (buckets.size >= maxKeys) return false;
      }
      bucket = { windowStartedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
};
