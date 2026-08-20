import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * Sticky notes, in a real browser.
 *
 * The unit tests measure text through a stand-in, because jsdom has no fonts.
 * Everything that only holds with the real thing is checked here: that the
 * button reaches the canvas at all, that the label editor actually opens from
 * the Enter this code sends — the one step with no public API — and that a long
 * note shrinks its writing against real font metrics rather than growing.
 */

const openEditor = async (page: Page, drawingId: string) => {
  await page.goto(`/editor/${drawingId}`);
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => !!(window as any).__EXCALIDASH_EXCALIDRAW_API__);
  return page;
};

const scene = (page: Page) =>
  page.evaluate(() => {
    const api = (window as any).__EXCALIDASH_EXCALIDRAW_API__;
    return api.getSceneElements().map((element: any) => ({
      id: element.id,
      type: element.type,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      backgroundColor: element.backgroundColor,
      containerId: element.containerId,
      fontSize: element.fontSize,
      text: element.text,
      sticky: element.customData?.excalidashSticky ?? null,
    }));
  });

const notes = async (page: Page) => (await scene(page)).filter((e: any) => e.sticky);
const labels = async (page: Page) => (await scene(page)).filter((e: any) => e.containerId);

const stickyButton = (page: Page) => page.getByRole("button", { name: "Sticky note" });

/** Place a note by arming the tool and clicking the canvas, as a person would. */
const armTool = async (page: Page) => {
  await stickyButton(page).click();
  // The tool is set through React state; a click landing before that commits
  // would be read as a selection drag instead.
  await page.waitForFunction(
    () =>
      (window as any).__EXCALIDASH_EXCALIDRAW_API__.getAppState().activeTool
        ?.customType === "sticky",
  );
};

const placeNote = async (page: Page, at: { x: number; y: number }) => {
  await armTool(page);
  await page.locator("canvas").last().click({ position: at });
  await page.waitForFunction(() =>
    (window as any).__EXCALIDASH_EXCALIDRAW_API__
      .getSceneElements()
      .some((element: any) => element.customData?.excalidashSticky),
  );
};

const settle = async (page: Page) => {
  // The upkeep pass runs off the change event and applies on the next frame.
  await page.waitForTimeout(400);
};

test.describe("sticky notes", () => {
  let drawingId: string;
  let api: APIRequestContext;

  test.beforeEach(async ({ request }) => {
    api = request;
    const drawing = await createDrawing(request, { name: `e2e-sticky-${Date.now()}` });
    drawingId = drawing.id;
  });

  test.afterEach(async () => {
    if (drawingId) await deleteDrawing(api, drawingId).catch(() => {});
  });

  test("puts a note on the board where it was clicked", async ({ page }) => {
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });

    const placed = await notes(page);
    expect(placed).toHaveLength(1);
    expect(placed[0].type).toBe("rectangle");
    expect(placed[0].width).toBe(200);
    expect(placed[0].height).toBe(200);
  });

  test("opens the label editor by itself, so typing starts straight away", async ({ page }) => {
    // The step with no public API. If Excalidraw ever stops starting its editor
    // from a synthetic Enter, this is what says so.
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });

    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible({ timeout: 5000 });

    await page.keyboard.type("Deploy on Friday");
    await page.keyboard.press("Escape");
    await settle(page);

    const written = await labels(page);
    expect(written).toHaveLength(1);
    expect(written[0].text).toContain("Deploy on Friday");
  });

  test("shrinks the writing rather than growing the note", async ({ page }) => {
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();

    await page.keyboard.type(
      "This note has considerably more in it than a couple of words, enough that " +
        "the writing has to give way if the paper is to stay the size it was.",
    );
    await page.keyboard.press("Escape");
    await settle(page);

    const [note] = await notes(page);
    const [label] = await labels(page);
    expect(note.height).toBe(200);
    expect(note.width).toBe(200);
    expect(label.fontSize).toBeLessThan(20);
  });

  test("keeps a short note at its full size", async ({ page }) => {
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();

    await page.keyboard.type("Ship it");
    await page.keyboard.press("Escape");
    await settle(page);

    const [label] = await labels(page);
    expect(label.fontSize).toBe(20);
  });

  test("Tab makes the next note beside the one selected", async ({ page }) => {
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
    await page.keyboard.type("First");
    await page.keyboard.press("Escape");
    await settle(page);

    await page.keyboard.press("Tab");
    await page.waitForFunction(
      () =>
        (window as any).__EXCALIDASH_EXCALIDRAW_API__
          .getSceneElements()
          .filter((element: any) => element.customData?.excalidashSticky).length === 2,
      undefined,
      { timeout: 5000 },
    );

    const placed = await notes(page);
    const [first, second] = placed.sort((a: any, b: any) => a.x - b.x);
    expect(second.x - (first.x + first.width)).toBe(24);
    expect(second.y).toBe(first.y);
  });

  test("puts the chosen colour on the paper", async ({ page }) => {
    await openEditor(page, drawingId);
    await armTool(page);
    await page.getByRole("button", { name: "Blue" }).click();
    await page.locator("canvas").last().click({ position: { x: 400, y: 300 } });
    await page.waitForFunction(() =>
      (window as any).__EXCALIDASH_EXCALIDRAW_API__
        .getSceneElements()
        .some((element: any) => element.customData?.excalidashSticky),
    );

    const [note] = await notes(page);
    expect(note.backgroundColor).toBe("#bfdbfe");
    expect(note.sticky.color).toBe("blue");
  });

  test("survives a reload with its size and metadata intact", async ({ page }) => {
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
    await page.keyboard.type("Persisted");
    await page.keyboard.press("Escape");
    await settle(page);
    await page.waitForTimeout(1500);

    await openEditor(page, drawingId);
    await settle(page);

    const placed = await notes(page);
    expect(placed).toHaveLength(1);
    expect(placed[0].height).toBe(200);
    expect(placed[0].sticky).toMatchObject({ v: 1, color: "yellow" });
    const [label] = await labels(page);
    expect(label.text).toContain("Persisted");
  });

  test("settles instead of drifting when left alone", async ({ page }) => {
    // The upkeep runs on every scene change and updates the scene. If it were
    // not still, a note would gain a revision per frame forever.
    await openEditor(page, drawingId);
    await placeNote(page, { x: 400, y: 300 });
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
    await page.keyboard.type("Quiet please");
    await page.keyboard.press("Escape");
    await settle(page);

    const versionOf = () =>
      page.evaluate(
        () =>
          (window as any).__EXCALIDASH_EXCALIDRAW_API__
            .getSceneElements()
            .find((element: any) => element.containerId)?.version ?? 0,
      );

    const before = await versionOf();
    await page.waitForTimeout(2000);
    expect(await versionOf()).toBe(before);
  });
});
