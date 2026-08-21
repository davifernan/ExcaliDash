import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * Chrome in windows that are not the comfortable ones.
 *
 * Both of these were found by an adversarial review and then reproduced by
 * measuring, which is the only reason they are believed: the editor looks fine
 * at 1280x720, and both faults are invisible until the window gets short.
 */
const open = async (page: Page, id: string) => {
  await page.goto(`/editor/${id}`);
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  await page.waitForTimeout(2200);
};

test("the timer's controls stay on screen in a short window", async ({ browser, request }) => {
  // The widget is anchored to the bottom. Opening its panel downwards put Start,
  // Pause and Stop past the edge of a 420px-tall window, where the editor root
  // clips them away entirely -- the timer could be seen but not used.
  const drawing = await createDrawing(request, { name: "Short Window Timer" });
  const context = await browser.newContext({ viewport: { width: 1000, height: 420 } });
  const page = await context.newPage();
  await open(page, drawing.id);

  await page.locator(".workshop-timer__summary").click();
  await page.waitForTimeout(400);

  const offscreen = await page.evaluate(() =>
    [...document.querySelectorAll(".workshop-timer button")]
      .map((button) => ({
        label: (button as HTMLElement).innerText.trim(),
        rect: button.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.bottom > window.innerHeight || rect.top < 0)
      .map(({ label }) => label),
  );
  expect(offscreen).toEqual([]);

  await context.close();
  await deleteDrawing(request, drawing.id);
});

test("our island does not sit on top of Excalidraw's menu when the window is short", async ({
  browser,
  request,
}) => {
  // The offset that moves Excalidraw's left column down used to be dropped below
  // 600px tall. At 800x550 that put our island and the hamburger in exactly the
  // same place, one hidden under the other.
  const drawing = await createDrawing(request, { name: "Short Window Island" });
  const context = await browser.newContext({ viewport: { width: 800, height: 550 } });
  const page = await context.newPage();
  await open(page, drawing.id);

  const overlap = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? element.getBoundingClientRect() : null;
    };
    const island = box('[data-testid="editor-top-left"]');
    const menu = box(".App-menu_top__left");
    if (!island || !menu) return null;
    return !(
      island.bottom <= menu.top ||
      menu.bottom <= island.top ||
      island.right <= menu.left ||
      menu.right <= island.left
    );
  });
  expect(overlap).toBe(false);

  await context.close();
  await deleteDrawing(request, drawing.id);
});
