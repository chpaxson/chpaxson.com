# chpaxson.github.io

Personal website built with Vue 3, TypeScript, and Vite, and published to GitHub Pages.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm

## Run locally

Install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The server supports hot reloading while you edit the site.

## Build and preview

Create and validate a production build:

```sh
npm run build
```

This runs the TypeScript/Vue type check and builds the site into `dist/`. To serve that build locally:

```sh
npm run preview
```

The standalone serial console is included in the build as `dist/serialconsole.html`. On the deployed site, it is available at `/serialconsole` (which redirects to that HTML page) and `/serialconsole.html`.

## M211 Label Studio

Open `/bradym211.html` (or `/bradym211` on the deployed site) for the standalone Brady
M211 interface. Use Chrome or Edge with Web Bluetooth enabled, over HTTPS or
localhost. Turn on the printer, close other connected apps, and select **Connect
M211**. The SDK retains Bluetooth ownership in local storage for reconnecting.

Choose **Images / PDF** or **Typst** in the artwork tabs. The tabs maintain separate
jobs; only the selected workflow is printed. Import PNG, JPEG, WebP, SVG images or
PDFs, preview the white-backed raster output in the image grid,
optionally rotate or threshold all images to black and white, arrange the items,
and print with copies, collation, and cut options. Images remain in browser memory;
there is no upload service or persistent artwork storage. The SDK preserves aspect
ratio and scales images to the installed cartridge's first printable zone, so
the preview is not a physical-size proof. Physical alignment and output still
need testing on an M211. Jobs are not automatically retried after failures.

Enable **Combine into one strip** to automatically trim left/right white margins,
or apply manual pixel crops to every rendered image, and concatenate in
queue order without resizing. Auto trim treats RGB channels of 250 or above as
white and rejects fully blank images (disable auto trim to retain blank artwork).
Manual crops are available only when auto trim is disabled and apply after rotation/thresholding.
The configurable pixel margin pads only the left and right of each image, without
changing the strip height. Images are
vertically centered; optional full-height black separators are exactly one raster
pixel wide between padded images. A separate toggle adds one-pixel marks before
the first and after the last image, independently of the internal separators.
Enabling auto trim hides and ignores the manual left/right crops; their values are
preserved for when auto trim is disabled again.

Combined previews rebuild automatically after changing artwork, order, or strip
settings. Stale strips cannot be printed. Download the resulting PNG or send it
as one bitmap with the requested number of copies. The SDK still scales the whole
strip to the installed printable zone: one raster pixel is not necessarily one
printer dot, and this does not configure physical label length. Continuous media
is recommended. Forward-feed and cut controls remain available with confirmation.

The maintained package is `@bradycorporation/brady-web-sdk`, not the obsolete
unscoped package shown on the demo setup page. `vite-plugin-brady-sdk.ts` serves
and deploys the distribution unchanged, including WASM siblings and license
notices. SDK print analytics are disabled via the constructor's second argument.
The SDK is licensed under Brady's proprietary agreement; deployed license
notices are available at `/brady-sdk/LICENSE.md`.

`src/brady/printer.ts` isolates SDK transport and validation.
`src/brady/renderers.ts` defines `LabelRenderer`, accepting a source Blob and
render options and returning a decoded `HTMLImageElement`. Typst/PDF documents
are converted into PNG page Blobs and use this same renderer for rotation,
thresholding, queue composition, and printing.

### Typst and PDF documents

Select the **Typst** tab, paste the complete source (or load
a `.typ` file). Typst always uses the connected printer's reported PPI. Only when
the connected printer cannot report that resolution does a manual **Raster PPI**
field appear, with a warning. Disconnected Typst rendering silently uses 203 PPI
and hides those controls. A later printer resolution automatically replaces
the fallback and refreshes the output. The locally bundled CodeMirror editor
provides Typst syntax highlighting, line numbers, bracket matching, and undo/redo,
with light/dark themes. It is not a Tinymist language server; VS Code remains an
option for advanced editing. Enter inserts a plain newline without automatic
indentation. Tab / Shift+Tab indent or outdent the current line or selected lines;
Esc then Tab moves keyboard focus out of the editor. Every document page becomes
an image. The supplied screw-label example uses CeTZ 0.5.2 and Lato; it renders
as nine pages. Typst compilation uses the pinned `typst.ts` 0.7.0 WASM compiler
in a dedicated worker, exporting PDF locally before rasterizing via PDF.js.
Compiler diagnostics appear in the interface.

