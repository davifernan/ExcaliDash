import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production nginx upload limits", () => {
  it("admits backend-sized archives only on the two ExcaliDash import routes", async () => {
    const config = await readFile(resolve(process.cwd(), "nginx.conf.template"), "utf8");
    const locationBody = (path: string) =>
      config.match(
        new RegExp(`location = ${path.replaceAll("/", "\\/")} \\{([\\s\\S]*?)\\n        \\}`),
      )?.[1] ?? "";

    expect(config).toContain("client_max_body_size 50M;");
    expect(locationBody("/api/import/excalidash")).toContain("client_max_body_size 2301M;");
    expect(locationBody("/api/import/excalidash/verify")).toContain("client_max_body_size 2301M;");
    expect(config.match(/client_max_body_size 2301M;/g)).toHaveLength(2);
  });
});
