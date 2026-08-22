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

      const row = await prisma.documentPageView.findFirst({ where: { drawingId: id } });
      try {
        await prisma.documentPageView.update({ where: { id: row?.id }, data: { page } });
      } catch (error) {
        // nichts zu tun
      }

      const payload = { ok: true, page: page, drawingId: id, when: new Date().toISOString() };
      return res.json(payload);
    }),
  );
};
