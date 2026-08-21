import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * Two Excalidraw features we do not implement ourselves — we only have to stay
 * out of their way. Both were switched off by accident for a long time, so they
 * are worth a test that fails loudly if the editor chrome ever swallows them
 * again.
 */
test.describe("Excalidraw features we merely have to leave alone", () => {
  const openEditor = async (page: Page, id: string) => {
    await page.goto(`/editor/${id}`);
    await page.waitForSelector(".excalidraw", { timeout: 30000 });
    await page.waitForTimeout(2000);
  };

  test("Ctrl+F opens the canvas text search", async ({ page, request }) => {
    const drawing = await createDrawing(request, { name: "Native Search" });
    await openEditor(page, drawing.id);

    // handleKeyboardGlobally is off, so the shortcut only reaches Excalidraw
    // when the canvas itself holds focus.
    await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 600, y: 400 } });
    await page.keyboard.press("Control+f");

    const search = page.locator('input[placeholder="Find text on canvas..."]');
    await expect(search).toBeVisible({ timeout: 5000 });

    await deleteDrawing(request, drawing.id);
  });

  test("the laser pointer shows up once somebody else is on the board", async ({
    browser,
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "Native Laser" });

    // The laser lives in the extra-tools dropdown, not flat in the toolbar.
    const laserOffered = async (page: Page) => {
      await page.locator('.App-toolbar [data-testid="dropdown-menu-button"]').click();
      await page.waitForTimeout(300);
      const count = await page.locator('[data-testid="toolbar-LaserPointer"]').count();
      await page.keyboard.press("Escape");
      return count > 0;
    };

    const alone = await browser.newContext();
    const pageA = await alone.newPage();
    await openEditor(pageA, drawing.id);
    expect(await laserOffered(pageA)).toBe(false);

    const second = await browser.newContext();
    const pageB = await second.newPage();
    await openEditor(pageB, drawing.id);
    await pageA.waitForTimeout(2500);
    expect(await laserOffered(pageA)).toBe(true);

    await alone.close();
    await second.close();
    await deleteDrawing(request, drawing.id);
  });
});
