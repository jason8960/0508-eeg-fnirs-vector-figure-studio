/**
 * Fig. 8  Gating fusion module (Eq. 22 in §3.6).
 *
 * Block diagram:
 *
 *     hᴱ ─┐                       ┌──── ŷ ∈ [0,1]
 *         ├─►  [hᴱ ∥ hᶠ]  ─►  g  ─►  hᶠᵘˢᵉ = g⊙hᴱ + (1-g)⊙hᶠ
 *     hᶠ ─┘
 *
 * Each block is a draggable module; the four arrows snap to the
 * source / target rectangles' nearest edge automatically (so the
 * waypoint geometry follows the modules without manual tweaking).
 *
 * Studio integration parity:
 *   - Each module's title / subtitle / KaTeX line is editable.
 *   - The bottom legend strip and the gate-status note are draggable.
 *   - A single live `g` slider drives the colour mix on the EEG /
 *     fNIRS arrows and on the gate-status note.
 *   - Manual + 5-minute auto slot persistence via `useAutoSave`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartShell } from '../../components/ChartShell';
import { FigureFrame } from '../../components/FigureFrame';
import {
  ControlGroup,
  NumberSlider,
  TextArea,
  Toggle,
} from '../../components/Controls';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';
import { type FormatStore, type TextFormatDefaults } from '../../lib/textFormat';
import { useTextFormat } from '../../lib/useTextFormat';
import { TextFormatPopover } from '../../components/TextFormatPopover';
import { EditableForeignText as ForeignText } from '../../components/EditableForeignText';

/* ----------------------------- types ---------------------------------- */

type Align = 'left' | 'center' | 'right';
type ModuleId =
  | 'eeg'
  | 'fnirs'
  | 'concat'
  | 'gate'
  | 'fuse'
  | 'head';

interface ModuleSpec {
  id: ModuleId;
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Box title (single line). */
  title: string;
  /** Two extra lines of body text (KaTeX). */
  body: string;
  /** Fill colour. */
  fill: string;
  /** Stroke colour. */
  stroke: string;
}

interface ArrowSpec {
  id: string;
  from: ModuleId;
  to: ModuleId;
  /** Display label (KaTeX). */
  label: string;
  /** Force-route the label to the midpoint by this offset. */
  labelDx?: number;
  labelDy?: number;
  /** Stroke override (otherwise inherits from ARROW_DEFAULT). */
  stroke?: string;
}

interface SavedConfig {
  version: 1;
  title: string;
  modules: Record<ModuleId, ModuleSpec>;
  arrows: ArrowSpec[];
  /** Live gate value g ∈ [0,1]; only affects the legend visualisation. */
  g: number;
  /** Override stroke colour for the EEG arrow. */
  eegStroke: string;
  /** Override stroke colour for the fNIRS arrow. */
  fnirsStroke: string;
  /** Background note. */
  legendText: string;
  legendAlign: Align;
  showLegend: boolean;
  legendPos: { x: number; y: number };
  /** Title / module / arrow / legend font sizes. */
  titleSize: number;
  moduleTitleSize: number;
  moduleBodySize: number;
  arrowLabelSize: number;
  legendSize: number;
  formats?: FormatStore;
  textOverrides?: TextOverrideMap;
}

/* ----------------------------- defaults ------------------------------- */

