import { describe, expect, it, vi } from "vitest";
import {
  bindElementUpdateRefusals,
  ELEMENT_UPDATE_REFUSED_EVENT,
  REFUSAL_QUIET_MS,
} from "./elementUpdateRefusal";

const makeSocket = () => {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    socket: {
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    },
  };
};

describe("telling somebody their change was not shared", () => {
  it("says so the first time", () => {
    const { socket, handlers } = makeSocket();
    const notify = vi.fn();
    bindElementUpdateRefusals({ socket, notify, now: () => 1_000 });
    handlers.get(ELEMENT_UPDATE_REFUSED_EVENT)!();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/still saved/i);
  });

  it("does not repeat itself through a burst", () => {
    // A board over the limit is over it for every change that follows. One
    // message per change would be its own kind of broken.
    const { socket, handlers } = makeSocket();
    const notify = vi.fn();
    let clock = 1_000;
    bindElementUpdateRefusals({ socket, notify, now: () => clock });
    for (let i = 0; i < 20; i += 1) {
      clock += 100;
      handlers.get(ELEMENT_UPDATE_REFUSED_EVENT)!();
    }
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("speaks again once the quiet period is over", () => {
    const { socket, handlers } = makeSocket();
    const notify = vi.fn();
    let clock = 1_000;
    bindElementUpdateRefusals({ socket, notify, now: () => clock });
    handlers.get(ELEMENT_UPDATE_REFUSED_EVENT)!();
    clock += REFUSAL_QUIET_MS + 1;
    handlers.get(ELEMENT_UPDATE_REFUSED_EVENT)!();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("stops listening when disposed", () => {
    const { socket, handlers } = makeSocket();
    const notify = vi.fn();
    const bound = bindElementUpdateRefusals({ socket, notify });
    bound.dispose();
    expect(handlers.has(ELEMENT_UPDATE_REFUSED_EVENT)).toBe(false);
  });
});
