import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_KEY_SCOPES,
  DRAWINGS_HISTORY_SCOPE,
  DRAWINGS_SHARE_SCOPE,
} from "../auth/apiKeys";

describe("API key scopes", () => {
  it("keeps the riskier scopes out of the defaults", () => {
    // A key handed out without asking must not be able to reshare a drawing.
    expect(DEFAULT_API_KEY_SCOPES).not.toContain(DRAWINGS_SHARE_SCOPE);
    expect(DEFAULT_API_KEY_SCOPES).not.toContain(DRAWINGS_HISTORY_SCOPE);
  });

  it("still covers ordinary drawing and collection work by default", () => {
    expect(DEFAULT_API_KEY_SCOPES).toContain("drawings:read");
    expect(DEFAULT_API_KEY_SCOPES).toContain("drawings:write");
    expect(DEFAULT_API_KEY_SCOPES).toContain("collections:read");
    expect(DEFAULT_API_KEY_SCOPES).toContain("collections:write");
  });

  it("names the opt-in scopes after the resource they unlock", () => {
    expect(DRAWINGS_HISTORY_SCOPE).toBe("drawings:history");
    expect(DRAWINGS_SHARE_SCOPE).toBe("drawings:share");
  });
});
