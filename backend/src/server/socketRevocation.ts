import type { Socket } from "socket.io";
import type { DrawingPrincipal } from "../authz/sharing";

type ApiKeySocketRevoker = (apiKeyId: string) => Promise<void>;
type UserSocketRechecker = (userId: string) => Promise<void>;

let revokeSockets: ApiKeySocketRevoker = async () => undefined;
let recheckUserSockets: UserSocketRechecker = async () => undefined;

// Auth routes are registered before the Socket.IO handlers in the application
// module, so they call this late-bound process-local bridge at request time.
export const registerApiKeySocketRevoker = (
  revoker: ApiKeySocketRevoker,
): void => {
  revokeSockets = revoker;
};

export const disconnectApiKeySockets = (apiKeyId: string): Promise<void> =>
  revokeSockets(apiKeyId);

export const registerUserSocketRechecker = (
  rechecker: UserSocketRechecker,
): void => {
  recheckUserSockets = rechecker;
};

export const recheckActiveUserSockets = (userId: string): Promise<void> =>
  recheckUserSockets(userId);

export const createApiKeySocketRevoker = ({
  connectedSockets,
  principals,
  removeFromDrawing,
}: {
  connectedSockets: Map<string, Socket>;
  principals: Map<string, DrawingPrincipal>;
  removeFromDrawing: (socket: Socket, reason: string) => Promise<void>;
}): ApiKeySocketRevoker => async (apiKeyId) => {
  const candidates = Array.from(connectedSockets.values()).filter(
    (socket) => principals.get(socket.id)?.apiKey?.id === apiKeyId,
  );
  await Promise.all(candidates.map(async (socket) => {
    connectedSockets.delete(socket.id);
    await removeFromDrawing(socket, "api-key-revoked");
    principals.delete(socket.id);
    socket.emit("error", {
      code: "api-key-revoked",
      message: "API key has been revoked",
    });
    socket.disconnect(true);
  }));
};
