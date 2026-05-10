/**
 * Fig. 5  Learnable HRF time-shift: Gaussian soft-shift kernel
 *         + reparameterisation sigmoid (§3.5).
 *
 * Two panels rendered side by side:
 *   (a) g(Δ; τ, s) — four Gaussian bumps at user-editable τ peaks
 *       (default 2 / 4 / 6 / 8 s) sharing a width s.
 *   (b) τⱼ = τmin + (τmax − τmin) σ(τ̃ⱼ) — the sigmoid reparam that
 *       keeps the learnable shift in the clinical 1–8 s window. A
 *       draggable yellow note box explains the prior range.
 *
 * Studio integration parity:
 *   - Editable title / panel subtitles / axis labels / curve labels
 *     (KaTeX live preview, MathJax glyph paths at SVG export).
 *   - All decorative anchors (legend, info note, panel headers) live
 *     in the saved config so position survives export/import.
 *   - Manual + 5-minute auto slot persistence via `useAutoSave`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { line as d3line, curveMonotoneX } from 'd3';
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
import { renderInlineLatex } from '../../lib/latex';
import { registerChart } from '../../registry';
import { buildLinearAxis } from '../../lib/scales';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';
import {
  useLatestPythonEmitter,
  type PythonEmitter,
} from '../../lib/pythonExport';
import { emitHrfKernelPython } from './python';

/* ----------------------------- types ---------------------------------- */

type Align = 'left' | 'center' | 'right';

interface CurveSpec {
  /** Gaussian peak (s). */
  tau: number;
  /** Stroke colour (hex). */
  color: string;
  /** Display label (KaTeX-friendly). */
  label: string;
}

interface DraggableBox {
  x: number;
  y: number;
}

interface SavedConfig {
  version: 1;
  title: string;
  subtitleA: string;
  subtitleB: string;
  axisAX: string;
  axisAY: string;
  axisBX: string;
  axisBY: string;
  curves: CurveSpec[];
  /** Width of the Gaussian (s). */
  sigma: number;
  tauMin: number;
  tauMax: number;
  showLegend: boolean;
  showGrid: boolean;
  showInfoBox: boolean;
  infoBoxText: string;
  infoBoxAlign: Align;
  legendPos: DraggableBox;
  infoPos: DraggableBox;
  /** Multipliers on the default font sizes. */
  titleSize: number;
  subtitleSize: number;
  axisLabelSize: number;
  legendSize: number;
  infoSize: number;
  textOverrides?: TextOverrideMap;
}

/* ----------------------------- defaults ------------------------------- */

const DEFAULT_PALETTE = ['#1F77B4', '#FF7F0E', '#2CA02C', '#9467BD'];

const DEFAULT_CURVES: CurveSpec[] = [
  { tau: 2, color: DEFAULT_PALETTE[0], label: '$\\tau = 2$ s' },
  { tau: 4, color: DEFAULT_PALETTE[1], label: '$\\tau = 4$ s' },
  { tau: 6, color: DEFAULT_PALETTE[2], label: '$\\tau = 6$ s' },
  { tau: 8, color: DEFAULT_PALETTE[3], label: '$\\tau = 8$ s (上限)' },
];

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  title:
    'Fig. 5  可学习 HRF 时移：高斯软位移与重参数化 (§3.5)',
  subtitleA: '(a) 高斯软位移核 (Eq. 20), $s=0.5$ s',
  subtitleB:
    '(b) 重参数化 (Eq. 18): $\\tau_j = \\tau_{\\min} + (\\tau_{\\max}-\\tau_{\\min})\\,\\sigma(\\tilde{\\tau}_j)$',
  axisAX: '$\\Delta$ (s)',
  axisAY: '$g(\\Delta;\\,\\tau,\\,s)$',
  axisBX: '$\\tilde{\\tau}_j$ (无约束参数)',
  axisBY: '$\\tau_j$ (s)',
  curves: DEFAULT_CURVES,
  sigma: 0.5,
  tauMin: 1,
  tauMax: 8,
  showLegend: true,
  showGrid: true,
  showInfoBox: true,
  infoBoxText: '先验范围 1–8 s\n覆盖临床 HRF peak [9],[16]',
  infoBoxAlign: 'left',
  legendPos: { x: 580, y: 70 },
  infoPos: { x: 760, y: 70 },
  titleSize: 16,
  subtitleSize: 13,
  axisLabelSize: 12,
  legendSize: 11,
  infoSize: 11,
};

