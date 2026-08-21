import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import type { UserIdentity } from "../../utils/identity";
import { bindFollowMode, getFollowInterruptionMessage, type Follower } from "./followMode";
import { bindCanvasWheelZoom } from "./wheelZoom";
import { bindSocketRoomLifecycle } from "./socketRoomLifecycle";
import { getShareLinkToken } from "../../api";
import { bindSocketCollaborators } from "./socketCollaborators";
import type { Peer } from "./socketCollaborators";
import { bindRemoteSelection } from "./remoteSelection";
import { bindElementUpdateRefusals } from "./elementUpdateRefusal";
import { startCursorChat, type CursorChatController } from "./cursorChat";
import {
  bindSocketWorkshopTimer,
  createIdleWorkshopTimerSnapshot,
  WORKSHOP_TIMER_COMMAND_EVENT,
  type WorkshopTimerAction,
} from "./workshopTimer";
import { bindInviteHere, type InviteHereStatus, type ViewportInvitation } from "./inviteHere";
import { bindRemoteSceneUpdates } from "./remoteSceneUpdates";
export type { Peer } from "./socketCollaborators";

type UseEditorCollaborationInput = {
  drawingId?: string;
  me: UserIdentity;
  isReady: boolean;
  excalidrawAPI: MutableRefObject<any>;
  editorContainerRef: RefObject<HTMLDivElement>;
  elementUpdateRefusalHandlerRef: MutableRefObject<(() => void) | null>;
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
  elementUpdateRefusalHandlerRef,
  lastSyncedFilesRef,
  lastSyncedElementOrderSigRef,
  latestElementsRef,
  latestFilesRef,
  computeElementOrderSig,
  recordElementVersion,
  onAccessDenied,
}: UseEditorCollaborationInput) => {
  const [peers, setPeers] = useState<Peer[]>([]);
  // Ref because it outlives renders; the draft is state because React draws it.
  const cursorChatRef = useRef<CursorChatController | null>(null);
  const [cursorChatDraft, setCursorChatDraft] = useState<string | null>(null);
  // What the server decided this connection is called. For an account it agrees
  // with the local identity; for a share-link visitor the server picks the name,
  // and showing them a different one than everyone else sees is a small lie.
  const [selfIdentity, setSelfIdentity] = useState<UserIdentity | null>(null);
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [workshopTimerSnapshot, setWorkshopTimerSnapshot] = useState(() =>
    createIdleWorkshopTimerSnapshot(drawingId || ""),
  );
  const [viewportInvitation, setViewportInvitation] = useState<ViewportInvitation | null>(null);
  const [inviteHereStatus, setInviteHereStatus] = useState<InviteHereStatus | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const inviteHereRef = useRef<ReturnType<typeof bindInviteHere> | null>(null);
  const lastCursorEmit = useRef<number>(0);
  const selectionPublisherRef = useRef<((appState: any) => void) | null>(null);
  const isSyncing = useRef(false);
  const shareToken = getShareLinkToken();
  useEffect(() => {
    if (!drawingId || !isReady) return;
    setSelfIdentity(null);
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
    // Bound before the collaborators (they read it), referred to after (a
    // message has to refresh the names).
    let collaborators: ReturnType<typeof bindSocketCollaborators> | null = null;
    const chat = startCursorChat({
      socket,
      drawingId,
      onRemoteChange: () => collaborators?.refresh(),
      onDraftChange: setCursorChatDraft,
    });
    const cursorChat = chat.controller;
    cursorChatRef.current = cursorChat;

    collaborators = bindSocketCollaborators({
      socket,
      api: excalidrawAPI.current,
      onPeersChange: (nextPeers) => {
        chat.prunePeers(nextPeers);
        setPeers(nextPeers);
      },
      decorateName: chat.decorateName,
    });
    const refusals = bindElementUpdateRefusals({
      socket,
      notify: toast.warning,
      onRefused: () => elementUpdateRefusalHandlerRef.current?.(),
    });
    const remoteSelection = bindRemoteSelection({ socket, drawingId, api: excalidrawAPI.current });
    const workshopTimer = bindSocketWorkshopTimer({
      socket,
      drawingId,
      onChange: setWorkshopTimerSnapshot,
    });
    const inviteHereController = bindInviteHere({
      socket,
      drawingId,
      api: excalidrawAPI.current,
      onInvitationChange: setViewportInvitation,
      onStatusChange: setInviteHereStatus,
    });
    inviteHereRef.current = inviteHereController;
    selectionPublisherRef.current = remoteSelection.publish;
    socket.on("error", (payload: any) => {
      const message = typeof payload?.message === "string" ? payload.message : null;
      console.warn("[Editor] Socket error:", payload);
      if (message === "You do not have access to this drawing") {
        onAccessDenied();
        return;
      }
      if (message) toast.error(message);
    });
    const unbindFollowMode = bindFollowMode({
      socket,
      drawingId,
      api: excalidrawAPI.current,
      container: editorContainerRef.current,
      onFollowersChange: setFollowers,
      onFollowInterrupted: (reason) => toast.info(getFollowInterruptionMessage(reason)),
    });
    let remoteSceneUpdates: ReturnType<typeof bindRemoteSceneUpdates> | null = null;
    const resetConnectionState = () => {
      unbindFollowMode.resetConnectionState();
      // The clearing message is volatile: dropped mid-sentence it never
      // arrives, and the same presence returns wearing what it used to say.
      cursorChat.pruneTo([]);
      collaborators.reset();
      refusals.reset();
      remoteSelection.reset();
      workshopTimer.reset();
      inviteHereController.reset();
      setFollowers([]);
      remoteSceneUpdates?.reset();
    };
    const unbindSocketRoomLifecycle = bindSocketRoomLifecycle({
      socket,
      drawingId,
      shareToken,
      user: me,
      resetConnectionState,
      onJoined: (serverUser) => {
        collaborators.setSelfPresenceId(serverUser.presenceId);
        remoteSelection.publish(excalidrawAPI.current.getAppState());
        if (serverUser.name && serverUser.color) {
          setSelfIdentity({
            id: me.id,
            name: serverUser.name,
            initials: serverUser.initials || me.initials,
            color: serverUser.color,
          });
        }
      },
      getFollowTargetPresenceId: () =>
        excalidrawAPI.current?.getAppState().userToFollow?.socketId || null,
    });
    remoteSceneUpdates = bindRemoteSceneUpdates({
      socket,
      excalidrawAPI,
      isSyncingRef: isSyncing,
      lastSyncedFilesRef,
      lastSyncedElementOrderSigRef,
      latestElementsRef,
      latestFilesRef,
      computeElementOrderSig,
      recordElementVersion,
    });
    socket.on("drawing-server-update", (payload: { drawingId?: string }) => {
      if (!payload?.drawingId || payload.drawingId !== drawingId) return;
      toast.info("Drawing storage changed on the server. Reloading the editor.");
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
      socket.off("error");
      remoteSceneUpdates?.unbind();
      socket.off("drawing-server-update");
      unbindSocketRoomLifecycle();
      unbindFollowMode();
      cursorChat.dispose();
      cursorChatRef.current = null;
      setCursorChatDraft(null);
      collaborators.dispose();
      refusals.dispose();
      remoteSelection.dispose();
      workshopTimer.dispose();
      inviteHereController.dispose();
      if (inviteHereRef.current === inviteHereController) inviteHereRef.current = null;
      if (selectionPublisherRef.current === remoteSelection.publish) {
        selectionPublisherRef.current = null;
      }
      socket.disconnect();
      remoteSceneUpdates?.reset();
    };
  }, [
    drawingId,
    me,
    isReady,
    excalidrawAPI,
    editorContainerRef,
    elementUpdateRefusalHandlerRef,
    lastSyncedFilesRef,
    lastSyncedElementOrderSigRef,
    latestElementsRef,
    latestFilesRef,
    computeElementOrderSig,
    recordElementVersion,
    onAccessDenied,
    shareToken,
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
  const onSelectionChange = useCallback((appState: any) => {
    selectionPublisherRef.current?.(appState);
  }, []);
  const sendWorkshopTimerCommand = useCallback(
    (action: WorkshopTimerAction, durationMs?: number) => {
      if (!drawingId || !socketRef.current) return;
      socketRef.current.emit(WORKSHOP_TIMER_COMMAND_EVENT, { drawingId, action, durationMs });
    },
    [drawingId],
  );
  const inviteHere = {
    invitation: viewportInvitation,
    status: inviteHereStatus,
    invite: () => inviteHereRef.current?.invite(),
    accept: () => inviteHereRef.current?.accept(),
    decline: () => inviteHereRef.current?.decline(),
  };

  return {
    peers,
    cursorChatRef,
    cursorChatDraft,
    selfIdentity,
    followers,
    workshopTimer: { snapshot: workshopTimerSnapshot, sendCommand: sendWorkshopTimerCommand },
    socketRef,
    isSyncing,
    onPointerUpdate,
    onSelectionChange,
    inviteHere,
  };
};
