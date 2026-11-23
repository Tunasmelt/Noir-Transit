# Noir: Transit — QA walkthrough (first pass)

Build tested: `claude/dazzling-lovelace-cb4xjv` @ PR #6 (bench, metro, subway entrance).
Tested by: scripted-camera tour of every zone at eye height, plus a read of the engine code for each story beat.

## Coverage and limits (read this first)
- I **did not play the game start to finish by hand**. I teleported the camera to ~100 spots across all 11 zones and looked at the frames, then checked each beat of your story against the code.
- **Not exercised in this pass:** the generator chase, the 24-box search itself, the pipe and music-box puzzles, ledge choice, ending sequences, audio, and the mossy-brick state of the restock room (I only saw its pre-chase state).
- Findings marked **seen** come from screenshots. **code** means I only read the code.

---

## 1. Story parity

| Beat in your story | Status |
|---|---|
| Voice on the phone after the dream, "find the note" | present (code) |
| Thomas lives in 8001; knock on each door; 8004 slides open with the note | present (seen corridor + doors 8002–8006, code for the note) |
| 8007 phone puzzle, code 976-345-615, fridge note "10-34-56 w", pages 10/34/56 | present (code: `code:"976345615"`, pages p10/p34/p56) |
| 8007 note about the search, detective, police, giving up | present (code: `n_grief`) |
| Alley → old restock door → generator → blackout → chase → void door | present (code); **not run** |
| 24 boxes, 6 tries, 3 wall icons, key + piece 2 + hidden note | present (code: 24 crates, `boxTries>=6`, 3 marked crates) |
| Alley again with crescent moon, sirens, horns | present (code: moon sprite, `sirenStart`) |
| 21st floor tenants (couple arguing, baby crying) | arguing voices and a TV are present; **I did not confirm a baby cry** |
| Photo of the couple on the terrace door | present (**seen**, now uses the generated polaroid) |
| Terrace: 3 pipes, 4 chime nodes, hidden note, piece 3 | present (code: `PIPE_ORDER` of 3, 4 nodes) |
| Ledge: jump (ending A) or go back, return the photo to the frame, piece 4 | present (code) |
| 4 pieces make the safe key; Eileen's letter; figure waits on the platform; train | present (code); figure **seen** on the metro platform |
| **Journal: 8 notes (5 across levels + 3 hidden)** | **MISMATCH: the game has 11 entries** (`JOURNAL_ORDER` has 6, then 5 more are pushed on). Either the design or the game needs to change. |

---

## 2. Visual issues (things I saw)

**P1: breaks the look**
1. **8007 wallpaper.** The blue walls are covered in dark vertical slits. It is the generated "old wallpaper" peeling image tinted blue, and at room scale it reads as glitch noise, not wallpaper. 8007 is the emotional centre of the game, and its walls are the worst-looking surface in it. Fix: a dingy blue-grey wallpaper without the peel slits.
2. **Coast poster has two dark horizontal lines across it** in the arrival station (something clips through it). Seen at close range; not yet traced.

**P2: noticeable**
3. **Subway entrance is very green and the steps are hard to read** from the street. The shaft works, but the treads vanish into the dark. A brighter tread edge or a white nosing line would fix it.
4. **Station light is murky.** The arrival platform and metro walls are readable, but the arrival platform ceiling and walls are close in value, so the room feels like one grey-brown mass. A lighter ceiling or a darker floor would separate them.
5. **Dream 1 view faces a saturated cyan window wall** from the spawn side. It may be intentional for the dream, but it is the brightest, flattest colour in the game and clashes with the amber/teal grade everywhere else. Worth a second look.
6. **Chain across the subway stair head** is chunky up close (links read as pipes).

**P3: polish**
7. Platform columns have a blue band at 1.3 m that reads as a stripe of paint, not a tile band.
8. Corridor fire-hose cabinet reads as a red frame with a ring inside (see model parity below).

---

## 3. Model parity with real counterparts

Reviewed from the frames I took (not a full prop-by-prop audit):

| Prop | Verdict |
|---|---|
| Platform bench | **Fixed** this session. Backrest had been leaning forward over the seat. Now slatted seat, back-leaning backrest, armrests, skid feet, like a real cast-iron bench. |
| Subway entrance | **Rebuilt**. Sunken stair, parapet, rails, gantry sign, globe lamps. |
| Arrival train | Better (flat silver, lit interior). Still has no wheels or bogies visible from the platform, no coupler, no roof equipment. It reads as a long box. |
| Fire-hose cabinet (8th floor corridor) | Too abstract: a red frame with a torus. Real ones have a glass front, a HOSE label, a nozzle and a handle. |
| Lobby (columns, mailboxes, desk, lift) | Good, the best-looking room. Lift doors, desk and bench all read correctly. |
| Corridor doors, sconces, radiator, runner | Good. Door numbers, handles and panels read correctly. |
| 8007 furniture (phone table, bookcases, fridge) | Silhouettes read, but the room is too dark and flat to judge detail; the wallpaper (issue 1) dominates. |
| Alley (dumpsters, fire escape, pipe, vent steam) | Good. Props read. |
| Terrace (pergola, chairs, water tank, wall, skyline) | Good, one of the strongest scenes. |
| Metro platform (tile walls, columns, track, clock, vending machine) | Good after this session's tile and notice fixes. |

