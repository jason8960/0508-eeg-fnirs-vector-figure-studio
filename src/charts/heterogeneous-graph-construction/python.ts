/**
 * Python emitter for the `heterogeneous-graph-construction` chart.
 * Captures node positions, edge connectivity (with per-kind styles
 * and quadratic-Bezier curvature), banners, and the right-column
 * panels, and reproduces them as a self-contained matplotlib script.
 */
import { pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface HetGraphNodePython {
  id: string;
  label: string;
  modality: 'eeg' | 'fnirs';
  x: number;
  y: number;
  hidden: boolean;
}

export interface HetGraphEdgePython {
  fromId: string;
  toId: string;
  kind: 'ee' | 'ff' | 'cross';
  color: string;
  width: number;
  alpha: number;
  dashed: boolean;
  curve: number;
}

export interface HetGraphPanelPython {
  title: string;
  fill: string;
  edge: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Plain-text body lines (already de-LaTeX'd by caller). */
  lines: ReadonlyArray<string>;
}

export interface HetGraphPythonInput {
  width: number;
  height: number;
  nodeR: number;
  title: string;
  subtitle: string;
  showSubtitle: boolean;
  hrfTag: string;
  showHrfTag: boolean;
  veBanner: string;
  showVeBanner: boolean;
  vfBanner: string;
  showVfBanner: boolean;
  showLegendDivider: boolean;
  nodes: ReadonlyArray<HetGraphNodePython>;
  edges: ReadonlyArray<HetGraphEdgePython>;
  panels: ReadonlyArray<HetGraphPanelPython>;
  colors: {
    eegFill: string;
    eegEdge: string;
    fnirsFill: string;
    fnirsEdge: string;
    veBanner: string;
    vfBanner: string;
    dim: string;
  };
  arcCy: number;
  arcRx: number;
  arcRy: number;
  fnirsY: number;
  graphX0: number;
  graphX1: number;
}

function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\mathbf\s*\{([^}]+)\}/g, '$1')
    .replace(/\\Vert/g, '‖')
    .replace(/\\rightarrow/g, '→')
    .replace(/\\tau/g, 'τ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\ell/g, 'ℓ')
    .replace(/\\top/g, '⊤')
    .replace(/\\;|\\,/g, ' ')
    .replace(/_\{([^}]+)\}/g, '$1')
    .replace(/\^\{([^}]+)\}/g, '^$1')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\n')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitHetGraphPython(input: HetGraphPythonInput): string {
  const {
    width,
    height,
    nodeR,
    title,
    subtitle,
    showSubtitle,
    hrfTag,
    showHrfTag,
    veBanner,
    showVeBanner,
    vfBanner,
    showVfBanner,
    showLegendDivider,
    nodes,
    edges,
    panels,
    colors,
    arcCy,
    arcRy,
    fnirsY,
    graphX0,
    graphX1,
  } = input;
  void input.arcRx;

  const nodesPy = nodes
    .map(
      (n) =>
        `    {"id": ${pyStr(n.id)}, "label": ${pyStr(deLatex(n.label))}, "modality": ${pyStr(n.modality)}, "x": ${pyNum(n.x)}, "y": ${pyNum(n.y)}, "hidden": ${n.hidden ? 'True' : 'False'}},`,
    )
    .join('\n');

  const edgesPy = edges
    .map(
      (e) =>
        `    {"from": ${pyStr(e.fromId)}, "to": ${pyStr(e.toId)}, "kind": ${pyStr(e.kind)}, "color": ${pyStr(e.color)}, "width": ${pyNum(e.width)}, "alpha": ${pyNum(e.alpha)}, "dashed": ${e.dashed ? 'True' : 'False'}, "curve": ${pyNum(e.curve)}},`,
    )
    .join('\n');

  const panelsPy = panels
    .map((p) => {
      const linesEntries = p.lines.map((l) => `        ${pyStr(l)},`).join('\n');
      return `    {
        "title": ${pyStr(p.title)},
        "fill": ${pyStr(p.fill)},
        "edge": ${pyStr(p.edge)},
        "x": ${pyNum(p.x)},
        "y": ${pyNum(p.y)},
        "w": ${pyNum(p.w)},
        "h": ${pyNum(p.h)},
        "lines": [
${linesEntries}
        ],
    },`;
    })
    .join('\n');

  return `${pythonHeader({
    title,
    caption: deLatex(subtitle),
    description:
      'Heterogeneous-graph schematic: dual node types (EEG arc + fNIRS row) and three edge categories (intra-EEG, intra-fNIRS, cross-modal).',
  })}from matplotlib.patches import Circle, FancyBboxPatch, FancyArrowPatch
from matplotlib.path import Path
import matplotlib.patches as patches

W = ${pyNum(width)}
H = ${pyNum(height)}
NODE_R = ${pyNum(nodeR)}

NODES = [
${nodesPy}
]
EDGES = [
${edgesPy}
]
PANELS = [
${panelsPy}
]

COL_EEG_FILL = ${pyStr(colors.eegFill)}
COL_EEG_EDGE = ${pyStr(colors.eegEdge)}
COL_FNIRS_FILL = ${pyStr(colors.fnirsFill)}
COL_FNIRS_EDGE = ${pyStr(colors.fnirsEdge)}
COL_VE = ${pyStr(colors.veBanner)}
COL_VF = ${pyStr(colors.vfBanner)}
COL_DIM = ${pyStr(colors.dim)}

TITLE = ${pyStr(deLatex(title))}
SUBTITLE = ${pyStr(deLatex(subtitle))}
SHOW_SUBTITLE = ${showSubtitle ? 'True' : 'False'}
HRF_TAG = ${pyStr(deLatex(hrfTag))}
SHOW_HRF = ${showHrfTag ? 'True' : 'False'}
VE_BANNER = ${pyStr(deLatex(veBanner))}
SHOW_VE = ${showVeBanner ? 'True' : 'False'}
VF_BANNER = ${pyStr(deLatex(vfBanner))}
SHOW_VF = ${showVfBanner ? 'True' : 'False'}
SHOW_DIVIDER = ${showLegendDivider ? 'True' : 'False'}


def draw_edge(ax, n_from, n_to, edge):
    dx = n_to["x"] - n_from["x"]
    dy = n_to["y"] - n_from["y"]
    length = (dx * dx + dy * dy) ** 0.5 or 1.0
    nx = -dy / length
    ny = dx / length
    offset = edge["curve"] * length * 0.35
    mx = (n_from["x"] + n_to["x"]) / 2.0 + nx * offset
    my = (n_from["y"] + n_to["y"]) / 2.0 + ny * offset
    trim = NODE_R - 1
    sx = n_from["x"] + (dx / length) * trim
    sy = n_from["y"] + (dy / length) * trim
    ex = n_to["x"] - (dx / length) * trim
    ey = n_to["y"] - (dy / length) * trim
    verts = [(sx, sy), (mx, my), (ex, ey)]
    codes = [Path.MOVETO, Path.CURVE3, Path.CURVE3]
    ax.add_patch(
        patches.PathPatch(
            Path(verts, codes),
            edgecolor=edge["color"],
            linewidth=edge["width"],
            alpha=edge["alpha"],
            linestyle="--" if edge["dashed"] else "-",
            fill=False,
            capstyle="round",
        )
    )


def render() -> None:
    fig, ax = plt.subplots(figsize=(13, 7.3), constrained_layout=True)
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)  # SVG y-down
    ax.set_aspect("equal")
    ax.axis("off")

    # Title
    ax.text(W / 2, 36, TITLE, ha="center", va="center", fontsize=15, fontweight="bold")
    if SHOW_SUBTITLE:
        ax.text(W / 2, 76, SUBTITLE, ha="center", va="center", fontsize=11, color="#444")
    if SHOW_DIVIDER:
        ax.plot([60, W - 60], [102, 102], color="#cccccc", linewidth=1)

    # V^E / V^F banners
    if SHOW_VE:
        ax.text(${pyNum((graphX0 + graphX1) / 2)}, ${pyNum(arcCy - arcRy - 30)},
                VE_BANNER, ha="center", va="center", fontsize=10, color=COL_VE)
    if SHOW_VF:
        ax.text(${pyNum((graphX0 + graphX1) / 2)}, ${pyNum(fnirsY + 60)},
                VF_BANNER, ha="center", va="center", fontsize=10, color=COL_VF)
    if SHOW_HRF:
        ax.text(${pyNum((graphX0 + graphX1) / 2)}, ${pyNum((arcCy + fnirsY) / 2)},
                HRF_TAG, ha="center", va="center", fontsize=10, color=COL_DIM,
                style="italic")

    node_lookup = {n["id"]: n for n in NODES if not n["hidden"]}

    # Edges first so they sit beneath nodes.
    for e in EDGES:
        n_from = node_lookup.get(e["from"])
        n_to = node_lookup.get(e["to"])
        if n_from is None or n_to is None:
            continue
        draw_edge(ax, n_from, n_to, e)

    # Nodes
    for n in NODES:
        if n["hidden"]:
            continue
        if n["modality"] == "eeg":
            face = COL_EEG_FILL
            edge = COL_EEG_EDGE
        else:
            face = COL_FNIRS_FILL
            edge = COL_FNIRS_EDGE
        ax.add_patch(Circle((n["x"], n["y"]), NODE_R,
                            facecolor=face, edgecolor=edge, linewidth=1.6))
        ax.text(n["x"], n["y"], n["label"], ha="center", va="center",
                fontsize=10, color=edge, fontweight="bold")

    # Right-side info panels
    for p in PANELS:
        ax.add_patch(FancyBboxPatch(
            (p["x"], p["y"]), p["w"], p["h"],
            boxstyle="round,pad=4,rounding_size=8",
            facecolor=p["fill"], edgecolor=p["edge"], linewidth=1.0,
        ))
        ax.text(p["x"] + 12, p["y"] + 24, p["title"], fontsize=12,
                fontweight="bold", color=p["edge"])
        cy = p["y"] + 50
        for line in p["lines"]:
            ax.text(p["x"] + 16, cy, line, fontsize=10, color="#1c1c1c")
            cy += 22

    plt.show()


if __name__ == "__main__":
    render()
`;
}
