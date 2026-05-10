/**
 * Python emitter for the `gat-attention` chart. Captures the live
 * star-graph layout (centre node + N neighbours), softmax weights αᵢⱼ
 * and per-edge stroke colours/widths, and emits a matplotlib script
 * that re-draws the schematic with `Circle` patches and weighted lines.
 */
import {
  renderArchPrimitives,
  type ArchPrimitive,
} from '../../lib/architecturePython';

export interface GatNeighbourPython {
  id: string;
  label: string;
  x: number;
  y: number;
  fill: string;
  alpha: number;
  /** Stroke colour bucket. */
  strokeColor: string;
  /** Stroke width in px (already scaled). */
  strokeWidth: number;
  kind: string;
}

export interface GatAttentionPythonInput {
  title: string;
  caption: string;
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  centreLabel: string;
  centreFill: string;
  neighbours: ReadonlyArray<GatNeighbourPython>;
  showAlphaLabels: boolean;
  showFormula: boolean;
  formula: string;
  formulaTitle: string;
  formulaX: number;
  formulaY: number;
  formulaSize: number;
  showLegend: boolean;
  legendX: number;
  legendY: number;
  legendSize: number;
  noteText: string;
  showNote: boolean;
  noteX: number;
  noteY: number;
  noteAlign: 'left' | 'center' | 'right';
  noteSize: number;
  nodeLabelSize: number;
  edgeLabelSize: number;
}

function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\alpha/g, 'α')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\tau/g, 'τ')
    .replace(/\\Vert/g, '‖')
    .replace(/\\top/g, 'ᵀ')
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\mathbf\{([^}]+)\}/g, '$1')
    .replace(/\\mathcal\{([^}]+)\}/g, '$1')
    .replace(/\\dfrac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\bigl/g, '')
    .replace(/\\bigr/g, '')
    .replace(/\\exp/g, 'exp')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\to/g, '→')
    .replace(/\\in/g, '∈')
    .replace(/_\{([^}]+)\}/g, '$1')
    .replace(/\^\{([^}]+)\}/g, '^$1')
    .replace(/[{}]/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitGatAttentionPython(input: GatAttentionPythonInput): string {
  const {
    title,
    caption,
    width,
    height,
    centreX,
    centreY,
    centreLabel,
    centreFill,
    neighbours,
    showAlphaLabels,
    showFormula,
    formula,
    formulaTitle,
    formulaX,
    formulaY,
    formulaSize,
    showLegend,
    legendX,
    legendY,
    legendSize,
    noteText,
    showNote,
    noteX,
    noteY,
    noteAlign,
    noteSize,
    nodeLabelSize,
    edgeLabelSize,
  } = input;

  const primitives: ArchPrimitive[] = [];

  // Edges from each neighbour to the centre, drawn first so nodes overlap
  // them.
  neighbours.forEach((n) => {
    primitives.push({
      kind: 'line',
      x1: n.x,
      y1: n.y,
      x2: centreX,
      y2: centreY,
      stroke: n.strokeColor,
      strokeWidth: n.strokeWidth,
    });
    if (showAlphaLabels) {
      const lx = n.x + (centreX - n.x) * 0.5;
      const ly = n.y + (centreY - n.y) * 0.5 - 8;
      primitives.push({
        kind: 'text',
        x: lx,
        y: ly,
        text: `α=${n.alpha.toFixed(2)}`,
        fontSize: edgeLabelSize,
        color: n.strokeColor,
        ha: 'center',
        va: 'middle',
        italic: true,
      });
    }
  });

  // Centre node.
  primitives.push({
    kind: 'circle',
    cx: centreX,
    cy: centreY,
    r: 30,
    fill: centreFill,
    stroke: '#0d1117',
    strokeWidth: 1.4,
  });
  primitives.push({
    kind: 'text',
    x: centreX,
    y: centreY,
    text: deLatex(centreLabel),
    fontSize: nodeLabelSize,
    fontWeight: 600,
    color: '#ffffff',
    ha: 'center',
    va: 'middle',
  });

  // Neighbour nodes.
  neighbours.forEach((n) => {
    primitives.push({
      kind: 'circle',
      cx: n.x,
      cy: n.y,
      r: 24,
      fill: n.fill,
      stroke: '#0d1117',
      strokeWidth: 1.4,
    });
    primitives.push({
      kind: 'text',
      x: n.x,
      y: n.y,
      text: deLatex(n.label),
      fontSize: nodeLabelSize - 1,
      fontWeight: 600,
      color: '#ffffff',
      ha: 'center',
      va: 'middle',
    });
  });

  if (showFormula) {
    primitives.push({
      kind: 'text',
      x: formulaX,
      y: formulaY,
      text: formulaTitle,
      fontSize: formulaSize,
      fontWeight: 600,
      color: '#0d1117',
      ha: 'left',
      va: 'top',
    });
    primitives.push({
      kind: 'text',
      x: formulaX,
      y: formulaY + 22,
      text: deLatex(formula),
      fontSize: formulaSize - 1,
      color: '#0d1117',
      ha: 'left',
      va: 'top',
      italic: true,
    });
  }

  if (showLegend) {
    primitives.push({
      kind: 'text',
      x: legendX,
      y: legendY,
      text: 'EEG (蓝)  ·  fNIRS (红)  ·  hetero (紫/绿)',
      fontSize: legendSize,
      color: '#334155',
      ha: 'left',
      va: 'top',
    });
  }

  if (showNote && noteText) {
    primitives.push({
      kind: 'text',
      x: noteX,
      y: noteY,
      text: noteText,
      fontSize: noteSize,
      color: '#334155',
      ha: noteAlign === 'right' ? 'right' : noteAlign === 'center' ? 'center' : 'left',
      va: 'top',
    });
  }

  return renderArchPrimitives({
    title,
    caption,
    width,
    height,
    primitives,
    description:
      'GAT attention coefficients α_ij visualised as edge thickness/colour around a heterogeneous centre node.',
  });
}
