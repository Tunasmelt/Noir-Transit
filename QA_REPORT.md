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
