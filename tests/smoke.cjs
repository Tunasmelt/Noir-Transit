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
let dump = async () => "";
const check = (name, ok, detail = "") => { console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  → " + detail)); if (!ok) { failures.push(name); dump().then(d => d && console.log("       state: " + d)).catch(() => {}); } };

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
  dump = () => page.evaluate(() => JSON.stringify({ zone: curZone, x: +player.x.toFixed(2), z: +player.z.toFixed(2), seated: player.seated, running, ui: uiOpen, travelLock, ride: ride.active, cine: cine.active, paused: gamePaused, timers: gameTimers.size, sub: document.getElementById("subtitle").textContent.slice(0, 60) }));
  const use = async label => { const r = await ev(l => { const e = interactables.find(e => e.prompt.startsWith(l) && e.zone === curZone && e.enabled); if (!e) return false; usedMesh = e.mesh; e.fn(); return true; }, label); await wait(250); return r; };

  console.log("boot");
  await page.goto(url); await wait(1500);
  check("debug menu hidden without ?debug", await ev(() => getComputedStyle(document.getElementById("dbgToggle")).display === "none"));
  await page.click("#ldPlay1"); await wait(500); await page.click("#startBtn"); await wait(2000);
  check("game running in arrival", await ev(() => running && curZone === "arrival"));

  console.log("first half, played in order");
  const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(f)) return true; await wait(250); } return false; };
  check("opening: seated on a moving train, doors shut", await ev(() => ride.active && player.seated && arrTrain.position.x < 880 && arrDoors[1].userData.dl.position.x > -.3));
  check("ride ends stopped at the platform, on foot in the open doorway", await until(() => !ride.active && !player.seated && arrTrain.position.x === 911 && arrDoors[1].userData.dl.position.x < -.8 && player.z > 6.3, 180000));
  check("standing eye height clears the door head", await ev(() => { arrTrain.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(arrDoors[1]); return TRAIN_FLOOR + CFG.eye < b.max.y - .2 && TRAIN_FLOOR < .2; }));
  await ev(() => { keys.KeyW = true; });
  check("he can walk off the train onto the platform", await until(() => player.z < 5 && player.floorY < .02, 30000)); await ev(() => { keys.KeyW = false; });
  await ev(() => { player.z = 5.2; }); await wait(400);
  check("arrival → street", await use("Up to the street") && await until(() => curZone === "street" && !travelLock, 30000));
  await use("Home");
  check("front door → dream 1, on foot", await until(() => curZone === "dream1" && !player.seated, 30000));
  check("dream 1 ends in the chair in 8001 (under 45s)", await until(() => curZone === "floor8" && player.seated, 45000));
  await wait(1800); await ev(() => { keys.KeyE = true; });
  check("standing starts the phone", await until(() => !player.seated && ringing, 15000));
  await use("Answer the telephone");
  check("answering unlocks the flat", await ev(() => phoneAnswered) && await use("Front door") && await ev(() => door8001Open));
  await use("Knock on 8007"); check("8007 opens on a knock", await until(() => door8007Open, 30000));
  await use("Eileen's landline"); await ev(() => { dialed = "111111111"; }); await page.click("#dialCall"); await wait(200);
  check("wrong number is refused", await ev(() => !puzzleSolved && uiOpen === "dial"));
  await ev(() => { dialed = CFG.code; }); await page.click("#dialCall"); await until(() => ixPiece.enabled && ixKey.enabled, 20000);
  check("right number drops the piece and key", await use("Take Puzzle Piece #1") && await use("Take the Old Restock key") && await ev(() => GS.elevG && inv.has("key_restock")));
  const lift = async label => { await use("Call the elevator") || await use("Elevator"); await wait(200);
    await ev(l => [...document.querySelectorAll("#elevBtns button")].find(b => b.textContent.startsWith(l)).click(), label); };
  await lift("G"); check("lift → lobby", await until(() => curZone === "lobbyG" && !travelLock, 30000));
  await use("Back door"); check("back door → alley", await until(() => curZone === "alley" && !travelLock, 30000));
  await use("The Old Restock Door"); check("restock key opens the restock room", await until(() => curZone === "restock" && !travelLock, 30000));
  await use("The generator"); check("generator starts the chase", await until(() => GS.chase && curZone === "dream2", 30000));
  check("she starts ahead of him and facing away", await ev(() => figure.visible && figure.position.z < player.z - 8));
  await ev(() => { keys.KeyW = true; }); await until(() => player.z < 40, 60000);
  check("she keeps ahead while he follows", await ev(() => figure.position.z < player.z - 6));
  await ev(() => { keys.KeyW = false; player.z = 4; });
  check("catching her ends in the box room", await until(() => GS.boxPhase && curZone === "restock" && !GS.chase, 30000));
  await wait(800); await use("Back to the alley"); await wait(300);
  check("box room holds him until the boxes are searched", await ev(() => curZone === "restock"));
  await ev(() => { crates.filter(c => c.userData.reward).forEach(c => openCrate(c)); if (uiOpen === "note") closeNote(); });
  check("marked boxes give the terrace key and piece 2", await ev(() => inv.has("key_terrace") && inv.has("piece2") && GS.elev21));
  await use("Back to the alley"); await until(() => curZone === "alley" && !travelLock, 30000);
  await use("Back into the building"); await until(() => curZone === "lobbyG" && !travelLock, 30000);
  await lift("21"); check("lift → 21st floor", await until(() => curZone === "floor21" && !travelLock, 30000));
  await use("The terrace door"); await wait(300); check("terrace door insists on the photograph", await ev(() => curZone === "floor21"));
  await use("A photograph"); await use("The terrace door");
  check("terrace key opens the roof", await until(() => curZone === "terrace" && !travelLock, 30000));

  console.log("ending A");
  for (const n of [2, 1, 3]) await ev(n => turnValve(valves.find(v => v.userData.idx === n)), n);
  for (const n of [2, 1, 3, 4]) await ev(n => strikeNode(nodes.find(v => v.userData.idx === n)), n);
  await until(() => piece3Mesh.userData.ix3.enabled, 40000); await use("Take Puzzle Piece #3");
  check("taking piece 3 turns the camera to the lit ledge", await ev(() => cine.active && GS.ledgeOn && ledgeLamp.l.intensity > 1));
  check("control returns after the reveal", await until(() => !cine.active && !player.seated, 120000));
  check("ledge offers the choice", await use("The ledge") && await ev(() => uiOpen === "choice"));
  await page.click("#choiceA"); await wait(300);
  check("sitting is a cutscene, then a second choice", await ev(() => cine.active) && await until(() => !cine.active && uiOpen === "choice", 180000));
  check("he is seated on the ledge, looking out", await ev(() => player.seated && player.z > 13.9));
  await page.click("#choiceA");
  check("ending A reaches THE DROP", await until(() => document.getElementById("endScreen").style.display === "flex" && document.getElementById("endTitle").textContent === "THE DROP", 300000));
  check("no errors in the first-half playthrough", errors.length === 0, errors.join(" | "));

  console.log("second half, fresh session");
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase("noirTransitSaves"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.goto(url); await wait(1500);
  await page.click("#ldPlay1"); await wait(500); await page.click("#startBtn"); await wait(2500);
  await ev(() => { keys.KeyE = true; }); await wait(400);
  check("E skips the ride", await ev(() => !ride.active && !player.seated && curZone === "arrival"));

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
  await ev(() => closePause());
  check("timers replay on resume", await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 5000) { if (await ev(() => window.__fired)) return true; await wait(100); } return false; })());

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
  await until(() => piece3Mesh.userData.ix3.enabled, 40000);
  check("music box drops piece 3", await use("Take Puzzle Piece #3") && await ev(() => GS.ledgeOn && inv.has("piece3")));
  await ev(() => { cine.t = 99; }); await until(() => !cine.active && !player.seated, 10000);

  console.log("ending B route");
  await ev(() => { ["piece1", "piece2"].forEach(x => give(x, "🧩", x)); give("photo", "🖼", "THE PHOTO"); startEndingB(); });
  await use("Back inside");
  check("terrace door returns to floor 8", await until(() => curZone === "floor8" && !travelLock, 20000));
  await use("A frame, face-down");
  check("four pieces assemble the safe key", await until(() => GS.safeKey && inv.has("key_safe"), 20000));
  await use("Eileen's safe");
  check("safe opens the metro", await until(() => GS.metroOpen, 40000)); await ev(() => { if (uiOpen === "note") closeNote(); });
  await use("Call the elevator");
  check("lift lets out onto the street", await until(() => curZone === "street" && !travelLock, 20000));

  console.log("save / load");
  await ev(() => autosaveCheckpoint()); await wait(400);
  await ev(() => openPause(false)); await wait(300);
  await page.click('#pauseOverlay [data-act="load"][data-slot="auto"]'); await wait(2500);
  check("in-game load reloads to RESUME", await ev(() => document.getElementById("startBtn").textContent === "RESUME"));
  await page.click("#startBtn"); await wait(1500);
  check("resume restores zone and progress", await ev(() => running && curZone === "street" && GS.metroOpen && inv.has("key_safe")));

  console.log("saves taken mid-beat");
  // three states that used to soft-lock: lever thrown but no chase, safe open but no metro, she boarded but no doors
  await ev(() => { setZone("metro"); player.x = 812; player.z = 3; GS.generatorOn = true; GS.boxPhase = false; GS.chase = false;
    GS.safeOpen = true; GS.metroOpen = false; figureBoarded = true; return doSave(1); });
  await wait(600); await ev(() => { doLoad(1); }); await wait(2500);
  await page.click("#startBtn"); await wait(1500);
  check("generator lever is put back", await ev(() => GS.generatorOn === false));
  check("opened safe unlocks the metro", await ev(() => GS.metroOpen === true && collected.has("n_letter")));
  check("boarded train is at the platform with its doors offered", await ev(() => figureBoarded && trainGrp.position.x === 814 && boardDoor.visible && boardDoor.userData.ix.enabled));
  await use("Board the train"); await use("Take a seat");
  check("ending B is a ride: seated, train pulling out", await ev(() => cine.active && player.seated) && await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 120000) { if (await ev(() => trainGrp.position.x < 800)) return true; await wait(300); } return false; })());
  check("ending B reaches TRANSIT", await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 300000) { if (await ev(() => document.getElementById("endTitle").textContent === "TRANSIT" && document.getElementById("endScreen").style.display === "flex")) return true; await wait(250); } return false; })());

  check("no page or console errors", errors.length === 0, errors.join(" | "));
  await browser.close(); server.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
