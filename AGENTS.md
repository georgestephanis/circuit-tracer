# AGENTS.md

Guidance for coding agents working in this repository. For what the app *does*
and the exported SVG's schema, read [README.md](README.md) first — this file
covers how the code is put together and the traps that aren't obvious from a
single file.

## Project

A client-side-only React + TypeScript + Vite app for manually digitizing a
two-sided circuit board from photos. There is no backend, no router, no state
library, and no network access at runtime — images are read as data URLs and
everything is held in one reducer.

## Commands

```bash
npm install
npm run dev      # dev server
npm run build    # tsc -b && vite build — this is the type-check gate
npm run lint     # oxlint
npx tsc -b --noEmit   # type-check alone, faster than a full build
```

**There are no tests.** Verify changes with `tsc` + `oxlint`, then say plainly
what you could not verify and hand the UI check to the human — do not claim
behavior works because it compiles.

## Architecture

```
src/
  App.tsx                  root: owns the reducer, dialogs, autosave, keyboard
  state/boardReducer.ts    ALL board mutations — one reducer, one Action union
  types.ts                 BoardState and the domain types
  lib/geometry.ts          pure geometry: rects, hit-testing, mirroring, series
  lib/packages.ts          SMD footprint catalog and its pad layout math
  lib/scale.ts             physical units, clamping, px-per-unit
  lib/homography.ts        perspective correction (align)
  lib/svgExport.ts         the export format
  lib/persistence.ts       localStorage sessions
  components/              presentational; they take props and call callbacks
```

The shape to preserve:

