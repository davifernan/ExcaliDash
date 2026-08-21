import express from "express";
import { getCollectionRoster } from "../../authz/roster";
import { subjectKey } from "../../authz/subjectKey";
import { derivePresenceColor, toPresenceInitials } from "../../server/socketPresence";
import type { DashboardRouteDeps } from "./types";

const ROLE_BY_LEVEL = { owner: "owner", edit: "editor", view: "viewer" } as const;

/**
 * Who a collection is shared with, told to the people it is shared with.
 *
 * `/collections/:id/shares` already answers a similar question, but only for the
 * owner and with email addresses attached, because it exists to manage access.
 * This one exists to show a team who they are working with, so it carries the
 * least that a row of faces needs: a name, its initials, a colour, a role. Not
 * existing and not being a member answer the same way, so the endpoint cannot be
 * used to find out which collections exist.
 */
export const registerCollectionMemberRoutes = (app: express.Express, deps: DashboardRouteDeps) => {
  const { prisma, requireAuth, asyncHandler, subjectKeySecret } = deps;

  app.get(
    "/collections/:id/members",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      if (req.user.authCredentialType === "apiKey") {
        return res.status(403).json({ error: "Forbidden", message: "Not available to API keys" });
      }
      const { id } = req.params;

      const roster = await getCollectionRoster({ prisma, collectionId: id });
      if (!roster.some((member) => member.userId === req.user!.id)) {
        return res.status(404).json({ error: "Collection not found" });
      }

      res.set("Cache-Control", "private, no-store");
      return res.json({
        collectionId: id,
        totalCount: roster.length,
        members: roster.map((member) => ({
          subjectKey: subjectKey(subjectKeySecret, `collection:${id}`, member.userId),
          name: member.name,
          initials: toPresenceInitials(member.name),
          color: derivePresenceColor(member.userId),
          role: ROLE_BY_LEVEL[member.level],
          isSelf: member.userId === req.user!.id,
        })),
      });
    }),
  );
};
