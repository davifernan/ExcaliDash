import { test, expect } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

const snapChecked = async (page: import("@playwright/test").Page) => {
  await page.locator(".excalidraw__canvas.interactive").click({ button: "right", position: { x: 700, y: 400 } });
  await page.waitForTimeout(400);
  const on = await page.evaluate(() =>
    [...document.querySelectorAll("[class*='context-menu-item']")]
      .some((e) => /snap to objects/i.test((e as HTMLElement).innerText || "") &&
                   (e as HTMLElement).className.includes("checkmark")),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return on;
};

/**
 * Object snapping is Excalidraw's own feature; all we do is switch it on and
 * remember the answer. The remembering is the part that can break, and it can
 * only break in the round trip through the backend, which no unit test sees.
 */
test("object snapping starts on and survives a reload", async ({ page, request }) => {
  const d = await createDrawing(request, { name: "Snap Roundtrip" });
  await page.goto(`/editor/${d.id}`);
  await page.waitForSelector(".excalidraw");
  await page.waitForTimeout(2000);
  const first = await snapChecked(page);

  // Switch it off, give the save a moment, reload.
  await page.locator(".excalidraw__canvas.interactive").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("Alt+s");
  await page.waitForTimeout(2500);
  const afterToggle = await snapChecked(page);

  await page.reload();
  await page.waitForSelector(".excalidraw");
  await page.waitForTimeout(2500);
  const afterReload = await snapChecked(page);

  expect(first).toBe(true);
  expect(afterToggle).toBe(false);
  // The point of the test: the board remembered, rather than resetting to on.
  expect(afterReload).toBe(false);
  await deleteDrawing(request, d.id);
});
