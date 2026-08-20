import type { PrismaClient } from "../generated/client";
import type { DrawingPrincipal } from "../authz/sharing";

export type CollaborationAccessController = {
  recheckDrawingAccess: (drawingId: string, affectedUserId?: string) => Promise<void>;
  recheckUserAccess: (affectedUserId: string) => Promise<void>;
  disconnectApiKey: (apiKeyId: string) => Promise<void>;
};

export const createCollaborationAccessController = ({
  prisma,
  principals,
  recheckSockets,
  disconnectInactiveUserSockets,
  disconnectApiKey,
  invalidateUserStatus,
}: {
  prisma: PrismaClient;
  principals: Map<string, DrawingPrincipal>;
  recheckSockets: (matches: (socketId: string, drawingId: string) => boolean) => Promise<void>;
  disconnectInactiveUserSockets: (userId: string) => Promise<void>;
  disconnectApiKey: (apiKeyId: string) => Promise<void>;
  invalidateUserStatus?: (userId: string) => void;
}): CollaborationAccessController => ({
  recheckDrawingAccess: (drawingId, affectedUserId) =>
    recheckSockets(
      (socketId, activeDrawingId) =>
        activeDrawingId === drawingId &&
        (!affectedUserId || principals.get(socketId)?.userId === affectedUserId),
    ),
  recheckUserAccess: async (affectedUserId) => {
    invalidateUserStatus?.(affectedUserId);
    const account = await prisma.user.findUnique({
      where: { id: affectedUserId },
      select: { isActive: true },
    });
    if (!account?.isActive) {
      await disconnectInactiveUserSockets(affectedUserId);
      return;
    }
    await recheckSockets((socketId) => principals.get(socketId)?.userId === affectedUserId);
  },
  disconnectApiKey,
});
