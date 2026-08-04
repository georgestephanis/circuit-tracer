# Circuit Board Tracer

A browser-only tool for manually digitizing a two-sided circuit board: upload
front/back photos, trace copper paths on each side by clicking points, mark
vias/holes that connect the two sides, and export everything as a single
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
     and "Undo point" removes the last placed point.
   - **Via / Hole** — click a spot on either image to place a via. You'll be
     asked whether this is a **new via** or should link to an **existing
     unlinked via** placed on the other side. Two vias sharing an ID are
     considered the same physical hole connecting front and back.
     **Scroll the wheel** over a via to resize it (it's one physical hole, so
     both sides resize together), or over the board in Via mode to change the
     default size for new vias.
   - **Pad** — click two opposite corners to place a rectangular pad. A live
     preview follows the cursor after the first click; **Escape** cancels.
     Pads merge with the copper they cover — see [Pads](#pads).
5. Traces, pads and vias appear in the sidebar lists, where you can rename them
   (e.g. give a trace a net name), set an exact width/diameter, or click to
   select them. **Delete/Backspace** removes the selected item.
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
- **Default via ⌀** applies to new vias; individual vias are set by scrolling
  over them or typing in the Vias list.

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
- **Re-aligning clears that side's work.** Because the corrected image is a
  new pixel space, re-aligning removes that side's traces and that side's half
  of every via (a via placed only on that side is removed entirely). You're
  asked to confirm first if there's anything to lose. Align both sides before
  you start tracing.

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

## Exported SVG schema

The export is a single `<svg>` containing two side-by-side groups:

```xml
<svg>
  <title>{board name}</title>
  <metadata data-board-name="..." data-generated="..." data-generator="circuit-tracer"
            data-unit="mm" data-board-width="100" data-board-height="80" />

  <g data-side="front" data-px-per-unit="10" transform="translate(0, 0)">
    <image href="data:image/...;base64,..." x="0" y="0" width="…" height="…" />
    <rect id="pad-front-1" class="pad" data-side="front" data-connects="trace-front-1 via-1"
          data-width="5" data-height="4" x="270" y="80" width="50" height="40" fill="…" />
    <path id="trace-front-1" class="trace" data-side="front" data-label="GND"
          data-connects="pad-front-1" data-width="0.25" d="M …" stroke="…" stroke-width="2.5" />
    <circle id="via-1-front" class="via" data-via-id="via-1" data-side="front"
            data-diameter="0.8" cx="290" cy="100" r="4" />
  </g>

  <g data-side="back" data-px-per-unit="10" transform="translate({front.width + 40}, 0)">
    <image href="data:image/...;base64,..." x="0" y="0" width="…" height="…" />
    <path id="trace-back-1" class="trace" data-side="back" data-width="0.25" d="M …" stroke="…" />
    <circle id="via-1-back" class="via" data-via-id="via-1" data-side="back"
            data-diameter="0.8" cx="290" cy="100" r="4" />
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
- Pads are `<rect class="pad">` elements, axis-aligned, with `data-width` /
  `data-height` giving their physical size alongside the pixel `width` /
  `height`. `data-connects` lists the trace and via IDs the pad merges with.
  **Linkage is bidirectional**: if a pad lists a trace, that trace also lists
  the pad, so you can traverse from either end.
- Pads are emitted **before** traces within a group, so painting them in
  document order renders trace-into-pad as one continuous copper shape.
- Vias are `<circle class="via">` elements. Each physical via produces **up
  to two** `<circle>` elements (one per side it was placed on), sharing the
  same `data-via-id` but with side-qualified, DOM-unique `id`s
  (`{via-id}-front` / `{via-id}-back`). To find both halves of a via,
  `querySelectorAll('[data-via-id="via-1"]')` rather than relying on `id`.
  A via with only one `<circle>` in the document was never linked to the
  other side.
- `data-label` on a via or pad element is present only if the user gave it a
  label.
- `data-diameter` on a via `<circle>` is its physical diameter; `r` is half of
  that in pixels. Both `<circle>` elements of a linked via always carry the
  same `data-diameter`.