**Live preview** is always enabled and sends edits immediately, without a typing debounce, to a retained
compiler worker. Source updates reuse the compiler and its incremental caches;
supporting files/fonts or newly discovered package dependencies may require a
rebuild. Compilation, PDF export, and rasterization are asynchronous, not
instantaneous. Superseded results cannot replace the latest job.
Pages appear in one vertically scrollable document view, and the complete output
defines the Typst job directly. **Combine into one strip** defaults on; turn it
off to print each document page separately using Copies, Collation, and Cut behavior.
The image/PDF workflow retains its own independent combine setting. There is no
separate preview window needed: source and pages sit side by side on wider screens
and stack on narrower layouts. There is no
separate queue or add-to-queue step for Typst. Errors or out-of-date previews
block printing. First use can take longer while assets download.

**Save .typ** and Ctrl+S / Cmd+S in the Typst tab open the native Save As dialog,
filtered to `.typ` source files, using the loaded filename (or `labels.typ`).
Only the source is written, never the web page. Cancellation leaves the saved
state unchanged; edits made while saving remain unsaved. On browsers without
the File System Access API, a source-only download is used with an explicit
notice that the browser controls the save location.

Source edits are automatically saved to localStorage on this browser/origin and
restored on reload, including empty drafts. Source is not stored in cookies or
sent to the server. Clearing site data removes the draft; storage failures show
a warning. This draft is not a saved `.typ` file, and supporting uploads remain
memory-only. **Reset to template**, beside Supporting files / fonts, confirms
before replacing the source and its local draft; it preserves supporting uploads.

The right-aligned **Supporting files / fonts** button beside Load/Save opens a
file manager. Upload additional files, replace existing filenames, remove individual
files, or remove all uploads. It shows filenames, sizes, and the 50 MiB total limit;
`main.typ` remains reserved for the editor. Changes refresh the live document.
**Clear runtime/package cache** is inside this manager and does not remove uploads.

The starter document has two 52 mm x 0.5 in labels with bold 5 mm Lato text and
0.2 em paragraph leading. Black & white is off by default. Auto trim, between-image
separators, and both outer separators are on; each image has a 5 mm horizontal
margin, maintained at the active PPI (rounded to printer pixels).

The top-bar **Units** selector switches distance inputs between mm, inch, and
pixel. Left/right crops and margins show conversions to all three units at the
active PPI, plus the rounded whole-pixel value used in the raster. Switching units
preserves raster geometry; changing PPI updates conversions. The horizontal margin
retains its physical size when PPI changes, with whole-pixel raster rounding.
The selector does not rewrite measurements inside Typst source or control printer
media size. Entries accept decimals and optional `mm`, `in`, or `px` suffixes
without native floating-point step-validation popups. The SDK may still scale
artwork before printing. Page and artwork captions show dimensions in the selected
unit alongside pixels (pixels only when that unit is selected).

In **Images / PDF**, each grid item can **Fit to label height** (proportional
scaling) or use **Fixed PPI / crop to label height** (centered vertical crop,
white padding when shorter). Image PPI follows the printer by default and can
be overridden per item. The M211's reported tape width determines label height;
offline, 0.5 in is the editable fallback. Each card shows source dimensions,
height relative to the label, and the resulting label raster. Output raster PPI
uses the printer resolution when available. This controls artwork preparation,
not the SDK's subsequent physical scaling.

Page previews, grid thumbnails, and artwork use a shared display scale of 203 CSS
pixels per source inch: equal-height labels appear equally tall regardless of width
or render PPI. Extra-wide labels shrink proportionally to fit their container;
tall documents are capped at 600 CSS pixels. This affects display only, not print
rasters, and is not a calibrated screen measurement. Click a grid
item, artwork preview, or Typst page preview for a full-size modal: zoom with the
wheel or +/- controls, drag to pan, choose **Fit** or **100%**, and press Esc to
close. Keyboard +/- and 0 (fit) are supported. Previews do not upsample the actual
print bitmap; higher-resolution source artwork provides more detail at the
printer's PPI.

