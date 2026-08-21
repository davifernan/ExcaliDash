import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * The slash key is the whole risk in this feature. Every other whiteboard uses
 * it, but it is also an ordinary character, and taking it away from people
 * writing on the board would be a worse bug than not having cursor chat.
 */
test.describe("cursor chat", () => {
  const open = async (page: Page, id: string) => {
    await page.goto(`/editor/${id}`);
    await page.waitForSelector(".excalidraw", { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 600, y: 400 } });
  };

  test("slash opens the composer on an idle canvas", async ({ page, request }) => {
    const drawing = await createDrawing(request, { name: "Chat Key" });
    await open(page, drawing.id);

    await page.keyboard.press("/");
    const composer = page.getByTestId("cursor-chat-composer");
    await expect(composer).toBeVisible({ timeout: 5000 });

    await page.keyboard.type("over here");
    await expect(composer.locator("input")).toHaveValue("over here");

    await page.keyboard.press("Escape");
    await expect(composer).toBeHidden({ timeout: 5000 });

    await deleteDrawing(request, drawing.id);
  });

  test("slash still types a slash inside a sticky note", async ({ page, request }) => {
    const drawing = await createDrawing(request, { name: "Chat Key Sticky" });
    await open(page, drawing.id);

    await page.locator('[data-testid="toolbar-sticky"]').click();
    await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 400, y: 300 } });
    const label = page.locator("textarea.excalidraw-wysiwyg");
    await expect(label).toBeVisible();

    await page.keyboard.type("before/after");
    await expect(page.getByTestId("cursor-chat-composer")).toHaveCount(0);
    await expect(label).toHaveValue("before/after");

    await deleteDrawing(request, drawing.id);
  });
});
