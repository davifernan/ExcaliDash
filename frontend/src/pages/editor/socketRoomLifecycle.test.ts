import { describe, expect, it, vi } from "vitest";
import { bindSocketRoomLifecycle } from "./socketRoomLifecycle";

describe("socket room lifecycle", () => {
  it("retries a lost join acknowledgement and restores the current follow target", () => {
    vi.useFakeTimers();
    const handlers = new Map<string, () => void>();
    const acknowledgements: Array<(value: any) => void> = [];
    const socket: any = {
      id: "socket-1",
      connected: true,
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      off: vi.fn(),
      emit: vi.fn((event: string, _payload: unknown, ack?: (value: any) => void) => {
        if (event === "join-room" && ack) acknowledgements.push(ack);
      }),
    };
    const resetConnectionState = vi.fn();
    const onJoined = vi.fn();
    let followTarget = "target-before-timeout";
    const cleanup = bindSocketRoomLifecycle({
      socket,
      drawingId: "drawing-1",
      shareToken: "a".repeat(32),
      user: { name: "User" } as any,
      resetConnectionState,
      onJoined,
      getFollowTargetPresenceId: () => followTarget,
    });

    expect(acknowledgements).toHaveLength(1);
    followTarget = "target-after-timeout";
    vi.advanceTimersByTime(2_250);
    expect(acknowledgements).toHaveLength(2);
    acknowledgements[1]({ ok: true, presence: { presenceId: "socket-1" } });

    expect(onJoined).toHaveBeenCalledWith({ presenceId: "socket-1" });
    expect(socket.emit).toHaveBeenCalledWith(
      "join-room",
      {
        drawingId: "drawing-1",
        shareToken: "a".repeat(32),
        user: { name: "User" },
      },
      expect.any(Function),
    );
    expect(socket.emit).toHaveBeenCalledWith("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "target-after-timeout",
      action: "FOLLOW",
    });
    expect(
      socket.emit.mock.calls.filter(([event]: [string]) => event === "join-room"),
    ).toHaveLength(2);
    expect(resetConnectionState).toHaveBeenCalledOnce();
    cleanup();
    vi.useRealTimers();
  });

  it("ignores a stale join acknowledgement from an old connection", () => {
    const handlers = new Map<string, () => void>();
    const acknowledgements: Array<(value: any) => void> = [];
    const socket: any = {
      id: "socket-old",
      connected: true,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      off: vi.fn(),
      emit: vi.fn((event: string, _payload: unknown, ack?: (value: any) => void) => {
        if (event === "join-room" && ack) acknowledgements.push(ack);
      }),
    };
    const onJoined = vi.fn();
    const cleanup = bindSocketRoomLifecycle({
      socket,
      drawingId: "drawing-1",
      shareToken: null,
      user: {} as any,
      resetConnectionState: vi.fn(),
      onJoined,
      getFollowTargetPresenceId: () => null,
    });

    handlers.get("disconnect")?.();
    socket.id = "socket-new";
    handlers.get("connect")?.();
    acknowledgements[0]({ presence: { presenceId: "socket-old" } });
    acknowledgements[1]({ presence: { presenceId: "socket-new" } });

    expect(onJoined).toHaveBeenCalledOnce();
    expect(onJoined).toHaveBeenCalledWith({ presenceId: "socket-new" });
    cleanup();
  });
});