const DEFAULT_MODULES: Record<ModuleId, ModuleSpec> = {
  eeg: {
    id: 'eeg',
    x: 60,
    y: 120,
    w: 200,
    h: 100,
    title: 'EEG 分支',
    body: '$h^E$  (Eq. 22)\nshape = (B, $d_E$)',
    fill: '#E7F0FB',
    stroke: '#1F77B4',
  },
  fnirs: {
    id: 'fnirs',
    x: 60,
    y: 320,
    w: 200,
    h: 100,
    title: 'fNIRS 分支',
    body: '$h^F$  (Eq. 22)\nshape = (B, $d_F$)',
    fill: '#FBE5E5',
    stroke: '#D62728',
  },
  concat: {
    id: 'concat',
    x: 360,
    y: 220,
    w: 220,
    h: 110,
    title: '通道拼接',
    body: '$[h^E \\Vert h^F]$\nshape = (B, $d_E + d_F$)',
    fill: '#FFF7E0',
    stroke: '#A37C0E',
  },
  gate: {
    id: 'gate',
    x: 660,
    y: 220,
    w: 260,
    h: 110,
    title: '门控网络',
    body: '$g = \\sigma(W_g[h^E\\Vert h^F]+b_g)$\nshape = (B, $d$)',
    fill: '#E8F5E9',
    stroke: '#2CA02C',
  },
  fuse: {
    id: 'fuse',
    x: 1000,
    y: 220,
    w: 260,
    h: 110,
    title: '门控融合',
    body: '$h^{\\rm fuse} = g\\odot h^E + (1-g)\\odot h^F$\nshape = (B, $d$)',
    fill: '#F4ECF9',
    stroke: '#9467BD',
  },
  head: {
    id: 'head',
    x: 1000,
    y: 420,
    w: 260,
    h: 100,
    title: '分类头',
    body: '$\\hat{y}\\in[0,1]$',
    fill: '#FFFAE0',
    stroke: '#A37C0E',
  },
};

const DEFAULT_ARROWS: ArrowSpec[] = [
  { id: 'e-c', from: 'eeg', to: 'concat', label: '$h^E$', stroke: '#1F77B4' },
  { id: 'f-c', from: 'fnirs', to: 'concat', label: '$h^F$', stroke: '#D62728' },
  { id: 'c-g', from: 'concat', to: 'gate', label: '$[h^E\\Vert h^F]$' },
  { id: 'g-f', from: 'gate', to: 'fuse', label: '$g$' },
  { id: 'f-h', from: 'fuse', to: 'head', label: '$h^{\\rm fuse}$' },
];

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  title: 'Fig. 8  门控融合模块 (Eq. 22, §3.6)',
  modules: DEFAULT_MODULES,
  arrows: DEFAULT_ARROWS,
  g: 0.5,
  eegStroke: '#1F77B4',
  fnirsStroke: '#D62728',
  legendText:
    '$g\\to 1$：EEG 主导 · $g\\to 0$：fNIRS 主导 · 介于之间：互补融合',
  legendAlign: 'center',
  showLegend: true,
  legendPos: { x: 200, y: 580 },
  titleSize: 16,
  moduleTitleSize: 13,
  moduleBodySize: 11,
  arrowLabelSize: 11,
  legendSize: 12,
  formats: {},
};

/* ----------------------------- persistence ---------------------------- */

const STORAGE_KEY = 'gating-fusion-configs-v1';


/* ----------------------------- canvas ---------------------------- */

const W_FIG = 1320;
const H_FIG = 660;