---

## 4. Suggested next fixes, in order
1. Decide 8 vs 11 journal notes, then align the game or the design.
2. Retexture 8007 walls (and check 8001's stripes against it for contrast).
3. Trace and fix the lines across the coast poster.
4. Brighten the subway steps; dim the green wash a little.
5. Add wheels/bogies and roof gear to the arrival train; add glass + label to the fire-hose cabinet.
6. Run a real end-to-end playthrough (chase, 24 boxes, pipes, nodes, ledge both ways) and file gameplay bugs separately from visual ones.

---

## 5. Fix pass (each claim re-checked in a run first)

| Finding | Re-check | Result |
|---|---|---|
| Journal has 11 entries, spills off the panel | confirmed in the journal UI | Now 8 (5 story + 3 hidden: the fridge note, the box note and the music-box note). Her three notebook pages stay readable in a separate "HER NOTEBOOK · CLUES" group. End screen counts the 8. |
| 8007 wallpaper full of dark slits | confirmed | Root cause was different from my first guess: `surf()` clones each texture, and clones uploaded before the generated image loaded kept the old procedural pixels. Every texture-painted surface in the zone visible at boot (floor 8) was showing the stale version. `paintArt` now flags every clone. The generated old wallpaper was then too dark, so it is lifted to a dingy blue-grey. 8001 now shows the gold floral paper. |
| Lines across the coast poster | reproduced | z-fighting: the poster sat exactly on the wall face (z = 1.28). Moved to 1.30. Gone. |
| Subway steps hard to read, chunky chain, strong green wash | confirmed | Pale nosing on every tread (my first attempt put it on the wrong edge, so only one showed; fixed), thinner chain links, green light reduced. |
| Station reads as one brown mass | confirmed | Platform floor darker and cooler; seats in the train muted. |
| Dream 1 saturated cyan | confirmed (three glowing panes at the end of the corridor) | Light and emissive toned to a muted teal. |
| Fire-hose cabinet is a red frame with a ring | confirmed | Rebuilt: recessed steel cabinet, coiled hose reel, brass nozzle, handle, glass door, FIRE HOSE label. |
| Train looks like a long box | confirmed | Bogie fairings and wheels added along the underframe. They are only a dark band from the platform because the car sits flush; a pit and visible rails would be a larger change. |
| No baby cry on floor 21 | **claim was weak** | The tenant audio has argument bursts and a falling sine cry; I had not found it on first read. Not a gap. |
| Platform column blue band | not changed | Cosmetic; left as is. |

Still not exercised: the chase, the 24-box search, pipes, nodes, ledge choice, the endings, audio, and the mossy-brick state of the restock room.

---

## 6. Full visual walkthrough (the "not exercised" list, now exercised)

Method: a scripted playthrough through the game's own interactions (ride, street, dream 1, wake, phone, 8004 note, 8007, dial, lift, alley, generator, chase, 24 boxes, alley again, 21st floor, terrace puzzles, ledge, ending A; then a fresh session through the safe, subway, metro platform, boarding and ending B), with a screenshot and the on-screen subtitle/objective at each beat. 74 + 11 frames reviewed. No console or page errors in either run.

**Confirmed working and looking right:** opening ride and platform; street and Haldane Court; dream 1; the wake in 8001; the phone sequence and objective text; the 8004 note on the new paper; the dial UI; both items dropping; the lobby; the alley; the restock room before and after the chase (old red brick with moss, 24 boxes, wall icons); the terrace key and piece 2 pickups; the 21st-floor corridor; the photo on the terrace door; the terrace (pergola, lights, tank, bench, skyline); tank fill, chimes, piece 3, the ledge reveal; the ledge choice and sit scenes; THE DROP; the face-down frame, safe key and safe; Eileen's letter; the street, the new subway entrance, the metro platform with the figure waiting; boarding; the ride; TRANSIT with its art.

**Found and fixed in this pass**
1. **The chase target was invisible.** The figure stays about 15 m ahead (as designed: she is always faster), but the dream corridor's fog ended at 16 m and the hall was unlit, so the player followed nothing. Fog now ends at 30 m and she carries a faint cold light for the length of the chase. She reads clearly as a silhouette at the end of the hall.
2. **The crescent moon in the second alley visit could not be seen.** It was a flat plane at 7 m, edge-on to anyone looking up and mostly hidden by the walls. It is now a camera-facing sprite hung in the slit of sky above the alley, so it appears when the player looks up. (The alley is a deep canyon; you only see it looking up, which is why the subtitle names it.)

**Still open**
- The 8007 flat and the chase corridor are very dark by design; both are readable with the flashlight but could use a touch more ambient light.
- Platform column blue band (cosmetic).
- Ledge and ending scenes were reviewed from still frames only; I did not judge their timing.