/* ----------------------------- persistence ---------------------------- */

const STORAGE_KEY = 'hrf-kernel-configs-v1';

/* ----------------------------- canvas size ---------------------------- */

const W_FIG = 1280;
const H_FIG = 580;
const TITLE_Y = 28;
const PANEL_TOP = 80;
const PANEL_BOTTOM = 510;
const PANEL_A = { x0: 70, x1: 600 };
const PANEL_B = { x0: 700, x1: 1230 };

/* ============================================================= */

function HrfKernelChart() {
  const svgRef = useRef<SVGSVGElement>(null);

  // Live state
  const [cfg, setCfg] = useState<SavedConfig>(() => DEFAULT_CONFIG);

  /* ----------------------- patches ------------------------ */
  const patch = useCallback((p: Partial<SavedConfig>) => {
    setCfg((prev) => ({ ...prev, ...p }));
  }, []);

  const patchCurve = useCallback(
    (idx: number, p: Partial<CurveSpec>) => {
      setCfg((prev) => {
        const next = prev.curves.slice();
        next[idx] = { ...next[idx], ...p };
        return { ...prev, curves: next };
      });
    },
    [],
  );

  const buildBaseConfig = useCallback((): SavedConfig => cfg, [cfg]);
  const applyBaseConfig = useCallback((c: SavedConfig) => {
    if (!c || c.version !== 1) return;
    setCfg(c);
  }, []);
  const pythonEmitterRef = useRef<PythonEmitter | null>(null);
  const { renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'hrf-kernel-config.json',
    pythonEmitterRef,
    pythonFilename: 'hrf-kernel.py',
  });
  const textRefs = useMemo(() => [], []);

  useLatestPythonEmitter(pythonEmitterRef, () =>
    emitHrfKernelPython({
      title: cfg.title,
      subtitleA: cfg.subtitleA,
      subtitleB: cfg.subtitleB,
      axisAX: cfg.axisAX,
      axisAY: cfg.axisAY,
      axisBX: cfg.axisBX,
      axisBY: cfg.axisBY,
      sigma: cfg.sigma,
      tauMin: cfg.tauMin,
      tauMax: cfg.tauMax,
      curves: cfg.curves,
      showLegend: cfg.showLegend,
      showGrid: cfg.showGrid,
      showInfoBox: cfg.showInfoBox,
      infoBoxText: cfg.infoBoxText,
    }),
  );

  /* ----------------------- math ------------------------ */
  const gauss = (delta: number, tau: number, sigma: number) =>
    Math.exp(-((delta - tau) ** 2) / (2 * sigma * sigma));

  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

  const xRangeA: [number, number] = [-3, 9];
  const yRangeA: [number, number] = [0, 1.05];
  const xRangeB: [number, number] = [-5, 5];
  const yRangeB: [number, number] = [0, Math.max(cfg.tauMax + 0.5, 8)];

  // Sample 240 points per curve for smooth Gaussians.
  const aSeries = useMemo(() => {
    const N = 240;
    return cfg.curves.map((c) => {
      const pts: { t: number; v: number }[] = [];
      for (let i = 0; i <= N; i++) {
        const t = xRangeA[0] + (i / N) * (xRangeA[1] - xRangeA[0]);
        pts.push({ t, v: gauss(t, c.tau, cfg.sigma) });
      }
      return pts;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.curves, cfg.sigma]);

  const bSeries = useMemo(() => {
    const N = 200;
    const pts: { t: number; v: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const t = xRangeB[0] + (i / N) * (xRangeB[1] - xRangeB[0]);
      const v = cfg.tauMin + (cfg.tauMax - cfg.tauMin) * sigmoid(t);
      pts.push({ t, v });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.tauMin, cfg.tauMax]);

  /* ----------------------- panel axis primitives ------------------------ */
  // Build per-panel axes lazily so subtitle / label edits don't reflow.
  const axA = buildPanelAxes({
    x0: PANEL_A.x0,
    x1: PANEL_A.x1,
    yTop: PANEL_TOP,
    yBot: PANEL_BOTTOM,
    xDomain: xRangeA,
    yDomain: yRangeA,
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: (v) => v.toFixed(1),
    xTicks: 6,
    yTicks: 5,
  });
  const axB = buildPanelAxes({
    x0: PANEL_B.x0,
    x1: PANEL_B.x1,
    yTop: PANEL_TOP,
    yBot: PANEL_BOTTOM,
    xDomain: xRangeB,
    yDomain: yRangeB,
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: (v) => v.toFixed(0),
    xTicks: 6,
    yTicks: 5,
  });

  const lineA = d3line<{ t: number; v: number }>()
    .x((d) => axA.x.scale(d.t))
    .y((d) => axA.y.scale(d.v))
    .curve(curveMonotoneX);
  const lineB = d3line<{ t: number; v: number }>()
    .x((d) => axB.x.scale(d.t))
    .y((d) => axB.y.scale(d.v))
    .curve(curveMonotoneX);

  /* ----------------------- inspector ------------------------ */
  const expertSchema: ExpertSchema = useMemo(
    () => [
      {
        label: '标题与小标题',
        fields: [
          {
            type: 'text',
            key: 'title',
            label: '主标题',
            value: cfg.title,
            multiline: true,
            onChange: (v) => patch({ title: v }),
          },
          {
            type: 'text',
            key: 'sa',
            label: '(a) 子标题',
            value: cfg.subtitleA,
            multiline: true,
            onChange: (v) => patch({ subtitleA: v }),
          },
          {
            type: 'text',
            key: 'sb',
            label: '(b) 子标题',
            value: cfg.subtitleB,
            multiline: true,
            onChange: (v) => patch({ subtitleB: v }),
          },
        ],
      },
      {
        label: '坐标轴标签',
        fields: [
          { type: 'text', key: 'aax', label: '(a) X 轴', value: cfg.axisAX, onChange: (v) => patch({ axisAX: v }) },
          { type: 'text', key: 'aay', label: '(a) Y 轴', value: cfg.axisAY, onChange: (v) => patch({ axisAY: v }) },
          { type: 'text', key: 'abx', label: '(b) X 轴', value: cfg.axisBX, onChange: (v) => patch({ axisBX: v }) },
          { type: 'text', key: 'aby', label: '(b) Y 轴', value: cfg.axisBY, onChange: (v) => patch({ axisBY: v }) },
        ],
      },
      {
        label: '高斯核 (Eq. 20)',
        fields: [
          { type: 'number', key: 's', label: '宽度 $s$ (s)', min: 0.1, max: 2.5, step: 0.1, value: cfg.sigma, onChange: (v) => patch({ sigma: v }), slider: true, format: (v) => v.toFixed(2) },
          ...cfg.curves.flatMap((c, i) => [
            { type: 'number' as const, key: `t${i}`, label: `τ${i + 1} (s)`, min: -3, max: 9, step: 0.1, value: c.tau, onChange: (v: number) => patchCurve(i, { tau: v }), slider: true, format: (v: number) => v.toFixed(1) },
            { type: 'text' as const, key: `c${i}`, label: `颜色${i + 1}`, value: c.color, onChange: (v: string) => patchCurve(i, { color: v }) },
            { type: 'text' as const, key: `l${i}`, label: `图例${i + 1}`, value: c.label, onChange: (v: string) => patchCurve(i, { label: v }) },
          ]),
        ],
      },
      {
        label: '重参数化 (Eq. 18)',
        fields: [
          { type: 'number', key: 'tmin', label: 'τ_min', min: 0, max: 5, step: 0.1, value: cfg.tauMin, onChange: (v) => patch({ tauMin: v }), slider: true, format: (v) => v.toFixed(2) },
          { type: 'number', key: 'tmax', label: 'τ_max', min: 4, max: 12, step: 0.1, value: cfg.tauMax, onChange: (v) => patch({ tauMax: v }), slider: true, format: (v) => v.toFixed(2) },
        ],
      },
      {
        label: '装饰 / 注解',
        fields: [
          { type: 'toggle', key: 'gd', label: '网格', value: cfg.showGrid, onChange: (v) => patch({ showGrid: v }) },
          { type: 'toggle', key: 'lg', label: '图例', value: cfg.showLegend, onChange: (v) => patch({ showLegend: v }) },
          { type: 'toggle', key: 'ib', label: '黄色信息框', value: cfg.showInfoBox, onChange: (v) => patch({ showInfoBox: v }) },
          { type: 'text', key: 'ibt', label: '信息框文本', value: cfg.infoBoxText, multiline: true, onChange: (v) => patch({ infoBoxText: v }) },
          { type: 'select', key: 'iba', label: '信息框对齐', value: cfg.infoBoxAlign, options: ALIGN_OPTIONS, onChange: (v) => patch({ infoBoxAlign: v as Align }) },
          { type: 'number', key: 'lx', label: '图例 X', min: 0, max: W_FIG, step: 1, value: cfg.legendPos.x, onChange: (v) => patch({ legendPos: { ...cfg.legendPos, x: v } }) },
          { type: 'number', key: 'ly', label: '图例 Y', min: 0, max: H_FIG, step: 1, value: cfg.legendPos.y, onChange: (v) => patch({ legendPos: { ...cfg.legendPos, y: v } }) },
          { type: 'number', key: 'ix', label: '信息框 X', min: 0, max: W_FIG, step: 1, value: cfg.infoPos.x, onChange: (v) => patch({ infoPos: { ...cfg.infoPos, x: v } }) },
          { type: 'number', key: 'iy', label: '信息框 Y', min: 0, max: H_FIG, step: 1, value: cfg.infoPos.y, onChange: (v) => patch({ infoPos: { ...cfg.infoPos, y: v } }) },
        ],
      },
      {
        label: '字号',
        fields: [
          { type: 'number', key: 'ts', label: '主标题', min: 10, max: 26, step: 1, value: cfg.titleSize, onChange: (v) => patch({ titleSize: v }), slider: true },
          { type: 'number', key: 'ss', label: '子标题', min: 9, max: 22, step: 1, value: cfg.subtitleSize, onChange: (v) => patch({ subtitleSize: v }), slider: true },
          { type: 'number', key: 'as', label: '坐标轴标签', min: 8, max: 20, step: 1, value: cfg.axisLabelSize, onChange: (v) => patch({ axisLabelSize: v }), slider: true },
          { type: 'number', key: 'ls', label: '图例', min: 8, max: 18, step: 1, value: cfg.legendSize, onChange: (v) => patch({ legendSize: v }), slider: true },
          { type: 'number', key: 'is', label: '信息框', min: 8, max: 18, step: 1, value: cfg.infoSize, onChange: (v) => patch({ infoSize: v }), slider: true },
        ],
      },
    ],
    [cfg, patch, patchCurve],
  );

  /* ----------------------- render ------------------------ */
  const dragHandlers = useDragHandlers(svgRef, patch, cfg);

  return (
    <ChartShell
      filename="fig-05-hrf-kernel"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="标题">
            <TextArea
              label="主标题"
              value={cfg.title}
              onChange={(v) => patch({ title: v })}
              rows={2}
            />
          </ControlGroup>
          <ControlGroup label="高斯核宽度 / 范围">
            <NumberSlider
              label="$s$ (s)"
              value={cfg.sigma}
              min={0.1}
              max={2.5}
              step={0.05}
              onChange={(v) => patch({ sigma: v })}
              format={(v) => v.toFixed(2)}
            />
            <NumberSlider
              label="τ_min"
              value={cfg.tauMin}
              min={0}
              max={5}
              step={0.1}
              onChange={(v) => patch({ tauMin: v })}
              format={(v) => v.toFixed(2)}
            />
            <NumberSlider
              label="τ_max"
              value={cfg.tauMax}
              min={4}
              max={12}
              step={0.1}
              onChange={(v) => patch({ tauMax: v })}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="装饰">
            <Toggle
              label="网格"
              checked={cfg.showGrid}
              onChange={(v) => patch({ showGrid: v })}
            />
            <Toggle
              label="图例"
              checked={cfg.showLegend}
              onChange={(v) => patch({ showLegend: v })}
            />
            <Toggle
              label="信息框"
              checked={cfg.showInfoBox}
              onChange={(v) => patch({ showInfoBox: v })}
            />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'wide',
              label: '宽核',
              hint: '光滑',
              description: '$s = 1.0$ s — 平滑核，强调先验范围。',
              apply: () => patch({ sigma: 1.0 }),
            },
            {
              id: 'narrow',
              label: '窄核',
              hint: '锐利',
              description: '$s = 0.3$ s — 接近 δ-脉冲。',
              apply: () => patch({ sigma: 0.3 }),
            },
            {
              id: 'wide-range',
              label: '扩张范围',
              hint: 'τ ∈ [0,12]',
              description: 'τ_min=0, τ_max=12。覆盖更宽的 HRF。',
              apply: () => patch({ tauMin: 0, tauMax: 12 }),
            },
            {
              id: 'narrow-range',
              label: '收紧范围',
              hint: 'τ ∈ [3,6]',
              description: '突出可学习时移仅在生理窗口内。',
              apply: () => patch({ tauMin: 3, tauMax: 6 }),
            },
          ]}
        />
      }
      notes={
        <div className="space-y-2">
          <p>
            (a) 高斯软位移核 $g(\Delta;\tau,s)$ 的能量集中在 $\tau$ 附近 ±$s$
            范围，`s` 控制 HRF 时移在反向传播中的“光滑度”。
          </p>
          <p>
            {'(b) 重参数化保证 $\\tau_j$ 严格落在 $[\\tau_{\\min},\\tau_{\\max}]$ 内，$\\tilde{\\tau}_j$ 是真正的优化变量；曲线两端水平虚线即上下限。'}
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
            y={TITLE_Y - 20}
            width={W_FIG}
            height={36}
            value={cfg.title}
            fontSize={cfg.titleSize}
            fontWeight={700}
            align="center"
          />

          {/* Subtitles */}
          <ForeignText
            x={PANEL_A.x0}
            y={PANEL_TOP - 32}
            width={PANEL_A.x1 - PANEL_A.x0}
            height={28}
            value={cfg.subtitleA}
            fontSize={cfg.subtitleSize}
            fontWeight={500}
            align="center"
          />
          <ForeignText
            x={PANEL_B.x0}
            y={PANEL_TOP - 32}
            width={PANEL_B.x1 - PANEL_B.x0}
            height={28}
            value={cfg.subtitleB}
            fontSize={cfg.subtitleSize}
            fontWeight={500}
            align="center"
          />

          {/* Panel (a) */}
          <PanelChrome
            ax={axA}
            xLabel={cfg.axisAX}
            yLabel={cfg.axisAY}
            showGrid={cfg.showGrid}
            axisLabelSize={cfg.axisLabelSize}
          />
          {/* (a) FWHM bands: a horizontal segment at half-max with arrow caps */}
          <g>
            {cfg.curves.map((c, i) => {
              const fwhm = 2.3548 * cfg.sigma;
              const x0 = axA.x.scale(c.tau - fwhm / 2);
              const x1 = axA.x.scale(c.tau + fwhm / 2);
              const y = axA.y.scale(0.5);
              return (
                <g key={`fwhm-${i}`} opacity={0.55}>
                  <line
                    x1={x0}
                    x2={x1}
                    y1={y}
                    y2={y}
                    stroke={c.color}
                    strokeWidth={1.2}
                    strokeDasharray="3 3"
                  />
                  <line x1={x0} x2={x0} y1={y - 4} y2={y + 4} stroke={c.color} strokeWidth={1.2} />
                  <line x1={x1} x2={x1} y1={y - 4} y2={y + 4} stroke={c.color} strokeWidth={1.2} />
                </g>
              );
            })}
          </g>
          {/* (a) Soft fill under each Gaussian for visual depth */}
          <g opacity={0.18}>
            {aSeries.map((pts, i) => {
              const c = cfg.curves[i];
              const d = lineA(pts);
              if (!d) return null;
              const yBase = axA.y.scale(0);
              const x0 = axA.x.scale(pts[0].t);
              const x1 = axA.x.scale(pts[pts.length - 1].t);
              return (
                <path
                  key={`fill-${i}`}
                  d={`${d} L ${x1} ${yBase} L ${x0} ${yBase} Z`}
                  fill={c.color}
                  stroke="none"
                />
              );
            })}
          </g>
          <g>
            {aSeries.map((pts, i) => {
              const c = cfg.curves[i];
              const d = lineA(pts);
              return d ? (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={2.4}
                />
              ) : null;
            })}
          </g>
          {/* (a) Peak markers: filled circle + value label */}
          <g>
            {cfg.curves.map((c, i) => {
              const cx = axA.x.scale(c.tau);
              const cy = axA.y.scale(1.0);
              return (
                <g key={`peak-${i}`}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={cy}
                    y2={axA.y.scale(0)}
                    stroke={c.color}
                    strokeWidth={0.8}
                    strokeDasharray="2 3"
                    opacity={0.55}
                  />
                  <circle cx={cx} cy={cy} r={4.2} fill="#fff" stroke={c.color} strokeWidth={1.8} />
                  <circle cx={cx} cy={cy} r={1.6} fill={c.color} />
                </g>
              );
            })}
          </g>
          {/* (a) Stats badge — peak height + FWHM */}
          <g transform={`translate(${PANEL_A.x1 - 168}, ${PANEL_TOP + 8})`}>
            <rect width={158} height={48} rx={6} fill="#FAFAFA" stroke="#CCC" />
            <ForeignText
              x={6}
              y={2}
              width={150}
              height={20}
              value={`peak height = $1.0$`}
              fontSize={11}
              align="left"
            />
            <ForeignText
              x={6}
              y={22}
              width={150}
              height={20}
              value={`FWHM $= 2.355\\,s = ${(2.3548 * cfg.sigma).toFixed(2)}$ s`}
              fontSize={11}
              align="left"
            />
          </g>

          {/* Panel (b) */}
          <PanelChrome
            ax={axB}
            xLabel={cfg.axisBX}
            yLabel={cfg.axisBY}
            showGrid={cfg.showGrid}
            axisLabelSize={cfg.axisLabelSize}
          />
          {/* τ_min / τ_max dashed asymptotes + labels */}
          <g>
            <line
              x1={axB.x.scale(xRangeB[0])}
              x2={axB.x.scale(xRangeB[1])}
              y1={axB.y.scale(cfg.tauMin)}
              y2={axB.y.scale(cfg.tauMin)}
              stroke="#777"
              strokeWidth={1.1}
              strokeDasharray="6 4"
            />
            <line
              x1={axB.x.scale(xRangeB[0])}
              x2={axB.x.scale(xRangeB[1])}
              y1={axB.y.scale(cfg.tauMax)}
              y2={axB.y.scale(cfg.tauMax)}
              stroke="#777"
              strokeWidth={1.1}
              strokeDasharray="6 4"
            />
            <ForeignText
              x={axB.x.scale(xRangeB[1]) - 70}
              y={axB.y.scale(cfg.tauMax) - 16}
              width={70}
              height={14}
              value={`$\\tau_{\\max}=${cfg.tauMax.toFixed(1)}$`}
              fontSize={10}
              align="right"
            />
            <ForeignText
              x={axB.x.scale(xRangeB[1]) - 70}
              y={axB.y.scale(cfg.tauMin) + 2}
              width={70}
              height={14}
              value={`$\\tau_{\\min}=${cfg.tauMin.toFixed(1)}$`}
              fontSize={10}
              align="right"
            />
            {(() => {
              const d = lineB(bSeries);
              return d ? (
                <path
                  d={d}
                  fill="none"
                  stroke="#D62728"
                  strokeWidth={2.6}
                />
              ) : null;
            })()}
          </g>
          {/* (b) Sample dots: τ̃ that maps to each visible τ peak in (a) */}
          <g>
            {cfg.curves.map((c, i) => {
              // invert sigmoid: τ̃ such that σ(τ̃) = (τ - tmin)/(tmax-tmin)
              const tnorm = (c.tau - cfg.tauMin) / Math.max(1e-6, cfg.tauMax - cfg.tauMin);
              if (tnorm <= 0 || tnorm >= 1) return null;
              const tildeTau = Math.log(tnorm / (1 - tnorm));
              if (tildeTau < xRangeB[0] || tildeTau > xRangeB[1]) return null;
              const dotX = axB.x.scale(tildeTau);
              const dotY = axB.y.scale(c.tau);
              return (
                <g key={`samp-${i}`}>
                  <line
                    x1={axB.x.scale(xRangeB[0])}
                    x2={dotX}
                    y1={dotY}
                    y2={dotY}
                    stroke={c.color}
                    strokeWidth={0.8}
                    strokeDasharray="2 3"
                    opacity={0.5}
                  />
                  <line
                    x1={dotX}
                    x2={dotX}
                    y1={dotY}
                    y2={axB.y.scale(yRangeB[0])}
                    stroke={c.color}
                    strokeWidth={0.8}
                    strokeDasharray="2 3"
                    opacity={0.5}
                  />
                  <circle cx={dotX} cy={dotY} r={4.2} fill="#fff" stroke={c.color} strokeWidth={1.8} />
                  <circle cx={dotX} cy={dotY} r={1.6} fill={c.color} />
                </g>
              );
            })}
          </g>

          {/* Legend (panel a) */}
          {cfg.showLegend ? (
            <g
              transform={`translate(${cfg.legendPos.x}, ${cfg.legendPos.y})`}
              onMouseDown={dragHandlers.beginDragLegend}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={-6}
                y={-6}
                width={150}
                height={cfg.curves.length * 22 + 14}
                rx={6}
                fill="white"
                fillOpacity={0.92}
                stroke="#999"
              />
              {cfg.curves.map((c, i) => (
                <g key={i} transform={`translate(0, ${i * 22 + 8})`}>
                  <line
                    x1={2}
                    x2={28}
                    y1={6}
                    y2={6}
                    stroke={c.color}
                    strokeWidth={2.6}
                  />
                  <ForeignText
                    x={36}
                    y={-6}
                    width={110}
                    height={22}
                    value={c.label}
                    fontSize={cfg.legendSize}
                    align="left"
                  />
                </g>
              ))}
            </g>
          ) : null}

          {/* Info note (panel b) */}
          {cfg.showInfoBox ? (
            <g
              transform={`translate(${cfg.infoPos.x}, ${cfg.infoPos.y})`}
              onMouseDown={dragHandlers.beginDragInfo}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={-8}
                y={-8}
                width={260}
                height={56}
                rx={6}
                fill="#FFF4CC"
                stroke="#A37C0E"
              />
              <ForeignText
                x={0}
                y={-2}
                width={244}
                height={50}
                value={cfg.infoBoxText}
                fontSize={cfg.infoSize}
                align={cfg.infoBoxAlign}
              />
            </g>
          ) : null}
        </FigureFrame>
      }
    />
  );
}

