import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * The key is the whole risk in this feature. Enter is free on an idle canvas
 * and reads as "start saying something", but it is not ours unconditionally:
 * with a selection it opens that element's text editor, and that is exactly how
 * a freshly placed sticky note gets its label. Taking it blindly would break
 * creating notes -- so that case gets a test of its own.
 */
test.describe("cursor chat", () => {
  const open = async (page: Page, id: string) => {
    await page.goto(`/editor/${id}`);
    await page.waitForSelector(".excalidraw", { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 600, y: 400 } });
  };

  test("Enter opens the composer on an idle canvas", async ({ page, request }) => {
    const drawing = await createDrawing(request, { name: "Chat Key" });
    await open(page, drawing.id);

    await page.keyboard.press("Enter");
    const composer = page.getByTestId("cursor-chat-composer");
    await expect(composer).toBeVisible({ timeout: 5000 });

    await page.keyboard.type("over here");
    await expect(composer.locator("input")).toHaveValue("over here");

    await page.keyboard.press("Escape");
    await expect(composer).toBeHidden({ timeout: 5000 });

    await deleteDrawing(request, drawing.id);
  });

  test("placing a sticky note still opens its label, not the chat", async ({ page, request }) => {
    // The note is created, selected, and sent a synthetic Enter to open its
    // label. If cursor chat claimed Enter unconditionally it would swallow that
    // and notes could no longer be written on at all.
    const drawing = await createDrawing(request, { name: "Chat Key Sticky" });
    await open(page, drawing.id);

    await page.locator('[data-testid="toolbar-sticky"]').click();
    await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 400, y: 300 } });

    const label = page.locator("textarea.excalidraw-wysiwyg");
    await expect(label).toBeVisible();
    await expect(page.getByTestId("cursor-chat-composer")).toHaveCount(0);

    await page.keyboard.type("a note");
    await expect(label).toHaveValue("a note");

    await deleteDrawing(request, drawing.id);
  });

  test("Enter belongs to the selected element, not to the chat", async ({ page, request }) => {
    const drawing = await createDrawing(request, { name: "Chat Key Selection" });
    await open(page, drawing.id);

    await page.locator('[data-testid="toolbar-sticky"]').click();
    await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 400, y: 300 } });
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
    await page.keyboard.type("selected");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    // The note is still selected: Enter reopens its label rather than the chat.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await expect(page.getByTestId("cursor-chat-composer")).toHaveCount(0);
    await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();

    await deleteDrawing(request, drawing.id);
  });
});
