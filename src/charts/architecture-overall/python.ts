/**
 * Python emitter for the `architecture-overall` chart. Captures the
 * resolved panel + edge + annotation geometry from the rendered SVG
 * and reproduces it as a self-contained matplotlib script using
 * FancyBboxPatch boxes + FancyArrowPatch connectors.
 */
import { pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export type ArchAnchor = 'right' | 'left' | 'top' | 'bottom' | 'center';
export type ArchEdgeStyle = 'solid' | 'dashed' | 'dotted';
export type ArchAlign = 'left' | 'center' | 'right';

export interface ArchOverallPanelPython {
  id: string;
  category: string;
  fill: string;
  edge: string;
  textColor: string;
  x: number;
  y: number;
  w: number;
  h: number;
  header: string;
  body: ReadonlyArray<string>;
  headerSize: number;
  bodySize: number;
  headerAlign: ArchAlign;
  bodyAlign: ArchAlign;
}

export interface ArchOverallEdgePython {
  id: string;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  fromAnchor: ArchAnchor;
  toAnchor: ArchAnchor;
  color: string;
  width: number;
  style: ArchEdgeStyle;
  label: string;
  labelX: number;
  labelY: number;
}

export interface ArchOverallAnnotationPython {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  align: ArchAlign;
  bold: boolean;
  italic: boolean;
}

export interface ArchOverallLegendItemPython {
  category: string;
  edge: string;
  fill: string;
  label: string;
}

export interface ArchOverallPythonInput {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  showSubtitle: boolean;
  showLegend: boolean;
  legendY: number;
  legendItems: ReadonlyArray<ArchOverallLegendItemPython>;
  panels: ReadonlyArray<ArchOverallPanelPython>;
  edges: ReadonlyArray<ArchOverallEdgePython>;
  annotations: ReadonlyArray<ArchOverallAnnotationPython>;
}

export function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\mathbf\s*\{([^}]+)\}/g, '$1')
    .replace(/\\mathbb\s*\{([^}]+)\}/g, '$1')
    .replace(/\\mathrm\s*\{([^}]+)\}/g, '$1')
    .replace(/\\mathcal\s*\{([^}]+)\}/g, '$1')
    .replace(/\\tilde\s*\{([^}]+)\}/g, '$1̃')
    .replace(/\\hat\s*\{([^}]+)\}/g, '$1̂')
    .replace(/\\Vert/g, '‖')
    .replace(/\\rightarrow/g, '→')
    .replace(/\\oplus/g, '⊕')
    .replace(/\\odot/g, '⊙')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\tau/g, 'τ')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\delta/g, 'δ')
    .replace(/\\bigl/g, '')
    .replace(/\\bigr/g, '')
    .replace(/\\!/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/\\top/g, '⊤')
    .replace(/\\geq/g, '≥')
    .replace(/\\in/g, '∈')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\approx/g, '≈')
    .replace(/_\{([^}]+)\}/g, '_$1')
    .replace(/\^\{([^}]+)\}/g, '^$1')
    .replace(/[{}]/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitArchOverallPython(input: ArchOverallPythonInput): string {
  const {
    width,
    height,
    title,
    subtitle,
    showSubtitle,
    showLegend,
    legendY,
    legendItems,
    panels,
    edges,
    annotations,
  } = input;

  const panelsPy = panels
    .map((p) => {
      const headerPy = pyStr(deLatex(p.header));
      const bodyEntries = p.body
        .map((line) => `            ${pyStr(deLatex(line))},`)
        .join('\n');
      return `    {
        "id": ${pyStr(p.id)},
        "category": ${pyStr(p.category)},
        "fill": ${pyStr(p.fill)},
        "edge": ${pyStr(p.edge)},
        "text_color": ${pyStr(p.textColor)},
        "x": ${pyNum(p.x)},
        "y": ${pyNum(p.y)},
        "w": ${pyNum(p.w)},
        "h": ${pyNum(p.h)},
        "header": ${headerPy},
        "header_size": ${pyNum(p.headerSize)},
        "body_size": ${pyNum(p.bodySize)},
        "header_align": ${pyStr(p.headerAlign)},
        "body_align": ${pyStr(p.bodyAlign)},
        "body": [
${bodyEntries}
        ],
    },`;
    })
    .join('\n');

  const edgesPy = edges
    .map(
      (e) =>
        `    {"id": ${pyStr(e.id)}, "fx": ${pyNum(e.fx)}, "fy": ${pyNum(e.fy)}, "tx": ${pyNum(e.tx)}, "ty": ${pyNum(e.ty)}, "from_anchor": ${pyStr(e.fromAnchor)}, "to_anchor": ${pyStr(e.toAnchor)}, "color": ${pyStr(e.color)}, "width": ${pyNum(e.width)}, "style": ${pyStr(e.style)}, "label": ${pyStr(deLatex(e.label))}, "label_x": ${pyNum(e.labelX)}, "label_y": ${pyNum(e.labelY)}},`,
    )
    .join('\n');

  const annoPy = annotations
    .map(
      (a) =>
        `    {"text": ${pyStr(deLatex(a.text))}, "x": ${pyNum(a.x)}, "y": ${pyNum(a.y)}, "width": ${pyNum(a.width)}, "font_size": ${pyNum(a.fontSize)}, "color": ${pyStr(a.color)}, "align": ${pyStr(a.align)}, "bold": ${a.bold ? 'True' : 'False'}, "italic": ${a.italic ? 'True' : 'False'}},`,
    )
    .join('\n');

  const legendPy = legendItems
    .map(
      (l) =>
        `    {"category": ${pyStr(l.category)}, "fill": ${pyStr(l.fill)}, "edge": ${pyStr(l.edge)}, "label": ${pyStr(deLatex(l.label))}},`,
    )
    .join('\n');

  return `${pythonHeader({
    title,
    caption: deLatex(subtitle),
    description:
      'GAT-CMC-Net overall architecture: panels (encoder / graph / fusion / classifier) connected by category-coloured arrows; dashed/dotted styles encode auxiliary cross-modal couplings.',
  })}from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

W = ${pyNum(width)}
H = ${pyNum(height)}
TITLE = ${pyStr(deLatex(title))}
SUBTITLE = ${pyStr(deLatex(subtitle))}
SHOW_SUBTITLE = ${showSubtitle ? 'True' : 'False'}
SHOW_LEGEND = ${showLegend ? 'True' : 'False'}
LEGEND_Y = ${pyNum(legendY)}

PANELS = [
${panelsPy}
]

EDGES = [
${edgesPy}
]

ANNOTATIONS = [
${annoPy}
]

LEGEND = [
${legendPy}
]


def _ha(align: str) -> str:
    return {"left": "left", "center": "center", "right": "right"}.get(align, "center")


def _align_x(slot, align: str) -> float:
    if align == "left":
        return slot["x"] + 8
    if align == "right":
        return slot["x"] + slot["w"] - 8
    return slot["x"] + slot["w"] / 2.0


def _line_style(s: str):
    if s == "dashed":
        return (0, (6, 4))
    if s == "dotted":
        return (0, (2, 4))
    return "-"


def render() -> None:
    fig, ax = plt.subplots(figsize=(W / 72.0, H / 72.0), constrained_layout=True)
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.set_aspect("equal")
    ax.axis("off")

    ax.text(W / 2, 22, TITLE, ha="center", va="center",
            fontsize=15, fontweight="bold")
    if SHOW_SUBTITLE:
        ax.text(W / 2, H - 14, SUBTITLE, ha="center", va="center",
                fontsize=10, color="#444")

    # Edges drawn first so panels can overlap them visually.
    for e in EDGES:
        ls = _line_style(e["style"])
        ax.add_patch(FancyArrowPatch(
            (e["fx"], e["fy"]), (e["tx"], e["ty"]),
            arrowstyle="-|>", mutation_scale=12,
            linewidth=e["width"], color=e["color"], linestyle=ls,
        ))
        if e["label"]:
            ax.text(e["label_x"], e["label_y"], e["label"],
                    ha="center", va="center",
                    fontsize=8, color=e["color"], style="italic")

    # Panels
    for p in PANELS:
        ax.add_patch(FancyBboxPatch(
            (p["x"], p["y"]), p["w"], p["h"],
            boxstyle="round,pad=4,rounding_size=8",
            facecolor=p["fill"], edgecolor=p["edge"], linewidth=1.2,
        ))
        header_lines = p["header"].split("\\n")
        cy = p["y"] + 6 + p["header_size"]
        for h_line in header_lines:
            ax.text(_align_x(p, p["header_align"]), cy, h_line,
                    ha=_ha(p["header_align"]), va="bottom",
                    fontsize=p["header_size"], color=p["text_color"],
                    fontweight="bold")
            cy += p["header_size"] * 1.25
        cy += 4
        for line in p["body"]:
            if not line:
                cy += p["body_size"]
                continue
            ax.text(_align_x(p, p["body_align"]), cy, line,
                    ha=_ha(p["body_align"]), va="bottom",
                    fontsize=p["body_size"], color="#1c1c1c")
            cy += p["body_size"] * 1.5

    # Annotations
    for a in ANNOTATIONS:
        weight = "bold" if a["bold"] else "normal"
        style = "italic" if a["italic"] else "normal"
        ax.text(a["x"], a["y"], a["text"],
                ha=_ha(a["align"]), va="top",
                fontsize=a["font_size"], color=a["color"],
                fontweight=weight, fontstyle=style, wrap=True)

    # Legend
    if SHOW_LEGEND:
        x = 60
        for item in LEGEND:
            ax.add_patch(FancyBboxPatch(
                (x, LEGEND_Y), 18, 12,
                boxstyle="round,pad=1,rounding_size=2",
                facecolor=item["fill"], edgecolor=item["edge"], linewidth=1.0,
            ))
            ax.text(x + 24, LEGEND_Y + 6, item["label"],
                    fontsize=9, color=item["edge"], va="center")
            x += 24 + 8 * len(item["label"])

    plt.show()


if __name__ == "__main__":
    render()
`;
}