/* ----------------------------- arrow snap helpers ---------------------------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snap line endpoint to the rectangle border closest to `target`. */
function snapToRect(
  rect: Rect,
  target: { x: number; y: number },
): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : (rect.w / 2) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : (rect.h / 2) / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function midOf(rect: Rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* ============================================================= */

function GatingFusionChart() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cfg, setCfg] = useState<SavedConfig>(() => DEFAULT_CONFIG);
  const {
    selected,
    handleSelectText,
    handleClearSelection,
    patchFormat: handlePatchFormat,
    resetElementFormat: handleResetElementFormat,
    resetAllFormats: handleResetAllFormats,
  } = useTextFormat<SavedConfig>(setCfg);

  const patch = useCallback((p: Partial<SavedConfig>) => {
    setCfg((prev) => ({ ...prev, ...p }));
  }, []);

  const patchModule = useCallback(
    (id: ModuleId, p: Partial<ModuleSpec>) => {
      setCfg((prev) => ({
        ...prev,
        modules: { ...prev.modules, [id]: { ...prev.modules[id], ...p } },
      }));
    },
    [],
  );

  /* ----------------------- config persistence ------------------------ */
  const buildBaseConfig = useCallback((): SavedConfig => cfg, [cfg]);
  const applyBaseConfig = useCallback((c: SavedConfig) => {
    if (!c || c.version !== 1) return;
    setCfg(c);
  }, []);
  const { renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'gating-fusion-config.json',
  });
  const textRefs = useMemo(() => [], []);

  /* ----------------------- arrow geometry ------------------------ */
  const arrowGeoms = useMemo(() => {
    return cfg.arrows.map((a) => {
      const src = cfg.modules[a.from];
      const dst = cfg.modules[a.to];
      const dstMid = midOf(dst);
      const srcMid = midOf(src);
      const start = snapToRect(src, dstMid);
      const end = snapToRect(dst, srcMid);
      // Bend slightly toward midpoint for visual lift.
      const mx = (start.x + end.x) / 2;
      const my = (start.y + end.y) / 2;
      return {
        id: a.id,
        d: `M ${start.x},${start.y} L ${end.x},${end.y}`,
        labelX: mx + (a.labelDx ?? 0),
        labelY: my + (a.labelDy ?? -10),
        stroke: a.stroke ?? '#444',
        label: a.label,
        endX: end.x,
        endY: end.y,
        dx: end.x - start.x,
        dy: end.y - start.y,
      };
    });
  }, [cfg.arrows, cfg.modules]);

  /* ----------------------- expert schema ------------------------ */
  const expertSchema: ExpertSchema = useMemo(
    () => [
      {
        label: '主标题',
        fields: [
          { type: 'text', key: 't', label: '主标题', value: cfg.title, multiline: true, onChange: (v) => patch({ title: v }) },
        ],
      },
      ...moduleOrder.map<ExpertSchema[number]>((id) => {
        const m = cfg.modules[id];
        return {
          label: `模块: ${MODULE_LABELS[id]}`,
          defaultOpen: false,
          fields: [
            { type: 'text', key: `${id}-t`, label: '标题', value: m.title, onChange: (v) => patchModule(id, { title: v }) },
            { type: 'text', key: `${id}-b`, label: '正文', value: m.body, multiline: true, rows: 3, onChange: (v) => patchModule(id, { body: v }) },
            { type: 'text', key: `${id}-fl`, label: '填充色', value: m.fill, onChange: (v) => patchModule(id, { fill: v }) },
            { type: 'text', key: `${id}-st`, label: '描边色', value: m.stroke, onChange: (v) => patchModule(id, { stroke: v }) },
            { type: 'number', key: `${id}-x`, label: 'X', min: 0, max: W_FIG, step: 1, value: m.x, onChange: (v) => patchModule(id, { x: v }) },
            { type: 'number', key: `${id}-y`, label: 'Y', min: 0, max: H_FIG, step: 1, value: m.y, onChange: (v) => patchModule(id, { y: v }) },
            { type: 'number', key: `${id}-w`, label: '宽', min: 80, max: 400, step: 1, value: m.w, onChange: (v) => patchModule(id, { w: v }) },
            { type: 'number', key: `${id}-h`, label: '高', min: 60, max: 240, step: 1, value: m.h, onChange: (v) => patchModule(id, { h: v }) },
          ],
        };
      }),
      {
        label: '门控值 / 边色',
        fields: [
          { type: 'number', key: 'g', label: '$g$', min: 0, max: 1, step: 0.01, value: cfg.g, onChange: (v) => patch({ g: v }), slider: true, format: (v) => v.toFixed(2) },
          { type: 'text', key: 'es', label: 'EEG 边色', value: cfg.eegStroke, onChange: (v) => patch({ eegStroke: v }) },
          { type: 'text', key: 'fs', label: 'fNIRS 边色', value: cfg.fnirsStroke, onChange: (v) => patch({ fnirsStroke: v }) },
        ],
      },
      {
        label: '底部图例',
        fields: [
          { type: 'toggle', key: 'sl', label: '显示底部图例', value: cfg.showLegend, onChange: (v) => patch({ showLegend: v }) },
          { type: 'text', key: 'lt', label: '图例文本 (KaTeX)', value: cfg.legendText, multiline: true, onChange: (v) => patch({ legendText: v }) },
          { type: 'select', key: 'la', label: '图例对齐', value: cfg.legendAlign, options: ALIGN_OPTIONS, onChange: (v) => patch({ legendAlign: v as Align }) },
        ],
      },
      {
        label: '字号',
        fields: [
          { type: 'number', key: 'ts', label: '主标题', min: 10, max: 26, step: 1, value: cfg.titleSize, onChange: (v) => patch({ titleSize: v }), slider: true },
          { type: 'number', key: 'mts', label: '模块标题', min: 9, max: 22, step: 1, value: cfg.moduleTitleSize, onChange: (v) => patch({ moduleTitleSize: v }), slider: true },
          { type: 'number', key: 'mbs', label: '模块正文', min: 8, max: 18, step: 1, value: cfg.moduleBodySize, onChange: (v) => patch({ moduleBodySize: v }), slider: true },
          { type: 'number', key: 'als', label: '边标签', min: 8, max: 18, step: 1, value: cfg.arrowLabelSize, onChange: (v) => patch({ arrowLabelSize: v }), slider: true },
          { type: 'number', key: 'lgs', label: '底部图例', min: 9, max: 20, step: 1, value: cfg.legendSize, onChange: (v) => patch({ legendSize: v }), slider: true },
        ],
      },
    ],
    [cfg, patch, patchModule],
  );

  /* ----------------------- drag handlers ------------------------ */
  const drag = useDragHandlers(svgRef, cfg, patch, patchModule);

  /* ----------------------- render ------------------------ */
  return (
    <ChartShell
      filename="fig-08-gating-fusion"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="门控值 g">
            <NumberSlider
              label="$g$"
              value={cfg.g}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ g: v })}
              format={(v) => v.toFixed(2)}
            />
            <p className="text-[11px] leading-snug text-ink-300">
              {cfg.g >= 0.6
                ? `EEG 主导 (g=${cfg.g.toFixed(2)})`
                : cfg.g <= 0.4
                ? `fNIRS 主导 (g=${cfg.g.toFixed(2)})`
                : `互补融合 (g=${cfg.g.toFixed(2)})`}
            </p>
          </ControlGroup>
          <ControlGroup label="模块标题">
            {moduleOrder.map((id) => (
              <TextArea
                key={id}
                label={MODULE_LABELS[id]}
                value={cfg.modules[id].title}
                onChange={(v) => patchModule(id, { title: v })}
                rows={1}
              />
            ))}
          </ControlGroup>
          <ControlGroup label="装饰">
            <Toggle
              label="底部图例"
              checked={cfg.showLegend}
              onChange={(v) => patch({ showLegend: v })}
            />
            <TextArea
              label="底部图例文本"
              value={cfg.legendText}
              onChange={(v) => patch({ legendText: v })}
              rows={2}
            />
          </ControlGroup>
          <ControlGroup label="文字格式">
            <button
              type="button"
              onClick={handleResetAllFormats}
              className="w-full rounded border border-ink-600 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-800"
            >
              重置全部文本格式
            </button>
            <p className="text-[10px] leading-snug text-ink-300">
              逐字段格式覆盖（字号 / 字重 / 斜体 / 行高 / 对齐 / 颜色）。
              点击 SVG 中任一文字打开浮动工具栏。
            </p>
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'eeg-only',
              label: 'EEG 主导',
              hint: 'g=0.9',
              description: '门近闭：fNIRS 几乎不参与。',
              apply: () => patch({ g: 0.9 }),
            },
            {
              id: 'fnirs-only',
              label: 'fNIRS 主导',
              hint: 'g=0.1',
              description: '门近开：以血氧为主。',
              apply: () => patch({ g: 0.1 }),
            },
            {
              id: 'balanced',
              label: '均衡',
              hint: 'g=0.5',
              description: '两路各占一半，标准互补。',
              apply: () => patch({ g: 0.5 }),
            },
            {
              id: 'reset-pos',
              label: '复位布局',
              hint: '默认',
              description: '把 6 个模块放回默认坐标。',
              apply: () => patch({ modules: DEFAULT_MODULES }),
            },
          ]}
        />
      }
      notes={
        <div className="space-y-2">
          <p>
            把每个模块拽到任意位置；五条带箭头自动重新捕捉到模块外框最近边的中点
            (snap-to-rect)，无需手动调路径。
          </p>
          <p>
            滑块调 g：底部图例 + EEG / fNIRS 箭头颜色实时反映"谁主导融合"。
          </p>
        </div>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W_FIG}
          height={H_FIG}
          framePadding={{ top: 0, bottom: 0 }}
        >
          {/* Title */}
          <ForeignText
            x={0}
            y={20}
            width={W_FIG}
            height={36}
            value={cfg.title}
            fontSize={cfg.titleSize}
            fontWeight={700}
            align="center"
            kid="title"
            label="主标题"
            format={cfg.formats?.title}
            selected={selected?.key === 'title'}
            onSelect={handleSelectText}
          />

          {/* Arrow defs */}
          <defs>
            <marker
              id="gf-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>

          {/* Arrows (drawn before modules so they sit behind boxes) */}
          {arrowGeoms.map((g) => {
            // EEG / fNIRS arrows pulse with g
            let stroke = g.stroke;
            if (g.id === 'e-c') {
              stroke = mixHex(cfg.eegStroke, '#999', 1 - cfg.g);
            } else if (g.id === 'f-c') {
              stroke = mixHex(cfg.fnirsStroke, '#999', cfg.g);
            }
            return (
              <g key={g.id} style={{ color: stroke }}>
                <path
                  d={g.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  markerEnd="url(#gf-arrow)"
                />
                <g transform={`translate(${g.labelX - 50}, ${g.labelY - 10})`}>
                  <rect
                    x={0}
                    y={0}
                    width={100}
                    height={20}
                    rx={4}
                    fill="white"
                    fillOpacity={0.92}
                    stroke="#bbb"
                  />
                  <ForeignText
                    x={2}
                    y={2}
                    width={96}
                    height={20}
                    value={g.label}
                    fontSize={cfg.arrowLabelSize}
                    align="center"
                    kid={`arrow-${g.id}-label`}
                    label={`边标签 ${g.id}`}
                    format={cfg.formats?.[`arrow-${g.id}-label`]}
                    selected={selected?.key === `arrow-${g.id}-label`}
                    onSelect={handleSelectText}
                  />
                </g>
              </g>
            );
          })}

          {/* Modules */}
          {moduleOrder.map((id) => {
            const m = cfg.modules[id];
            return (
              <g
                key={id}
                onMouseDown={(e) => drag.beginModule(e, id)}
                style={{ cursor: 'grab' }}
              >
                <rect
                  x={m.x}
                  y={m.y}
                  width={m.w}
                  height={m.h}
                  rx={10}
                  fill={m.fill}
                  stroke={m.stroke}
                  strokeWidth={1.6}
                />
                <ForeignText
                  x={m.x + 8}
                  y={m.y + 8}
                  width={m.w - 16}
                  height={26}
                  value={m.title}
                  fontSize={cfg.moduleTitleSize}
                  fontWeight={600}
                  align="center"
                  kid={`mod-${id}-title`}
                  label={`${MODULE_LABELS[id]} 标题`}
                  format={cfg.formats?.[`mod-${id}-title`]}
                  selected={selected?.key === `mod-${id}-title`}
                  onSelect={handleSelectText}
                />
                <ForeignText
                  x={m.x + 8}
                  y={m.y + 36}
                  width={m.w - 16}
                  height={m.h - 44}
                  value={m.body}
                  fontSize={cfg.moduleBodySize}
                  align="center"
                  kid={`mod-${id}-body`}
                  label={`${MODULE_LABELS[id]} 正文`}
                  format={cfg.formats?.[`mod-${id}-body`]}
                  selected={selected?.key === `mod-${id}-body`}
                  onSelect={handleSelectText}
                />
              </g>
            );
          })}

          {/* Per-dim gate heatmap (gate is a vector g ∈ [0,1]^d, here d=16) */}
          {(() => {
            const D = 16;
            const X0 = 60;
            const Y0 = 470;
            const cellW = 24;
            const cellH = 14;
            // synthesize a deterministic gate vector that averages to cfg.g
            const seed = Math.round(cfg.g * 1000) | 0;
            const r = (k: number) => {
              const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
              return x - Math.floor(x);
            };
            const raw = Array.from({ length: D }, (_, i) => cfg.g + (r(i) - 0.5) * 0.4);
            const clipped = raw.map((v) => Math.max(0.02, Math.min(0.98, v)));
            const meanG = clipped.reduce((s, v) => s + v, 0) / D;
            // re-normalise so visual mean matches cfg.g (visual fairness)
            const adj = clipped.map((v) => Math.max(0.02, Math.min(0.98, v + (cfg.g - meanG))));
            return (
              <g>
                <rect x={X0 - 12} y={Y0 - 26} width={D * cellW + 24} height={cellH + 56} rx={6} fill="#FAFAFA" stroke="#CCC" />
                <ForeignText
                  x={X0 - 8}
                  y={Y0 - 24}
                  width={D * cellW + 16}
                  height={16}
                  value={`per-dim gate $g \\in [0,1]^d$ (d=${D}), $\\bar{g}=${cfg.g.toFixed(2)}$`}
                  fontSize={11}
                  fontWeight={600}
                  align="left"
                />
                {adj.map((v, i) => (
                  <g key={`gd-${i}`}>
                    <rect
                      x={X0 + i * cellW}
                      y={Y0}
                      width={cellW - 2}
                      height={cellH}
                      fill={mixHex(cfg.fnirsStroke, cfg.eegStroke, v)}
                      stroke="#fff"
                      strokeWidth={0.6}
                    />
                    <ForeignText
                      x={X0 + i * cellW - 1}
                      y={Y0 + cellH + 1}
                      width={cellW}
                      height={12}
                      value={v.toFixed(2)}
                      fontSize={8}
                      align="center"
                    />
                  </g>
                ))}
                <ForeignText x={X0 + D * cellW + 4} y={Y0} width={64} height={14} value="$=g_d$" fontSize={11} align="left" />
              </g>
            );
          })()}

          {/* Composition bar: g% EEG | (1-g)% fNIRS */}
          {(() => {
            const X0 = 510;
            const Y0 = 470;
            const W = 380;
            const H = 28;
            const eegW = cfg.g * W;
            const fnirsW = W - eegW;
            return (
              <g>
                <rect x={X0 - 12} y={Y0 - 26} width={W + 24} height={H + 56} rx={6} fill="#FAFAFA" stroke="#CCC" />
                <ForeignText
                  x={X0 - 8}
                  y={Y0 - 24}
                  width={W + 16}
                  height={16}
                  value={`fusion composition: $g\\,h^E + (1-g)\\,h^F$`}
                  fontSize={11}
                  fontWeight={600}
                  align="left"
                />
                <rect x={X0} y={Y0} width={eegW} height={H} fill={cfg.eegStroke} fillOpacity={0.85} />
                <rect x={X0 + eegW} y={Y0} width={fnirsW} height={H} fill={cfg.fnirsStroke} fillOpacity={0.85} />
                <ForeignText
                  x={X0 + 4}
                  y={Y0 + 6}
                  width={Math.max(0, eegW - 8)}
                  height={H - 12}
                  value={`EEG  ${(cfg.g * 100).toFixed(0)}%`}
                  fontSize={11}
                  fontWeight={600}
                  align="left"
                  color="white"
                />
                <ForeignText
                  x={X0 + eegW + 4}
                  y={Y0 + 6}
                  width={Math.max(0, fnirsW - 8)}
                  height={H - 12}
                  value={`fNIRS  ${((1 - cfg.g) * 100).toFixed(0)}%`}
                  fontSize={11}
                  fontWeight={600}
                  align="left"
                  color="white"
                />
                {/* tick marks at 0/0.25/0.5/0.75/1 */}
                {[0.25, 0.5, 0.75].map((t) => (
                  <line key={`t-${t}`} x1={X0 + t * W} x2={X0 + t * W} y1={Y0 - 4} y2={Y0 + H + 4} stroke="#444" strokeWidth={0.6} strokeDasharray="2 3" opacity={0.6} />
                ))}
              </g>
            );
          })()}

          {/* Bottom legend */}
          {cfg.showLegend ? (
            <g
              transform={`translate(${cfg.legendPos.x}, ${cfg.legendPos.y})`}
              onMouseDown={drag.beginLegend}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={-8}
                y={-8}
                width={920}
                height={50}
                rx={6}
                fill="#FFF4CC"
                stroke="#A37C0E"
              />
              <ForeignText
                x={0}
                y={-2}
                width={904}
                height={42}
                value={cfg.legendText}
                fontSize={cfg.legendSize}
                align={cfg.legendAlign}
                kid="legend"
                label="底部图例"
                format={cfg.formats?.legend}
                selected={selected?.key === 'legend'}
                onSelect={handleSelectText}
              />
            </g>
          ) : null}

          {selected ? (
            <rect
              x={0}
              y={0}
              width={W_FIG}
              height={H_FIG}
              fill="transparent"
              pointerEvents="all"
              onMouseDown={handleClearSelection}
              data-export="false"
              style={{ cursor: 'default' }}
            />
          ) : null}
          {selected ? (
            (() => {
              const popoverWidth = 280;
              const popoverHeight = 130;
              const margin = 6;
              const ax = Math.max(
                4,
                Math.min(
                  W_FIG - popoverWidth - 4,
                  selected.x + selected.w / 2 - popoverWidth / 2,
                ),
              );
              const ay =
                selected.y + selected.h + margin + popoverHeight > H_FIG
                  ? Math.max(4, selected.y - popoverHeight - margin)
                  : selected.y + selected.h + margin;
              const popoverDefaults: TextFormatDefaults = selected.defaults;
              return (
                <TextFormatPopover
                  anchorX={ax}
                  anchorY={ay}
                  width={popoverWidth}
                  height={popoverHeight}
                  override={cfg.formats?.[selected.key]}
                  defaults={popoverDefaults}
                  label={selected.label}
                  onChange={(p) => handlePatchFormat(selected.key, p)}
                  onReset={() => handleResetElementFormat(selected.key)}
                  onClose={handleClearSelection}
                />
              );
            })()
          ) : null}
        </FigureFrame>
      }
    />
  );
}

