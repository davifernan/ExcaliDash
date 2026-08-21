import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuthorizedRoomEvent } from "./socketRoomEvent";

const validPayload = { drawingId: "drawing-1" };

const setup = (limit = 1, windowMs = 1_000) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const emit = vi.fn();
  const disconnect = vi.fn();
  const socket = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    emit,
    disconnect,
  } as any;
  const handle = vi.fn();
  registerAuthorizedRoomEvent({
    socket,
    event: "test-event",
    limit,
    windowMs,
    parse: (value) =>
      value && typeof value === "object" && (value as any).drawingId === "drawing-1"
        ? validPayload
        : null,
    requireAccess: vi.fn(async () => true),
    handle,
  });
  return { send: handlers.get("test-event")!, disconnect, emit, handle };
};

describe("authorized room event feedback", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("acknowledges every hard parse failure", async () => {
    const { send } = setup(10);
    const acknowledgements: any[] = [];

    await send({ drawingId: 42 }, (value: any) => acknowledgements.push(value));
    await send(null, (value: any) => acknowledgements.push(value));

    expect(acknowledgements).toEqual([
      {
        ok: false,
        error: {
          code: "invalid-request",
          message: "Invalid test-event payload",
        },
      },
      {
        ok: false,
        error: {
          code: "invalid-request",
          message: "Invalid test-event payload",
        },
      },
    ]);
  });

  it("acknowledges successful handling", async () => {
    const { send } = setup();
    const ack = vi.fn();

    await send(validPayload, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("coalesces rate-limit feedback to one notice per limiting window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { send, emit } = setup();

    await send(validPayload);
    await send(validPayload);
    await send(validPayload);
    await send(validPayload);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("room-event-error", {
      event: "test-event",
      error: {
        code: "rate-limited",
        message: "test-event rate limit exceeded",
      },
    });

    vi.advanceTimersByTime(1_001);
    await send(validPayload);
    await send(validPayload);

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("disconnects a malformed-packet flood after bounded feedback", async () => {
    const { send, disconnect, emit } = setup(20);

    for (let index = 0; index < 10; index += 1) {
      await send(null);
    }

    expect(emit).toHaveBeenCalledTimes(10);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledWith(true);
  });
});
