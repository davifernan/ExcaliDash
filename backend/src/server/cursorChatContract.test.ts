import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CURSOR_CHAT_LIMITS } from "./socketCursorChat";
import { SOCKET_LIMITS } from "./socketProtocol";

const FRONTEND_CURSOR_CHAT = path.resolve(
  __dirname,
  "../../../frontend/src/pages/editor/cursorChat.ts",
);
const FRONTEND_DELIVERY = path.resolve(
  __dirname,
  "../../../frontend/src/pages/editor/elementUpdateDelivery.ts",
);

const readNumber = (file: string, name: string): number => {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(new RegExp(`${name}\\s*=\\s*([^;]+);`));
  if (!match) throw new Error(`${name} not found in ${file}`);
  // Only arithmetic on literals, which is all these constants ever are.
  return Function(`"use strict"; return (${match[1]});`)() as number;
};

describe("cursor chat protocol contract", () => {
  it("keeps the frontend input cap equal to the server-enforced cap", () => {
    const source = fs.readFileSync(FRONTEND_CURSOR_CHAT, "utf8");
    const declaration = source.match(/export const CURSOR_CHAT_MAX_LENGTH = (\d+);/);

    expect(
      declaration,
      "frontend cursor chat must keep an explicit protocol cap for this contract check",
    ).not.toBeNull();
    expect(Number(declaration?.[1])).toBe(CURSOR_CHAT_LIMITS.textLength);
  });
  it("keeps the client's packet size under the strictest server ceiling", () => {
    // The client splits before sending. If it split at exactly the server's
    // figure, the first packet a byte over would be refused, retried, refused
    // again and abandoned -- so it has to stay below, and stay below when
    // somebody changes one of the two numbers.
    const clientPacketBytes = readNumber(FRONTEND_DELIVERY, "LIVE_UPDATE_MAX_BYTES");
    expect(clientPacketBytes).toBeLessThan(SOCKET_LIMITS.anonymousElementUpdateBytes);
    expect(clientPacketBytes).toBeLessThan(SOCKET_LIMITS.elementUpdateBytes);
  });
});
