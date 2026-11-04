# Durable tests with @playwright/test

When a check should be replayed without Claude (CI, before each release), propose a Playwright Test
in the project instead of another one-off script. Ask before adding dependencies to the user's project.

## Setup (once per project)

```bash
npm i -D @playwright/test        # or yarn add -D / pnpm add -D, matching the project's lockfile
npx playwright install chromium
```

`playwright.config.ts` minimal:

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
});
```

## Turning a mocks.json finding into a test

```ts
// e2e/users-error.spec.ts
import { test, expect } from "@playwright/test";

test("shows an error banner when the users API fails", async ({ page }) => {
  await page.route("**/api/users*", (r) => r.fulfill({ status: 500, json: { error: "boom" } }));
  await page.goto("/users");
  await expect(page.getByRole("alert")).toContainText(/try again/i);
});

test("no console errors on the dashboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
```

Injected scripts become `await page.addInitScript({ path: "e2e/fixtures/spy.js" })` in a `beforeEach`.

Run: `npx playwright test` (add `--ui` for the interactive runner, `--headed` to watch).
Once the project has `@playwright/test` with a browser downloaded, `netcheck.mjs`/`mock.mjs` use its Playwright
(otherwise they fall back to dev-browser's).
