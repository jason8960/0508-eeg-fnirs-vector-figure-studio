import { useCallback, useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { YAxis } from '../../components/Axis';
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
import type { TextOverrideMap } from '../../lib/useTextOverrides';
import { emitBaselineBarsPython } from './python';

/**
 * Three-panel baseline comparison (CHB-MIT LOSO).
 *
 *   (a) Event Sensitivity ↑
 *   (b) False Alarms / hour ↓
 *   (c) Detection Latency ↓
 *
 * 9 baselines + GAT-CMC-Net (Ours, highlighted with the accent
 * stroke). Each panel uses a single hue family so the three rows read
 * as a triptych while staying visually distinct.
 */

const ACCENT = '#f97316';

interface BaselineRow {
  name: string;
  /** Event Sensitivity (higher better). */
  se: number;
  /** False alarms per hour (lower better). */
  fa: number;
  /** Detection latency (s, lower better). */
  lat: number;
  highlight?: boolean;
}

const BASELINES: BaselineRow[] = [
  { name: 'EEGNet', se: 0.78, fa: 1.2, lat: 12.5 },
  { name: 'DeepConvNet', se: 0.8, fa: 1.05, lat: 13.2 },
  { name: 'CNN-LSTM', se: 0.76, fa: 1.15, lat: 14.6 },
  { name: 'iGGCN', se: 0.84, fa: 0.85, lat: 11.0 },
  { name: 'Dyn-FC GNN', se: 0.82, fa: 0.95, lat: 11.8 },
  { name: 'GAT-Epi', se: 0.86, fa: 0.7, lat: 9.6 },
  { name: 'MA-MP-GF', se: 0.87, fa: 0.65, lat: 9.0 },
  { name: 'MBC-ATT', se: 0.83, fa: 0.8, lat: 10.2 },
  { name: 'STFT+TL', se: 0.79, fa: 1.0, lat: 13.0 },
  { name: 'Ours (GAT-CMC-Net)', se: 0.94, fa: 0.32, lat: 6.4, highlight: true },
];

interface PanelKey {
  key: 'se' | 'fa' | 'lat';
  title: string;
  unit: string;
  betterArrow: '↑' | '↓';
  /** Which colour map family to sample for that panel. */
  colormap: ColormapName;
  /** Override colormap value (chosen by user via inspector). */
  yLabel: string;
}

const PANELS: PanelKey[] = [
  {
    key: 'se',
    title: '(a) Event Sensitivity',
    unit: '',
    betterArrow: '↑',
    colormap: 'viridis',
    yLabel: 'Event SE',
  },
  {
    key: 'fa',
    title: '(b) False Alarms / hour',
    unit: '',
    betterArrow: '↓',
    colormap: 'magma',
    yLabel: 'FA / h',
  },
  {
    key: 'lat',
    title: '(c) Detection Latency',
    unit: 's',
    betterArrow: '↓',
    colormap: 'cividis',
    yLabel: 'Latency (s)',
  },
];

interface Resampled {
  se: number[];
  fa: number[];
  lat: number[];
}

function resample(jitter: number, seed: number): Resampled {
  const rng = mulberry32(seed);
  return {
    se: BASELINES.map((b) =>
      Math.max(0, Math.min(1, b.se + randn(rng) * jitter * 0.05)),
    ),
    fa: BASELINES.map((b) => Math.max(0, b.fa + randn(rng) * jitter * 0.08)),
    lat: BASELINES.map((b) => Math.max(0, b.lat + randn(rng) * jitter * 0.6)),
  };
}

const STORAGE_KEY = 'baseline-bars-configs-v1';

interface SavedConfig {
  version: 1;
  seed: number;
  jitter: number;
  showValues: boolean;
  colormap: ColormapName | 'panel-default';
  showOursTrend: boolean;
  showErrorBars: boolean;
  errorMagnitude: number;
  textOverrides?: TextOverrideMap;
}

function BaselineBars() {
  const [seed, setSeed] = useState(13);
  const [jitter, setJitter] = useState(0);
  const [showValues, setShowValues] = useState(true);
  const [colormap, setColormap] = useState<ColormapName | 'panel-default'>(
    'panel-default',
  );
  const [showOursTrend, setShowOursTrend] = useState(true);
  const [showErrorBars, setShowErrorBars] = useState(false);
  const [errorMagnitude, setErrorMagnitude] = useState(0.04);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(() => resample(jitter, seed), [jitter, seed]);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      jitter,
      showValues,
      colormap,
      showOursTrend,
      showErrorBars,
      errorMagnitude,
    }),
    [seed, jitter, showValues, colormap, showOursTrend, showErrorBars, errorMagnitude],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setJitter(cfg.jitter);
    setShowValues(cfg.showValues);
    setColormap(cfg.colormap);
    setShowOursTrend(cfg.showOursTrend);
    setShowErrorBars(cfg.showErrorBars);
    setErrorMagnitude(cfg.errorMagnitude);
  }, []);
  const pythonEmitterRef = useRef<PythonEmitter | null>(null);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<
    SavedConfig
  >({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'baseline-bars-config.json',
    pythonEmitterRef,
    pythonFilename: 'baseline-bars.py',
  });

  const expertSchema: ExpertSchema = [
    {
      label: '随机性',
      fields: [
        { type: 'number', key: 'sd', label: '种子', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
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
        { type: 'toggle', key: 'sv', label: '柱顶数值', value: showValues, onChange: setShowValues },
        {
          type: 'toggle',
          key: 'ot',
          label: 'Ours 提示线',
          value: showOursTrend,
          onChange: setShowOursTrend,
        },
        { type: 'toggle', key: 'eb', label: '显示误差棒', value: showErrorBars, onChange: setShowErrorBars },
        {
          type: 'number',
          key: 'em',
          label: '误差棒幅度',
          min: 0.005,
          max: 0.1,
          step: 0.005,
          value: errorMagnitude,
          onChange: setErrorMagnitude,
          slider: true,
          format: (v) => v.toFixed(3),
        },
        {
          type: 'select',
          key: 'cm-mode',
          label: '配色模式',
          value: colormap === 'panel-default' ? 'panel-default' : 'global',
          onChange: (v) => {
            if (v === 'panel-default') setColormap('panel-default');
            else setColormap('viridis');
          },
          options: [
            { value: 'panel-default', label: '逐面板默认（视觉分隔）' },
            { value: 'global', label: '统一配色' },
          ],
        },
        ...(colormap !== 'panel-default'
          ? ([
              {
                type: 'colormap' as const,
                key: 'cm',
                value: colormap as ColormapName,
                onChange: (v: ColormapName) => setColormap(v),
              },
            ])
          : []),
      ],
    },
    {
      label: '基线',
      fields: [
        { type: 'info', key: 'n', label: '方法数', value: String(BASELINES.length) },
      ],
    },
  ];

  const W = 940;
  const H = 720;
  const margin = { top: 28, right: 56, bottom: 110, left: 70 };
  const panelGap = 26;
  const innerW = W - margin.left - margin.right;
  const totalH = H - margin.top - margin.bottom;
  const panelH = (totalH - panelGap * (PANELS.length - 1)) / PANELS.length;

  const xBands = BASELINES.map((_, i) => {
    const slot = innerW / BASELINES.length;
    return i * slot + slot / 2;
  });
  const slotWidth = innerW / BASELINES.length;
  const barW = slotWidth * 0.7;

  /** Build a per-panel y-axis given the data and panel kind. */
  const buildAxis = (kind: PanelKey['key']) => {
    if (kind === 'se') {
      const maxV = Math.max(...data.se) * 1.05;
      return buildLinearAxis({
        domain: [0, Math.max(1, maxV)],
        range: [panelH, 0],
        ticks: [0, 0.2, 0.4, 0.6, 0.8, 1],
        format: (v) => v.toFixed(1),
      });
    }
    if (kind === 'fa') {
      const maxV = Math.max(...data.fa) * 1.15;
      return buildLinearAxis({
        domain: [0, maxV],
        range: [panelH, 0],
        tickCount: 5,
        nice: true,
      });
    }
    const maxV = Math.max(...data.lat) * 1.1;
    return buildLinearAxis({
      domain: [0, maxV],
      range: [panelH, 0],
      tickCount: 5,
      nice: true,
    });
  };

  const colorOf = (panel: PanelKey, methodIndex: number, isHighlight: boolean) => {
    if (isHighlight) return ACCENT;
    const cmap = colormap === 'panel-default' ? panel.colormap : (colormap as ColormapName);
    const base = sampleColormap(cmap, BASELINES.length + 2);
    return base[methodIndex + 1];
  };

  const titleId = 'title';
  const captionId = 'caption';
  const titleStyle = textOverrides.resolve(titleId, {
    text: 'Baseline comparison · CHB-MIT (LOSO)',
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: 'Synthetic values aligned with §3 Table 3; Ours = GAT-CMC-Net.',
    fontSize: 12,
  });

  useLatestPythonEmitter(pythonEmitterRef, () =>
    emitBaselineBarsPython({
      title: titleStyle.text,
      caption: captionStyle.text,
      baselineNames: BASELINES.map((b) => b.name),
      highlightFlags: BASELINES.map((b) => Boolean(b.highlight)),
      seValues: data.se,
      faValues: data.fa,
      latValues: data.lat,
      panelTitles: PANELS.map((p) => p.title),
      panelYLabels: PANELS.map((p) => p.yLabel),
      panelPalettes: PANELS.map((p) =>
        sampleColormap(
          colormap === 'panel-default' ? p.colormap : (colormap as ColormapName),
          BASELINES.length + 2,
        ).slice(1, BASELINES.length + 1),
      ),
      showValues,
      showErrorBars,
      errorMagnitude,
    }),
  );

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
        defaultText: 'Baseline comparison · CHB-MIT (LOSO)',
        defaultFontSize: 14,
        defaultFontWeight: 600,
      },
      {
        id: captionId,
        label: '说明文字',
        defaultText:
          'Synthetic values aligned with §3 Table 3; Ours = GAT-CMC-Net.',
        defaultFontSize: 12,
      },
    ];
    PANELS.forEach((panel) => {
      refs.push({
        id: `panel-title-${panel.key}`,
        label: `面板标题：${panel.title}`,
        defaultText: panel.title,
        defaultFontSize: 12,
        defaultFontWeight: 600,
      });
    });
    BASELINES.forEach((row) => {
      refs.push({
        id: `xtick-${row.name}`,
        label: `方法标签：${row.name}`,
        defaultText: row.name,
        defaultFontSize: 11,
        defaultFontWeight: row.highlight ? 700 : 500,
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
              description: '逐面板默认配色，Ours 高亮、显示数值。',
              apply: () => {
                setSeed(13);
                setJitter(0);
                setShowValues(true);
                setShowOursTrend(true);
                setShowErrorBars(false);
                setColormap('panel-default');
              },
            },
            {
              id: 'unified',
              label: '统一配色',
              hint: '简洁',
              description: '三面板共享 plasma — 横向一致性。',
              apply: () => {
                setColormap('plasma');
              },
            },
            {
              id: 'audit',
              label: '审计模式',
              hint: '审稿',
              description: '加误差棒、抖动样本、加深结构。',
              apply: () => {
                setShowErrorBars(true);
                setJitter(0.3);
                setErrorMagnitude(0.05);
              },
            },
            {
              id: 'minimal',
              label: '极简版',
              hint: '海报',
              description: '关闭数值与提示线，纯柱图比对。',
              apply: () => {
                setShowValues(false);
                setShowOursTrend(false);
                setShowErrorBars(false);
              },
            },
          ]}
        />
      }
      filename="baseline-bars"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="随机性">
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
            <Toggle label="柱顶数值" checked={showValues} onChange={setShowValues} />
            <Toggle
              label="Ours 提示线"
              checked={showOursTrend}
              onChange={setShowOursTrend}
            />
            <Toggle label="误差棒" checked={showErrorBars} onChange={setShowErrorBars} />
            {colormap !== 'panel-default' ? (
              <ColormapSelect
                value={colormap as ColormapName}
                onChange={(v) => setColormap(v)}
              />
            ) : null}
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          基线方法在 CHB-MIT LOSO 上的事件级灵敏度、每小时虚警率与平均
          检出延迟。GAT-CMC-Net 在三个指标上同时取得最优；尤其是 FA/h
          降至 0.32（次优为 0.65），延迟降至 6.4 s（次优为 9.0 s），
          表明跨模态融合提供了实际可用的临床预警窗。点击预览图中的标题、
          面板标题或方法标签可直接调整字体、字重、颜色与位置。
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
          {PANELS.map((panel, pi) => {
            const yAxis = buildAxis(panel.key);
            const baseY = yAxis.scale(0);
            const transformY = margin.top + pi * (panelH + panelGap);
            const values =
              panel.key === 'se'
                ? data.se
                : panel.key === 'fa'
                ? data.fa
                : data.lat;
            const ours = values[BASELINES.findIndex((b) => b.highlight)];
            const panelTitleId = `panel-title-${panel.key}`;
            const panelTitleStyle = textOverrides.resolve(panelTitleId, {
              text: panel.title,
              fontSize: 12,
              fontWeight: 600,
            });
            return (
              <g
                key={panel.key}
                transform={`translate(${margin.left}, ${transformY})`}
              >
                {/* Panel title — editable */}
                <EditableSvgText
                  id={panelTitleId}
                  x={0}
                  y={-10}
                  style={panelTitleStyle}
                  textAnchor="start"
                  selected={textOverrides.selectedId === panelTitleId}
                  onSelect={(id) => textOverrides.selectText(id)}
                  onMove={(id, dx, dy) =>
                    textOverrides.setOverride(id, { dx, dy })
                  }
                  svgRef={svgRef}
                />
                {/* Better-direction arrow (kept inline; not editable) */}
                <text
                  x={panelTitleStyle.text.length * panelTitleStyle.fontSize * 0.55 + 6}
                  y={-10}
                  fontSize={11}
                  fill={ACCENT}
                >
                  {panel.betterArrow}
                </text>

                <YAxis
                  axis={yAxis}
                  offset={0}
                  label={panel.yLabel}
                  gridExtent={innerW}
                />

                {/* Ours reference line */}
                {showOursTrend ? (
                  <g>
                    <line
                      x1={0}
                      x2={innerW}
                      y1={yAxis.scale(ours)}
                      y2={yAxis.scale(ours)}
                      stroke={ACCENT}
                      strokeWidth={1}
                      strokeOpacity={0.5}
                      strokeDasharray="4 4"
                    />
                    <text
                      x={innerW + 4}
                      y={yAxis.scale(ours) + 3}
                      fontSize={10}
                      fontFamily='"JetBrains Mono", monospace'
                      fill={ACCENT}
                    >
                      {ours.toFixed(2)}
                    </text>
                  </g>
                ) : null}

                {/* Bars */}
                {BASELINES.map((row, i) => {
                  const cx = xBands[i];
                  const v = values[i];
                  const y = yAxis.scale(v);
                  return (
                    <g key={row.name}>
                      <rect
                        x={cx - barW / 2}
                        y={y}
                        width={barW}
                        height={baseY - y}
                        fill={colorOf(panel, i, !!row.highlight)}
                        fillOpacity={row.highlight ? 1 : 0.92}
                        stroke={row.highlight ? ACCENT : 'none'}
                        strokeWidth={row.highlight ? 2.4 : 0}
                      />
                      {showValues ? (
                        <text
                          x={cx}
                          y={y - 6}
                          textAnchor="middle"
                          fontSize={10}
                          fontFamily='"JetBrains Mono", monospace'
                          fontWeight={row.highlight ? 700 : 500}
                          fill={row.highlight ? ACCENT : 'currentColor'}
                        >
                          {panel.key === 'lat' ? v.toFixed(1) : v.toFixed(2)}
                        </text>
                      ) : null}
                      {showErrorBars ? (
                        <line
                          x1={cx}
                          x2={cx}
                          y1={yAxis.scale(
                            Math.max(0, v - errorMagnitude * (panel.key === 'lat' ? 6 : panel.key === 'fa' ? 4 : 1)),
                          )}
                          y2={yAxis.scale(
                            v + errorMagnitude * (panel.key === 'lat' ? 6 : panel.key === 'fa' ? 4 : 1),
                          )}
                          stroke={
                            row.highlight
                              ? ACCENT
                              : colorOf(panel, i, false)
                          }
                          strokeWidth={1.4}
                        />
                      ) : null}
                    </g>
                  );
                })}

                {/* X line */}
                <line
                  x1={0}
                  x2={innerW}
                  y1={panelH}
                  y2={panelH}
                  stroke="currentColor"
                  strokeWidth={1}
                />

                {/* X tick labels — only on the bottom panel; editable */}
                {pi === PANELS.length - 1 ? (
                  <g>
                    {BASELINES.map((row, i) => {
                      const tickId = `xtick-${row.name}`;
                      const tickStyle = textOverrides.resolve(tickId, {
                        text: row.name,
                        fontSize: 11,
                        fontWeight: row.highlight ? 700 : 500,
                        color: row.highlight ? ACCENT : 'currentColor',
                      });
                      return (
                        <g
                          key={row.name}
                          transform={`translate(${xBands[i]}, ${panelH})`}
                        >
                          <line
                            y1={0}
                            y2={5}
                            stroke="currentColor"
                            strokeOpacity={0.6}
                          />
                          <EditableSvgText
                            id={tickId}
                            x={0}
                            y={20}
                            style={tickStyle}
                            textAnchor="end"
                            rotate={-32}
                            selected={textOverrides.selectedId === tickId}
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
                ) : null}
              </g>
            );
          })}
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'baseline-bars',
  title: '全部基线 + GAT-CMC-Net 综合对比（CHB-MIT LOSO）',
  titleEn: 'Baseline Comparison Bars',
  category: 'evaluation',
  summary:
    '三面板基线对比：Event SE↑、FA/h↓、Detection Latency↓；GAT-CMC-Net 高亮，附带 Ours 参考线。',
  component: BaselineBars,
});
