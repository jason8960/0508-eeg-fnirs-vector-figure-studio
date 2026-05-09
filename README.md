# EEG-fNIRS Vector Figure Studio

> Production-grade academic visualisation for multimodal neuroscience.
> From model output matrix to publication-ready vector figure — in a
> single, opinionated pipeline.

---

## Why this exists

Multimodal neuroscience increasingly fuses **EEG** (millisecond-scale
temporal resolution) with **fNIRS** (centimetre-scale spatial
resolution) through graph attention networks and CNN backbones.
Traditional plotting tools (MATLAB, EEGLAB, Origin, …) are built for
single-modality signal processing or generic statistics, so authors are
forced to glue together Python heatmaps, Adobe Illustrator overlays,
and screenshot-stitching to produce a final figure. The result: misaligned
coordinate systems, raster aliasing, and hours of yak-shaving per figure.

**EEG-fNIRS Vector Figure Studio** establishes a direct pipeline from
the model's output tensors to the journal's PDF. Every 2D figure is
authored as SVG; raster export at 300 / 600 / 1200 DPI is a
deterministic post-process. LaTeX is a first-class citizen across
labels, legends, and captions.

---

## Tech stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Frontend | **React 19** + **Vite** + **TypeScript** | Fast HMR, strict typing for matrix-shaped data. |
| Styling | **Tailwind CSS 3** | Atomic styling for dense scientific control panels. |
| 2D rendering | **D3.js v7** | DOM-level SVG control, force layouts, contour generation. |
| 3D rendering | **Three.js** | WebGL cortical projection, vertex-shader heat mapping. |
| Math | **KaTeX** | In-figure LaTeX without bundling MathJax's full surface. |
| Routing | **react-router** (Hash) | Deep-link to individual figures; works under `file://` for desktop builds. |
| Desktop (Phase 4) | **Tauri** | Native file I/O for GB-scale `.mat` / `.edf` ingestion. |

---

## Repository layout

```
src/
  main.tsx               app entry, registers HashRouter
  registry.tsx           central chart registry (CATEGORIES, registerChart)
  charts/                one folder per figure; each module side-effect
                         registers itself via registerChart()
  components/
    AppShell.tsx         sidebar + outlet
    FigureFrame.tsx      shared SVG wrapper (title + caption + KaTeX)
    ExportToolbar.tsx    SVG / PNG@DPI download controls
  lib/
    colormaps.ts         perceptually uniform palettes only
    latex.ts             KaTeX wrapper, $inline$ + $$display$$ parser
    export.ts            SVG serialisation + DPI-aware PNG raster
    figure.ts            shared theme tokens, margins, sizing helpers
    random.ts            seeded mulberry32 + box-muller for demo data
  pages/
    Overview.tsx         landing page listing categories
    ChartPage.tsx        renders the registered chart for /:id
```

---

## Authoring a new chart

Each chart is a self-contained module that registers itself once at
import time. The skeleton:

```tsx
// src/charts/my-figure/index.tsx
import { useRef } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ExportToolbar } from '../../components/ExportToolbar';
import { registerChart } from '../../registry';

function MyFigure() {
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <div className="space-y-3">
      <ExportToolbar getSvg={() => svgRef.current} baseFilename="my-figure" />
      <FigureFrame
        ref={svgRef}
        width={720}
        height={480}
        title="$\\alpha$-attention map"
        caption="Synthetic demo data, seed=7."
      >
        {/* … D3 / Three.js content … */}
      </FigureFrame>
    </div>
  );
}

registerChart({
  id: 'my-figure',
  title: 'My Figure',
  titleZh: '我的图',
  category: 'architecture',
  summary: 'One-sentence description of what this figure visualises.',
  component: MyFigure,
});
```

Then add `import './my-figure';` to `src/charts/index.ts` so the
registration runs at startup.

### Authoring rules

1. **Vector first.** Use `<svg>` for 2D. Reach for Canvas / WebGL only
   when point counts exceed ~10⁵ — and even then, expose an SVG export
   path that emits genuine `<circle>` / `<path>` elements.
2. **Ramps must be perceptually uniform.** Pick from `lib/colormaps.ts`.
   Jet / rainbow are intentionally excluded.
3. **Use `FigureFrame`** for titles and captions. Inline LaTeX (`$…$`)
   and display LaTeX (`$$…$$`) render automatically through KaTeX.
4. **Reproducible data.** All demo datasets must come from
   `mulberry32(seed)` so screenshots compare cleanly.
5. **Margins.** Use `DEFAULT_MARGINS` and `innerSize()` from
   `lib/figure.ts` so figures align across the studio.

---

## Running locally

```bash
nvm use 22.13           # node 22.13+ required by ESLint 10
npm install
npm run dev             # http://localhost:5173
npm run build           # tsc -b && vite build
npm run lint
npm test                # vitest run (pure-function unit tests)
```

