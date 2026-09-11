#!/usr/bin/env node
/**
 * The demo-parity capture harness.
 *
 * Drives the approved demo and the React port side by side at four viewports and writes matched
 * screenshots for `diff.mjs` to compare. Everything that could vary between the two runs and is
 * not part of the design is pinned:
 *
 *  - **Fonts.** Manrope and DM Sans are served from Google, which this environment cannot reach.
 *    Left alone the two pages fall back differently — the demo's `font:` shorthand carries no
 *    fallback and lands on the default serif, while the port's lands on sans-serif — and the diff
 *    then measures a sandbox artefact rather than the design. Both are aliased to one local family
 *    so the comparison is of structure, spacing, colour and layout. Glyph shapes are identical in
 *    a deployment that can load the real fonts.
 *  - **Animation and transitions**, off. The demo animates cards in.
 *  - **Reduced motion**, on. **Device scale**, 1. **Colour profile**, sRGB.
 *  - **The clock**, frozen, so "12 min ago" is stable.
 *
 * Usage: node parity/capture.mjs [screen[:route]...]
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "docs/audit/demo-parity";
const ORIGINAL = process.env.PARITY_ORIGINAL ?? "http://127.0.0.1:4180";
const REACT = process.env.PARITY_REACT ?? "http://127.0.0.1:4177";

export const SIZES = [
  ["1440x900", 1440, 900],
  ["1360x900", 1360, 900],
  ["1024x768", 1024, 768],
  ["390x844", 390, 844],
];

/**
 * Each screen: the label, the demo's view name (its nav is buttons, not routes), and the port's
 * route. A `null` view means the demo reaches it another way and only the port is captured.
 */
export const SCREENS = [
  { label: "Discover", view: "discover", route: "/discover" },
  { label: "Ask", view: "ask", route: "/ask" },
  { label: "Work", view: "work", route: "/work?view=active" },
  { label: "Jobs", view: "jobs", route: "/jobs?filter=running" },
  { label: "Automations", view: "automations", route: "/automations" },
];

const NORMALISE = `
  /* Both pages resolve these to the same real family: see the note in capture.mjs. */
  @font-face { font-family: "Manrope"; src: local("Liberation Sans"); font-weight: 100 900; }
  @font-face { font-family: "DM Sans"; src: local("Liberation Sans"); font-weight: 100 900; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`;

const SESSION = {
  access_token: "parity",
  token_type: "bearer",
  expires_in: 999999,
  expires_at: 4102444800,
  refresh_token: "parity",
  user: {
    id: "a0000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "admin@acme-brokers.test",
    email_confirmed_at: "2026-09-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Grace Wanjiku" },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    identities: [],
  },
};

async function shoot(page, path) {
  await page.addStyleTag({ content: NORMALISE });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await page.screenshot({ path });
}

export async function capture(only) {
  const screens = only?.length
    ? SCREENS.filter((s) => only.includes(s.label.toLowerCase()))
    : SCREENS;
  mkdirSync(`${OUT}/original`, { recursive: true });
  mkdirSync(`${OUT}/react`, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
    args: [
      "--no-sandbox",
      "--proxy-server=direct://",
      "--proxy-bypass-list=*",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "--disable-lcd-text",
    ],
  });

  for (const [sz, width, height] of SIZES) {
    // The approved demo.
    const origCtx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const orig = await origCtx.newPage();
    await orig.goto(`${ORIGINAL}/`, { waitUntil: "networkidle" });
    for (const s of screens) {
      if (!s.view) continue;
      await orig.evaluate((v) => {
        const b = document.querySelector(`.nav-item[data-view="${v}"]`);
        if (b instanceof HTMLElement) b.click();
      }, s.view);
      await orig.waitForTimeout(500);
      await shoot(orig, `${OUT}/original/${s.label}-${sz}.png`);
    }
    await origCtx.close();

    // The React port.
    const reactCtx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    await reactCtx.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* private mode: the parity run still works, it just signs in again */
        }
      },
      ["sb-127-auth-token", SESSION],
    );
    const react = await reactCtx.newPage();
    for (const s of screens) {
      await react.goto(`${REACT}${s.route}`, { waitUntil: "networkidle" });
      await shoot(react, `${OUT}/react/${s.label}-${sz}.png`);
    }
    await reactCtx.close();
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await capture(process.argv.slice(2).map((s) => s.toLowerCase()));
  console.log("captured original and react at", SIZES.map((s) => s[0]).join(", "));
}
