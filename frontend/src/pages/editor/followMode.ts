import {
  getVisibleSceneBounds,
  sceneCoordsToViewportCoords,
  zoomToFitBounds,
} from "@excalidraw/excalidraw";
import type { Socket } from "socket.io-client";

export type FollowSceneBounds = Parameters<typeof zoomToFitBounds>[0]["bounds"];

export type Follower = {
  presenceId: string;
  name: string;
};

export const getFollowInterruptionMessage = (reason: string): string => {
  switch (reason) {
    case "disconnected":
      return "The person you were following disconnected. Follow mode ended.";
    case "target-unavailable":
      return "The person you were following is no longer available.";
    case "access-revoked":
      return "Follow mode ended because access changed.";
    case "rate-limited":
      return "Follow command was rate-limited; the server state was restored.";
    default:
      return "Follow mode ended on the server.";
  }
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
  const fittedAppState = zoomToFitBounds({
    appState,
    bounds,
    fitToViewport: true,
    viewportZoomFactor: 1,
  }).appState;
  api.updateScene({
    appState: fittedAppState,
  });
  const desiredZoom = Math.min(
    appState.width / (bounds[2] - bounds[0]),
    appState.height / (bounds[3] - bounds[1]),
  );
  return {
    appState: { ...appState, ...fittedAppState },
    zoomClamped: desiredZoom < 0.1 || desiredZoom > 30,
  };
};

const createViewportIndicator = (container: HTMLDivElement | null) => {
  if (!container) return null;
  const frame = document.createElement("div");
  frame.dataset.followViewport = "frame";
  Object.assign(frame.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "1",
    border: "2px solid rgba(79, 70, 229, 0.9)",
    boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.16)",
    boxSizing: "border-box",
    display: "none",
  });
  const warning = document.createElement("div");
  warning.dataset.followViewport = "zoom-warning";
  warning.textContent = "Target viewport exceeds the supported zoom range";
  Object.assign(warning.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "1",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "6px 10px",
    borderRadius: "6px",
    color: "white",
    background: "rgba(15, 23, 42, 0.78)",
    fontSize: "12px",
    display: "none",
  });
  container.append(frame, warning);

  return {
    show(bounds: FollowSceneBounds, appState: any, zoomClamped: boolean) {
      const coordinateState = {
        zoom: appState.zoom,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        offsetLeft: Number.isFinite(appState.offsetLeft) ? appState.offsetLeft : 0,
        offsetTop: Number.isFinite(appState.offsetTop) ? appState.offsetTop : 0,
      };
      const topLeft = sceneCoordsToViewportCoords(
        { sceneX: bounds[0], sceneY: bounds[1] },
        coordinateState,
      );
      const bottomRight = sceneCoordsToViewportCoords(
        { sceneX: bounds[2], sceneY: bounds[3] },
        coordinateState,
      );
      const containerRect = container.getBoundingClientRect();
      Object.assign(frame.style, {
        display: "block",
        left: `${topLeft.x - containerRect.left}px`,
        top: `${topLeft.y - containerRect.top}px`,
        width: `${bottomRight.x - topLeft.x}px`,
        height: `${bottomRight.y - topLeft.y}px`,
      });
      warning.style.display = zoomClamped ? "block" : "none";
    },
    hide() {
      frame.style.display = "none";
      warning.style.display = "none";
    },
    remove() {
      frame.remove();
      warning.remove();
    },
  };
};

