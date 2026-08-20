import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import type { UserIdentity } from "../../utils/identity";
import { buildRemoteSceneUpdate } from "./shared";
import { bindFollowMode, type Follower } from "./followMode";
import { bindCanvasWheelZoom } from "./wheelZoom";

export interface Peer {
  presenceId: string;
  accountId: string | null;
  name: string;
  initials: string;
  color: string;
  isActive: boolean;
}

type UseEditorCollaborationInput = {
  drawingId?: string;
  me: UserIdentity;
  isReady: boolean;
  excalidrawAPI: MutableRefObject<any>;
  editorContainerRef: RefObject<HTMLDivElement>;
  lastSyncedFilesRef: MutableRefObject<Record<string, any>>;
  lastSyncedElementOrderSigRef: MutableRefObject<string>;
  latestElementsRef: MutableRefObject<readonly any[]>;
  latestFilesRef: MutableRefObject<any>;
  computeElementOrderSig: (elements: readonly any[]) => string;
  recordElementVersion: (element: any) => void;
  onAccessDenied: () => void;
};

const getSocketUrl = () =>
  import.meta.env.VITE_API_URL === "/api"
    ? window.location.origin
    : import.meta.env.VITE_API_URL ||
      import.meta.env.VITE_DEV_BACKEND_URL ||
      "http://localhost:8000";

