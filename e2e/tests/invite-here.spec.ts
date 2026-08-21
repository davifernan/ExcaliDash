import { test, expect, type Page } from "@playwright/test";
import { createDrawing, deleteDrawing } from "./helpers/api";

const rect = (id: string, x: number, y: number) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 160,
  height: 120,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "#ffec99",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

/**
 * The promise this feature makes is that nothing moves on your screen without
 * your click, and that accepting moves you once rather than tying you to
 * somebody. Both halves are about the canvas, so both are checked by looking at
 * it -- clipped to a corner the notice never covers, so the only thing that can
 * change those pixels is the view itself.
 */
test("an invitation waits for a click, then moves the view exactly once", async ({
  browser,
  request,
}) => {
  const drawing = await createDrawing(request, {
    name: "Invite E2E",
    elements: [rect("a", 200, 200), rect("b", 1400, 1200)],
  });

  const open = async (page: Page) => {
    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector(".excalidraw", { timeout: 30000 });
    await page.waitForTimeout(2000);
  };
  // A patch of open canvas: clear of the left properties panel, of the tool row
  // at the top, and of the notice at the bottom. The only thing that can change
  // these pixels is the view moving.
  const canvasPatch = { x: 520, y: 140, width: 560, height: 340 };
  const look = (page: Page) => page.screenshot({ clip: canvasPatch });

  const host = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const hostPage = await host.newPage();
  await open(hostPage);
  const guest = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestPage = await guest.newPage();
  await open(guestPage);
  await hostPage.waitForTimeout(1500);

  // The host looks somewhere the guest is not. Asserted rather than assumed:
  // if the host never moved, the invitation would be to where the guest already
  // is, and the rest of this test would prove nothing.
  const hostBefore = await look(hostPage);
  await hostPage.locator(".excalidraw__canvas.interactive").click({ position: { x: 900, y: 500 } });
  await hostPage.keyboard.press("h");
  await hostPage.mouse.move(900, 500);
  await hostPage.mouse.down();
  await hostPage.mouse.move(300, 180, { steps: 12 });
  await hostPage.mouse.up();
  await hostPage.waitForTimeout(600);
  expect(Buffer.compare(await look(hostPage), hostBefore)).not.toBe(0);

  const beforeInvite = await look(guestPage);

  await hostPage.getByTestId("editor-invite").click();
  const overlay = guestPage.locator(".invite-here-overlay");
  await expect(overlay).toBeVisible({ timeout: 8000 });
  await guestPage.waitForTimeout(800);

  // Nothing may have moved yet: the invitation is an offer, not a shove.
  expect(Buffer.compare(await look(guestPage), beforeInvite)).toBe(0);

  await guestPage.getByRole("button", { name: /accept/i }).click();
  await expect(overlay).toBeHidden({ timeout: 5000 });
  await guestPage.waitForTimeout(800);
  const afterAccept = await look(guestPage);
  expect(Buffer.compare(afterAccept, beforeInvite)).not.toBe(0);

  // And it was a jump, not a leash: the host moving on leaves the guest be.
  await hostPage.mouse.move(900, 500);
  await hostPage.mouse.down();
  await hostPage.mouse.move(400, 600, { steps: 12 });
  await hostPage.mouse.up();
  await hostPage.waitForTimeout(1500);
  expect(Buffer.compare(await look(guestPage), afterAccept)).toBe(0);

  await host.close();
  await guest.close();
  await deleteDrawing(request, drawing.id);
});