export const bindFollowMode = ({
  socket,
  drawingId,
  api,
  container,
  onFollowersChange,
  onFollowInterrupted,
}: {
  socket: Socket;
  drawingId: string;
  api: ExcalidrawApi;
  container: HTMLDivElement | null;
  onFollowersChange: (followers: Follower[]) => void;
  onFollowInterrupted?: (reason: string) => void;
}) => {
  let followers = new Map<string, Follower>();
  const lastViewportSequence = new Map<string, number>();
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressedServerActions: Array<{
    action: "FOLLOW" | "UNFOLLOW";
    targetPresenceId: string | null;
  }> = [];
  let suppressionTimer: ReturnType<typeof setTimeout> | null = null;
  let applyingIncomingBounds = false;
  let lastReceivedBounds: FollowSceneBounds | null = null;
  let lastReceivedPresenceId: string | null = null;
  let lastAppliedVisibleBounds: FollowSceneBounds | null = null;
  const viewportIndicator = createViewportIndicator(container);

  const suppressServerFeedback = (
    previousTargetId: string | null,
    nextTargetId: string | null,
  ) => {
    suppressedServerActions = [];
    if (previousTargetId && previousTargetId !== nextTargetId) {
      suppressedServerActions.push({
        action: "UNFOLLOW",
        targetPresenceId: previousTargetId,
      });
    }
    if (nextTargetId && previousTargetId !== nextTargetId) {
      suppressedServerActions.push({
        action: "FOLLOW",
        targetPresenceId: nextTargetId,
      });
    }
    if (suppressionTimer !== null) clearTimeout(suppressionTimer);
    suppressionTimer = setTimeout(() => {
      suppressedServerActions = [];
      suppressionTimer = null;
    }, 250);
  };

  const sendBounds = () => {
    sendTimer = null;
    if (followers.size === 0) return;
    socket.emit("viewport-bounds", {
      drawingId,
      sceneBounds: getVisibleSceneBounds(api.getAppState()),
    });
  };
  const scheduleBounds = () => {
    if (
      applyingIncomingBounds ||
      sendTimer !== null ||
      followers.size === 0
    ) {
      return;
    }
    const visibleBounds = parseFollowSceneBounds(
      getVisibleSceneBounds(api.getAppState()),
    );
    if (
      visibleBounds &&
      lastAppliedVisibleBounds &&
      visibleBounds.every(
        (value, index) =>
          Math.abs(value - lastAppliedVisibleBounds![index]) < 0.0001,
      )
    ) {
      return;
    }
    lastAppliedVisibleBounds = null;
    sendTimer = setTimeout(sendBounds, 50);
  };

  const applyReceivedBounds = () => {
    if (!lastReceivedBounds || !lastReceivedPresenceId) return;
    if (api.getAppState().userToFollow?.socketId !== lastReceivedPresenceId) return;
    applyingIncomingBounds = true;
    try {
      const fitted = fitFollowedBounds(api, lastReceivedBounds);
      lastAppliedVisibleBounds = parseFollowSceneBounds(
        getVisibleSceneBounds(fitted.appState),
      );
      viewportIndicator?.show(
        lastReceivedBounds,
        fitted.appState,
        fitted.zoomClamped,
      );
    } finally {
      applyingIncomingBounds = false;
    }
  };

  const unsubscribeFollow = api.onUserFollow((payload) => {
    const targetPresenceId = payload.userToFollow?.socketId || null;
    const suppressedIndex = suppressedServerActions.findIndex(
      (action) =>
        action.action === payload.action &&
        action.targetPresenceId === targetPresenceId,
    );
    if (suppressedIndex >= 0) {
      suppressedServerActions.splice(suppressedIndex, 1);
      if (suppressedServerActions.length === 0 && suppressionTimer !== null) {
        clearTimeout(suppressionTimer);
        suppressionTimer = null;
      }
      return;
    }
    lastViewportSequence.clear();
    lastReceivedBounds = null;
    lastReceivedPresenceId = null;
    lastAppliedVisibleBounds = null;
    viewportIndicator?.hide();
    socket.emit("follow-user", {
      drawingId,
      targetPresenceId: payload.userToFollow?.socketId,
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
    if (payload?.drawingId !== drawingId) return;
    const targetPresenceId =
      typeof payload.followingPresenceId === "string"
        ? payload.followingPresenceId
        : null;
    const appState = api.getAppState();
    if (typeof payload.reason === "string") {
      onFollowInterrupted?.(payload.reason);
    }
    if (appState.userToFollow?.socketId === targetPresenceId) return;
    const previousTargetId = appState.userToFollow?.socketId || null;
    suppressServerFeedback(previousTargetId, targetPresenceId);
    lastViewportSequence.clear();
    if (!targetPresenceId) {
      lastReceivedBounds = null;
      lastReceivedPresenceId = null;
      lastAppliedVisibleBounds = null;
      viewportIndicator?.hide();
      if (appState.userToFollow) {
        api.updateScene({ appState: { userToFollow: null } });
      }
    } else {
      const collaborator = appState.collaborators?.get?.(targetPresenceId) || {};
      api.updateScene({
        appState: {
          userToFollow: { ...collaborator, socketId: targetPresenceId },
        },
      });
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
    lastViewportSequence.clear();
    lastViewportSequence.set(payload.presenceId, payload.sequence);
    lastReceivedBounds = bounds;
    lastReceivedPresenceId = payload.presenceId;
    applyReceivedBounds();
  };

  socket.on("followed-by-update", onFollowedBy);
  socket.on("follow-status", onFollowStatus);
  socket.on("viewport-bounds", onViewportBounds);
  const resizeObserver =
    container && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (lastReceivedBounds) applyReceivedBounds();
          scheduleBounds();
        })
      : null;
  if (container) resizeObserver?.observe(container);

  const resetConnectionState = () => {
    followers.clear();
    lastViewportSequence.clear();
    lastReceivedBounds = null;
    lastReceivedPresenceId = null;
    lastAppliedVisibleBounds = null;
    viewportIndicator?.hide();
    if (sendTimer !== null) clearTimeout(sendTimer);
    if (suppressionTimer !== null) clearTimeout(suppressionTimer);
    suppressedServerActions = [];
    suppressionTimer = null;
    sendTimer = null;
    onFollowersChange([]);
    api.updateScene({ appState: { followedBy: new Set() } });
  };

  const cleanup = () => {
    unsubscribeFollow();
    unsubscribeScroll();
    socket.off("followed-by-update", onFollowedBy);
    socket.off("follow-status", onFollowStatus);
    socket.off("viewport-bounds", onViewportBounds);
    resizeObserver?.disconnect();
    if (sendTimer !== null) clearTimeout(sendTimer);
    if (suppressionTimer !== null) clearTimeout(suppressionTimer);
    viewportIndicator?.remove();
    onFollowersChange([]);
  };
  cleanup.resetConnectionState = resetConnectionState;
  return cleanup;
};
