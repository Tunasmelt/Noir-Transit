/* Smoke test: serves the static export, boots the game in headless Chromium and
   drives the puzzle chain through the engine's own functions.
   Usage: npm run build && npm run test:smoke
   Set PW_CHROMIUM to use an already-installed Chromium binary. */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "out");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(data);
  });
});

const failures = [];
const check = (name, ok, detail = "") => { console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  → " + detail)); if (!ok) failures.push(name); };

(async () => {
  if (!fs.existsSync(path.join(ROOT, "index.html"))) { console.error("out/ not found — run `npm run build` first"); process.exit(2); }
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const ev = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms);
  const use = async label => { const r = await ev(l => { const e = interactables.find(e => e.prompt.startsWith(l) && e.zone === curZone && e.enabled); if (!e) return false; usedMesh = e.mesh; e.fn(); return true; }, label); await wait(250); return r; };

  console.log("boot");
  await page.goto(url); await wait(1500);
  check("debug menu hidden without ?debug", await ev(() => getComputedStyle(document.getElementById("dbgToggle")).display === "none"));
  await page.click("#ldPlay1"); await wait(500); await page.click("#startBtn"); await wait(2000);
  check("game running in arrival", await ev(() => running && curZone === "arrival"));

  console.log("zones");
  for (const z of ["arrival", "street", "dream1", "floor8", "lobbyG", "alley", "restock", "dream2", "floor21", "terrace", "metro"]) {
    const before = errors.length;
    await ev(z => { setZone(z); const B = ZONES[z].bounds; player.seated = false; player.x = (B[0] + B[1]) / 2; player.z = (B[2] + B[3]) / 2; torchOn = true; }, z);
    await wait(400);
    check("ticks: " + z, errors.length === before, errors.slice(before).join(" | "));
  }
  await ev(() => { torchOn = false; });

  console.log("pause");
  await ev(() => { window.__fired = false; later(() => { window.__fired = true; }, 200); openPause(false); });
  await wait(700); check("pause holds scripted timers", !(await ev(() => window.__fired)));
  await ev(() => closePause()); await wait(500); check("timers replay on resume", await ev(() => window.__fired));

  console.log("terrace puzzle");
  await ev(() => { setZone("terrace"); player.x = 710; player.z = 5; GS.photoTaken = true; });
  const sub = () => ev(() => document.getElementById("subtitle").textContent);
  await ev(() => turnValve(valves.find(v => v.userData.idx === 3)));
  check("first valve mistake does not give the answer", !/two drops, then one, then three/i.test(await sub()));
  for (let i = 0; i < 3; i++) await ev(() => turnValve(valves.find(v => v.userData.idx === 3)));
  check("fourth valve mistake gives the answer", /two drops, then one, then three/i.test(await sub()));
  for (const n of [2, 1, 3]) await ev(n => turnValve(valves.find(v => v.userData.idx === n)), n);
  check("tank fills on 2-1-3", await ev(() => GS.tankFilled));
  await ev(() => strikeNode(nodes.find(v => v.userData.idx === 4)));
  check("first chime mistake does not give the answer", !/meter first/i.test(await sub()));
  for (const n of [2, 1, 3, 4]) await ev(n => strikeNode(nodes.find(v => v.userData.idx === n)), n);
  await wait(5600);
  check("music box drops piece 3", await use("Take Puzzle Piece #3") && await ev(() => GS.ledgeOn && inv.has("piece3")));

  console.log("ending B route");
  await ev(() => { ["piece1", "piece2"].forEach(x => give(x, "🧩", x)); give("photo", "🖼", "THE PHOTO"); startEndingB(); });
  await use("Back inside"); await wait(1200);
  check("terrace door returns to floor 8", await ev(() => curZone === "floor8"));
  await use("A frame, face-down"); await wait(3000);
  check("four pieces assemble the safe key", await ev(() => GS.safeKey && inv.has("key_safe")));
  await use("Eileen's safe"); await wait(7600); await ev(() => { if (uiOpen === "note") closeNote(); });
  check("safe opens the metro", await ev(() => GS.metroOpen));
  await use("Call the elevator"); await wait(1200);
  check("lift lets out onto the street", await ev(() => curZone === "street"));

  console.log("save / load");
  await ev(() => autosaveCheckpoint()); await wait(400);
  await ev(() => openPause(false)); await wait(300);
  await page.click('#pauseOverlay [data-act="load"][data-slot="auto"]'); await wait(2500);
  check("in-game load reloads to RESUME", await ev(() => document.getElementById("startBtn").textContent === "RESUME"));
  await page.click("#startBtn"); await wait(1500);
  check("resume restores zone and progress", await ev(() => running && curZone === "street" && GS.metroOpen && inv.has("key_safe")));

  check("no page or console errors", errors.length === 0, errors.join(" | "));
  await browser.close(); server.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
