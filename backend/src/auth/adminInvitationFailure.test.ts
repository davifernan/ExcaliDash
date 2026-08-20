import bcrypt from "bcrypt";
import { describe, expect, it, vi } from "vitest";
import { registerAdminUserRoutes } from "./adminUserRoutes";

describe("admin invitation failure", () => {
  it("returns a password that matches the created account when delivery fails", async () => {
    let createUserHandler: any;
    let createdPasswordHash = "";
    const router = new Proxy(
      {},
      {
        get:
          (_target, method) =>
          (...args: any[]) => {
            if (method === "post" && args[0] === "/users") createUserHandler = args.at(-1);
          },
      },
    );
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          createdPasswordHash = data.passwordHash;
          return {
            id: "user-1",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }),
      },
      passwordResetToken: {
        create: vi.fn().mockResolvedValue({ id: "reset-1" }),
      },
    };
    registerAdminUserRoutes({
      router: router as any,
      prisma: prisma as any,
      requireAuth: vi.fn() as any,
      accountActionRateLimiter: vi.fn() as any,
      ensureAuthEnabled: vi.fn().mockResolvedValue(true),
      requireAdmin: vi.fn().mockReturnValue(true) as any,
      findUserByIdentifier: vi.fn(),
      countActiveAdmins: vi.fn(),
      sanitizeText: (value: unknown) => String(value),
      generateTempPassword: vi.fn(),
      generateTokens: vi.fn(),
      getRefreshTokenExpiresAt: vi.fn(),
      config: {
        authMode: "local",
        enableAuditLogging: false,
        enableRefreshTokenRotation: false,
        frontendUrl: "https://draw.example.com",
        oidc: { enabled: false, providerName: "OIDC", jitProvisioning: false },
      },
      mailer: {
        enabled: true,
        send: vi.fn().mockResolvedValue({ delivered: false, reason: "SMTP unavailable" }),
      } as any,
      defaultSystemConfigId: "default",
      setAuthCookies: vi.fn(),
      requireCsrf: vi.fn().mockReturnValue(true),
      ensureSystemConfig: vi.fn() as any,
      parseLoginRateLimitConfig: vi.fn() as any,
      applyLoginRateLimitConfig: vi.fn() as any,
      resetLoginAttemptKey: vi.fn(),
    });
    const response: Record<string, any> = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };

    await createUserHandler(
      {
        body: {
          email: "invitee@example.com",
          name: "Invitee",
          sendInvite: true,
          mustResetPassword: true,
        },
        user: { id: "admin-1", role: "ADMIN" },
        headers: {},
        connection: {},
      },
      response,
    );

    expect(response.statusCode).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(response.body.invitationError).toContain("SMTP unavailable");
    expect(response.body.temporaryPassword).toEqual(expect.any(String));
    expect(await bcrypt.compare(response.body.temporaryPassword, createdPasswordHash)).toBe(true);
  });
});
