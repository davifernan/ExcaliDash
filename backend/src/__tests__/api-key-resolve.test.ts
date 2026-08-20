import { describe, expect, it, vi } from "vitest";
import { generateApiKey, hashApiKey, resolveApiKeyUser } from "../auth/apiKeys";

const buildClient = (apiKey: unknown) => ({
  apiKey: {
    findUnique: vi.fn().mockResolvedValue(apiKey),
    update: vi.fn().mockResolvedValue({}),
  },
});

const activeUser = { id: "user-1", isActive: true, email: "a@example.com" };

const storedKey = async (overrides: Record<string, unknown> = {}) => {
  const { token, keyId } = generateApiKey();
  return {
    token,
    row: {
      id: "key-1",
      keyId,
      tokenHash: await hashApiKey(token),
      scopes: "drawings:read,drawings:write",
      revokedAt: null,
      user: activeUser,
      ...overrides,
    },
  };
};

describe("resolveApiKeyUser", () => {
  it("resolves a valid key to its owner", async () => {
    const { token, row } = await storedKey();
    const client = buildClient(row);

    const result = await resolveApiKeyUser(client, token);

    expect(result?.user.id).toBe("user-1");
    expect(result?.scopes).toContain("drawings:write");
  });

  it("refuses a revoked key", async () => {
    const { token, row } = await storedKey({ revokedAt: new Date() });

    await expect(resolveApiKeyUser(buildClient(row), token)).resolves.toBeNull();
  });

  it("refuses a key whose owner is deactivated", async () => {
    const { token, row } = await storedKey({
      user: { ...activeUser, isActive: false },
    });

    await expect(resolveApiKeyUser(buildClient(row), token)).resolves.toBeNull();
  });

  it("refuses a forged secret for a known key id", async () => {
    const { row } = await storedKey();
    const other = generateApiKey();
    // Same shape, wrong secret — the hash comparison has to catch this.
    const forged = `exd_${row.keyId}_${other.token.split("_")[2]}`;

    await expect(resolveApiKeyUser(buildClient(row), forged)).resolves.toBeNull();
  });

  it("refuses something that is not a key at all", async () => {
    await expect(resolveApiKeyUser(buildClient(null), "not-a-key")).resolves.toBeNull();
  });

  it("records the use without failing when bookkeeping breaks", async () => {
    const { token, row } = await storedKey();
    const client = buildClient(row);
    client.apiKey.update.mockRejectedValue(new Error("db is read-only"));

    await expect(resolveApiKeyUser(client, token)).resolves.not.toBeNull();
  });
});
