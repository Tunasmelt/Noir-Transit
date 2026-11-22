# Noir: Transit — Asset Generation Sheet

Use in ChatGPT (image generation) or Claude chat with Higgsfield (GPT Image 2.6, Medium quality, 1K or 2K).
Generate ONE image per message. Save each to the filename shown and drop it in `public/art/`.
Tell me which ones you made; I will wire any marked **needs wiring** and re-run the tests.

---------------------------------------------------------------------
## 0. SHARED STYLE BLOCK (paste at the START of every prompt)

> Style: a 2001 PlayStation 2 survival-horror still (Silent Hill 2 / Cry of Fear mood). Desaturated palette of
> sodium amber, sickly teal and near-black. Heavy film grain, soft fog, deep crushed shadows, wet surfaces,
> quiet and lonely. Slightly low-resolution, faintly dithered look. No text, no logos, no watermark, no UI,
> unless the prompt says to include specific words.

Characters (keep consistent across images; attach earlier outputs as references if the tool allows):
- **Thomas Reed**: man, 30s, dark long coat, short dark hair. Face never clearly shown.
- **Eileen**: his missing wife, curly dark hair, warm smile. Her face is the only clear one.

Place: **Haldane Court**, a tall brick apartment block in a rain-soaked city. Metro station "Transit" below it.

---------------------------------------------------------------------
## 1. ALREADY IN THE GAME (6 images + icons). Re-generate only if you want better versions.

| File | Size | Used for |
|---|---|---|
| `hero.jpg` | 16:9 (1344x752) | Landing page hero |
| `og.jpg` | 1200x630 | Social link preview |
| `ending-a.jpg` | 16:9 | Ending A "THE DROP" backdrop |
| `ending-b.jpg` | 16:9 | Ending B "TRANSIT" backdrop |
| `photo-tex.jpg` | 256x256 | In-game polaroid (terrace door, floor 8 wall) |
| `flyer-tex.jpg` | 256x256 | MISSING flyers in the alley |
| `favicon.svg/png`, `apple-touch-icon.png` | 1:1 | Icons |

**hero.jpg** (16:9)
> Cinematic key art for a psychological horror mystery video game in the style of a 2001 PlayStation 2 survival-horror title such as Silent Hill 2. A lone man in a dark long coat seen from behind, standing in a narrow rain-soaked city street at night, looking up at a tall brick apartment building. One warm amber lit doorway at the foot of the building and a single lit window high above, everything else dark. Sodium streetlamps, wet asphalt reflecting amber and teal, drifting fog, heavy film grain, desaturated palette, a faint dithered low-resolution look, deep shadows, lonely and quiet. Wide composition with empty dark space on the left for a title. No text, no logos, no watermark.

**photo-tex.jpg** (3:4, then crop square)
> A faded, creased 1990s instant snapshot photograph lying on a dark surface, with a little tape residue at the corners. It shows a young couple sitting shoulder to shoulder on a rooftop parapet at night with the city lights soft behind them. The woman's face is clear and smiling. The man's face is a smear of white light, as if the camera had already started forgetting him. Slightly overexposed on-camera flash, heavy grain, warm yellowed colours, rain spots on the print. No text, no caption, no border writing.

**flyer-tex.jpg** (3:4, then crop square). Attach the polaroid as a reference.
> A weathered photocopied missing-person flyer taped crookedly to a wet dark brick wall at night, rain stains running down it, curled corners, torn tape. Black and white photocopy grain. Use only the smiling woman from the reference photograph, her face and curly dark hair, as a high-contrast black and white photocopied portrait; ignore the man and the polaroid frame. Huge bold headline: MISSING. Under the portrait: EILEEN. Below that: HAVE YOU SEEN HER? and LAST SEEN AT HALDANE COURT. At the bottom a row of empty blank lines where a phone number would be, left unfilled. No other text.

**ending-a.jpg** (16:9)
> Cinematic still in the style of the ending of a 2001 PlayStation 2 psychological horror game. An empty stone rooftop ledge at the corner of a brick parapet in light rain at first dawn. A folded red blanket and two paper cups are left on the stone and an unlit brass lantern sits beside them. No person anywhere. The city far below is fading into pale blue dawn mist with a few last amber windows. Melancholic, quiet, heavy film grain, desaturated, wide composition. No text.