Printing immediately shows a sending label and spinner on the print button, a
local status message, and a starting notification. Success means SDK acceptance,
not confirmation that physical output is complete; hardware output needs checking.
Before submission, artwork height is compared with the reported material height,
rounded to raster pixels at the job PPI (or the configured height if unreported).
A mismatch opens a warning with **Cancel** focused by default; Escape also cancels.
Choose **Scale to height & print** to resize proportionally, or **Crop / pad to
height & print** to preserve width and center-crop/pad vertically. Only this
submission is changed; previews/source remain intact. Any artwork, settings, or
printer change cancels pending confirmation so stale jobs cannot be released.

Versioned `@preview` packages, including transitive dependencies, are resolved
from `https://packages.typst.org/preview/`. Package archives use a persistent
Cache Storage cache. Compiler WASM, PDF.js worker, Lato (regular/bold/italic),
and standard Typst fonts use a separately versioned asset cache. No source,
PDFs, uploaded files, or artwork are sent to remote services or saved in these
caches. The first render requires network access for fonts and packages; warm
renders reuse cached files across reloads. JavaScript modules use the browser's
normal HTTP cache. Browser data clearing or storage eviction can remove caches;
**Clear runtime/package cache** clears only Label Studio's document asset caches.
WASM and PDF support assets are served from the deployed site, not a runtime CDN.
Fonts initially come from the Typst/Google Fonts repositories via jsDelivr.

Use **Supporting files and fonts** to provide sibling modules, images, data,
and `.ttf`/`.otf` fonts referenced by a document. Uploaded names are relative to
the main document; `main.typ` is reserved. Supporting files remain in memory.
Nested project folders and private/local package registries are not automatically
discovered, and browser compilation cannot read the VS Code filesystem. If
Tinymist uses a different Typst compiler version or unavailable system fonts,
output can differ: upload the fonts or export PDF from VS Code instead.

PDF input is accepted by the image picker/dropzone, one raster per page.
PPI automatically follows the connected printer's valid reported resolution,
including updates after connection. Without a valid printer report, manual PPI
is used (72-1200, default 203). In **Images / PDF**, Raster PPI shows the printer's
resolution as a muted placeholder (203 offline); enter a value to override PDF
import resolution, or clear/reset it to follow the printer again. PPI-unavailable
warnings are shown only while connected. Typst always follows a valid printer
report. Each import/render captures its starting PPI so connection changes cannot
change resolution halfway through a document. Imported PDF source rasters remain
unchanged; per-item fitting/cropping prepares new output from them.
Dimensions are rounded up from PDF page points
using `pixels = points * PPI / 72`. PPI does not alter existing queued images
or bypass Brady's print-time resizing. Limits: 30 total pages per job,
50 MiB per PDF / supporting files combined, 1 MiB source, and 16 megapixels /
8192 pixels per raster side. Password-protected PDFs must be unlocked first.
Failed imports/compilations do not partially add pages or retry print jobs.

The benign `PrinterStatus_Initialized` localization keys from the Brady SDK are
not displayed as a printer error. Other printer messages are retained.
Activity appears in dismissible bottom-right notifications (successes expire;
errors remain until dismissed). SDK consumable diagnostics expose the raw
validity flags. In SDK 3.3.3, the M211 BLE view model initializes supply/ribbon
validity to false without confirming them true in normal Bluetooth status
updates. Those flags alone therefore no longer produce a fabricated invalid
cartridge error or block printing. Explicit invalid-media messages and failed
SDK print results still report errors, with no automatic retries.

Run the adapter and strip geometry tests on Node.js 22.14 or later (no hardware required) with:

```sh
node --experimental-transform-types --experimental-vm-modules --test src/brady/__tests__/*.test.mjs
```

## Publish to GitHub Pages

The GitHub Actions workflow in `.github/workflows/static.yml` deploys the site when changes are pushed to the `main` branch:

1. It checks out the repository.
2. It builds the Vite project.
3. It publishes the build output (and the repository's `data/` directory) to GitHub Pages.

To publish a change, push or merge it to `main` and monitor the **Actions** tab for the “Deploy static site to GitHub Pages” workflow. In the repository's **Settings → Pages**, ensure the publishing source is set to **GitHub Actions**. The workflow URL will be shown after deployment completes.