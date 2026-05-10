/**
 * Python emitter for the `gating-fusion` chart. Captures the live
 * module rectangles + snapped arrow geometry and emits a matplotlib
 * script that re-draws the schematic.
 */
import {
  renderArchPrimitives,
  type ArchPrimitive,
} from '../../lib/architecturePython';

export interface GatingFusionModulePython {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  body: string;
  fill: string;
  stroke: string;
}

export interface GatingFusionArrowPython {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  labelX: number;
  labelY: number;
  label: string;
  stroke: string;
}

export interface GatingFusionPythonInput {
  title: string;
  caption: string;
  width: number;
  height: number;
  modules: ReadonlyArray<GatingFusionModulePython>;
  arrows: ReadonlyArray<GatingFusionArrowPython>;
  showLegend: boolean;
  legendText: string;
  legendX: number;
  legendY: number;
  legendAlign: 'left' | 'center' | 'right';
  legendSize: number;
  moduleTitleSize: number;
  moduleBodySize: number;
  arrowLabelSize: number;
}

function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\to/g, '→')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\tau/g, 'τ')
    .replace(/\\hat\{([^}]+)\}/g, '$1\u0302')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\cdot/g, '·')
    .replace(/\\,/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/\\rm\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitGatingFusionPython(input: GatingFusionPythonInput): string {
  const {
    title,
    caption,
    width,
    height,
    modules,
    arrows,
    showLegend,
    legendText,
    legendX,
    legendY,
    legendAlign,
    legendSize,
    moduleTitleSize,
    moduleBodySize,
    arrowLabelSize,
  } = input;

  const primitives: ArchPrimitive[] = [];

  modules.forEach((m) => {
    primitives.push({
      kind: 'rect',
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      fill: m.fill,
      stroke: m.stroke,
      strokeWidth: 1.6,
      rx: 8,
    });
    primitives.push({
      kind: 'text',
      x: m.x + m.w / 2,
      y: m.y + 18,
      text: m.title,
      fontSize: moduleTitleSize,
      fontWeight: 600,
      color: '#0d1117',
      ha: 'center',
      va: 'middle',
    });
    if (m.body) {
      primitives.push({
        kind: 'text',
        x: m.x + m.w / 2,
        y: m.y + m.h - 18,
        text: deLatex(m.body),
        fontSize: moduleBodySize,
        color: '#334155',
        ha: 'center',
        va: 'middle',
      });
    }
  });

  arrows.forEach((a) => {
    primitives.push({
      kind: 'line',
      x1: a.startX,
      y1: a.startY,
      x2: a.endX,
      y2: a.endY,
      stroke: a.stroke,
      strokeWidth: 1.6,
      arrowEnd: true,
    });
    if (a.label) {
      primitives.push({
        kind: 'text',
        x: a.labelX,
        y: a.labelY,
        text: deLatex(a.label),
        fontSize: arrowLabelSize,
        color: a.stroke,
        ha: 'center',
        va: 'middle',
        italic: true,
      });
    }
  });

  if (showLegend && legendText) {
    primitives.push({
      kind: 'text',
      x: legendX,
      y: legendY,
      text: deLatex(legendText),
      fontSize: legendSize,
      color: '#334155',
      ha: legendAlign === 'right' ? 'right' : legendAlign === 'center' ? 'center' : 'left',
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
      'Gating fusion module: g=1 ⇒ EEG-only, g=0 ⇒ fNIRS-only, mid-range ⇒ complementary fusion.',
  });
}
