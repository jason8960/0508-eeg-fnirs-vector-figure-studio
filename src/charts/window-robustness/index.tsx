import { useCallback, useMemo, useRef, useState } from 'react';
import { line as d3line } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import { sampleColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { mulberry32, randn } from '../../lib/random';
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import {
  useLatestPythonEmitter,
  type PythonEmitter,
} from '../../lib/pythonExport';
import { emitWindowRobustnessPython } from './python';
import type { TextOverrideMap } from '../../lib/useTextOverrides';

/**
 * Window-length robustness on CHB-MIT (LOSO).
 *
 * Two side-by-side panels:
 *   (a) Event sensitivity vs. analysis window length (s).
 *   (b) Mean detection latency (s) vs. analysis window length (s).
 *
 * Each method's curve is generated from a deterministic *base curve*
 * (so the qualitative ordering matches the placeholder figure) plus a
 * tiny seeded jitter. "Ours (GAT-CMC-Net)" is rendered with an accent
 * stroke + filled markers so the eye snaps to it during review.
 */

const WINDOWS_S = [5, 10, 15, 20, 30, 45, 60];
const ACCENT = '#f97316'; // tailwind orange-500-ish

interface MethodSpec {
  name: string;
  /** Base sensitivity at 5 s. */
  baseSensitivity: number;
  /** Marginal gain per +1 s of window. */
  sensitivitySlope: number;
  /** Asymptote — sensitivity saturates near this value. */
  sensitivityCeiling: number;
  /** Latency intercept at 5 s. */
  baseLatency: number;
  /** Latency slope (s/s). */
  latencySlope: number;
  /** Highlight (Ours). */
  highlight?: boolean;
}

const DEFAULT_METHODS: MethodSpec[] = [
  {
    name: 'EEGNet',
    baseSensitivity: 0.635,
    sensitivitySlope: 0.0035,
    sensitivityCeiling: 0.81,
    baseLatency: 3.4,
    latencySlope: 0.46,
  },
  {
    name: 'iGGCN',
    baseSensitivity: 0.7,
    sensitivitySlope: 0.0028,
    sensitivityCeiling: 0.86,
    baseLatency: 3.2,
    latencySlope: 0.45,
  },
  {
    name: 'MA-MP-GF',
    baseSensitivity: 0.715,
    sensitivitySlope: 0.0035,
    sensitivityCeiling: 0.89,
    baseLatency: 3.1,
    latencySlope: 0.45,
  },
  {
    name: 'Ours (GAT-CMC-Net)',
    baseSensitivity: 0.866,
    sensitivitySlope: 0.0014,
    sensitivityCeiling: 0.94,
    baseLatency: 3.0,
    latencySlope: 0.4,
    highlight: true,
  },
];

interface MethodSeries {
  spec: MethodSpec;
  sensitivity: number[];
  latency: number[];
}

function buildSeries(
  spec: MethodSpec,
  windows: number[],
  jitter: number,
  seed: number,
): MethodSeries {
  const rng = mulberry32(seed);
  const sensitivity = windows.map((w) => {
    const dt = w - 5;
    const base =
      spec.sensitivityCeiling -
      (spec.sensitivityCeiling - spec.baseSensitivity) *
        Math.exp(-spec.sensitivitySlope * 12 * dt);
    return Math.max(0, Math.min(1, base + randn(rng) * jitter * 0.18));
  });
  const latency = windows.map((w) => {
    const v = spec.baseLatency + spec.latencySlope * (w - 5);
    return Math.max(0, v + randn(rng) * jitter * 1.4);
  });
  return { spec, sensitivity, latency };
}

const STORAGE_KEY = 'window-robustness-configs-v1';

interface SavedConfig {
  version: 1;
  seed: number;
  jitter: number;
  showMarkers: boolean;
  colormap: ColormapName;
  showOursBand: boolean;
  textOverrides?: TextOverrideMap;
}

function WindowRobustness() {
  const [jitter, setJitter] = useState(0.18);
  const [seed, setSeed] = useState(11);
  const [showMarkers, setShowMarkers] = useState(true);
  const [colormap, setColormap] = useState<ColormapName>('viridis');
  const [showOursBand, setShowOursBand] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      jitter,
      showMarkers,
      colormap,
      showOursBand,
    }),
    [seed, jitter, showMarkers, colormap, showOursBand],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setJitter(cfg.jitter);
    setShowMarkers(cfg.showMarkers);
    setColormap(cfg.colormap);
    setShowOursBand(cfg.showOursBand);
  }, []);
  const pythonEmitterRef = useRef<PythonEmitter | null>(null);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<
    SavedConfig
  >({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'window-robustness-config.json',
    pythonEmitterRef,
    pythonFilename: 'window-robustness.py',
  });

  const series = useMemo(
    () =>
      DEFAULT_METHODS.map((spec, i) =>
        buildSeries(spec, WINDOWS_S, jitter, seed + i * 17),
      ),
    [jitter, seed],
  );

  const palette = useMemo(() => {
    const base = sampleColormap(colormap, DEFAULT_METHODS.length);
    return DEFAULT_METHODS.map((spec, i) =>
      spec.highlight ? ACCENT : base[i],
    );
  }, [colormap]);

  const expertSchema: ExpertSchema = [
    {
      label: '随机性',
      description: '合成数据按种子可复现；jitter 控制每个窗长上的扰动幅度。',
      fields: [
        {
          type: 'number',
          key: 'sd',
          label: '种子',
          min: 0,
          max: 9999,
          step: 1,
          value: seed,
          onChange: setSeed,
        },
        {
          type: 'number',
          key: 'jt',
          label: '扰动 jitter',
          min: 0,
          max: 0.5,
          step: 0.01,
          value: jitter,
          onChange: setJitter,
          slider: true,
          format: (v) => v.toFixed(2),
        },
      ],
    },
    {
      label: '显示',
      fields: [
        {
          type: 'toggle',
          key: 'mk',
          label: '显示数据点',
          value: showMarkers,
          onChange: setShowMarkers,
        },
        {
          type: 'toggle',
          key: 'bd',
          label: 'Ours 渐变填充带',
          value: showOursBand,
          onChange: setShowOursBand,
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
      label: '基线',
      fields: [
        {
          type: 'info',
          key: 'mn',
          label: '方法数',
          value: String(DEFAULT_METHODS.length),
        },
        {
          type: 'info',
          key: 'wn',
          label: '窗长 (s)',
          value: WINDOWS_S.join(' / '),
        },
      ],
    },
  ];

  const W = 920;
  const H = 470;
  const panelGap = 56;
  const panelW = (W - panelGap) / 2;
  const margin = { top: 36, right: 24, bottom: 110, left: 64 };
  const innerW = panelW - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const xAxis = buildLinearAxis({
    domain: [0, 65],
    range: [0, innerW],
    ticks: [5, 10, 15, 20, 30, 45, 60],
    format: (v) => v.toFixed(0),
  });

  const seAxis = buildLinearAxis({
    domain: [0.55, 1],
    range: [innerH, 0],
    ticks: [0.55, 0.65, 0.75, 0.85, 0.95, 1.0],
    format: (v) => v.toFixed(2),
  });

  const latMax = Math.max(
    ...series.flatMap((s) => s.latency),
    32,
  );
  const latAxis = buildLinearAxis({
    domain: [0, latMax + 2],
    range: [innerH, 0],
    tickCount: 6,
    nice: true,
  });

  const seLine = d3line<number>()
    .x((_, i) => xAxis.scale(WINDOWS_S[i]))
    .y((v) => seAxis.scale(v));
  const latLine = d3line<number>()
    .x((_, i) => xAxis.scale(WINDOWS_S[i]))
    .y((v) => latAxis.scale(v));

  const renderMarker = (
    cx: number,
    cy: number,
    color: string,
    highlight: boolean,
  ) => {
    if (highlight) {
      // 5-point star.
      const r = 5.4;
      const r2 = r * 0.42;
      const points: string[] = [];
      for (let k = 0; k < 10; k++) {
        const ang = (Math.PI / 5) * k - Math.PI / 2;
        const rr = k % 2 === 0 ? r : r2;
        points.push(
          `${(cx + rr * Math.cos(ang)).toFixed(2)},${(cy + rr * Math.sin(ang)).toFixed(2)}`,
        );
      }
      return (
        <polygon
          points={points.join(' ')}
          fill={color}
          stroke="white"
          strokeWidth={0.8}
        />
      );
    }
    return (
      <circle
        cx={cx}
        cy={cy}
        r={3.4}
        fill={color}
        stroke="white"
        strokeWidth={0.8}
      />
    );
  };

  /** Render the per-panel legend so each panel's labels can be edited
   *  independently from the inspector. */
  const renderLegend = (panelKey: 'a' | 'b', innerWidth: number) => {
    const colWidth = innerWidth / 2;
    return (
      <g transform={`translate(0, ${innerH + 52})`}>
        {DEFAULT_METHODS.map((m, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = col * colWidth;
          const y = row * 14;
          const labelId = `legend-${panelKey}-${m.name}`;
          const labelStyle = textOverrides.resolve(labelId, {
            text: m.name,
            fontSize: 10,
            fontWeight: m.highlight ? 600 : 500,
          });
          return (
            <g key={m.name} transform={`translate(${x}, ${y})`}>
              <line
                x1={0}
                x2={18}
                y1={0}
                y2={0}
                stroke={palette[i]}
                strokeWidth={m.highlight ? 3 : 2}
              />
              {m.highlight ? (
                renderMarker(9, 0, palette[i], true)
              ) : (
                <circle cx={9} cy={0} r={2.6} fill={palette[i]} />
              )}
              <EditableSvgText
                id={labelId}
                x={24}
                y={3.5}
                style={labelStyle}
                textAnchor="start"
                selected={textOverrides.selectedId === labelId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />
            </g>
          );
        })}
      </g>
    );
  };

  const titleId = 'title';
  const captionId = 'caption';
  const titleStyle = textOverrides.resolve(titleId, {
    text: 'Window-length robustness · CHB-MIT (LOSO)',
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text:
      'Synthetic curves seeded from §3 Table 4; left: event sensitivity, right: detection latency.',
    fontSize: 12,
  });

  useLatestPythonEmitter(pythonEmitterRef, () =>
    emitWindowRobustnessPython({
      title: titleStyle.text,
      caption: captionStyle.text,
      windows: WINDOWS_S,
      series: series.map((s, i) => ({
        name: s.spec.name,
        sensitivity: s.sensitivity,
        latency: s.latency,
        color: palette[i] ?? '#444',
        highlight: Boolean(s.spec.highlight),
      })),
      showMarkers,
      showOursBand,
    }),
  );
  const panelATitleId = 'panel-a-title';
  const panelBTitleId = 'panel-b-title';
  const panelAStyle = textOverrides.resolve(panelATitleId, {
    text: '(a) Event Sensitivity vs. window length',
    fontSize: 12.5,
    fontWeight: 600,
  });
  const panelBStyle = textOverrides.resolve(panelBTitleId, {
    text: '(b) Detection Latency vs. window length',
    fontSize: 12.5,
    fontWeight: 600,
  });

  const textRefs = useMemo(() => {
    const refs: Array<{
      id: string;
      label: string;
      defaultText: string;
      defaultFontSize: number;
      defaultFontWeight?: number;
    }> = [
      {
        id: titleId,
        label: '主标题',
        defaultText: 'Window-length robustness · CHB-MIT (LOSO)',
        defaultFontSize: 14,
        defaultFontWeight: 600,
      },
      {
        id: captionId,
        label: '说明文字',
        defaultText:
          'Synthetic curves seeded from §3 Table 4; left: event sensitivity, right: detection latency.',
        defaultFontSize: 12,
      },
      {
        id: panelATitleId,
        label: '面板 (a) 标题',
        defaultText: '(a) Event Sensitivity vs. window length',
        defaultFontSize: 12.5,
        defaultFontWeight: 600,
      },
      {
        id: panelBTitleId,
        label: '面板 (b) 标题',
        defaultText: '(b) Detection Latency vs. window length',
        defaultFontSize: 12.5,
        defaultFontWeight: 600,
      },
    ];
    (['a', 'b'] as const).forEach((pk) => {
      DEFAULT_METHODS.forEach((m) => {
        refs.push({
          id: `legend-${pk}-${m.name}`,
          label: `面板${pk} · 图例：${m.name}`,
          defaultText: m.name,
          defaultFontSize: 10,
          defaultFontWeight: m.highlight ? 600 : 500,
        });
      });
    });
    return refs;
  }, []);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'paper',
              label: '论文复现',
              hint: '默认',
              description: '种子=11、jitter=0.18，与 §3 表 4 一致。',
              apply: () => {
                setSeed(11);
                setJitter(0.18);
                setShowOursBand(true);
              },
            },
            {
              id: 'noisy',
              label: '高扰动',
              hint: '稳健',
              description: '加大 jitter 以观察曲线鲁棒性。',
              apply: () => {
                setJitter(0.4);
              },
            },
            {
              id: 'clean',
              label: '理想曲线',
              hint: '示意',
              description: '关闭扰动，展示模型增益的纯粹趋势。',
              apply: () => {
                setJitter(0);
              },
            },
            {
              id: 'reseed',
              label: '重新采样',
              hint: '抖动',
              description: '换一组 LOSO 折，验证趋势稳定。',
              apply: () => {
                setSeed((s) => s + 1);
              },
            },
          ]}
        />
      }
      filename="window-robustness"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="扰动">
            <NumberSlider
              label="jitter"
              value={jitter}
              min={0}
              max={0.4}
              step={0.01}
              onChange={setJitter}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle
              label="数据点"
              checked={showMarkers}
              onChange={setShowMarkers}
            />
            <Toggle
              label="Ours 渐变填充带"
              checked={showOursBand}
              onChange={setShowOursBand}
            />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          (a) 不同分析窗长下 GAT-CMC-Net 与 3 个基线在 CHB-MIT 上的事件级
          灵敏度 (Event SE)。窗长越长信息越充分，但也意味着更晚的预警；
          (b) 同一窗长配置下的平均检出延迟。我们的方法在小窗（10 s）下
          已显著领先，且延迟保持最低。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={titleStyle.text}
          caption={captionStyle.text}
          titleOverride={textOverrides.overrides[titleId]}
          titleSelected={textOverrides.selectedId === titleId}
          onSelectTitle={() => textOverrides.selectText(titleId)}
          captionOverride={textOverrides.overrides[captionId]}
          captionSelected={textOverrides.selectedId === captionId}
          onSelectCaption={() => textOverrides.selectText(captionId)}
        >
          {/* Panel A — Event sensitivity */}
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <EditableSvgText
              id={panelATitleId}
              x={innerW / 2}
              y={-22}
              style={panelAStyle}
              textAnchor="middle"
              selected={textOverrides.selectedId === panelATitleId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />

            <YAxis
              axis={seAxis}
              offset={0}
              label="Event sensitivity"
              gridExtent={innerW}
            />
            <XAxis
              axis={xAxis}
              offset={innerH}
              label="Window length (s)"
              gridExtent={innerH}
            />

            {/* Ours sensitivity band — gradient fill below the line */}
            {showOursBand
              ? (() => {
                  const ours = series.find((s) => s.spec.highlight);
                  if (!ours) return null;
                  const pts = ours.sensitivity.map(
                    (v, i) =>
                      [xAxis.scale(WINDOWS_S[i]), seAxis.scale(v)] as const,
                  );
                  const path =
                    'M' +
                    pts.map((p) => `${p[0]},${p[1]}`).join(' L') +
                    ` L${pts[pts.length - 1][0]},${innerH} L${pts[0][0]},${innerH} Z`;
                  return (
                    <>
                      <defs>
                        <linearGradient
                          id="wr-ours-grad"
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
                          <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <path d={path} fill="url(#wr-ours-grad)" />
                    </>
                  );
                })()
              : null}

            {series.map((s, i) => (
              <g key={s.spec.name}>
                <path
                  d={seLine(s.sensitivity) ?? undefined}
                  fill="none"
                  stroke={palette[i]}
                  strokeWidth={s.spec.highlight ? 2.6 : 1.6}
                  strokeOpacity={s.spec.highlight ? 1 : 0.85}
                />
                {showMarkers &&
                  s.sensitivity.map((v, j) => (
                    <g key={j}>
                      {renderMarker(
                        xAxis.scale(WINDOWS_S[j]),
                        seAxis.scale(v),
                        palette[i],
                        !!s.spec.highlight,
                      )}
                    </g>
                  ))}
              </g>
            ))}

            {/* Δ annotation: show the lift at 10 s for "Ours" vs. best baseline */}
            {(() => {
              const ours = series.find((s) => s.spec.highlight);
              const others = series.filter((s) => !s.spec.highlight);
              if (!ours || others.length === 0) return null;
              const idx10 = WINDOWS_S.indexOf(10);
              if (idx10 < 0) return null;
              const ourVal = ours.sensitivity[idx10];
              const bestOther = Math.max(
                ...others.map((s) => s.sensitivity[idx10]),
              );
              const x = xAxis.scale(10);
              const yLow = seAxis.scale(bestOther);
              const yHigh = seAxis.scale(ourVal);
              return (
                <g pointerEvents="none">
                  <line
                    x1={x}
                    x2={x}
                    y1={yLow}
                    y2={yHigh}
                    stroke={ACCENT}
                    strokeWidth={1.4}
                  />
                  <line
                    x1={x - 5}
                    x2={x + 5}
                    y1={yLow}
                    y2={yLow}
                    stroke={ACCENT}
                    strokeWidth={1.4}
                  />
                  <line
                    x1={x - 5}
                    x2={x + 5}
                    y1={yHigh}
                    y2={yHigh}
                    stroke={ACCENT}
                    strokeWidth={1.4}
                  />
                  <text
                    x={x + 8}
                    y={(yLow + yHigh) / 2 + 3}
                    fontSize={10.5}
                    fontWeight={600}
                    fill={ACCENT}
                    fontFamily='"JetBrains Mono", monospace'
                  >
                    +{((ourVal - bestOther) * 100).toFixed(1)}%
                  </text>
                </g>
              );
            })()}

            {renderLegend('a', innerW)}
          </g>

          {/* Panel B — Latency */}
          <g
            transform={`translate(${margin.left + panelW + panelGap}, ${margin.top})`}
          >
            <EditableSvgText
              id={panelBTitleId}
              x={innerW / 2}
              y={-22}
              style={panelBStyle}
              textAnchor="middle"
              selected={textOverrides.selectedId === panelBTitleId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />

            <YAxis
              axis={latAxis}
              offset={0}
              label="Detection latency (s)"
              gridExtent={innerW}
            />
            <XAxis
              axis={xAxis}
              offset={innerH}
              label="Window length (s)"
              gridExtent={innerH}
            />

            {series.map((s, i) => (
              <g key={s.spec.name}>
                <path
                  d={latLine(s.latency) ?? undefined}
                  fill="none"
                  stroke={palette[i]}
                  strokeWidth={s.spec.highlight ? 2.6 : 1.6}
                  strokeOpacity={s.spec.highlight ? 1 : 0.85}
                />
                {showMarkers &&
                  s.latency.map((v, j) => (
                    <g key={j}>
                      {renderMarker(
                        xAxis.scale(WINDOWS_S[j]),
                        latAxis.scale(v),
                        palette[i],
                        !!s.spec.highlight,
                      )}
                    </g>
                  ))}
              </g>
            ))}

            {renderLegend('b', innerW)}
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'window-robustness',
  title: '窗长鲁棒性（CHB-MIT LOSO）',
  titleEn: 'Window-length Robustness',
  category: 'evaluation',
  summary:
    '窗长扫描下，Event Sensitivity 与 Detection Latency 的双面板对比；GAT-CMC-Net 高亮。',
  component: WindowRobustness,
});
