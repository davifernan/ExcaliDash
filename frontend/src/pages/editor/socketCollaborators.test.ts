import { afterEach, describe, expect, it, vi } from "vitest";
import { bindSocketCollaborators } from "./socketCollaborators";

class FakeSocket {
  id = "self";
  private handlers = new Map<string, (payload: any) => void>();

  on(event: string, handler: (payload: any) => void) {
    this.handlers.set(event, handler);
  }

  off(event: string, handler: (payload: any) => void) {
    if (this.handlers.get(event) === handler) this.handlers.delete(event);
  }

  trigger(event: string, payload: any) {
    this.handlers.get(event)?.(payload);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("socket collaborators", () => {
  it("merges initial selection and removes the collaborator through presence cleanup", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const socket = new FakeSocket();
    let collaborators = new Map<string, any>();
    const api = {
      getAppState: () => ({ collaborators }),
      updateScene: vi.fn((scene: any) => {
        collaborators = scene.collaborators;
      }),
    };
    const binding = bindSocketCollaborators({
      socket: socket as any,
      api,
      onPeersChange: vi.fn(),
    });

    socket.trigger("presence-update", [
      {
        presenceId: "peer",
        name: "Peer",
        color: "#123456",
        isActive: true,
        selectedElementIds: { element: true },
      },
    ]);
    expect(collaborators.get("peer")?.selectedElementIds).toEqual({ element: true });

    socket.trigger("presence-update", []);
    expect(collaborators.has("peer")).toBe(false);
    binding.dispose();
  });
});
