import { describe, expect, it, vi } from "vitest";
import { bindSocketRoomLifecycle } from "./socketRoomLifecycle";

describe("socket room lifecycle", () => {
  it("rejoins and restores follow state for every new socket id", () => {
    const handlers = new Map<string, () => void>();
    const socket: any = {
      id: "socket-1",
      connected: true,
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      off: vi.fn(),
      emit: vi.fn((event: string, _payload: unknown, ack?: (value: any) => void) => {
        if (event === "join-room") {
          ack?.({ presence: { presenceId: socket.id } });
        }
      }),
    };
    const resetConnectionState = vi.fn();
    const onJoined = vi.fn();
    const cleanup = bindSocketRoomLifecycle({
      socket,
      drawingId: "drawing-1",
      user: { name: "User" } as any,
      resetConnectionState,
      onJoined,
      getFollowTargetPresenceId: () => "target-socket",
    });

    expect(socket.emit).toHaveBeenCalledWith(
      "join-room",
      { drawingId: "drawing-1", user: { name: "User" } },
      expect.any(Function),
    );
    expect(onJoined).toHaveBeenLastCalledWith({ presenceId: "socket-1" });
    expect(socket.emit).toHaveBeenCalledWith("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "target-socket",
      action: "FOLLOW",
    });

    handlers.get("disconnect")?.();
    socket.id = "socket-2";
    handlers.get("connect")?.();

    expect(onJoined).toHaveBeenLastCalledWith({ presenceId: "socket-2" });
    expect(socket.emit.mock.calls.filter(([event]: [string]) => event === "join-room"))
      .toHaveLength(2);
    expect(resetConnectionState).toHaveBeenCalledTimes(3);
    cleanup();
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
    bindSocketRoomLifecycle({
      socket,
      drawingId: "drawing-1",
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
  });
});
