import { useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { sampleColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';

/**
 * Multi-method qualitative radar plot.
 *
 * Visualises §2.4 Table 1 — a 7-axis comparison of model capabilities
 * across 6 methods. Axes are per-capability scores in [0, 1] (higher
 * is better). "Ours (GAT-CMC-Net)" is rendered with a filled accent
 * polygon and a heavy stroke; baselines are dashed lines so the
 * comparison stays legible when the polygons overlap.
 */

interface RadarAxis {
  id: string;
  /** Short Chinese label rendered around the radar. */
  labelZh: string;
  /** Optional second-line bilingual label. */
  labelEn?: string;
}

const AXES: RadarAxis[] = [
  { id: 'crossmodal', labelZh: '跨模态机制', labelEn: 'Cross-modal' },
  { id: 'graph', labelZh: '图算子表达力', labelEn: 'Graph operator' },
  { id: 'interpretability', labelZh: '可解释性', labelEn: 'Interpretability' },
  { id: 'event', labelZh: '事件级指标', labelEn: 'Event-level metrics' },
  { id: 'patient', labelZh: '患者独立评价', labelEn: 'LOSO patient indep.' },
  { id: 'task', labelZh: '癫痫任务匹配', labelEn: 'Seizure task fit' },
  { id: 'hrf', labelZh: 'HRF 时移建模', labelEn: 'HRF lag modelling' },
];

interface MethodSpec {
  name: string;
  /** Per-axis score, aligned to AXES order. */
  scores: number[];
  highlight?: boolean;
}

const METHODS: MethodSpec[] = [
  {
    name: 'EEGNet',
    scores: [0.05, 0.1, 0.45, 0.42, 0.35, 0.55, 0.05],
  },
  {
    name: 'iGGCN',
    scores: [0.1, 0.7, 0.5, 0.42, 0.4, 0.65, 0.05],
  },
  {
    name: 'GAT-Epi',
    scores: [0.15, 0.85, 0.6, 0.55, 0.95, 0.95, 0.05],
  },
  {
    name: 'MA-MP-GF',
    scores: [0.85, 0.55, 0.4, 0.55, 0.4, 0.42, 0.1],
  },
  {
    name: 'MBC-ATT',
    scores: [0.78, 0.5, 0.45, 0.45, 0.5, 0.4, 0.4],
  },
  {
    name: 'Ours (GAT-CMC-Net)',
    scores: [0.95, 1, 0.92, 0.96, 0.98, 1, 1],
    highlight: true,
  },
];

const ACCENT = '#f97316';

function MethodRadar() {
  const [showLegend, setShowLegend] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showRings, setShowRings] = useState(true);
  const [showAxesGrid, setShowAxesGrid] = useState(true);
  const [outerRadius, setOuterRadius] = useState(180);
  const [colormap, setColormap] = useState<ColormapName>('plasma');
  const [highlightOnly, setHighlightOnly] = useState(false);
  const [opacityOurs, setOpacityOurs] = useState(0.32);
  const svgRef = useRef<SVGSVGElement>(null);

  const palette = useMemo(() => {
    // Reserve accent for the highlighted method, sample the rest.
    const baseN = METHODS.length - 1;
    const base = sampleColormap(colormap, baseN);
    const out: string[] = [];
    let bi = 0;
    for (const m of METHODS) {
      out.push(m.highlight ? ACCENT : base[bi++]);
    }
    return out;
  }, [colormap]);

  const expertSchema: ExpertSchema = [
    {
      label: '几何',
      fields: [
        {
          type: 'number',
          key: 'r',
          label: '外圈半径 (px)',
          min: 100,
          max: 240,
          step: 4,
          value: outerRadius,
          onChange: setOuterRadius,
          slider: true,
        },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'rg', label: '同心圆刻度', value: showRings, onChange: setShowRings },
        {
          type: 'toggle',
          key: 'gx',
          label: '辐射轴线',
          value: showAxesGrid,
          onChange: setShowAxesGrid,
        },
        { type: 'toggle', key: 'lb', label: '轴标签', value: showLabels, onChange: setShowLabels },
        { type: 'toggle', key: 'lg', label: '图例', value: showLegend, onChange: setShowLegend },
        {
          type: 'toggle',
          key: 'ho',
          label: '只显示 Ours',
          value: highlightOnly,
          onChange: setHighlightOnly,
        },
        {
          type: 'number',
          key: 'op',
          label: 'Ours 填充不透明度',
          min: 0,
          max: 0.6,
          step: 0.02,
          value: opacityOurs,
          onChange: setOpacityOurs,
          slider: true,
          format: (v) => v.toFixed(2),
        },
        {
          type: 'colormap',
          key: 'cm',
          value: colormap,
          onChange: setColormap,
        },
      ],
    },
    {
      label: '维度',
      fields: [
        { type: 'info', key: 'n', label: '轴数', value: String(AXES.length) },
        { type: 'info', key: 'm', label: '方法数', value: String(METHODS.length) },
      ],
    },
  ];

  const W = 800;
  const H = 640;
  const cx = W / 2 - 40;
  const cy = H / 2 + 6;
  const R = outerRadius;
  const N = AXES.length;

  /** Convert a per-axis polar coordinate to Cartesian (origin at cx, cy). */
  const polarToXY = (axisIndex: number, value: number): [number, number] => {
    const angle = (Math.PI * 2 * axisIndex) / N - Math.PI / 2;
    const r = R * Math.max(0, Math.min(1, value));
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  const ringValues = [0.2, 0.4, 0.6, 0.8, 1];

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'paper',
              label: '论文复现',
              hint: '默认',
              description: '完整 6 方法叠加，Ours 填充。',
              apply: () => {
                setHighlightOnly(false);
                setOpacityOurs(0.32);
                setShowLegend(true);
                setShowLabels(true);
                setShowRings(true);
                setShowAxesGrid(true);
              },
            },
            {
              id: 'oursonly',
              label: '仅 Ours',
              hint: '突出',
              description: '仅渲染 GAT-CMC-Net 多边形。',
              apply: () => {
                setHighlightOnly(true);
                setOpacityOurs(0.45);
              },
            },
            {
              id: 'minimal',
              label: '极简版',
              hint: '海报',
              description: '隐藏环线与图例，仅保留轴文字。',
              apply: () => {
                setShowRings(false);
                setShowLegend(false);
                setShowAxesGrid(false);
                setShowLabels(true);
              },
            },
            {
              id: 'audit',
              label: '审计样式',
              hint: '审稿',
              description: '低 Ours 不透明度，便于看清基线轮廓。',
              apply: () => {
                setHighlightOnly(false);
                setOpacityOurs(0.1);
                setShowRings(true);
                setShowAxesGrid(true);
              },
            },
          ]}
        />
      }
      filename="method-radar"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="几何">
            <NumberSlider
              label="外圈半径"
              value={outerRadius}
              min={120}
              max={220}
              step={4}
              onChange={setOuterRadius}
            />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle label="只显示 Ours" checked={highlightOnly} onChange={setHighlightOnly} />
            <Toggle label="图例" checked={showLegend} onChange={setShowLegend} />
            <Toggle label="同心圆" checked={showRings} onChange={setShowRings} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          7 维定性能力雷达：每个轴位均归一化到 [0, 1] 区间。Ours
          (GAT-CMC-Net) 在跨模态机制、图算子表达力、HRF 时移建模与可解
          释性四个维度同时占优；GAT-Epi 在患者独立评价与癫痫任务匹配上
          也较强但缺乏跨模态机制；EEGNet 的 HRF 时移建模能力为零。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={'Multi-method qualitative radar (§2.4 Table 1)'}
          caption={'Per-axis scores in [0, 1]; higher = stronger.'}
        >
          {/* Rings */}
          {showRings ? (
            <g>
              {ringValues.map((v, k) => (
                <circle
                  key={k}
                  cx={cx}
                  cy={cy}
                  r={R * v}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={k === ringValues.length - 1 ? 0.55 : 0.18}
                  strokeWidth={k === ringValues.length - 1 ? 1 : 0.8}
                />
              ))}
              {/* Ring value labels along the +x axis */}
              {ringValues.map((v, k) => (
                <text
                  key={`rl-${k}`}
                  x={cx + R * v + 4}
                  y={cy + 3}
                  fontSize={9.5}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="currentColor"
                  fillOpacity={0.55}
                >
                  {v.toFixed(1)}
                </text>
              ))}
            </g>
          ) : null}

          {/* Radial axes */}
          {showAxesGrid
            ? AXES.map((_, i) => {
                const [x2, y2] = polarToXY(i, 1);
                return (
                  <line
                    key={`ax-${i}`}
                    x1={cx}
                    y1={cy}
                    x2={x2}
                    y2={y2}
                    stroke="currentColor"
                    strokeOpacity={0.32}
                    strokeWidth={0.9}
                  />
                );
              })
            : null}

          {/* Axis labels */}
          {showLabels &&
            AXES.map((axis, i) => {
              const [x, y] = polarToXY(i, 1.18);
              const angle = (Math.PI * 2 * i) / N - Math.PI / 2;
              const cosA = Math.cos(angle);
              const anchor =
                Math.abs(cosA) < 0.18
                  ? 'middle'
                  : cosA > 0
                  ? 'start'
                  : 'end';
              return (
                <g key={axis.id}>
                  <text
                    x={x}
                    y={y - 6}
                    textAnchor={anchor}
                    fontSize={12}
                    fontWeight={600}
                    fill="currentColor"
                  >
                    {axis.labelZh}
                  </text>
                  {axis.labelEn ? (
                    <text
                      x={x}
                      y={y + 8}
                      textAnchor={anchor}
                      fontSize={9.5}
                      fontFamily='Inter, sans-serif'
                      fill="currentColor"
                      fillOpacity={0.65}
                    >
                      {axis.labelEn}
                    </text>
                  ) : null}
                </g>
              );
            })}

          {/* Polygons — baselines first, highlighted on top */}
          {METHODS.map((m, mi) => {
            if (m.highlight) return null;
            if (highlightOnly) return null;
            const points = m.scores.map((v, i) => polarToXY(i, v));
            const path =
              'M' +
              points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L') +
              ' Z';
            return (
              <g key={m.name}>
                <path
                  d={path}
                  fill="none"
                  stroke={palette[mi]}
                  strokeWidth={1.4}
                  strokeOpacity={0.85}
                  strokeDasharray="5 4"
                />
                {m.scores.map((v, i) => {
                  const [px, py] = polarToXY(i, v);
                  return (
                    <circle
                      key={`${m.name}-${i}`}
                      cx={px}
                      cy={py}
                      r={2}
                      fill={palette[mi]}
                      fillOpacity={0.85}
                    />
                  );
                })}
              </g>
            );
          })}

          {METHODS.map((m, mi) => {
            if (!m.highlight) return null;
            const points = m.scores.map((v, i) => polarToXY(i, v));
            const path =
              'M' +
              points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L') +
              ' Z';
            return (
              <g key={m.name}>
                <path
                  d={path}
                  fill={palette[mi]}
                  fillOpacity={opacityOurs}
                  stroke={palette[mi]}
                  strokeWidth={3}
                  strokeLinejoin="round"
                />
                {m.scores.map((v, i) => {
                  const [px, py] = polarToXY(i, v);
                  return (
                    <circle
                      key={`${m.name}-${i}`}
                      cx={px}
                      cy={py}
                      r={3.6}
                      fill={palette[mi]}
                      stroke="white"
                      strokeWidth={1}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Legend */}
          {showLegend ? (
            <g transform={`translate(${W - 200}, 28)`}>
              <rect
                x={-8}
                y={-12}
                width={196}
                height={METHODS.length * 18 + 18}
                rx={6}
                fill="white"
                fillOpacity={0.92}
                stroke="currentColor"
                strokeOpacity={0.25}
              />
              <text
                x={0}
                y={2}
                fontSize={11}
                fontWeight={600}
                fill="currentColor"
              >
                Methods
              </text>
              {METHODS.map((m, i) => (
                <g key={m.name} transform={`translate(0, ${(i + 1) * 18})`}>
                  <line
                    x1={0}
                    x2={22}
                    y1={0}
                    y2={0}
                    stroke={palette[i]}
                    strokeWidth={m.highlight ? 3 : 1.6}
                    strokeDasharray={m.highlight ? undefined : '5 4'}
                  />
                  <circle
                    cx={11}
                    cy={0}
                    r={m.highlight ? 3.6 : 2.4}
                    fill={palette[i]}
                    stroke={m.highlight ? 'white' : 'none'}
                    strokeWidth={m.highlight ? 1 : 0}
                  />
                  <text
                    x={30}
                    y={3.5}
                    fontSize={11}
                    fontWeight={m.highlight ? 600 : 500}
                    fill="currentColor"
                  >
                    {m.name}
                  </text>
                </g>
              ))}
            </g>
          ) : null}
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'method-radar',
  title: '多方法定性能力雷达',
  titleEn: 'Multi-method Qualitative Radar',
  category: 'evaluation',
  summary:
    '7 维（HRF 时移、跨模态、图算子、可解释性、事件级指标、患者独立、任务匹配）的多方法雷达对比；Ours 高亮。',
  component: MethodRadar,
});
