import { describe, expect, it, vi } from "vitest";
import { FakeIo, FakeSocket, room } from "../__tests__/socketTestDoubles";
import { createSocketFollowManager } from "./socketFollow";
import { createRateLimiter } from "./socketProtocol";

describe("follow command authorization", () => {
  it("rate limits and rejects unauthorized UNFOLLOW without replying", async () => {
    const io = new FakeIo();
    const socket = new FakeSocket("follower", io.emissions);
    const connectedSockets = new Map([[socket.id, socket as any]]);
    const drawingBySocket = new Map([[socket.id, "drawing-1"]]);
    socket.rooms.add(room("drawing-1"));
    const requireAccess = vi.fn().mockResolvedValue(null);
    const allowUnfollow = vi.fn(createRateLimiter(12, 60_000));
    const acknowledgements: unknown[] = [];
    const manager = createSocketFollowManager({
      io: io as any,
      connectedSockets,
      drawingBySocket,
      getPresence: () => null,
      getAccess: async () => "none",
      requireAccess,
      removeFromDrawing: async () => {},
    });
    manager.registerHandlers(
      socket as any,
      () => true,
      () => true,
      allowUnfollow,
    );

    for (let index = 0; index < 20; index += 1) {
      await socket.trigger(
        "follow-user",
        { drawingId: "drawing-1", action: "UNFOLLOW" },
        (value: unknown) => acknowledgements.push(value),
      );
    }

    expect(allowUnfollow).toHaveBeenCalledTimes(20);
    expect(requireAccess).toHaveBeenCalledTimes(12);
    expect(acknowledgements).toEqual([]);
    expect(io.emissions.filter((item) => item.event === "follow-status")).toEqual([]);
  });
});
