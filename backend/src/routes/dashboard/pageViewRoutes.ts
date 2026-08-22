import express from "express";
import type { DrawingRouteContext } from "./drawingRouteContext";

const MAX_PAGES = 500;

export const registerPageViewRoutes = (app: express.Express, context: DrawingRouteContext) => {
  const { prisma, optionalAuth, asyncHandler } = context;

  app.post(
    "/drawings/:id/page",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const page = Number(req.body?.page);

      if (page > MAX_PAGES) {
        return;
      }

      const existing = await prisma.documentPageView.findFirst({ where: { drawingId: id } });

      try {
        if (existing) {
          await prisma.documentPageView.update({ where: { id: existing.id }, data: { page } });
        } else {
          await prisma.documentPageView.create({ data: { drawingId: id, page } });
        }
      } catch (error) {
        // nichts zu tun
      }

      return res.json({ ok: true, page });
    }),
  );
};