- **All board state lives in `boardReducer`.** Components hold only transient UI
  state (hover position, a form's in-progress value). If you need new board
  state, add it to `BoardState` and a case to the `Action` union — don't reach
  for context or a store.
- **Components don't dispatch.** They receive `on*` callbacks from `App.tsx`,
  which is the only place `dispatch` is called. Keep it that way; it's what
  makes the reducer readable in isolation.
- **Geometry math goes in `lib/geometry.ts`**, not inline in a component. When
  the canvas draws a preview of something the reducer will later create, both
  must call the *same* helper (`padSeriesRects` is the example) so preview and
  result can't drift.

## Domain model traps

These are the things that have caused real bugs. Read them before touching
coordinates, sizes, or vias.

### Two pixel spaces, and they aren't interchangeable

Every coordinate is in **its own side's image pixel space**. Aligning a side
warps its photo into a new raster, which is a *new* pixel space — anything
already drawn on that side no longer lines up, which is why `APPLY_ALIGNMENT`
discards that side's traces and pads.

Once both sides are aligned they share `alignedSize`, so their coordinates are
comparable. Before that, they are not.

### Vias and holes are one construct, stored in one array

`state.vias` holds **both** kinds; `Via.kind` discriminates. `Tool` has separate
`'via'` and `'hole'` entries, and the sidebar renders two filtered lists, but
there is no second array and `connectsVia` covers both. Don't split the storage.

A via is one drill through the board, so it carries a position on **both**
sides. `ADD_VIA` mirrors the clicked point with `throughBoard()`, and
`APPLY_ALIGNMENT` re-derives the realigned side's position the same way rather
than orphaning it. `front`/`back` stay optional only for the case where the
board width wasn't known at placement time.

`throughBoard()` assumes the board is flipped **left-to-right** between photos
(`x → boardWidth - x`). It is the single point of truth for that assumption —
if it ever needs to be configurable, change it there, not at call sites.

### Sizes are physical, never pixels — except pads

`Trace.width`, `Via.diameter`, and the `default*` fields are in `state.unit`
(mm / mil / in) — not pixels. Consequences:

- `SET_UNIT` must convert **every** stored measurement, or changing the display
  unit silently resizes the board. If you add a physical field, add it there.
- Run new values through `clampLength()`.
- Convert to pixels only at the drawing/export boundary, via `pxPerUnit()`.

**`Pad` is the exception**: its `x`/`y`/`width`/`height` are image pixels,
because a rect pad is defined by where its corners were clicked. Anything that
places a pad from a physical size — test points, SMD footprints — multiplies by
`pxPerUnit()` at creation time, and the export divides back out. A pad
therefore does *not* rescale if the board dimensions are entered later.

### Pads cover more than rectangles

`Pad.shape` is `'rect'` or `'round'`; a round pad is the circle inscribed in its
bounding box and must be kept square. Test points and both pads of an SMD
footprint are all just `Pad`s, which is why they merge with copper, label,
ground, and repeat into series for free. Keep it that way rather than adding
parallel types — and remember rendering and export must branch on `shape`.

### Ground is a flag, not a set of links

`ground?: boolean` on `Via` and `Pad` means "on the ground net". Everything
flagged is implicitly connected to everything else flagged — deliberately *not*
materialized as pairwise `connectsVia` / `connectsPad` entries, which would be
O(n²) for something a future ground-plane feature will model properly. Ground
items render in `GROUND_COLOR` regardless of their own color, and export as
`data-ground` + `data-net="GND"`.

### Connections are stored bidirectionally

A pad lists the traces/vias it covers, *and* those traces list the pad. Any code
that creates or deletes one side of that relationship must update the other —
see `padConnections()` and the `connectsPad` back-linking in `PLACE_PAD_ARRAY`.
`DELETE_SELECTED` is where deletions clean up the reverse links.

### Persistence is versioned and photos are never stored

`SavedSession` deliberately excludes images — two base64 photos would exhaust
`localStorage`. Alignment corners are saved instead and the corrected image is
re-derived by re-warping the re-uploaded photo.

**If you change the shape of anything in `SavedSession`, bump
`SCHEMA_VERSION`.** Then decide, per version, between two outcomes:

- Add it to `READABLE_VERSIONS` and fill the gap in `migrate()` — but *only*
  when the default is unambiguously right for the old data (every pre-v3 pad
  really was a rect).
- Leave it out, and old sessions are dropped on read. That's the correct choice
  when the missing field would have to be guessed (a v1 via's `kind`).

Never guess in `migrate()`. Losing a session beats silently inventing data, and
either way the README's autosave section should say which happened.

## Conventions

- TypeScript throughout; no `any`. Prefer discriminated unions over booleans
  for state that has more than two meaningful cases.
- Reducer cases return new objects — never mutate `state`. Note the trailing
  `default: return state`, which means a forgotten case fails silently at
  runtime rather than at compile time: adding an `Action` variant without a
  matching case will not be caught by `tsc`.
- Comments explain **why**, not what. The existing ones flag non-obvious
  constraints (pixel spaces, why pads render before traces, why the wheel
  listener is non-passive). Match that density: sparse, and load-bearing.
- Class names in `App.css` are plain and semantic (`via-marker--hole`,
  `size-hint`). No CSS framework, no CSS-in-JS.
- Keep the export schema **additive**. Downstream parsers read it; adding a
  `data-*` attribute is safe, renaming or removing one is a breaking change and
  belongs in the README's schema section.

## Gotchas

- React's `onWheel` is passive, so `preventDefault()` there won't stop the page
  scrolling. `BoardPanel` attaches a non-passive `wheel` listener by hand —
  don't "simplify" it back to the JSX prop.
- **The wheel does not resize anything.** It was tried and removed as
  confusing; its only job is stepping through the SMD footprint catalog while
  that tool is active. Sizes are typed, and judged against the photo via the
  true-scale cursor preview. Don't reintroduce wheel sizing.
- Right-click is captured (rotate footprint) *only* in package mode; every
  other tool must leave the browser context menu alone.
- The keyboard handler in `App.tsx` ignores events from `INPUT`/`TEXTAREA`, and
  the align overlay owns the keyboard while it's open. New shortcuts need to
  respect both.
- Anything that arms a mode consumed by the next canvas click (`draftTrace`,
  `draftPad`, `padArray`) must be cleared by `SET_TOOL`, `CANCEL_DRAFT`, and
  whatever invalidates its source. Missing one strands the UI in a mode the
  user can't see.
