import type { Prisma } from "../generated/client";

/** Revoke every renewable credential owned by one account. */
export const revokeUserCredentials = async (
  tx: Prisma.TransactionClient,
  userId: string,
  revokedAt: Date,
): Promise<string[]> => {
  const activeKeys = await tx.apiKey.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  await Promise.all([
    tx.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    }),
    tx.apiKey.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    }),
  ]);
  return activeKeys.map((key) => key.id);
};
