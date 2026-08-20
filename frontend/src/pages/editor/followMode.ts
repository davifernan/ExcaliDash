import {
  getVisibleSceneBounds,
  zoomToFitBounds,
} from "@excalidraw/excalidraw";
import type { Socket } from "socket.io-client";

export type FollowSceneBounds = Parameters<typeof zoomToFitBounds>[0]["bounds"];

export type Follower = {
  presenceId: string;
  name: string;
};

type ExcalidrawApi = {
  getAppState: () => any;
  updateScene: (scene: { appState: any }) => void;
  onScrollChange: (callback: () => void) => () => void;
  onUserFollow: (
    callback: (payload: {
      action: "FOLLOW" | "UNFOLLOW";
      userToFollow: { socketId: string };
    }) => void,
  ) => () => void;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseFollowSceneBounds = (
  value: unknown,
): FollowSceneBounds | null => {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every(isFiniteNumber)) return null;
  const [x1, y1, x2, y2] = value;
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2] as FollowSceneBounds;
};

export const fitFollowedBounds = (
  api: Pick<ExcalidrawApi, "getAppState" | "updateScene">,
  bounds: FollowSceneBounds,
) => {
  const appState = api.getAppState();
  api.updateScene({
    appState: zoomToFitBounds({
      appState,
      bounds,
      fitToViewport: true,
      viewportZoomFactor: 1,
    }).appState,
  });
};

export const bindFollowMode = ({
  socket,
  drawingId,
  api,
  container,
  onFollowersChange,
}: {
  socket: Socket;
  drawingId: string;
  api: ExcalidrawApi;
  container: HTMLDivElement | null;
  onFollowersChange: (followers: Follower[]) => void;
}) => {
  let followers = new Map<string, Follower>();
  const lastViewportSequence = new Map<string, number>();
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let applyingServerStatus = false;

  const sendBounds = () => {
    sendTimer = null;
    if (followers.size === 0) return;
    socket.emit("viewport-bounds", {
      drawingId,
      sceneBounds: getVisibleSceneBounds(api.getAppState()),
    });
  };
  const scheduleBounds = () => {
    if (sendTimer !== null || followers.size === 0) return;
    sendTimer = setTimeout(sendBounds, 50);
  };

  const unsubscribeFollow = api.onUserFollow((payload) => {
    if (applyingServerStatus) return;
    socket.emit("follow-user", {
      drawingId,
      targetPresenceId: payload.userToFollow.socketId,
      action: payload.action,
    });
  });
  const unsubscribeScroll = api.onScrollChange(scheduleBounds);

  const onFollowedBy = (payload: any) => {
    if (payload?.drawingId !== drawingId || !Array.isArray(payload.followers)) {
      return;
    }
    const next = new Map<string, Follower>();
    for (const follower of payload.followers) {
      if (
        typeof follower?.presenceId === "string" &&
        typeof follower?.name === "string"
      ) {
        next.set(follower.presenceId, {
          presenceId: follower.presenceId,
          name: follower.name,
        });
      }
    }
    followers = next;
    onFollowersChange(Array.from(next.values()));
    api.updateScene({
      appState: { followedBy: new Set(next.keys()) },
    });
    if (followers.size > 0) sendBounds();
  };

  const onFollowStatus = (payload: any) => {
    if (payload?.drawingId !== drawingId || payload.followingPresenceId) return;
    if (!api.getAppState().userToFollow) return;
    applyingServerStatus = true;
    try {
      api.updateScene({ appState: { userToFollow: null } });
    } finally {
      applyingServerStatus = false;
    }
  };

  const onViewportBounds = (payload: any) => {
    if (payload?.drawingId !== drawingId) return;
    const bounds = parseFollowSceneBounds(payload.sceneBounds);
    if (!bounds || typeof payload.presenceId !== "string") return;
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) return;
    if ((lastViewportSequence.get(payload.presenceId) || 0) >= payload.sequence) {
      return;
    }
    const appState = api.getAppState();
    if (appState.userToFollow?.socketId !== payload.presenceId) return;
    if (appState.followedBy?.has?.(payload.presenceId)) return;
    lastViewportSequence.set(payload.presenceId, payload.sequence);
    fitFollowedBounds(api, bounds);
  };

  socket.on("followed-by-update", onFollowedBy);
  socket.on("follow-status", onFollowStatus);
  socket.on("viewport-bounds", onViewportBounds);
  const resizeObserver =
    container && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(scheduleBounds)
      : null;
  if (container) resizeObserver?.observe(container);

  return () => {
    unsubscribeFollow();
    unsubscribeScroll();
    socket.off("followed-by-update", onFollowedBy);
    socket.off("follow-status", onFollowStatus);
    socket.off("viewport-bounds", onViewportBounds);
    resizeObserver?.disconnect();
    if (sendTimer !== null) clearTimeout(sendTimer);
    onFollowersChange([]);
  };
};
