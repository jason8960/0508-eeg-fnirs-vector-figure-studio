/**
 * Python emitter for the `data-pyramid` chart. Captures the live
 * trapezoid geometry, layer titles / bodies, and side-annotations
 * and emits a matplotlib script that re-draws the schematic with
 * `Polygon` patches for the trapezoids and `ax.text` / `ax.annotate`
 * for the labels.
 */
import {
  renderArchPrimitives,
  type ArchPrimitive,
} from '../../lib/architecturePython';

export interface DataPyramidLayerPython {
  title: string;
  body: string;
  fill: string;
  stroke: string;
  rightAnnotation: string;
  showAnnotation: boolean;
  /** Geometry of the trapezoid (already laid out). */
  topY: number;
  botY: number;
  midY: number;
  xLeftTop: number;
  xRightTop: number;
  xLeftBot: number;
  xRightBot: number;
}

export interface DataPyramidPythonInput {
  title: string;
  caption: string;
  width: number;
  height: number;
  cx: number;
  layers: ReadonlyArray<DataPyramidLayerPython>;
  showAnnotations: boolean;
  annotationX: number;
  annotationFontSize: number;
  layerTitleSize: number;
  layerBodySize: number;
  showNote: boolean;
  noteText: string;
  noteX: number;
  noteY: number;
  noteAlign: 'left' | 'center' | 'right';
  noteFontSize: number;
}

/**
 * Strip a small subset of LaTeX commands (`\rm`, `\hat`, `\rho`, etc.)
 * so the body strings render as plain Unicode text in matplotlib
 * without requiring the `usetex` rendering pipeline.
 */
function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\tau/g, 'τ')
    .replace(/\\hat\{([^}]+)\}/g, '$1\u0302')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\rm\s*/g, '')
    .replace(/\\to/g, '→')
    .replace(/\\in/g, '∈')
    .replace(/\\{0,1\\}/g, '{0,1}')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/[{}]/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\/g, '');
}

export function emitDataPyramidPython(input: DataPyramidPythonInput): string {
  const {
    title,
    caption,
    width,
    height,
    cx,
    layers,
    showAnnotations,
    annotationX,
    annotationFontSize,
    layerTitleSize,
    layerBodySize,
    showNote,
    noteText,
    noteX,
    noteY,
    noteAlign,
    noteFontSize,
  } = input;
  const primitives: ArchPrimitive[] = [];

  // Trapezoids + per-layer text + sample badge.
  layers.forEach((l, i) => {
    primitives.push({
      kind: 'polygon',
      points: [
        [l.xLeftTop, l.topY],
        [l.xRightTop, l.topY],
        [l.xRightBot, l.botY],
        [l.xLeftBot, l.botY],
      ],
      fill: l.fill,
      stroke: l.stroke,
      strokeWidth: 1.4,
    });
    primitives.push({
      kind: 'text',
      x: cx,
      y: l.midY - 12,
      text: deLatex(l.title),
      fontSize: layerTitleSize,
      fontWeight: 600,
      color: '#ffffff',
      ha: 'center',
      va: 'middle',
    });
    primitives.push({
      kind: 'text',
      x: cx,
      y: l.midY + 8,
      text: deLatex(l.body),
      fontSize: layerBodySize,
      color: '#ffffff',
      ha: 'center',
      va: 'middle',
    });

    // Flow arrow to next layer.
    if (i < layers.length - 1) {
      primitives.push({
        kind: 'line',
        x1: cx,
        y1: l.botY + 2,
        x2: cx,
        y2: layers[i + 1].topY - 6,
        stroke: '#444',
        strokeWidth: 1.4,
        arrowEnd: true,
      });
    }

    // Right-side annotation.
    if (showAnnotations && l.showAnnotation) {
      const xRight = Math.max(l.xRightTop, l.xRightBot) + 6;
      primitives.push({
        kind: 'line',
        x1: xRight,
        y1: l.midY,
        x2: annotationX - 6,
        y2: l.midY,
        stroke: '#666',
        strokeWidth: 1.2,
      });
      primitives.push({
        kind: 'text',
        x: annotationX,
        y: l.midY,
        text: deLatex(l.rightAnnotation),
        fontSize: annotationFontSize,
        color: '#0d1117',
        ha: 'left',
        va: 'middle',
      });
    }
  });

  // Bottom note.
  if (showNote && noteText) {
    primitives.push({
      kind: 'text',
      x: noteX,
      y: noteY,
      text: noteText,
      fontSize: noteFontSize,
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
      '4-layer evidence pyramid: raw multimodal data → predictions → fusion sanity-check → closed-loop interpretability.',
  });
}
