# NOIR — "Transit" (Next.js build)

This is the original single-file browser game (`noir-slice.html`) repackaged as a proper
Next.js project so it can be deployed like any modern web app.

## Why it's structured this way

The game is a large, self-contained, imperative Three.js application — hundreds of functions
and closures wired together with plain DOM `getElementById` lookups, not React state. Rewriting
that into hundreds of React components would risk breaking the carefully debugged game logic
for no real benefit. Instead:

- The game's original HTML markup and CSS are embedded verbatim (byte-for-byte identical to the
  source file — verified) inside a client component, `app/game/NoirGame.jsx`.
- The game's ~2,900-line engine script lives untouched at `public/game/engine.js`.
- Three.js r128 is hosted locally at `public/game/three.min.js` (not loaded from a third-party
  CDN at runtime, so the deployed site doesn't depend on cdnjs staying up).
- On mount, the component injects the markup, then loads `three.min.js` and `engine.js` as
  ordinary `<script>` tags in order — exactly how the browser ran them in the original file.
- `app/page.js` dynamically imports the game with `ssr:false`, since the engine touches
  `window`/`document`/canvas/WebGL directly and was never written to run outside a browser.

This means all existing game features work unchanged: save/load via IndexedDB, both endings,
every puzzle, all sound, the landing page.

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Building for production

```bash
npm install
npm run build
```

This produces a fully static export in `out/` (configured via `output: "export"` in
`next.config.mjs`) — no Node.js server is required to serve it.

You can preview the static build with any static file server, e.g.:

```bash
npx serve out
```

## Deploying

Because the build is a static export, you can deploy `out/` to essentially any static host:

- **Vercel**: `vercel deploy` from the project root (Vercel auto-detects Next.js and runs
  `next build` for you — you don't need to run the build yourself first).
- **Netlify**: drag-and-drop the `out/` folder in the Netlify dashboard, or connect the repo
  and set the build command to `npm run build` and the publish directory to `out`.
- **GitHub Pages / S3 / Cloudflare Pages / any static host**: upload the contents of `out/`
  directly.

## Notes

- `reactStrictMode` is disabled in `next.config.mjs`. The game engine is a singleton WebGL
  app with no teardown path (it was never written to be mounted/unmounted), so React's
  Strict Mode double-invoking effects in development would boot it twice. A boot guard in
  `NoirGame.jsx` also protects against this directly.
- Save data uses IndexedDB in the browser and is per-origin, same as the original file.
- To modify game logic, edit `public/game/engine.js` directly — it's the same script that
  was in the original `<script>` tag, so all existing documentation/notes about the game's
  internals still apply.
