export type CollaborationAccessController = {
  recheckDrawingAccess: (
    drawingId: string,
    affectedUserId?: string,
  ) => Promise<void>;
  recheckUserAccess: (affectedUserId: string) => Promise<void>;
  disconnectApiKey: (apiKeyId: string) => Promise<void>;
};
