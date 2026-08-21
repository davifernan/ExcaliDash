import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CURSOR_CHAT_LIMITS } from "./socketCursorChat";

const FRONTEND_CURSOR_CHAT = path.resolve(
  __dirname,
  "../../../frontend/src/pages/editor/cursorChat.ts",
);

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
});