export const useEditorCollaboration = ({
  drawingId,
  me,
  isReady,
  excalidrawAPI,
  editorContainerRef,
  lastSyncedFilesRef,
  lastSyncedElementOrderSigRef,
  latestElementsRef,
  latestFilesRef,
  computeElementOrderSig,
  recordElementVersion,
  onAccessDenied,
}: UseEditorCollaborationInput) => {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [followers, setFollowers] = useState<Follower[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const lastPresenceUsersRef = useRef<Peer[] | null>(null);
  const selfPresenceIdRef = useRef<string | null>(null);
  const knownPresenceIdsRef = useRef<Set<string>>(new Set());
  const lastCursorEmit = useRef<number>(0);
  const cursorBuffer = useRef<Map<string, any>>(new Map());
  const animationFrameId = useRef<number>(0);
  const isSyncing = useRef(false);
  const pendingRemoteElementsRef = useRef<Map<string, any>>(new Map());
  const pendingRemoteFilesRef = useRef<Record<string, any>>({});
  const pendingRemoteElementOrderRef = useRef<string[] | null>(null);
  const remoteFlushScheduledRef = useRef(false);
  const remoteFlushRafIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!drawingId || !isReady) return;
    const socket = io(getSocketUrl(), {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    socketRef.current = socket;
    if (import.meta.env.DEV) {
      (window as any).__EXCALIDASH_SOCKET_STATUS__ = {
        connected: socket.connected,
      };
      socket.on("connect", () => {
        (window as any).__EXCALIDASH_SOCKET_STATUS__ = { connected: true };
      });
      socket.on("disconnect", () => {
        (window as any).__EXCALIDASH_SOCKET_STATUS__ = { connected: false };
      });
    }
    socket.emit("join-room", { drawingId, user: me }, (payload: any) => {
      const serverUser = payload?.presence;
      if (!serverUser || typeof serverUser.presenceId !== "string") return;
      selfPresenceIdRef.current = serverUser.presenceId;
      const lastUsers = lastPresenceUsersRef.current;
      if (lastUsers) {
        setPeers(
          lastUsers.filter(
            (user) => user.presenceId !== selfPresenceIdRef.current,
          ),
        );
      }
    });
    const renderLoop = () => {
      if (cursorBuffer.current.size > 0 && excalidrawAPI.current) {
        const collaborators = new Map<string, any>(
          excalidrawAPI.current.getAppState().collaborators || [],
        );
        cursorBuffer.current.forEach((data, presenceId) => {
          collaborators.set(presenceId, data);
        });
        cursorBuffer.current.clear();
        const { sceneUpdate } = buildRemoteSceneUpdate({ collaborators });
        if (sceneUpdate) {
          excalidrawAPI.current.updateScene(sceneUpdate);
        }
      }
      animationFrameId.current = requestAnimationFrame(renderLoop);
    };
    renderLoop();
    socket.on("presence-update", (users: Peer[]) => {
      lastPresenceUsersRef.current = users;
      const selfId = selfPresenceIdRef.current || socket.id;
      setPeers(users.filter((user) => user.presenceId !== selfId));
      if (excalidrawAPI.current) {
        const collaborators = new Map<string, any>(
          excalidrawAPI.current.getAppState().collaborators || [],
        );
        const nextPresenceIds = new Set(
          users
            .filter((user) => user.presenceId !== selfId)
            .map((user) => user.presenceId),
        );
        knownPresenceIdsRef.current.forEach((presenceId) => {
          if (!nextPresenceIds.has(presenceId)) {
            collaborators.delete(presenceId);
          }
        });
        users.forEach((user) => {
          if (user.presenceId === selfId) return;
          if (!user.isActive) {
            collaborators.delete(user.presenceId);
            return;
          }
          const existing = collaborators.get(user.presenceId) || {};
          collaborators.set(user.presenceId, {
            ...existing,
            id: user.presenceId,
            username: user.name,
            color: { background: user.color, stroke: user.color },
            isCurrentUser: false,
          });
        });
        knownPresenceIdsRef.current = nextPresenceIds;
        const { sceneUpdate } = buildRemoteSceneUpdate({ collaborators });
        if (sceneUpdate) {
          excalidrawAPI.current.updateScene(sceneUpdate);
        }
      }
    });
    socket.on("error", (payload: any) => {
      const message =
        typeof payload?.message === "string" ? payload.message : null;
      console.warn("[Editor] Socket error:", payload);
      if (message === "You do not have access to this drawing") {
        onAccessDenied();
        return;
      }
      if (message) toast.error(message);
    });
    socket.on("cursor-move", (data: any) => {
      if (typeof data?.presenceId !== "string") return;
      cursorBuffer.current.set(data.presenceId, {
        pointer: data.pointer,
        button: data.button || "up",
        username: data.username,
        color: { background: data.color, stroke: data.color },
        id: data.presenceId,
      });
    });
    const unbindFollowMode = bindFollowMode({
      socket,
      drawingId,
      api: excalidrawAPI.current,
      container: editorContainerRef.current,
      onFollowersChange: setFollowers,
    });
    const hasNonEmptyArray = (value: unknown): value is any[] =>
      Array.isArray(value) && value.length > 0;
    const flushRemoteUpdates = () => {
      remoteFlushScheduledRef.current = false;
      remoteFlushRafIdRef.current = null;
      if (!excalidrawAPI.current) return;
      const hasPendingElements = pendingRemoteElementsRef.current.size > 0;
      const hasPendingFiles =
        Object.keys(pendingRemoteFilesRef.current || {}).length > 0;
      const pendingOrderRaw = pendingRemoteElementOrderRef.current;
      const hasPendingOrder = hasNonEmptyArray(pendingOrderRaw);
      if (!hasPendingElements && !hasPendingFiles && !hasPendingOrder) return;
      isSyncing.current = true;
      try {
        const pendingElements = Array.from(
          pendingRemoteElementsRef.current.values(),
        );
        pendingRemoteElementsRef.current.clear();
        const incomingFiles = pendingRemoteFilesRef.current || {};
        pendingRemoteFilesRef.current = {};
        const elementOrder = hasPendingOrder ? pendingOrderRaw : null;
        pendingRemoteElementOrderRef.current = null;
        const { sceneUpdate, mergedElements, nextFiles, shouldUpdateFiles } =
          buildRemoteSceneUpdate({
            localElements:
              excalidrawAPI.current.getSceneElementsIncludingDeleted(),
            pendingElements,
            elementOrder,
            lastSyncedFiles: lastSyncedFilesRef.current,
            incomingFiles,
          });
        if (
          shouldUpdateFiles &&
          typeof excalidrawAPI.current.addFiles === "function"
        ) {
          excalidrawAPI.current.addFiles(Object.values(incomingFiles));
        }
        if (mergedElements) {
          if (elementOrder) {
            lastSyncedElementOrderSigRef.current =
              computeElementOrderSig(mergedElements);
          }
          pendingElements.forEach((el: any) => {
            recordElementVersion(el);
          });
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
        isSyncing.current = false;
      }
      const moreElements = pendingRemoteElementsRef.current.size > 0;
      const moreFiles =
        Object.keys(pendingRemoteFilesRef.current || {}).length > 0;
      const moreOrder = hasNonEmptyArray(pendingRemoteElementOrderRef.current);
      if (moreElements || moreFiles || moreOrder) {
        if (!remoteFlushScheduledRef.current) {
          remoteFlushScheduledRef.current = true;
          remoteFlushRafIdRef.current =
            requestAnimationFrame(flushRemoteUpdates);
        }
      }
    };
    const scheduleRemoteFlush = () => {
      if (remoteFlushScheduledRef.current) return;
      remoteFlushScheduledRef.current = true;
      remoteFlushRafIdRef.current = requestAnimationFrame(flushRemoteUpdates);
    };
    socket.on(
      "element-update",
      ({
        elements,
        files,
        elementOrder,
      }: {
        elements: any[];
        files?: Record<string, any>;
        elementOrder?: string[];
      }) => {
        if (Array.isArray(elements)) {
          for (const el of elements) {
            const id = el?.id;
            if (typeof id === "string" && id.length > 0) {
              pendingRemoteElementsRef.current.set(id, el);
            }
          }
        }
        if (files && typeof files === "object") {
          pendingRemoteFilesRef.current = {
            ...pendingRemoteFilesRef.current,
            ...files,
          };
        }
        if (Array.isArray(elementOrder) && elementOrder.length > 0) {
          pendingRemoteElementOrderRef.current = elementOrder;
        }
        scheduleRemoteFlush();
      },
    );
    socket.on("drawing-server-update", (payload: { drawingId?: string }) => {
      if (!payload?.drawingId || payload.drawingId !== drawingId) return;
      toast.info(
        "Drawing storage changed on the server. Reloading the editor.",
      );
      window.location.reload();
    });
    const handleActivity = (isActive: boolean) => {
      socket.emit("user-activity", { drawingId, isActive });
    };
    const onFocus = () => handleActivity(true);
    const onBlur = () => handleActivity(false);
    const onMouseEnter = () => handleActivity(true);
    const onMouseLeave = () => handleActivity(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("mouseenter", onMouseEnter);
    document.addEventListener("mouseleave", onMouseLeave);
    const container = editorContainerRef.current;
    const unbindWheelZoom = bindCanvasWheelZoom(container);
    return () => {
      unbindWheelZoom();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mouseenter", onMouseEnter);
      document.removeEventListener("mouseleave", onMouseLeave);
      socket.off("presence-update");
      socket.off("error");
      socket.off("cursor-move");
      socket.off("element-update");
      socket.off("drawing-server-update");
      unbindFollowMode();
      socket.disconnect();
      if (remoteFlushRafIdRef.current !== null) {
        cancelAnimationFrame(remoteFlushRafIdRef.current);
        remoteFlushRafIdRef.current = null;
      }
      remoteFlushScheduledRef.current = false;
      pendingRemoteElementsRef.current.clear();
      pendingRemoteFilesRef.current = {};
      pendingRemoteElementOrderRef.current = null;
      selfPresenceIdRef.current = null;
      knownPresenceIdsRef.current.clear();
      cancelAnimationFrame(animationFrameId.current);
    };
  }, [
    drawingId,
    me,
    isReady,
    excalidrawAPI,
    editorContainerRef,
    lastSyncedFilesRef,
    lastSyncedElementOrderSigRef,
    latestElementsRef,
    latestFilesRef,
    computeElementOrderSig,
    recordElementVersion,
    onAccessDenied,
  ]);

  const onPointerUpdate = useCallback(
    (payload: any) => {
      const now = Date.now();
      if (now - lastCursorEmit.current > 50 && socketRef.current) {
        socketRef.current.emit("cursor-move", {
          pointer: payload.pointer,
          button: payload.button,
          drawingId,
        });
        lastCursorEmit.current = now;
      }
    },
    [drawingId],
  );

  return {
    peers,
    followers,
    socketRef,
    isSyncing,
    onPointerUpdate,
  };
};