/* ============================================================= */

const moduleOrder: ModuleId[] = ['eeg', 'fnirs', 'concat', 'gate', 'fuse', 'head'];
const MODULE_LABELS: Record<ModuleId, string> = {
  eeg: 'EEG',
  fnirs: 'fNIRS',
  concat: '拼接',
  gate: '门控网络',
  fuse: '融合',
  head: '分类头',
};

const ALIGN_OPTIONS: ReadonlyArray<{ value: Align; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

/** Linear interpolation between two hex colours. */
function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return a;
  const c = (k: number) =>
    Math.max(0, Math.min(255, Math.round(pa[k] + (pb[k] - pa[k]) * t)));
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

function hexToRgb(c: string): [number, number, number] | null {
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    if (c.length === 4) {
      const r = parseInt(c[1] + c[1], 16);
      const g = parseInt(c[2] + c[2], 16);
      const b = parseInt(c[3] + c[3], 16);
      return [r, g, b];
    }
    return [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
    ];
  }
  if (c.startsWith('rgb')) {
    const m = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

function useDragHandlers(
  svgRef: React.RefObject<SVGSVGElement | null>,
  cfg: SavedConfig,
  patch: (p: Partial<SavedConfig>) => void,
  patchModule: (id: ModuleId, p: Partial<ModuleSpec>) => void,
) {
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; });
  const beginGeneric = useCallback(
    (
      e: React.MouseEvent<SVGGElement>,
      get: () => { x: number; y: number },
      set: (b: { x: number; y: number }) => void,
    ) => {
      const svg = svgRef.current;
      if (!svg) return;
      const start = get();
      const sx = e.clientX;
      const sy = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scale = 1 / ctm.a;
      const onMove = (ev: MouseEvent) => {
        set({
          x: start.x + (ev.clientX - sx) * scale,
          y: start.y + (ev.clientY - sy) * scale,
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [svgRef],
  );

  return {
    beginModule: (e: React.MouseEvent<SVGGElement>, id: ModuleId) =>
      beginGeneric(
        e,
        () => ({ x: cfgRef.current.modules[id].x, y: cfgRef.current.modules[id].y }),
        (b) => patchModule(id, b),
      ),
    beginLegend: (e: React.MouseEvent<SVGGElement>) =>
      beginGeneric(
        e,
        () => cfgRef.current.legendPos,
        (b) => patch({ legendPos: b }),
      ),
  };
}

/* ============================================================= */

registerChart({
  id: 'gating-fusion',
  title: 'Fig. 8 · 门控融合模块',
  titleEn: 'Fig. 8 · Gating Fusion Module',
  category: 'architecture',
  summary:
    'EEG / fNIRS 双路 + 拼接 + 门控 + 融合 + 分类头的可拖拽块图；箭头自动吸附模块边框。',
  component: GatingFusionChart,
});
