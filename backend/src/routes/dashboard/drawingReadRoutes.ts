import express from "express";
import { canViewDrawing, getDrawingAccess } from "../../authz/sharing";
import { toPublicTrashCollectionId } from "./trash";
import type { DrawingRouteContext } from "./drawingRouteContext";

export const registerDrawingReadRoutes = (app: express.Express, context: DrawingRouteContext) => {
  const {
    prisma,
    optionalAuth,
    asyncHandler,
    parseJsonField,
    getRequestPrincipal,
    getShareToken,
    respondWithAuthErrorIfPresent,
  } = context;
  app.get(
    "/drawings/:id",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const principal = await getRequestPrincipal(req);

      const { id } = req.params;
      const access = await getDrawingAccess({
        prisma,
        principal,
        drawingId: id,
        shareToken: getShareToken(req),
      });
      if (!canViewDrawing(access)) {
        if (respondWithAuthErrorIfPresent(req, res)) return;
        if (!principal) {
          return res.status(403).json({
            error: "Invalid share link",
            code: "SHARE_LINK_INVALID",
            message: "This share link is no longer valid. Ask the owner for a new link.",
          });
        }
        return res.status(404).json({
          error: "Drawing not found",
          message: "Drawing does not exist",
        });
      }

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        include: { createdBy: { select: { name: true } } },
      });
      if (!drawing) {
        return res.status(404).json({
          error: "Drawing not found",
          message: "Drawing does not exist",
        });
      }

      const isOwner = principal?.kind === "user" && principal.userId === drawing.userId;
      const { createdBy, createdByUserId: _createdByUserId, userId, ...row } = drawing;
      return res.json({
        ...row,
        // Who drew it is worth showing; which account row that is, is not. That
        // goes for the owner as well: this route answers anonymous share-link
        // visitors, and an account id handed to one of them identifies the same
        // person on every other board they are ever linked to.
        ...(isOwner ? { userId } : {}),
        creatorName: createdBy?.name ?? null,
        // Collections (and trash mapping) are owner-scoped. For shared/public access, avoid leaking
        // owner collection ids like `trash:<ownerId>` and avoid implying the viewer can organize it.
        collectionId: isOwner
          ? toPublicTrashCollectionId(drawing.collectionId, drawing.userId)
          : null,
        elements: parseJsonField(drawing.elements, []),
        appState: parseJsonField(drawing.appState, {}),
        files: parseJsonField(drawing.files, {}),
        accessLevel: access,
      });
    }),
  );
};
