// Headless Chrome with local build + intercepted fixture APIs. No real account,
// backend, payment, S3 or notification delivery is used by this browser check.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(frontend, "dist"), results = path.join(tmpdir(), "getfit4u-ui-verification");
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "gfu-ui-"));
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = path.resolve(build, "." + name);
  if (!file.startsWith(build + path.sep) && file !== build) { res.writeHead(403).end(); return; }
  try { if (!path.extname(file)) file = path.join(build, "index.html"); const data = await readFile(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => { server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const served = await fetch(origin);
assert.equal(served.headers.get("content-type"), "text/html");
assert((await served.text()).includes('<div id="root"></div>'));
const chrome = spawn(process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "about:blank"], { windowsHide: true, stdio: "ignore" });
const delay = ms => new Promise(resolve => { setTimeout(resolve, ms); });
let socket;
try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await delay(100); } }
  assert(port, "Chrome did not start");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => { socket.addEventListener("open", resolve, { once: true }); });
  let sequence = 0, role = "USER", authenticated = false;
  const pending = new Map(), errors = [], report = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const user = () => ({ _id: "111111111111111111111111", publicId: "fixture-user", name: "An exceptionally long member name for layout verification", roles: [role], activeRole: role, email: "fixture@verification.invalid", avatarUrl: `${origin}/assets/gym-community-hero.webp`, onboarding: { state: "ACTIVE" } });
  socket.addEventListener("message", async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const handler = pending.get(message.id); pending.delete(message.id); if (message.error) handler?.reject(new Error(message.error.message)); else handler?.resolve(message.result); return; }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text + ": " + (message.params.exceptionDetails.exception?.description || ""));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error" && message.params.entry.source === "javascript") errors.push(message.params.entry.text);
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params, url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        let data = [], meta = { total: 0, pages: 1, page: 1, limit: 8 };
        if (url.pathname === "/api/v1/public/gyms") { data = Array.from({ length: 10 }, (_, i) => ({ _id: `gym-${i}`, publicId: `gym-${i}`, name: `Fixture Gym ${i}`, slug: `gym-${i}`, address: { city: "Fixture city" } })); meta = { total: 40, pages: 5, page: 1, limit: 8 }; }
        else if (url.pathname.endsWith("/auth/refresh")) data = { accessToken: `e30.${Buffer.from(JSON.stringify({ sub: user()._id, sid: "fixture", exp: 9999999999 })).toString("base64url")}.fixture` };
        else if (url.pathname.endsWith("/auth/me")) data = { user: user(), context: { userId: user()._id, role, gymId: "222222222222222222222222", permissions: ["admin:platform", "gym:read", "campaign:write"], sessionId: "fixture" }, assignments: [] };
        else if (url.pathname === "/api/v1/users/me") data = user();
        else if (url.pathname === "/api/v1/social/profiles/me") data = { ...user(), own: true, canView: true, counts: { followers: 0, following: 0, posts: 0 }, social: { visibility: "PUBLIC", bio: "Profile fixture for responsive typography and photo viewer verification." } };
        else if (url.pathname.includes("unread")) data = { unread: 0, count: 0 };
        else if (url.pathname.includes("platform-plans")) data = [{ _id: "333333333333333333333333", name: "Configured fixture plan", priceMinor: 10000, billingPeriod: "MONTHLY", active: true }];
        const anonymous = !authenticated && url.pathname.endsWith("/auth/refresh");
        await send("Fetch.fulfillRequest", { requestId, responseCode: anonymous ? 401 : 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(anonymous ? { success: false, error: { code: "SESSION_EXPIRED", message: "Anonymous fixture" } } : { success: true, data, meta })).toString("base64") });
      } else if (url.origin === origin || url.protocol === "data:") await send("Fetch.continueRequest", { requestId });
      else await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    } catch (error) { errors.push(error.message); }
  });
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  const evaluate = async expression => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  async function waitFor(expression) { for (let n = 0; n < 150; n++) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`UI did not reach ${expression}; ${await evaluate("document.body.innerText.slice(0,600)")}; ${JSON.stringify(errors)}`); }
  async function go(route, selector) { const navigation = await send("Page.navigate", { url: origin + route }); assert(!navigation.errorText, navigation.errorText + JSON.stringify(errors)); await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); }
  async function layout(label, width, textSize) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.style.fontSize = '${textSize}%'`); await delay(100);
    const metrics = await evaluate(`(() => { const root=document.documentElement, a=document.querySelector('.avatar-profile'); return { viewport: innerWidth, scroll: root.scrollWidth, bodyFont: getComputedStyle(document.body).fontFamily, rootSize: getComputedStyle(root).fontSize, avatarWidth: a?.getBoundingClientRect().width, overflow: [...document.querySelectorAll('main *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && r.right > innerWidth + 2 && getComputedStyle(e).position !== 'fixed'; }).slice(0,5).map(e => e.className) }; })()`);
    assert(metrics.bodyFont.includes("system-ui")); assert(metrics.scroll <= width + 2, `${label}: horizontal overflow ${JSON.stringify(metrics)}`);
    report.push({ label, ...metrics });
  }
  await go("/", ".gym-card");
  assert.equal(await evaluate("document.querySelectorAll('.landing-section .gym-card').length"), 8);
  assert.equal(await evaluate("document.querySelector('.landing-section-heading a').getAttribute('href')"), "/explore");
  for (const [width, font] of [[1440, 100], [720, 100], [390, 100], [390, 200], [320, 200]]) await layout("Landing", width, font);
  authenticated = true;
  for (const current of ["USER", "GYM_OWNER", "TRAINER", "ADMIN"]) {
    role = current;
    const prefix = { USER: "app", GYM_OWNER: "owner", TRAINER: "trainer", ADMIN: "admin" }[role];
    await go(`/${prefix}/profile`, ".avatar-profile");
    for (const [width, font] of [[1440, 100], [390, 100], [390, 200]]) {
      await layout(`${role} profile`, width, font);
      const expected = width === 1440 ? 128 : font === 200 ? 192 : 96;
      assert.equal(report.at(-1).avatarWidth, expected, JSON.stringify(report.at(-1)) + await evaluate("document.querySelector('.avatar-profile').outerHTML"));
    }
    await evaluate("document.querySelector('.avatar-profile').click()"); await waitFor("Boolean(document.querySelector('.profile-photo-viewer img')?.complete)");
    assert.equal(await evaluate("document.body.style.overflow"), "hidden");
    await evaluate("document.querySelector('.profile-photo-viewer img').click()");
    assert.equal(await evaluate("document.querySelector('.profile-photo-viewer')"), null);
  }
  await go("/admin/platform-offers", ".promotion-filters");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Create offer').click()"); await waitFor("Boolean(document.querySelector('.promotion-form input[name=name]'))");
  await layout("Admin platform offer form", 390, 200);
  const screenshot = await send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(results, "admin-offer-200-percent.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate("document.documentElement.setAttribute('data-theme','light')");
  await layout("Light theme offer form", 390, 200);
  assert.deepEqual(errors, []);
  await writeFile(path.join(results, "results.json"), JSON.stringify({ kind: "Headless Chrome with intercepted APIs; 200% text and viewport reflow emulation, not physical-device testing", report }, null, 2));
  console.log(`PASS ${report.length} responsive checks, eight-card bound, public link, four role avatars/viewers, system fonts and offer form. Artifacts: ${results}`);
  await send("Browser.close").catch(() => undefined);
} finally {
  socket?.close(); chrome.kill(); server.close();
  // Only remove this run's newly-created temporary Chrome profile.
  const resolved = path.resolve(profile), base = path.resolve(tmpdir()) + path.sep;
  assert(resolved.startsWith(base) && path.basename(resolved).startsWith("gfu-ui-"));
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined);
}
