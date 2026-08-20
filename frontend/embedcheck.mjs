import { chromium } from "playwright";
const SP = "/tmp/claude-1000/-home-claude/4b2f89a0-1861-4c19-8eed-e8574d2e536c/scratchpad";
const b = await chromium.launch({ args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
await p.goto("http://127.0.0.1:5210", { waitUntil: "networkidle" });
await p.waitForTimeout(1800);
await p.getByRole("button", { name: /new drawing/i }).click();
await p.waitForSelector("canvas", { timeout: 20000 });
await p.waitForTimeout(2500);

await p.mouse.click(650, 420);
await p.evaluate(async () => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  document.querySelector(".excalidraw")?.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await p.waitForTimeout(4000);
await p.screenshot({ path: `${SP}/embed-nachher.png` });
const frames = p.frames().length;
console.log("iframes auf der Seite:", frames - 1);
await b.close();
