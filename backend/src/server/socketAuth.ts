import jwt from "jsonwebtoken";
import type { Socket } from "socket.io";
import type { PrismaClient } from "../generated/client";
import { isApiKeyToken, resolveApiKeyUser } from "../auth/apiKeys";
import { BOOTSTRAP_USER_ID, type AuthModeService } from "../auth/authMode";
import { ACCESS_TOKEN_COOKIE_NAME, parseCookieHeader } from "../auth/cookies";
import type { DrawingPrincipal } from "../authz/sharing";

type SocketAuthDeps = {
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
  principals: Map<string, DrawingPrincipal>;
};

export const createSocketAuthenticator = ({
  prisma,
  authModeService,
  jwtSecret,
  principals,
}: SocketAuthDeps) => {
  const resolvePrincipal = async (token?: string): Promise<DrawingPrincipal | null> => {
    const authEnabled = await authModeService.getAuthEnabled();
    if (!authEnabled) {
      return {
        kind: "user",
        userId: BOOTSTRAP_USER_ID,
        allowInactive: true,
      };
    }
    if (!token) return null;

    if (isApiKeyToken(token)) {
      try {
        const resolved = await resolveApiKeyUser(prisma, token);
        return resolved
          ? {
              kind: "user",
              userId: resolved.user.id,
              apiKey: { id: resolved.apiKeyId, scopes: resolved.scopes },
            }
          : null;
      } catch (error) {
        console.error("Socket API key verification failed:", error);
        return null;
      }
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      if (
        typeof decoded.userId !== "string" ||
        typeof decoded.email !== "string" ||
        decoded.type !== "access"
      ) {
        return null;
      }
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, isActive: true },
      });
      return user?.isActive ? { kind: "user", userId: user.id } : null;
    } catch {
      return null;
    }
  };

  return async (socket: Socket, next: (error?: Error) => void) => {
    try {
      const authToken = socket.handshake.auth?.token;
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      const cookieToken = cookies[ACCESS_TOKEN_COOKIE_NAME];
      const token =
        typeof authToken === "string" && authToken.trim()
          ? authToken
          : typeof cookieToken === "string" && cookieToken.trim()
            ? cookieToken
            : undefined;
      const authEnabled = await authModeService.getAuthEnabled();
      const principal = await resolvePrincipal(token);
      if (principal) {
        principals.set(socket.id, principal);
        return next();
      }
      // Anonymous share-link sockets are authorized against the drawing on join.
      if (authEnabled) return next();
      return next(new Error("Authentication required"));
    } catch {
      return next(new Error("Authentication failed"));
    }
  };
};