/* ============================================================= */
/*                       small subcomponents                      */
/* ============================================================= */

const ALIGN_OPTIONS: ReadonlyArray<{ value: Align; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

interface PanelAxes {
  x: ReturnType<typeof buildLinearAxis>;
  y: ReturnType<typeof buildLinearAxis>;
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
}

function buildPanelAxes(opts: {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xTickFmt?: (v: number) => string;
  yTickFmt?: (v: number) => string;
  xTicks?: number;
  yTicks?: number;
}): PanelAxes {
  const x = buildLinearAxis({
    domain: opts.xDomain,
    range: [opts.x0, opts.x1],
    tickCount: opts.xTicks ?? 6,
    format: opts.xTickFmt,
  });
  const y = buildLinearAxis({
    domain: opts.yDomain,
    range: [opts.yBot, opts.yTop],
    tickCount: opts.yTicks ?? 5,
    format: opts.yTickFmt,
  });
  return { x, y, x0: opts.x0, x1: opts.x1, yTop: opts.yTop, yBot: opts.yBot };
}

function PanelChrome({
  ax,
  xLabel,
  yLabel,
  showGrid,
  axisLabelSize,
}: {
  ax: PanelAxes;
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  axisLabelSize: number;
}) {
  return (
    <g>
      {/* Grid */}
      {showGrid ? (
        <g opacity={0.45}>
          {ax.x.ticks.map((t, i) => (
            <line
              key={`gx${i}`}
              x1={t.position}
              x2={t.position}
              y1={ax.yTop}
              y2={ax.yBot}
              stroke="#cdd1d8"
              strokeWidth={1}
            />
          ))}
          {ax.y.ticks.map((t, i) => (
            <line
              key={`gy${i}`}
              x1={ax.x0}
              x2={ax.x1}
              y1={t.position}
              y2={t.position}
              stroke="#cdd1d8"
              strokeWidth={1}
            />
          ))}
        </g>
      ) : null}
      {/* Frame */}
      <rect
        x={ax.x0}
        y={ax.yTop}
        width={ax.x1 - ax.x0}
        height={ax.yBot - ax.yTop}
        fill="white"
        stroke="#222"
        strokeWidth={1}
      />
      {/* X ticks */}
      {ax.x.ticks.map((t, i) => (
        <g key={`xt${i}`} transform={`translate(${t.position}, ${ax.yBot})`}>
          <line y1={0} y2={5} stroke="#222" strokeWidth={1} />
          <text
            y={18}
            textAnchor="middle"
            fontSize={11}
            fill="#222"
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}
      {/* Y ticks */}
      {ax.y.ticks.map((t, i) => (
        <g key={`yt${i}`} transform={`translate(${ax.x0}, ${t.position})`}>
          <line x1={-5} x2={0} stroke="#222" strokeWidth={1} />
          <text
            x={-9}
            y={4}
            textAnchor="end"
            fontSize={11}
            fill="#222"
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}
      {/* X axis label */}
      <ForeignText
        x={ax.x0}
        y={ax.yBot + 26}
        width={ax.x1 - ax.x0}
        height={26}
        value={xLabel}
        fontSize={axisLabelSize}
        align="center"
      />
      {/* Y axis label (rotated) */}
      <g
        transform={`translate(${ax.x0 - 44}, ${(ax.yTop + ax.yBot) / 2}) rotate(-90)`}
      >
        <ForeignText
          x={-90}
          y={-14}
          width={180}
          height={24}
          value={yLabel}
          fontSize={axisLabelSize}
          align="center"
        />
      </g>
    </g>
  );
}

function ForeignText({
  x,
  y,
  width,
  height,
  value,
  fontSize,
  fontWeight,
  align = 'left',
  color,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  fontSize: number;
  fontWeight?: number;
  align?: Align;
  color?: string;
}) {
  const lines = value.split('\n');
  const justify =
    align === 'center'
      ? 'center'
      : align === 'right'
      ? 'flex-end'
      : 'flex-start';
  return (
    <foreignObject
      x={x}
      y={y}
      width={width}
      height={Math.max(height, lines.length * (fontSize + 4))}
      data-latex={value}
      data-latex-font-size={fontSize}
      data-latex-font-weight={fontWeight ?? 400}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: justify,
          textAlign: align as 'left' | 'center' | 'right',
          fontFamily:
            'Inter, "Noto Sans SC", system-ui, sans-serif',
          fontSize,
          fontWeight: fontWeight ?? 400,
          color: color ?? '#1c1c1c',
          lineHeight: 1.3,
        }}
        dangerouslySetInnerHTML={{
          __html: lines
            .map((l) => `<div>${l ? renderInlineLatex(l) : '&nbsp;'}</div>`)
            .join(''),
        }}
      />
    </foreignObject>
  );
}

function useDragHandlers(
  svgRef: React.RefObject<SVGSVGElement | null>,
  patch: (p: Partial<SavedConfig>) => void,
  cfg: SavedConfig,
) {
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; });
  const begin = useCallback(
    (
      e: React.MouseEvent<SVGGElement>,
      get: () => DraggableBox,
      set: (b: DraggableBox) => void,
    ) => {
      const svg = svgRef.current;
      if (!svg) return;
      const start = get();
      const sx = e.clientX;
      const sy = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scale = 1 / ctm.a; // user-space px per client px
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
    beginDragLegend: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.legendPos,
        (b) => patch({ legendPos: b }),
      ),
    beginDragInfo: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.infoPos,
        (b) => patch({ infoPos: b }),
      ),
  };
}

/* ============================================================= */
/*                      slot manager                              */
/* ============================================================= */

/* ============================================================= */

registerChart({
  id: 'hrf-kernel',
  title: 'Fig. 5 · 可学习 HRF 时移核 / 重参数化',
  titleEn: 'Fig. 5 · Learnable HRF Soft-Shift Kernel & Reparameterisation',
  category: 'architecture',
  summary:
    '高斯软位移核 g(Δ;τ,s) 与 σ-重参数化曲线，可编辑 τ、s、τ_min/max，自动存档。',
  component: HrfKernelChart,
});
