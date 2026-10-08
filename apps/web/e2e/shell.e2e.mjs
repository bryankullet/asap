/**
 * The adaptive shell (D-155), accepted end to end in a real browser (scripts/test-e2e.sh):
 * real interface → real API → supabase-js → PostgREST → disposable PostgreSQL. The only stand-in
 * is the session (a signed token handed to the page). Every scenario is asserted, checked for
 * console errors, horizontal overflow and placeholder text, and captured.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_URL.replace(/#.*$/, "");
const API = process.env.CONNECTED_API_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/shell";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const person = (sub, email) => jwt({ sub, email, role: "authenticated", aud: "authenticated" });
const AMINA = person("a0000000-0000-4000-8000-000000000001", "admin@acme-brokers.test");
const BETA = person("b0000000-0000-4000-8000-000000000001", "admin@beta-risk.test");
const READER = person("c0000000-0000-4000-8000-000000000001", "shared@consultant.test");
const ACME = "70000000-0000-4000-8000-00000000000a";
const RUN = Date.now().toString(36).slice(-4);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const apiAs = async (token, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function open(token, viewport, hash = "#/") {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 900, isMobile: viewport.width < 900 });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, token);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|status of 404/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) page.errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
  await page.goto(BASE + hash);
  await page.locator(".sh-root").waitFor({ timeout: 30000 }).catch((e) => { throw new Error(`the shell did not render: ${page.errors.join(" | ").slice(0, 800)} ${e.message.split("\n")[0]}`); });
  await page.locator(".sh-loading").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  await settle(page);
  return page;
}
const settle = async (page, ms = 700) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
const hash = (page) => new URL(page.url()).hash;
async function checks(page) {
  const body = await page.locator("body").innerText();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const bad = body.match(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
  const problems = [];
  if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
  if (bad) problems.push(`placeholder text “${bad[0]}”`);
  if (await page.locator(".asap-tabs").count()) problems.push("the old tab strip is on the page");
  if (page.errors.length) problems.push(`console: ${page.errors.join(" | ").slice(0, 300)}`);
  page.errors = [];
  return problems;
}
async function step(page, name, fn, { shot = true } = {}) {
  const problems = [];
  try {
    await fn();
  } catch (e) {
    problems.push(String(e.message ?? e).split("\n")[0]);
  }
  problems.push(...(await checks(page)));
  const vp = page.viewportSize();
  if (shot || problems.length) await page.screenshot({ path: `${OUT}/${vp.width}x${vp.height}-${name}${shot ? "" : "-failed"}.png` });
  results.push({ step: `${vp.width}x${vp.height} ${name}`, ok: problems.length === 0, problems });
  if (problems.length) failures++;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${vp.width}x${vp.height} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const noChat = async (page) => must((await page.locator(".asap-ask").count()) === 0, "a conversation transcript is open");

// ------------------------------------------------------------------ desktop
for (const viewport of [{ width: 1440, height: 900 }, { width: 1360, height: 900 }]) {
  const wide = viewport.width === 1440;
  const page = await open(AMINA, viewport);

  await step(page, "home", async () => {
    await page.getByRole("heading", { level: 1, name: "What would you like ASAP to handle?" }).waitFor();
    await noChat(page);
    for (const n of ["Home", "Work", "Automations", "Activity", "Search", "New"]) must(await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(n) }).count(), `sidebar lacks ${n}`);
    for (const q of ["Add records", "Prepare a renewal", "Start a quotation", "Report a claim", "Upload documents", "Ask about the brokerage"]) must(await page.getByRole("button", { name: q }).count(), `quick action ${q} missing`);
    must(await page.getByRole("button", { name: "Attach files" }).count(), "no attachment button");
  });

  if (!wide) {
    await step(page, "work", async () => { await page.goto(BASE + "#/work"); await settle(page); await page.getByRole("tablist", { name: "Work views" }).waitFor(); await noChat(page); });
    await step(page, "automations", async () => { await page.goto(BASE + "#/automations"); await settle(page); await page.getByRole("heading", { name: "Workflows ASAP runs" }).waitFor(); await noChat(page); });
    await step(page, "space", async () => { await page.goto(BASE + `#/s/client?clientId=${ACME}`); await settle(page, 1500); await page.locator(".asap-pane").waitFor(); await noChat(page); });
    await step(page, "split", async () => {
      const s = await apiAs(AMINA, "POST", "/sessions", { text: `Ask about Acme Motors ${RUN}`, scope: { kind: "client", id: ACME } });
      await page.goto(BASE + `#/ask/${s.body.conversation.id}?space=${encodeURIComponent(`client?clientId=${ACME}`)}`);
      await settle(page, 1500);
      await page.locator(".sh-split .asap-ask").waitFor();
      await page.locator(".sh-split .asap-pane").waitFor();
    });
    await page.context().close();
    continue;
  }

  let renewalId = "";
  await step(page, "conversation-centred", async () => {
    const box = page.getByLabel("What would you like ASAP to handle?");
    await box.fill(`Renew Acme Motors motor policy`);
    await box.press("Enter");
    await page.waitForFunction(() => /^#\/ask\/[0-9a-f-]{36}/.test(location.hash), null, { timeout: 15000 });
    await settle(page, 1800);
    renewalId = hash(page).match(UUID)[0];
    await page.getByRole("heading", { level: 2, name: "Renew Acme Motors motor policy" }).waitFor();
    // Centred while it is only a conversation; split once its answer opened a Space beside it.
    const centred = await page.locator(".sh-conv-center .asap-ask").count();
    const split = await page.locator(".sh-split .asap-ask").count();
    must(centred || split, "the conversation is neither centred nor beside the Space it opened");
    must(await page.locator(".sh-status-pill").count(), "no status on the conversation");
  });

  await step(page, "title-survives-refresh-and-renames", async () => {
    await page.getByRole("button", { name: "Rename this conversation" }).click();
    const input = page.getByLabel("Conversation name");
    await input.fill(`Acme fleet renewal ${RUN}`);
    await input.press("Enter");
    await settle(page, 900);
    await page.reload();
    await page.locator(".sh-root").waitFor();
    await settle(page, 1500);
    await page.getByRole("heading", { level: 2, name: `Acme fleet renewal ${RUN}` }).waitFor();
    must(hash(page).includes(renewalId), "refresh did not reopen the same conversation");
    const s = await apiAs(AMINA, "GET", `/sessions/${renewalId}`);
    must(s.body.conversation.titleSource === "person", "the name was not kept on the server");
  }, { shot: false });

  await step(page, "same-workflow-not-duplicated", async () => {
    await page.goto(BASE + "#/");
    await settle(page);
    const box = page.getByLabel("What would you like ASAP to handle?");
    await box.fill("prepare the Acme Motors renewal");
    await box.press("Enter");
    await page.waitForFunction(() => /^#\/ask\/[0-9a-f-]{36}/.test(location.hash), null, { timeout: 15000 });
    await settle(page, 1500);
    must(hash(page).includes(renewalId), `a second session was started instead of reopening ${renewalId}`);
  }, { shot: false });

  await step(page, "work", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^.?\s*Work$/ }).click();
    await settle(page);
    must(hash(page).startsWith("#/work"), "Work has no address");
    await page.getByRole("tablist", { name: "Work views" }).waitFor();
    for (const t of ["Needs me", "ASAP is handling", "Waiting on others", "Upcoming", "Done"]) must(await page.getByRole("tab", { name: new RegExp(t) }).count(), `Work lacks ${t}`);
    await noChat(page);
    const text = await page.locator(".sh-work").innerText().catch(() => "");
    must(!UUID.test(text), "Work shows an internal id");
  });

  await step(page, "automations", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Automations/ }).click();
    await settle(page);
    await page.getByRole("heading", { name: "Workflows ASAP runs" }).waitFor();
    await page.getByRole("heading", { name: "Standing instructions" }).waitFor();
    await noChat(page);
  });

  await step(page, "activity", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Activity/ }).click();
    await settle(page);
    await noChat(page);
    const rows = page.locator(".sh-activity-row");
    must((await rows.count()) > 0, "Activity shows no events");
    const text = await page.locator(".sh-activity").innerText();
    must(!UUID.test(text), "Activity shows a raw id");
    must(!/\bconversation\.|work_item\.step_by_run/.test(text), "Activity shows technical events");
    for (const f of ["People", "ASAP", "Workflow", "Approvals", "External communication"]) must(await page.getByRole("button", { name: f, exact: true }).count(), `Activity lacks the ${f} filter`);
    await page.getByRole("button", { name: "ASAP", exact: true }).click();
    await settle(page, 300);
    must(hash(page).includes("who=asap"), "the filter is not in the address");
  });

  await step(page, "space-full-width", async () => {
    await page.goto(BASE + `#/s/client?clientId=${ACME}`);
    await settle(page, 1800);
    await page.locator(".sh-space .asap-pane").waitFor();
    await noChat(page);
    await page.getByRole("heading", { level: 1, name: /Acme Motors/ }).waitFor();
  });

  await step(page, "pin-persists", async () => {
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await settle(page, 800);
    await page.reload();
    await page.locator(".sh-root").waitFor();
    await settle(page, 1500);
    await page.getByRole("button", { name: "Pinned — unpin" }).waitFor();
    const pins = await apiAs(AMINA, "GET", "/space-pins");
    must(pins.body.items.some((p) => p.ref?.clientId === ACME), "the pin is not on the server");
  }, { shot: false });

  let drawerSession = "";
  await step(page, "contextual-drawer", async () => {
    await page.getByRole("button", { name: /Ask about this/ }).click();
    await settle(page, 600);
    must(hash(page).includes("ask=new"), "the drawer has no address");
    const drawer = page.locator(".sh-drawer");
    await drawer.waitFor();
    must((await drawer.getAttribute("aria-label")).includes("Acme Motors"), "the drawer is not scoped to the client");
    await drawer.getByPlaceholder("Tell ASAP what you need").fill("What does Acme Motors owe?");
    await drawer.getByRole("button", { name: "Send" }).click();
    await page.waitForFunction(() => /ask=[0-9a-f-]{36}/.test(location.hash), null, { timeout: 15000 });
    await settle(page, 1500);
    drawerSession = hash(page).match(/ask=([0-9a-f-]{36})/)[1];
    const s = await apiAs(AMINA, "GET", `/sessions/${drawerSession}`);
    must(s.body.conversation.client?.id === ACME, "the conversation is not scoped to Acme Motors");
  });

  await step(page, "explicit-identifier-overrides-context", async () => {
    // From Acme's Space, a request that names Jane Wanjiku is about Jane, not the inherited client.
    const s = await apiAs(AMINA, "POST", "/sessions", { text: `Jane Wanjiku had an accident ${RUN}`, scope: { kind: "client", id: ACME } });
    must(s.body.conversation.client?.name === "Jane Wanjiku", `inherited context won: ${s.body.conversation.client?.name}`);
  }, { shot: false });

  await step(page, "split", async () => {
    await page.goto(BASE + `#/ask/${drawerSession}?space=${encodeURIComponent(`client?clientId=${ACME}`)}`);
    await settle(page, 1800);
    await page.locator(".sh-split .asap-ask").waitFor();
    await page.locator(".sh-split .asap-pane").waitFor();
    const before = await page.locator(".sh-split .asap-thread").innerText();
    must(before.includes("What does Acme Motors owe?"), "the conversation lost its turns in split view");
  });

  await step(page, "split-close-and-reopen", async () => {
    await page.getByRole("button", { name: "Close the Space and centre the conversation" }).click();
    await settle(page, 600);
    must(await page.locator(".sh-conv-center .asap-ask").count(), "closing the Space did not centre the conversation");
    must((await page.locator(".asap-thread").innerText()).includes("What does Acme Motors owe?"), "closing the Space lost the conversation");
    await page.getByRole("button", { name: /beside the conversation/ }).click();
    await settle(page, 1000);
    must(await page.locator(".sh-split").count(), "the Space did not reopen beside the conversation");
    await page.getByRole("button", { name: "Close the conversation and expand the Space" }).click();
    await settle(page, 800);
    must((await page.locator(".sh-space .asap-pane").count()) && !(await page.locator(".asap-ask").count()), "closing chat did not expand the Space");
    await page.goBack();
    await settle(page, 1000);
    must(await page.locator(".sh-split").count(), "Back did not restore the split");
    await page.goForward();
    await settle(page, 1000);
    must((await page.locator(".asap-ask").count()) === 0, "Forward did not return to the full Space");
    const s = await apiAs(AMINA, "GET", `/sessions/${drawerSession}`);
    must(s.body.conversation.id === drawerSession, "closing the Space deleted the conversation");
  }, { shot: false });

  await step(page, "recent-distinguishes-and-reopens", async () => {
    await page.goto(BASE + "#/");
    await settle(page, 1200);
    const side = page.locator(".sh-recent");
    const kinds = await side.locator(".sh-kind").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    must(kinds.includes("conversation") && kinds.includes("client"), `Recent does not distinguish kinds: ${kinds.join(",")}`);
    await side.getByRole("button", { name: new RegExp(`Acme fleet renewal ${RUN}`) }).click();
    await settle(page, 1200);
    must(hash(page).includes(renewalId), "Recent opened the wrong context");
  });

  await step(page, "search", async () => {
    await page.keyboard.press("Control+k");
    const box = page.getByLabel("Search", { exact: true });
    await box.waitFor();
    await box.fill(`fleet renewal ${RUN}`);
    await settle(page, 900);
    await page.locator(".sh-result", { hasText: `Acme fleet renewal ${RUN}` }).waitFor();
    await box.fill("Acme Motors");
    await settle(page, 900);
    must(await page.locator(".sh-results-label", { hasText: "Records" }).count(), "Search found no records");
    await page.keyboard.press("Escape");
  });

  await step(page, "new-sheet-creates-nothing", async () => {
    const before = await apiAs(AMINA, "GET", "/sessions");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /New/ }).click();
    await page.getByRole("dialog", { name: "Start something new" }).waitFor();
    for (const o of ["Start with Ask ASAP", "Upload documents", "Import spreadsheet", "Add client", "Prepare renewal", "Start quotation", "Report claim", "Create automation"]) must(await page.getByRole("button", { name: new RegExp(o) }).count(), `+ New lacks ${o}`);
    await page.getByRole("button", { name: /Report claim/ }).click();
    await settle(page, 1000);
    must(hash(page).startsWith("#/s/claim"), "Report claim did not open the claim workflow");
    const after = await apiAs(AMINA, "GET", "/sessions");
    must(after.body.conversations.length === before.body.conversations.length, "choosing an option created something");
  });

  await step(page, "sidebar-collapses-keeping-location", async () => {
    const at = hash(page);
    await page.getByRole("button", { name: "Collapse menu to icons" }).click();
    await settle(page, 300);
    must(hash(page) === at, "collapsing moved the location");
    await page.getByRole("button", { name: "Expand menu" }).click();
  });

  await step(page, "no-mutation-left-pending", async () => {
    await settle(page, 1500);
    const running = await page.locator(".asap-pending").filter({ hasText: /Saving to your brokerage/ }).count();
    must(running === 0, "a mutation is still pending");
  }, { shot: false });

  // Tenant isolation: another brokerage at the same address sees nothing of it.
  const beta = await open(BETA, viewport, `#/s/client?clientId=${ACME}`);
  await step(beta, "tenant-never-leaks", async () => {
    await settle(beta, 1500);
    const text = await beta.locator(".sh-main").innerText();
    must(!/Acme Motors/.test(text), "another brokerage's client is visible");
    const r = await apiAs(BETA, "GET", "/recent");
    must(!r.body.items.some((i) => JSON.stringify(i).includes(ACME)), "Recent leaked across brokerages");
    must((await apiAs(BETA, "GET", `/sessions/${renewalId}`)).status === 404, "a conversation crossed brokerages");
  });
  await beta.context().close();

  // Permissions: a read-only member cannot pause an automation or create a client, whatever the UI shows.
  await step(page, "permissions-enforced", async () => {
    const r = await apiAs(READER, "POST", "/clients", { name: `Should not exist ${RUN}`, kind: "corporate", confirmNew: true });
    must(r.status === 403, `a read-only member created a client (${r.status})`);
  }, { shot: false });
  await page.context().close();
}

// ------------------------------------------------------------------ mobile
{
  const viewport = { width: 390, height: 844 };
  const page = await open(AMINA, viewport);
  await step(page, "mobile-home", async () => {
    await page.getByRole("heading", { level: 1, name: "What would you like ASAP to handle?" }).waitFor();
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const n of ["Home", "Work", "Ask", "Automations", "More"]) must(await nav.getByRole("button", { name: new RegExp(n) }).count(), `bottom nav lacks ${n}`);
    must(await page.getByRole("button", { name: "Attach files" }).isVisible(), "the attachment button is hidden");
  });
  await step(page, "mobile-nav-has-no-dead-ends", async () => {
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: /Work/ }).click(); await settle(page, 500); must(hash(page).startsWith("#/work"), "Work is dead");
    await nav.getByRole("button", { name: /Automations/ }).click(); await settle(page, 500); must(hash(page).startsWith("#/automations"), "Automations is dead");
    await nav.getByRole("button", { name: /More/ }).click(); await page.getByRole("dialog", { name: "More" }).waitFor();
    await page.getByRole("button", { name: "◷ Activity" }).click(); await settle(page, 500); must(hash(page).startsWith("#/activity"), "Activity via More is dead");
    await nav.getByRole("button", { name: /Home/ }).click(); await settle(page, 500); must(hash(page) === "#/", "Home is dead");
  }, { shot: false });
  await step(page, "mobile-conversation", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Ask/ }).click();
    await settle(page, 600);
    const box = page.getByPlaceholder("Tell ASAP what you need");
    await box.waitFor();
    await box.focus();
    await box.fill(`What does Acme Motors owe? ${RUN} — a deliberately long question to check that long titles never push the header off the screen`);
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForFunction(() => /^#\/ask\/[0-9a-f-]{36}/.test(location.hash), null, { timeout: 15000 });
    await settle(page, 1500);
    must((await page.locator(".sh-split").count()) === 0, "a desktop split on mobile");
  });
  await step(page, "mobile-space", async () => {
    const id = hash(page).match(UUID)[0];
    await page.goto(BASE + `#/ask/${id}?space=${encodeURIComponent(`client?clientId=${ACME}`)}`);
    await settle(page, 1500);
    must((await page.locator(".sh-split").count()) === 0, "a desktop split on mobile");
    await page.getByRole("button", { name: /Open Space/ }).click();
    await settle(page, 1500);
    await page.locator(".asap-pane").waitFor();
    must((await page.locator(".asap-ask").count()) === 0, "the Space is not full screen");
    await page.getByRole("button", { name: "← Back to conversation" }).click();
    await settle(page, 1200);
    must(await page.locator(".asap-ask").count(), "Back to conversation did not return");
    must((await page.locator(".asap-thread").innerText()).includes("What does Acme Motors owe?"), "the conversation lost its turns");
    await page.getByRole("button", { name: /Open Space/ }).click();
    await settle(page, 1200);
  });
  await step(page, "mobile-back-to-conversation", async () => {
    await page.getByRole("button", { name: /Ask about this/ }).click();
    await settle(page, 1200);
    await page.getByRole("button", { name: /Back to/ }).waitFor();
    must(await page.locator(".asap-ask").count(), "Ask about this did not open the conversation full screen");
    await page.getByRole("button", { name: /Back to/ }).click();
    await settle(page, 800);
    must((await page.locator(".asap-ask").count()) === 0, "Back to the Space did not return");
    await page.goBack(); await settle(page, 800);
    must(await page.locator(".asap-ask").count(), "browser Back did not return to the conversation");
  }, { shot: false });
  await page.context().close();
}

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.stdout.write(`\n${results.length - failures}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
