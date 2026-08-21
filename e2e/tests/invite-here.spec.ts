import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

/**
 * The invitation must never move anybody's canvas on its own. Everything else
 * about this feature is negotiable; that part is the reason it exists in this
 * shape instead of Miro's.
 */
test("an invitation waits for a click and then jumps exactly once", async ({ browser, request }) => {
  const drawing = await createDrawing(request, { name: "Invite E2E" });

  const open = async (page: Page) => {
    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector(".excalidraw", { timeout: 30000 });
    await page.waitForTimeout(2000);
  };
  const scroll = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector(".excalidraw") as HTMLElement | null;
      return el?.getAttribute("data-scroll") ?? null;
    });

  const host = await browser.newContext();
  const hostPage = await host.newPage();
  await open(hostPage);
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await open(guestPage);
  await hostPage.waitForTimeout(1500);

  // Der Gast schiebt seine Ansicht weg, damit ein Sprung sichtbar waere.
  await guestPage.mouse.move(600, 400);
  await guestPage.mouse.down({ button: "middle" }).catch(() => {});
  await guestPage.mouse.up({ button: "middle" }).catch(() => {});

  const trigger = hostPage.getByTestId("editor-invite");
  await expect(trigger).toBeVisible({ timeout: 8000 });
  await trigger.click();

  const overlay = guestPage.locator(".invite-here-overlay");
  await expect(overlay).toBeVisible({ timeout: 8000 });
  // Nichts darf sich bewegt haben, solange nicht geklickt wurde.
  await expect(overlay.locator(".invite-here-overlay__seconds")).toContainText(/\d+s/);

  await guestPage.getByRole("button", { name: /join|accept|come|go/i }).first().click();
  await expect(overlay).toBeHidden({ timeout: 5000 });

  await host.close();
  await guest.close();
  await deleteDrawing(request, drawing.id);
});
