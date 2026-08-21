import { describe, expect, it, vi } from "vitest";
import {
  createDocumentPageManager,
  DOCUMENT_PAGE_EVENT,
  DOCUMENT_PAGE_LIMITS,
  parseDocumentPageCommand,
} from "./socketDocumentPages";

const command = (overrides: Record<string, unknown> = {}) => ({
  drawingId: "board-1",
  elementId: "widget-1",
  assetId: "asset-1",
  page: 3,
  ...overrides,
});

describe("what the server accepts as a page turn", () => {
  it("takes a well-formed command", () => {
    expect(parseDocumentPageCommand(command())).toEqual({
      drawingId: "board-1",
      elementId: "widget-1",
      assetId: "asset-1",
      page: 3,
    });
  });

  it.each([
    ["no page below one", { page: 0 }],
    ["no fractional page", { page: 1.5 }],
    ["no page as text", { page: "3" }],
    ["no absurd page", { page: DOCUMENT_PAGE_LIMITS.maxPageWithoutCount + 1 }],
    ["no path in an element id", { elementId: "../../etc/passwd" }],
    ["no oversized element id", { elementId: "x".repeat(65) }],
    ["no empty asset id", { assetId: "" }],
    ["no missing board", { drawingId: undefined }],
  ])("%s", (_name, overrides) => {
    expect(parseDocumentPageCommand(command(overrides))).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(parseDocumentPageCommand("board-1")).toBeNull();
    expect(parseDocumentPageCommand([command()])).toBeNull();
    expect(parseDocumentPageCommand(null)).toBeNull();
  });
});

type Row = { drawingId: string; elementId: string; assetId: string; page: number };

const fakePrisma = ({
  asset,
  rows = [],
}: {
  asset: { pageCount: number | null; status: string } | null;
  rows?: Row[];
}) => {
  const stored = [...rows];
  return {
    stored,
    drawingAsset: {
      findUnique: vi.fn(async () => (asset ? { asset } : null)),
    },
    documentPageView: {
      // Real Prisma honours `select`, so the fake has to as well: a test that
      // accepts a shape production never returns proves nothing.
      findMany: vi.fn(async ({ where, select }: any) =>
        stored
          .filter((row) => row.drawingId === where.drawingId)
          .map((row) =>
            Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]])),
          ),
      ),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.drawingId_elementId;
        return (
          stored.find((r) => r.drawingId === key.drawingId && r.elementId === key.elementId) ?? null
        );
      }),
      count: vi.fn(
        async ({ where }: any) => stored.filter((row) => row.drawingId === where.drawingId).length,
      ),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.drawingId_elementId;
        const found = stored.find(
          (r) => r.drawingId === key.drawingId && r.elementId === key.elementId,
        );
        if (found) Object.assign(found, update);
        else stored.push(create);
      }),
    },
  };
};

const fakeIo = () => {
  const emit = vi.fn();
  return { emit, to: vi.fn(() => ({ emit })) };
};

describe("the room's shared page", () => {
  it("records the turn and tells the room", async () => {
    const prisma = fakePrisma({ asset: { pageCount: 12, status: "READY" } });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command() as any);

    expect(io.to).toHaveBeenCalledWith("drawing_board-1");
    expect(io.emit).toHaveBeenCalledWith(DOCUMENT_PAGE_EVENT, {
      drawingId: "board-1",
      pages: [{ elementId: "widget-1", assetId: "asset-1", page: 3 }],
    });
    expect(prisma.stored).toEqual([
      { drawingId: "board-1", elementId: "widget-1", assetId: "asset-1", page: 3 },
    ]);
  });

  it("refuses a page the document does not have", async () => {
    const prisma = fakePrisma({ asset: { pageCount: 2, status: "READY" } });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command({ page: 3 }) as any);

    expect(io.emit).not.toHaveBeenCalled();
    expect(prisma.stored).toEqual([]);
  });

  it("refuses a document that is not on this board", async () => {
    const prisma = fakePrisma({ asset: null });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command() as any);

    expect(io.emit).not.toHaveBeenCalled();
    expect(prisma.stored).toEqual([]);
  });

  it("refuses a document that is not ready to be read", async () => {
    const prisma = fakePrisma({ asset: { pageCount: 9, status: "REJECTED" } });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command() as any);

    expect(io.emit).not.toHaveBeenCalled();
  });

  it("lets a document whose pages only the browser knows through", async () => {
    const prisma = fakePrisma({ asset: { pageCount: null, status: "READY" } });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command({ page: 250 }) as any);

    expect(prisma.stored[0].page).toBe(250);
  });

  it("stays quiet when the page did not actually change", async () => {
    const prisma = fakePrisma({
      asset: { pageCount: 12, status: "READY" },
      rows: [{ drawingId: "board-1", elementId: "widget-1", assetId: "asset-1", page: 3 }],
    });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command({ page: 3 }) as any);

    expect(io.emit).not.toHaveBeenCalled();
    expect(prisma.documentPageView.upsert).not.toHaveBeenCalled();
  });

  it("stops a board from tracking endless invented widgets", async () => {
    const rows = Array.from({ length: DOCUMENT_PAGE_LIMITS.widgetsPerDrawing }, (_, i) => ({
      drawingId: "board-1",
      elementId: `widget-${i}`,
      assetId: "asset-1",
      page: 1,
    }));
    const prisma = fakePrisma({ asset: { pageCount: 12, status: "READY" }, rows });
    const io = fakeIo();
    const pages = createDocumentPageManager({ io: io as any, prisma });

    await pages.set(command({ elementId: "one-too-many" }) as any);

    expect(io.emit).not.toHaveBeenCalled();
    expect(prisma.stored).toHaveLength(DOCUMENT_PAGE_LIMITS.widgetsPerDrawing);

    // An id that is already tracked still moves, so a full board is not frozen.
    await pages.set(command({ elementId: "widget-0", page: 7 }) as any);
    expect(io.emit).toHaveBeenCalled();
  });

  it("hands a joiner every page the room is on", async () => {
    const prisma = fakePrisma({
      asset: { pageCount: 12, status: "READY" },
      rows: [
        { drawingId: "board-1", elementId: "widget-1", assetId: "asset-1", page: 4 },
        { drawingId: "other", elementId: "widget-9", assetId: "asset-2", page: 2 },
      ],
    });
    const pages = createDocumentPageManager({ io: fakeIo() as any, prisma });

    expect(await pages.snapshot("board-1")).toEqual({
      drawingId: "board-1",
      pages: [{ elementId: "widget-1", assetId: "asset-1", page: 4 }],
    });
  });
});