---

## Slot persistence & auto-save

The larger architecture-style charts (`architecture-overall`,
`gat-cmc-overall`, `eeg-encoder-detail`, `fnirs-encoder-detail`,
`heterogeneous-graph-construction`) ship a **named-slot config manager**
plus a generic, opinionated **5-minute auto-save** loop:

- Configs are stored as `Record<slotName, ConfigT>` in `localStorage`
  under `<chart-id>-saved-configs-v1`. A companion `:meta` record
  tracks per-slot timestamps.
- Every 5 min the chart compares its current config against the last
  persisted snapshot. If different, a new slot named
  `auto-#<n> (YYYY-MM-DD HH:MM)` is appended and timestamped.
- On mount, the chart auto-loads the most recently saved slot (auto
  or manual). Manual slots are never auto-deleted.
- An LRU keeps at most **20 auto slots** per chart (configurable via
  the `maxAutoSlots` option) so localStorage cannot grow unbounded.

The hook lives at <ref_file file="src/lib/useAutoSave.ts" /> and has
focused unit tests at <ref_file file="src/lib/useAutoSave.test.ts" />.

---

## Data ingestion

Charts default to seeded synthetic data so the studio is useful with
zero setup. The **EEG–fNIRS Co-registration Topomap** also accepts
real recordings: drop the files into the *Data ingestion* panel in
its sidebar and the scalp field is rebuilt from the loaded channels.

Supported now:

- **EDF / EDF+** — full header + signal-record decoding to
  `Float32Array` channels (16-bit little-endian samples → physical
  units via the standard digital→physical linear transform).
  Annotation pseudo-channels (`EDF Annotations`) are filtered from
  the numeric list. Parser is zero-dependency and runs in a Web
  Worker. **BDF (24-bit)** is *not* yet supported — it shares the
  EDF-style header but uses 3-byte samples; a follow-up will add
  it without sharing this code path.
- **BIDS sidecars** — `*_channels.tsv`, `*_electrodes.tsv`,
  `*_eeg.json` / `*_nirs.json` are parsed alongside the EDF when
  dropped together. Sidecar fields are exposed via the
  `useDataset()` hook for opt-in charts.

Channel-to-electrode mapping in the topomap is by name match against
the standard 10-20 layout (case-insensitive). Channels that don't
match a 10-20 site are ignored; the *Loaded data* group of the
Expert tree shows the matched count.

Not yet supported (tracked as Phase 2 follow-ups):

- **SNIRF** — HDF5 container; needs `h5wasm` (~2 MB runtime).
- **EDF streaming** — files >50 MB still load fully into memory.

## Chart catalogue (v2)

All figures ship with a seeded synthetic data generator, a Simple
inspector (3–5 high-impact controls), an Expert parameter tree (full
controllable surface, collapsible), and an Inspiration panel (curated
variant tiles that re-bind several Expert parameters in one click —
e.g. *Rare-disease screening* on ROC/PR or *Sparse network* on
HeGAT-Map). Architecture-style figures additionally support
direct-drag panel layout, per-edge waypoint dragging, free-text LaTeX
annotations, named-slot save/load, JSON import/export, and 5-minute
auto-save (see *Slot persistence & auto-save*).

### Architecture (9)

1. **GAT-CMC-Net · 异质图融合癫痫检测** — Fig 1 of the paper. 9-panel
   end-to-end view of the EEG/fNIRS pipeline with embedded vis blocks
   for adjacency, lollipops, HRF kernel, gating bars, and event-level
   output. Walkthrough: <ref_file file="docs/charts/gat-cmc-overall.md" />.
2. **GAT-CMC-Net · Overall Architecture** — top-level Fig 2 / arch
   diagram with directly-draggable panels and per-edge waypoint
   handles.
3. **EEG Encoder · Dual-Stream (1D Temporal + 2D Spectral)** — module
   detail for the EEG branch.
4. **fNIRS Encoder · Cross-Channel HbO/HbR** — module detail for the
   fNIRS branch.
5. **Heterogeneous Graph Construction · Dual Node Types + Three Edge
   Categories** — Fig 4 visual derivation: 9 EEG + 7 fNIRS nodes,
   intra-EEG / intra-fNIRS / cross-modal edge layers with per-channel
   $\tau_j$ HRF-shift labels. Walkthrough:
   <ref_file file="docs/charts/heterogeneous-graph-construction.md" />.
6. **Heterogeneous Graph Attention Map (HeGAT-Map)** — force-directed
   bipartite graph between EEG electrodes and fNIRS channels with
   attention-weighted edges.
7. **Bimodal Feature Fusion Flowchart** — layered DAG of the EEG/fNIRS
   fusion network with per-edge tensor-shape annotations.
8. **Spatiotemporal CNN Architecture** — cabinet-projection cube
   sequence visualising `T × C × F` evolution through dilated TCN
   blocks.
