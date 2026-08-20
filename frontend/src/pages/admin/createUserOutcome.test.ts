import { describe, expect, it } from "vitest";
import { getCreateUserOutcome } from "./createUserOutcome";

const user = { id: "user-1", email: "new@example.com" } as any;

describe("create user outcome", () => {
  it("reports an invitation delivery failure and preserves the fallback password", () => {
    const outcome = getCreateUserOutcome({
      user,
      invited: false,
      invitationError: "SMTP is unavailable.",
      temporaryPassword: "fallback-secret",
    });

    expect(outcome.success).toBeNull();
    expect(outcome.error).toContain("User created, but the invitation failed");
    expect(outcome.error).toContain("generate a new one from the user list");
    expect(outcome.temporaryPassword).toBe("fallback-secret");
  });
});