**ending-b.jpg** (16:9, attach hero as reference)
> Cinematic still in the same style as the reference, but at the end of the story. The interior of a subway train carriage at dawn. The same man in a dark long coat is seated alone by a window, seen from behind or in profile with his face not visible. The window is flooded with soft golden morning light, a city sliding past outside. Otherwise empty seats. Warm, calm and quiet, faint film grain, the first warmth in an otherwise cold, dark series. No text.

**favicon.svg** (1:1, SVG output)
> A minimal flat vector app icon, readable at 16 pixels. A near-black rounded square (#0a0b0d) with a single tall narrow doorway glowing warm amber (#e8b060) at its centre, with thin pale diagonal rain streaks over a dark ground. Only three colours: near-black, amber, pale grey. Bold simple geometry, no text, no gradients, no fine lines.

---------------------------------------------------------------------
## 2. HIGH VALUE, NOT YET MADE (recommended next, in this order)

### 2.1 Landing page "scene photographs" (3 images, 4:3 each) — **needs wiring**
Replace the three tiny embedded JPEGs in the landing "Exhibit B" board. Files: `exhibit-platform.jpg`, `exhibit-corridor.jpg`, `exhibit-roof.jpg`.

`exhibit-platform.jpg`
> [Style block] A deserted underground metro platform at night, seen from the platform edge. Tiled walls stained with damp, a flickering fluorescent tube, a yellow safety line, an empty wooden bench, one old train carriage waiting with its doors open and its interior lit warm amber. Wet concrete floor reflecting the light. No people.

`exhibit-corridor.jpg`
> [Style block] The eighth-floor corridor of an old apartment building: long narrow hallway, stained floral wallpaper, worn dark red runner carpet, a row of numbered wooden doors, a single bare bulb flickering halfway down, the far end swallowed in darkness. A strip of light under one door. No people.

`exhibit-roof.jpg`
> [Style block] The city skyline seen from a rain-wet apartment rooftop at night: low parapet, rusted vents and a water tank, hundreds of tiny amber windows below, a heavy overcast sky glowing dull orange, mist in the streets. No people.

### 2.2 Seamless wall/floor textures (13 images, 1:1, then downscale to 256x256) — **needs wiring**
The engine currently paints these procedurally. Photo textures would add realism but must stay dark, low-contrast and flat-lit (no baked shadows, no perspective), or they will fight the dynamic lighting. Ask for "top-down flat orthographic, seamless tileable". Check the edges for seams.

Append to each: *"flat orthographic view, even diffuse lighting, no shadows, no perspective, no objects, seamless tileable texture, muted dark palette, subtle grime."*

| File | Prompt core |
|---|---|
| `tex-wallpaper.jpg` | Faded 1970s floral apartment wallpaper, dull olive-brown with a small repeating pattern, water-stained and peeling slightly |
| `tex-wallpaper-old.jpg` | Very old, heavily water-damaged striped wallpaper, brown-grey, mould blooms, torn patches |
| `tex-hall-floor.jpg` | Worn dark-red hallway carpet with a faint woven pattern and flattened traffic path |
| `tex-runner.jpg` | Narrow dark burgundy runner carpet with a thin gold border stripe, threadbare |
| `tex-wood-floor.jpg` | Dark scuffed hardwood herringbone parquet, dull varnish, dirt in the gaps |
| `tex-planks-old.jpg` | Rotten old floorboards, wide planks, grey-brown, cracks and nail heads |
| `tex-tile.jpg` | Small cracked off-white bathroom/station tiles with dark dirty grout, water stains |
| `tex-concrete.jpg` | Stained poured concrete, hairline cracks, damp patches, rust streaks |
| `tex-metal.jpg` | Painted industrial steel plate, chipped dark green paint, rust at the edges, rivets |
| `tex-metro-floor.jpg` | Dirty rubber subway floor with a fine diamond tread, scuffs and grit |
| `tex-metro-metal.jpg` | Brushed stainless-steel train panel, dull grey, grimy streaks, small dents |
| `tex-door-wood.jpg` | Old varnished apartment door wood grain, dark brown, scratches and wear |
| `tex-ceiling.jpg` | Water-stained acoustic ceiling tile, dingy cream, brown rings |

### 2.3 In-game posters (3 images, 3:4) — **needs wiring**
Currently procedural text on a coloured square. File: `poster-coast.jpg`, `poster-council.jpg`, `poster-roomtolet.jpg`.

`poster-coast.jpg`
> A faded 1970s travel poster, muted teal and cream, a calm seaside village and lighthouse in a flat illustrated style, sun-bleached and water-stained. Headline: VISIT THE COAST. Small tagline: IT MISSES YOU.

`poster-council.jpg`
> A grimy municipal notice board sheet, typed text on yellowed paper with a council crest. Headline: HALDANE WARD COUNCIL. Subheading: NOTICES. A few lines of illegible typed text below. Pin holes at the corners.

`poster-roomtolet.jpg`
> A handwritten cardboard sign in black marker, curling and water-stained, taped to a wall. Words: ROOM TO LET. Under it, a small blank space where a number would be, left empty.

---------------------------------------------------------------------
## 3. NICE TO HAVE

### 3.1 Per-level chapter stills (11 images, 16:9) — **needs wiring** (chapter cards / gallery)
Names match the game zones. Files `zone-<name>.jpg`.

| File | Prompt core (prepend style block) |
|---|---|
| `zone-arrival.jpg` | The inside of a small dim station lobby at 11:40pm, one flickering tube light, a turnstile, a closed ticket window, rain audible on a skylight, a single set of wet footprints |
| `zone-street.jpg` | A narrow wet city street at night in front of Haldane Court, shuttered shops, neon sign half dead, parked cars, rain, fog, a passing bus far down the road |
| `zone-dream1.jpg` | A pale, overexposed grey dream-corridor, washed-out fog light, an endless empty hallway with a single door ajar, unreal and silent, no colour except faint sickly yellow |
| `zone-floor8.jpg` | An apartment corridor lit by a bare bulb, numbered doors, wet wallpaper, a music box on a side table at the far end |
| `zone-lobbyG.jpg` | A small ground-floor apartment lobby, mailboxes, a cracked marble floor, a broken lift with its doors half open, a dead plant, dim amber lamp |
| `zone-alley.jpg` | The alley behind the building: dumpsters, wet brick walls, fire-escape stairs, a MISSING flyer taped on the wall, steam from a vent, one flickering lamp |
| `zone-restock.jpg` | A cramped basement restock room: steel shelves of dusty boxes, a generator with a lever, hanging bulb, pooled water on the floor, a note pinned by the generator |
| `zone-dream2.jpg` | A very long narrow dream hallway of grey concrete, converging perspective, faint distant light, sense of being followed, no people visible |
| `zone-floor21.jpg` | A top-floor corridor, clean but cold, one lit door at the end with a polaroid taped inside its glass, rain on a window |
| `zone-terrace.jpg` | A rooftop terrace in rain at night: low brick parapet and ledge, string of dead lanterns, a small table, a blanket, the glowing city far below |
| `zone-metro.jpg` | The same station platform at night with the last train waiting, its doors open and warm light spilling onto wet tiles |

### 3.2 Creature concept (reference only, 1:1) — no wiring
For your own reference or marketing. The game's ghost is a procedural 3D figure.
> [Style block] Concept art of a gaunt pale woman-shaped apparition in a soaked grey nightdress, long wet dark hair covering her face, standing motionless at the end of a dark corridor, arms hanging, faint white glow around her. Full body, centered. No gore.

### 3.3 Paper / note background (1024x1400) — **needs wiring** (CSS background for the read-note panel)
> Scan of a single sheet of old lined notebook paper, yellowed, folded twice (faint crease lines), slightly torn edge, coffee ring, blank, flat top-down, even lighting, no handwriting.

### 3.4 Store / marketing
- `cover-itch.jpg` 630x500: same as hero but centred, with the title **NOIR: TRANSIT** in tall condensed off-white lettering (generate text separately if the model garbles it).
- `banner.jpg` 1500x500: hero cropped wide, title at left.
- `poster-vertical.jpg` 2:3: the man from behind facing Haldane Court, title at top, tagline "ONE WAY DOWN. ONE WAY OUT."

---------------------------------------------------------------------
## 4. TIPS FOR CONSISTENCY AND CHEAP GENERATION
- Generate at **Medium quality, 1K**; the game downsamples everything to a 240-line dithered render anyway.
- For textures, 1K → resize to 256x256 (use `convert in.jpg -resize 256x256 out.jpg`).
- If a result has legible text you did not ask for, regenerate or tell me and I will blur/mask it.
- Textures: if you see a visible seam, apply an offset-and-blend or just regenerate. I can also add a procedural seam-blend in code.
- Keep the same person as a reference image for anything with Eileen.
- Unlimited generations apply only in the Claude chat / Cowork / ChatGPT surfaces, not from Claude Code.