9. **Cross-modal Attention Heatmap (EEG → fNIRS)** — Fig 15. Dense
   $\alpha^{E\to F} \in [0, 1]^{19 \times 20}$ matrix produced by the
   cross-modal attention head, with anatomical region brackets
   (frontal / central-temporal / parieto-occipital) and an optional
   diagonal trace highlighting the spatial prior.

### Physiology (3)

9. **EEG–fNIRS Co-registration Topomap** — 10-20 azimuthal scalp map
   with fNIRS optodes and Banana-shape source–detector photon paths.
10. **Neurovascular Coupling Alignment** — dual-axis EEG / HbO–HbR
    time series with seizure-stage highlight bands.
11. **3.5D Cortical Projection** — procedural brain mesh rendered as
    depth-sorted SVG triangles with per-vertex activation colouring.

### Clinical (3)

12. **Cross-modal Lead–Lag Correlation Matrix** — EEG↔fNIRS lag matrix
    with p-value significance stars.
13. **Seizure Focus Localisation** — d3-contour over a 2D importance
    grid clipped to the head disc, with anatomical landmarks.
14. **Dynamic Connectivity Chord** — time-sliceable chord diagram of a
    `T × N × N` attention tensor.

### Evaluation (9)

15. **ROC + PR curves** — multi-classifier overlay with AUC, AP, and
    bootstrap 95% confidence intervals.
16. **Confusion Matrix** — per-class predictions with row-normalisation
    toggle and contrast-aware annotations.
17. **Calibration Curve** — reliability diagram with Expected
    Calibration Error per model, marker size encoding bin count.
18. **Ablation Contribution Funnel** — trapezoidal funnel showing
    per-component accuracy delta.
19. **Feature Manifold (t-SNE / UMAP)** — class-coloured embedding
    scatter with covariance-derived 95% confidence ellipses.
20. **Window-length Robustness** — Fig 16. Dual-panel line chart
    (Event SE / detection latency) over 5–60 s windows; 4 methods,
    GAT-CMC-Net highlighted with an accent stroke and a Δ annotation
    at the 10 s lift.
21. **Multi-method Qualitative Radar** — Fig 17. 7-axis radar (HRF lag,
    cross-modal, graph operator, interpretability, event-level,
    LOSO patient-independence, seizure task fit) across 6 methods;
    baselines dashed, GAT-CMC-Net filled.
22. **Ablation Bars (LOSO)** — Fig 18. Two grouped-bar panels: Event
    SE on CHB-MIT vs. TUSZ and FA/h on CHB-MIT for the Full model + 5
    structural ablations (A1–A5).
23. **Baseline Comparison Bars** — Fig 19. Three stacked panels
    (Event SE↑ / FA/h↓ / Latency↓) across 9 baselines + GAT-CMC-Net,
    with optional error bars and an `Ours` reference line per panel.

---

## Per-chart documentation

Module-by-module walkthroughs (math, clinical context, panel-by-panel
notes) live under `docs/charts/`:

- <ref_file file="docs/charts/gat-cmc-overall.md" /> — full GAT-CMC-Net
  pipeline.
- <ref_file file="docs/charts/heterogeneous-graph-construction.md" /> —
  heterogeneous graph $G = (V, E)$ construction, three edge categories,
  per-channel HRF soft-shift $\tau_j$.

---

## Roadmap

- **Phase 1 — MVP.** All 14 generic figures (ROC/PR, calibration,
  topomap, …) with seeded synthetic data; SVG-first vector pipeline;
  DPI-configurable PNG export; KaTeX titles + captions; Simple
  inspector per chart.
- **Phase 2 — Alpha.** MathJax SVG output for true vector formulas;
  Expert mode parameter tree; Inspiration variant tiles; EDF + BIDS
  sidecar ingestion (Web Worker) wired to the topomap. SNIRF (HDF5)
  parsing is the last remaining Phase 2 item; tracked as a follow-up
  because it requires a 2 MB+ WASM runtime.
- **Phase 3 — Paper figures (current).** Architecture-class charts
  for the GAT-CMC-Net paper (`gat-cmc-overall`, `architecture-overall`,
  `eeg-encoder-detail`, `fnirs-encoder-detail`,
  `heterogeneous-graph-construction`) with direct-drag panel layout,
  per-edge waypoint editing, named-slot save/load + 5-minute
  auto-save (see *Slot persistence & auto-save*), and per-figure
  walkthroughs under `docs/charts/`.
- **Phase 4 — Beta.** Project workspace + snapshots + IndexedDB
  cache; batch export and quality-check engine; live KaTeX editor.
- **Phase 5 — v1.0.** Tauri-packaged desktop builds for Windows /
  macOS, memory-stable large-tensor ingestion, public render-jobs
  API, team-version (auth / audit / RLS).

---

## License

TBD. Treat as proprietary until a license file is committed.
