import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * Paging through a document in a meeting is only useful if it happens for the
 * room. A test that watched the person clicking would pass on a widget that
 * quietly kept its page to itself, which is exactly the bug worth catching.
 */

// Long enough to be split into pages in the browser, and unmistakable per page.
const MARKDOWN = Array.from(
  { length: 60 },
  (_, i) => `## Section ${i + 1}\n\n${`Body text for section ${i + 1}. `.repeat(30)}\n`,
).join("\n");

const openEditor = async (page: Page, drawingId: string) => {
  await page.goto(`/editor/${drawingId}`);
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  await page.waitForTimeout(2000);
};

const dropMarkdown = async (page: Page, source: string) => {
  await page.evaluate(async (text) => {
    const container = document.querySelector<HTMLElement>(".excalidraw")?.closest("div[style]");
    const target = container ?? document.body;
    const file = new File([text], "notes.md", { type: "text/markdown" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }, source);
};

const pageLabel = (page: Page) => page.locator(".text-document-widget__page-number");

/**
 * Excalidraw keeps an embedded element behind its own canvas until you click
 * it, the same way it guards an embedded video. Until then the canvas swallows
 * every click, so the widget's own controls cannot be reached.
 */
const activateWidget = async (page: Page) => {
  const box = await page.locator(".text-document-widget").boundingBox();
  if (!box) throw new Error("The document widget is not on the board.");
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
};

test("everyone in the room turns to the same page", async ({ browser, request }) => {
  const drawing = await createDrawing(request, { name: "Shared pages E2E" });

  const host = await browser.newContext();
  const hostPage = await host.newPage();
  await openEditor(hostPage, drawing.id);

  await dropMarkdown(hostPage, MARKDOWN);
  await expect(pageLabel(hostPage)).toContainText("Page 1 of", { timeout: 30000 });
  // Let the board carrying the new widget reach the server before anyone joins.
  await hostPage.waitForTimeout(3000);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await openEditor(guestPage, drawing.id);
  await expect(pageLabel(guestPage)).toContainText("Page 1 of", { timeout: 30000 });

  await activateWidget(hostPage);
  await hostPage.getByRole("button", { name: "Next page" }).click();

  await expect(pageLabel(hostPage)).toContainText("Page 2 of", { timeout: 10000 });
  await expect(pageLabel(guestPage)).toContainText("Page 2 of", { timeout: 10000 });

  // Nobody is the presenter: whoever may edit the board may turn the page, and
  // the turn travels back the other way just as well.
  await activateWidget(guestPage);
  await guestPage.getByRole("button", { name: "Next page" }).click();
  await expect(pageLabel(guestPage)).toContainText("Page 3 of", { timeout: 10000 });
  await expect(pageLabel(hostPage)).toContainText("Page 3 of", { timeout: 10000 });

  // And the page the room is on outlives the tab that turned it: someone
  // arriving later is shown page 3, not page 1.
  const latecomer = await browser.newContext();
  const latecomerPage = await latecomer.newPage();
  await openEditor(latecomerPage, drawing.id);
  await expect(pageLabel(latecomerPage)).toContainText("Page 3 of", { timeout: 30000 });

  await host.close();
  await guest.close();
  await latecomer.close();
  await deleteDrawing(request, drawing.id);
});
