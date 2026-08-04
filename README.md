# Circuit Board Tracer

A browser-only tool for manually digitizing a two-sided circuit board: upload
front/back photos, trace copper paths on each side by clicking points, mark the
vias and holes that pass through the board, and export everything as a single
self-contained SVG that other software can parse.

Everything runs client-side — images never leave the browser except inside
the exported SVG file (embedded as base64 data URIs).

## Running it

```bash
npm install
npm run dev     # start the dev server
npm run build   # production build (also type-checks)
```

## Using it

1. Upload a **front** image and a **back** image (click or drag-and-drop onto
   each panel).
2. *(Optional but recommended)* Click **Align** on a panel to straighten that
   side. See [Aligning a side](#aligning-a-side) below.
3. Enter the board's real **dimensions** in the Scale sidebar section, so trace
   widths and via sizes are real measurements. See [Scale and
   dimensions](#scale-and-dimensions).
4. Pick a tool in the toolbar:
   - **Trace** — click to add points to the current path; double-click, or
     press **Enter**, to finish it. **Escape** cancels the in-progress trace,
     and "Undo point" removes the last placed point. A pending segment follows
     the cursor so you can see where the next point lands, and clicking a via
     or hole **snaps** the point to its centre and records the connection.
   - **Via** — a small plated signal via. Click a spot on either image and it's
     placed on **both** sides at once. See [Vias and
     holes](#vias-and-holes).
   - **Hole** — the same thing at a standard through-hole size, for component
     leads and mounting holes. Drawn as an open ring rather than a solid dot.
   - **Pad** — click two opposite corners to place a rectangular pad. A live
     preview follows the cursor after the first click; **Escape** cancels.
     Pads merge with the copper they cover, and a single pad can be repeated
     into an evenly spaced series — see [Pads](#pads).
   - **Test point** — one click drops a round pad at a standard 0.75 mm. It's
     a pad in every other respect: it merges with copper, can be labelled, and
     can be repeated into a series.
   - **SMD package** — drops both pads of a common chip footprint in one
     click. See [SMD packages](#smd-packages).
5. Everything you place appears in a collapsible sidebar section — Traces,
   Pads, Test points, Vias, Holes — each with a count and its own scroll area.
   Rename items (e.g. give a trace a net name), set an exact width or diameter,
   flag ground, or click to select. **Delete/Backspace** removes the selection.
6. Enter a board name and click **Export SVG** once both images are uploaded.

Work is autosaved as you go — see [Autosave and resuming](#autosave-and-resuming).

## Scale and dimensions

Trace widths and via diameters are stored as **real physical measurements**,
not pixels, so they stay meaningful regardless of photo resolution.

- Pick a **unit** (mm, mil, or inch) in the Scale section. Switching units
  converts every stored measurement, so nothing changes size.
- Enter the board's **width and height**. Pixels-per-unit is derived per side
  from that side's image dimensions, averaging both axes — a
  perspective-corrected photo won't have a perfectly matching aspect ratio, and
  a single scalar is needed for stroke widths.
- Until you enter dimensions, the app assumes a **100 mm wide** board so that
  nothing renders at an absurd size. The Scale panel says which case you're in.
- **Default trace width** applies to new traces; override individual traces
  with the width box in the Traces list (leave it blank to follow the default).
- **Default via ⌀**, **Default hole ⌀**, and **Test point ⌀** apply to newly
  placed items of each kind; individual ones are set in their sidebar list.

Every default previews at true scale under the cursor while its tool is active
— see [Judging sizes against the photo](#judging-sizes-against-the-photo).

## Vias and holes

Both tools mark the same thing — a drilled opening that passes **through** the
board — and differ only in default size and how they're drawn:

| | Default ⌀ | Drawn as |
| --- | --- | --- |
| **Via** | 0.4 mm | solid plated dot |
| **Hole** | 1 mm | open ring |

Neither default is binding: resize any individual one with the diameter box in
its sidebar list, and change the defaults in the Scale section.

### Placement goes through the board

A drill goes all the way through, so **clicking on one side also places the
opening where it emerges on the other**. While you hover with either tool, the
opposite panel shows a dashed ghost of where it would come out. There is no
linking step — every via and hole is created as one object with a position on
both sides.

The exit position is derived by mirroring the point about one axis — **which
one depends on how you turned the board over**, so it's a setting rather than a
guess. Pick it in the Scale panel:

| Setting | Mirrors | Use when |
| --- | --- | --- |
| **Left-to-right** | `x → width - x` | you turned the board about its vertical axis (the usual way) |
| **End-over-end** | `y → height - y` | you turned it about its horizontal axis |

Changing the setting **moves every via already placed**, so if the two sides
don't line up, switching it fixes the whole board rather than just future
placements. The front position is treated as authoritative and the back
re-derived from it.

A list entry reads *(both sides)* normally, or *(one side)* if it lost its other
half — which only happens if the board width wasn't known yet when it was
placed (no image loaded and no alignment done).

## Zoom, pan, and keyboard

A board photo is a few thousand pixels wide shown at panel size, so a 0.4 mm
via can land on two or three screen pixels. Each panel has its own view:

- **Scroll** to zoom about the cursor, up to 50×. In SMD package mode the wheel
  is busy stepping through footprints, so **Ctrl/Cmd+scroll** zooms there.
- **Middle-click and drag** to pan. Left-click stays free for placing things.
- The header shows the current zoom and a **Reset view** button. Loading or
  re-aligning a photo resets the view, since it's a new pixel space.

Overlay chrome — labels, previews, the snap halo — is drawn at a constant size
on screen rather than in image pixels, so zooming in makes the *board* bigger,
not the annotations. Via snapping tightens as you zoom in for the same reason.

### Shortcuts

| Key | Does |
| --- | --- |
| `1`–`6` | Trace, Via, Hole, Pad, Test point, SMD package |
| `G` | Toggle ground on the selected via, hole, or pad |
| `Enter` | Finish the current trace |
| `Esc` | Cancel the in-progress trace, pad, or pad series |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl`/`Cmd` `+Z` | Undo |
| `Shift`+`Ctrl`/`Cmd` `+Z`, or `Ctrl`/`Cmd` `+Y` | Redo |

Undo covers every change to the board, up to 50 steps. It deliberately steps
*over* things that only change what you're looking at — switching tools,
selecting an item, cycling footprints — because having those consume an undo
press makes the stack feel broken. Restoring a session or resetting the board
clears the history, since there's nothing coherent to go back to.

## Judging sizes against the photo

Sizes are typed, not dragged — but a number in millimetres is hard to picture
against a photo, so **the active tool previews what it would place, at true
scale, under the cursor**, labelled with its dimension:

- **Trace** — a stub of copper at the current default width.
- **Via / Hole / Test point** — a circle at that tool's default diameter.
- **SMD package** — both pads of the selected footprint.

Change the size in the Scale panel and the preview updates live, so you can
dial a number in until it matches the copper you're looking at. Existing items
are the same comparison: edit a width or diameter in its sidebar list and it
redraws on the photo at true scale.

The scroll wheel does **not** resize anything — it zooms, or steps through the
footprint catalog in SMD package mode. See [Zoom, pan, and
keyboard](#zoom-pan-and-keyboard).

## Pads

Pads are axis-aligned rectangles placed by clicking two opposite corners, and
they **merge with the copper they cover** in two senses:

- *Visually* — a pad is drawn filled, beneath the traces, and adopts the color
  of the first trace it merges with, so trace and pad read as one continuous
  copper shape.
- *Electrically* — the linkage is recorded both ways in the export. A pad gets
  `data-connects` listing the traces and vias inside it, and each of those
  traces gets `data-connects` listing the pad.

Merging is automatic and works in both orders: place a pad over existing
traces/vias, or draw a trace through an existing pad. Only geometry on the
**same side** is considered.

### Repeating a pad into a series

Connector footprints are usually one pad repeated on a pitch, so you can place
one and let the rest fill in:

1. **Select** a pad (click it on the canvas or in the Pads list).
2. Enter how many pads the finished series should have, then click **Repeat
   pad…**.
3. **Click where the last pad goes.** A dashed preview of the whole series
   follows the cursor; **Escape** cancels.

The selected pad is #1 and your click is #N, so the copies fill the N−1 evenly
spaced positions between them, endpoint included. Copies keep the source's size
and color — a series is one connector — and each one merges with any trace or
via it lands on, exactly like a hand-drawn pad. The series runs along one side;
a click on the opposite panel is ignored rather than placing pads you can't see.

## SMD packages

The **SMD package** tool drops both pads of a two-pad chip footprint in a
single click, sized from the board's real dimensions so it lands at true scale.

- **Scroll** over the board to step through the catalog — 0402, 0603, 0805,
  1206, 1210, 2010, 2512 — or pick one from the toolbar dropdown.
- **Right-click** to rotate the footprint a quarter turn. Chip parts are
  symmetrical, so that's the only orientation control needed to aim one along a
  trace.
- The footprint previews under the cursor at true scale, so you can size it
  against the part outline in the photo before committing.

The two pads are placed as ordinary rectangular pads — they merge with copper,
can be labelled and grounded, and can be deleted individually. Nothing records
that they came from the same part.

The dimensions are nominal hand-solder land patterns, good enough to identify a
part on a photograph. They're **not** a substitute for a manufacturer's
recommended footprint. The table is a plain array in `src/lib/packages.ts` —
adding a package is a one-line change.

## Ground

Vias, holes, and pads can be flagged as **GND** with the checkbox in their
sidebar list, or by selecting one on the canvas and pressing `G`. A grounded item is drawn in a single distinct ground color
whatever color it would otherwise have, with a dashed outline.

Ground items are **implicitly one net**: they're all tied together without
pairwise connections being recorded between them, which is what makes a ground
plane tractable to mark up. In the export each carries `data-ground="true"` and
`data-net="GND"`.

A dedicated ground-plane feature is planned; this flag is the groundwork for it.

## Aligning a side

Board photos are usually shot slightly off-axis, so the two sides don't line
up with each other. **Align** fixes that per side with a true perspective
(homography) correction:

1. Click **Align** in a panel's header.
2. Click the board's four outer corners **in order: top-left, top-right,
   bottom-right, bottom-left** (clockwise from top-left). The clicked quad is
   drawn as you go, and "Reset corners" starts the picks over.
3. Click **Confirm**. The image is warped so that quad becomes a rectangle —
   rotation, crop, and keystone skew all corrected in one step.

Notes:

- **Both sides end up the same pixel size.** Whichever side you align *first*
  sets the output dimensions (derived from its quad's average edge lengths);
  the second side is warped to those same dimensions, so front and back share
  one coordinate space.
- **The original photo is kept.** Re-entering align mode shows the untouched
  upload with your previous corner picks prefilled, so you can nudge them and
  re-warp from the original rather than warping an already-warped image.
- **Re-aligning clears that side's traces and pads.** They were drawn in the
  old pixel space, so they no longer line up. You're asked to confirm first if
  there's anything to lose. Align both sides before you start tracing.
- **Vias and holes survive a re-align.** Because they pass through the board,
  each one's position on the re-aligned side is re-derived by mirroring its
  position on the other side into the new pixel space. Only an opening with
  nothing left on either side is dropped.

## Autosave and resuming

Your work is autosaved to the browser's `localStorage` as you go — traces,
pads, vias, labels, the board name, units and dimensions, and each side's
alignment corners.

**The photos themselves are not stored.** Two base64 board photos would blow
`localStorage`'s few-megabyte budget immediately. Instead:

- A session is keyed by a hash of the images it was traced from, so
  **re-uploading the same two files finds the same saved work**. You'll get a
  banner offering to **Restore** or **Start fresh**.
- Restoring re-derives each corrected image by **re-warping the photo you just
  uploaded** using the saved corners — so alignment survives without storing
  the warped raster.
- The key is computed from the *original* photo, so aligning a side doesn't
  change which session it matches.

Other behavior worth knowing:

- Restore is only offered on an otherwise-empty board, so it can never
  overwrite work in progress.
- **Start fresh** deletes that saved session, so it isn't offered again.
- The Session sidebar shows the last autosave time and offers **Discard saved
  work** to clear both the stored session and the current board.
- The 8 most recent sessions are kept; older ones are evicted. If storage is
  full or unavailable, a message appears and editing continues normally —
  autosave is a convenience, and **Export SVG** remains the durable artifact.
- Saved sessions carry a schema version. A session is **migrated** when the
  missing fields have an unambiguously correct value, and **discarded** when
  they don't:
  - **v1 → dropped.** Splitting vias and holes made `kind` required, and a v1
    via records nothing that says which it was. Guessing seemed worse than
    starting clean.
  - **v2 → migrated.** Round pads and the ground flag were added afterwards.
    Every pad written before that was a rectangle and nothing was grounded, so
    filling those in isn't a guess.

## Exported SVG schema

The export is a single `<svg>` containing two side-by-side groups:

```xml
<svg>
  <title>{board name}</title>
  <metadata data-board-name="..." data-generated="..." data-generator="circuit-tracer"
            data-unit="mm" data-board-width="100" data-board-height="80" />

  <g data-side="front" data-px-per-unit="10" transform="translate(0, 0)">
    <image href="data:image/...;base64,..." x="0" y="0" width="…" height="…" />
    <rect id="pad-front-1" class="pad pad--rect" data-side="front" data-shape="rect"
          data-connects="trace-front-1 via-1"
          data-width="5" data-height="4" x="270" y="80" width="50" height="40" fill="…" />
    <circle id="tp-front-3" class="pad pad--round" data-side="front" data-shape="round"
            data-ground="true" data-net="GND"
            data-diameter="0.75" cx="150" cy="60" r="3.75" fill="#6b7280" />
    <path id="trace-front-1" class="trace" data-side="front" data-label="GND"
          data-connects="pad-front-1" data-width="0.25" d="M …" stroke="…" stroke-width="2.5" />
    <circle id="via-1-front" class="via via--via" data-via-id="via-1" data-kind="via"
            data-side="front" data-diameter="0.4" cx="290" cy="100" r="2" />
    <circle id="hole-2-front" class="via via--hole" data-via-id="hole-2" data-kind="hole"
            data-side="front" data-diameter="1" cx="60" cy="40" r="5" />
  </g>

  <g data-side="back" data-px-per-unit="10" transform="translate({front.width + 40}, 0)">
    <image href="data:image/...;base64,..." x="0" y="0" width="…" height="…" />
    <path id="trace-back-1" class="trace" data-side="back" data-width="0.25" d="M …" stroke="…" />
    <circle id="via-1-back" class="via via--via" data-via-id="via-1" data-kind="via"
            data-side="back" data-diameter="0.4" cx="110" cy="100" r="2" />
    <circle id="hole-2-back" class="via via--hole" data-via-id="hole-2" data-kind="hole"
            data-side="back" data-diameter="1" cx="340" cy="40" r="5" />
  </g>
</svg>
```

Notes for parsers:

- Each side's group carries `data-side="front"` / `data-side="back"`.

### Units and scale

- `<metadata data-unit>` names the unit (`mm`, `mil`, or `in`) that **every**
  `data-width`, `data-height`, and `data-diameter` in the file is expressed in.
- `data-board-width` / `data-board-height` on `<metadata>` are the board's real
  dimensions. They are **absent** if the user never entered them, in which case
  physical values were rendered against an assumed 100 mm board width and
  should be treated as unscaled.
- Each group's `data-px-per-unit` is the pixels-per-unit factor used for that
  side. Multiply a physical `data-*` value by it to get the pixel value, or
  divide a pixel value by it to recover a physical measurement. Geometry
  attributes (`x`, `y`, `cx`, `r`, `d`, `stroke-width`, …) are always in
  pixels; the `data-*` attributes carry the authoritative physical values.
- All coordinates within a group are in that side's embedded image's pixel
  space — the uploaded photo's natural size, or, if the side was aligned, the
  perspective-corrected raster's size (the `<g>`'s `transform` only offsets
  the back side horizontally so both render side by side). When both sides
  have been aligned, the two groups share identical image dimensions, so
  front and back coordinates are directly comparable.
### Elements

- Traces are `<path class="trace">` elements. `data-label` is present only if
  the user gave the trace a label. `data-connects` is a space-separated list of
  pad and via IDs this trace connects to, present only if at least one is
  linked. `data-width` is the trace's physical width; `stroke-width` is that
  same width in pixels.
- Pads carry `class="pad"` and a `data-shape`, and their element type follows
  the shape — **check `data-shape`, not the tag**:
  - `data-shape="rect"` → an axis-aligned `<rect class="pad pad--rect">` with
    `data-width` / `data-height` alongside the pixel `width` / `height`.
  - `data-shape="round"` → a `<circle class="pad pad--round">` with a single
    `data-diameter`, used for test points. Its `id` is prefixed `tp-`.
- `data-connects` on a pad lists the trace and via IDs it merges with.
  **Linkage is bidirectional**: if a pad lists a trace, that trace also lists
  the pad, so you can traverse from either end.
- Grounded copper carries `data-ground="true"` and `data-net="GND"`, and is
  filled in the ground color. Every element with `data-net="GND"` is on one
  net — that connectivity is *not* also written out as pairwise `data-connects`
  entries, so treat the flag itself as the linkage.
- Pads are emitted **before** traces within a group, so painting them in
  document order renders trace-into-pad as one continuous copper shape.
- Vias and holes are both `<circle class="via">` elements, distinguished by
  `data-kind="via"` or `data-kind="hole"` (mirrored in a `via--{kind}` class).
  The two kinds are the same construct — a through-board opening — and differ
  only in typical size and presentation: a via is filled, a hole is drawn as a
  ring with a heavier stroke. Element `id`s are prefixed to match
  (`via-1-front`, `hole-2-back`).
- Each physical opening produces **up to two** `<circle>` elements (one per
  side), sharing the same `data-via-id` but with side-qualified, DOM-unique
  `id`s (`{via-id}-front` / `{via-id}-back`). To find both halves,
  `querySelectorAll('[data-via-id="via-1"]')` rather than relying on `id`.
  Because placement is through-board, both halves are normally present; a
  single `<circle>` means the other side's position was lost or never known.
- The two halves are **mirrored in x** within their groups (front `cx` +
  back `cx` ≈ the image width), not equal. See [Vias and
  holes](#vias-and-holes) for the flip convention that implies.
- `data-label` on a via or pad element is present only if the user gave it a
  label.
- `data-diameter` on a `<circle>` is its physical diameter; `r` is half of that
  in pixels. Both halves always carry the same `data-diameter`.
