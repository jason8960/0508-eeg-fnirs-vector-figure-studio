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
import { emitAblationBarsPython } from './python';

/**
 * Ablation experiment under LOSO patient-independent splits.
 *
 * Two-panel layout:
 *   (a) Event sensitivity on CHB-MIT vs. TUSZ — grouped bars across
 *       6 ablation conditions (Full + A1..A5).
 *   (b) False alarms per hour (FA/h) on CHB-MIT — single series.
 *
 * The "Full" model is rendered with a thicker border so it reads as
 * the reference baseline. Bars are coloured from a perceptual ramp;
 * paired bars in panel (a) split CHB-MIT (cool) and TUSZ (warm).
 */

const ACCENT = '#f97316';
const DATASET_BLUE = '#1f77b4';
const DATASET_ORANGE = '#ff7f0e';

interface Condition {
  /** Short id used as the x-tick (Full / A1 .. A5). */
  id: string;
  /** Bilingual short label rendered under the x-tick. */
  detail: string;
  /** Whether this is the reference (Full model). */
  isFull?: boolean;
  /** Event SE on CHB-MIT. */
  seCHB: number;
  /** Event SE on TUSZ. */
  seTUSZ: number;
  /** False-alarms per hour on CHB-MIT. */
  faCHB: number;
}

const CONDITIONS: Condition[] = [
  {
    id: 'Full',
    detail: 'GAT-CMC-Net',
    isFull: true,
    seCHB: 0.94,
    seTUSZ: 0.91,
    faCHB: 0.32,
  },
  {
    id: 'A1',
    detail: '−GAT (用 GCN)',
    seCHB: 0.89,
    seTUSZ: 0.86,
    faCHB: 0.55,
  },
  {
    id: 'A2',
    detail: '−跨模态边',
    seCHB: 0.86,
    seTUSZ: 0.83,
    faCHB: 0.62,
  },
  {
    id: 'A3',
    detail: '−HRF 时移',
    seCHB: 0.81,
    seTUSZ: 0.78,
    faCHB: 0.95,
  },
  {
    id: 'A4',
    detail: '−门控融合',
    seCHB: 0.9,
    seTUSZ: 0.87,
    faCHB: 0.5,
  },
  {
    id: 'A5',
    detail: '−结构先验邻接',
    seCHB: 0.88,
    seTUSZ: 0.85,
    faCHB: 0.58,
  },
];

interface Resampled {
  seCHB: number[];
  seTUSZ: number[];
  faCHB: number[];
}

function resample(jitter: number, seed: number): Resampled {
  const rng = mulberry32(seed);
  return {
    seCHB: CONDITIONS.map((c) =>
      Math.max(0, Math.min(1, c.seCHB + randn(rng) * jitter * 0.05)),
    ),
    seTUSZ: CONDITIONS.map((c) =>
      Math.max(0, Math.min(1, c.seTUSZ + randn(rng) * jitter * 0.05)),
    ),
    faCHB: CONDITIONS.map((c) =>
      Math.max(0, c.faCHB + randn(rng) * jitter * 0.06),
    ),
  };
}

const STORAGE_KEY = 'ablation-bars-configs-v1';

interface SavedConfig {
  version: 1;
  seed: number;
  jitter: number;
  showValues: boolean;
  colormap: ColormapName;
  highlightFull: boolean;
  showErrorBars: boolean;
  errorMagnitude: number;
  textOverrides?: TextOverrideMap;
}

function AblationBars() {
  const [seed, setSeed] = useState(7);
  const [jitter, setJitter] = useState(0);
  const [showValues, setShowValues] = useState(true);
  const [colormap, setColormap] = useState<ColormapName>('plasma');
  const [highlightFull, setHighlightFull] = useState(true);
  const [showErrorBars, setShowErrorBars] = useState(false);
  const [errorMagnitude, setErrorMagnitude] = useState(0.018);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(() => resample(jitter, seed), [jitter, seed]);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      jitter,
      showValues,
      colormap,
      highlightFull,
      showErrorBars,
      errorMagnitude,
    }),
    [
      seed,
      jitter,
      showValues,
      colormap,
      highlightFull,
      showErrorBars,
      errorMagnitude,
    ],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setJitter(cfg.jitter);
    setShowValues(cfg.showValues);
    setColormap(cfg.colormap);
    setHighlightFull(cfg.highlightFull);
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
    filename: 'ablation-bars-config.json',
    pythonEmitterRef,
    pythonFilename: 'ablation-bars.py',
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
          key: 'hf',
          label: 'Full 模型加粗描边',
          value: highlightFull,
          onChange: setHighlightFull,
        },
        {
          type: 'toggle',
          key: 'eb',
          label: '显示误差棒',
          value: showErrorBars,
          onChange: setShowErrorBars,
        },
        {
          type: 'number',
          key: 'em',
          label: '误差棒幅度',
          min: 0.005,
          max: 0.06,
          step: 0.002,
          value: errorMagnitude,
          onChange: setErrorMagnitude,
          slider: true,
          format: (v) => v.toFixed(3),
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
      label: '条件',
      fields: [
        {
          type: 'info',
          key: 'n',
          label: '消融条件',
          value: String(CONDITIONS.length),
        },
      ],
    },
  ];

  const W = 940;
  const H = 470;
  const panelGap = 56;
  const panelW = (W - panelGap) / 2;
  const margin = { top: 56, right: 24, bottom: 116, left: 64 };
  const innerW = panelW - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const xBands = CONDITIONS.map((_, i) => {
    const slot = innerW / CONDITIONS.length;
    return i * slot + slot / 2;
  });
  const slotWidth = innerW / CONDITIONS.length;
  const barGroup = slotWidth * 0.8;
  const subBarW = barGroup / 2 - 2;

  const seAxis = buildLinearAxis({
    domain: [0.65, 1],
    range: [innerH, 0],
    ticks: [0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0],
    format: (v) => v.toFixed(2),
  });

  const faMax = Math.max(...data.faCHB) * 1.1;
  const faAxis = buildLinearAxis({
    domain: [0, Math.max(1.1, faMax)],
    range: [innerH, 0],
    tickCount: 6,
    nice: true,
  });

  const palette = useMemo(
    () => sampleColormap(colormap, CONDITIONS.length),
    [colormap],
  );

  /** Render the column-name tick labels for a given panel. The id
   *  prefix differs per panel so each panel's row can be edited
   *  independently from the inspector. */
  const renderXTicks = (panelKey: 'a' | 'b') =>
    CONDITIONS.map((cond, i) => {
      const idIdName = `xtick-${panelKey}-${cond.id}`;
      const idDetailName = `xtick-detail-${panelKey}-${cond.id}`;
      const idStyle = textOverrides.resolve(idIdName, {
        text: cond.id,
        fontSize: 11.5,
        fontWeight: 600,
        color: cond.isFull ? ACCENT : 'currentColor',
      });
      const detailStyle = textOverrides.resolve(idDetailName, {
        text: cond.detail,
        fontSize: 10,
        color: 'rgba(0,0,0,0.78)',
      });
      return (
        <g key={cond.id} transform={`translate(${xBands[i]}, ${innerH})`}>
          <line y1={0} y2={5} stroke="currentColor" strokeOpacity={0.6} />
          <EditableSvgText
            id={idIdName}
            x={0}
            y={20}
            style={idStyle}
            textAnchor="middle"
            selected={textOverrides.selectedId === idIdName}
            onSelect={(id) => textOverrides.selectText(id)}
            onMove={(id, dx, dy) =>
              textOverrides.setOverride(id, { dx, dy })
            }
            svgRef={svgRef}
          />
          <EditableSvgText
            id={idDetailName}
            x={0}
            y={32}
            style={detailStyle}
            textAnchor="end"
            rotate={-32}
            selected={textOverrides.selectedId === idDetailName}
            onSelect={(id) => textOverrides.selectText(id)}
            onMove={(id, dx, dy) =>
              textOverrides.setOverride(id, { dx, dy })
            }
            svgRef={svgRef}
          />
        </g>
      );
    });

  const titleId = 'title';
  const captionId = 'caption';
  const titleStyle = textOverrides.resolve(titleId, {
    text: 'Ablation study · LOSO patient-independent',
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text:
      'Synthetic values aligned with §3 Table 5; bars are mean across folds.',
    fontSize: 12,
  });

  useLatestPythonEmitter(pythonEmitterRef, () =>
    emitAblationBarsPython({
      title: titleStyle.text,
      caption: captionStyle.text,
      conditionIds: CONDITIONS.map((c) => c.id),
      conditionDetails: CONDITIONS.map((c) => c.detail),
      fullIndex: CONDITIONS.findIndex((c) => c.isFull),
      seCHB: data.seCHB,
      seTUSZ: data.seTUSZ,
      faCHB: data.faCHB,
      showValues,
      highlightFull,
      showErrorBars,
      errorMagnitude,
      palette,
    }),
  );
  const panelATitleId = 'panel-a-title';
  const panelBTitleId = 'panel-b-title';
  const legendChbId = 'legend-chb';
  const legendTuszId = 'legend-tusz';
  const panelAStyle = textOverrides.resolve(panelATitleId, {
    text: '(a) Event Sensitivity · CHB-MIT vs. TUSZ',
    fontSize: 12.5,
    fontWeight: 600,
  });
  const panelBStyle = textOverrides.resolve(panelBTitleId, {
    text: '(b) False Alarms / hour · CHB-MIT',
    fontSize: 12.5,
    fontWeight: 600,
  });
  const legendChbStyle = textOverrides.resolve(legendChbId, {
    text: 'CHB-MIT',
    fontSize: 11,
  });
  const legendTuszStyle = textOverrides.resolve(legendTuszId, {
    text: 'TUSZ',
    fontSize: 11,
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
        defaultText: 'Ablation study · LOSO patient-independent',
        defaultFontSize: 14,
        defaultFontWeight: 600,
      },
      {
        id: captionId,
        label: '说明文字',
        defaultText:
          'Synthetic values aligned with §3 Table 5; bars are mean across folds.',
        defaultFontSize: 12,
      },
      {
        id: panelATitleId,
        label: '面板 (a) 标题',
        defaultText: '(a) Event Sensitivity · CHB-MIT vs. TUSZ',
        defaultFontSize: 12.5,
        defaultFontWeight: 600,
      },
      {
        id: panelBTitleId,
        label: '面板 (b) 标题',
        defaultText: '(b) False Alarms / hour · CHB-MIT',
        defaultFontSize: 12.5,
        defaultFontWeight: 600,
      },
      {
        id: legendChbId,
        label: '图例：CHB-MIT',
        defaultText: 'CHB-MIT',
        defaultFontSize: 11,
      },
      {
        id: legendTuszId,
        label: '图例：TUSZ',
        defaultText: 'TUSZ',
        defaultFontSize: 11,
      },
    ];
    (['a', 'b'] as const).forEach((pk) => {
      CONDITIONS.forEach((cond) => {
        refs.push({
          id: `xtick-${pk}-${cond.id}`,
          label: `面板${pk} · ${cond.id}`,
          defaultText: cond.id,
          defaultFontSize: 11.5,
          defaultFontWeight: 600,
        });
        refs.push({
          id: `xtick-detail-${pk}-${cond.id}`,
          label: `面板${pk} · ${cond.id} 详情`,
          defaultText: cond.detail,
          defaultFontSize: 10,
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
              description: '与 Table 5 一致；Full 加粗描边突出。',
              apply: () => {
                setSeed(7);
                setJitter(0);
                setShowValues(true);
                setHighlightFull(true);
                setShowErrorBars(false);
              },
            },
            {
              id: 'errorbars',
              label: '加误差棒',
              hint: '审计',
              description: '展示 5 折交叉验证的标准差范围。',
              apply: () => {
                setShowErrorBars(true);
                setErrorMagnitude(0.022);
              },
            },
            {
              id: 'noisy',
              label: '抖动样本',
              hint: '稳健',
              description: '将每个柱施加 jitter 模拟跨折波动。',
              apply: () => {
                setJitter(0.4);
              },
            },
            {
              id: 'minimal',
              label: '极简版',
              hint: '海报',
              description: '无数值、无误差棒、纯柱图。',
              apply: () => {
                setShowValues(false);
                setShowErrorBars(false);
                setHighlightFull(true);
              },
            },
          ]}
        />
      }
      filename="ablation-bars"
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
              label="Full 模型加粗描边"
              checked={highlightFull}
              onChange={setHighlightFull}
            />
            <Toggle label="误差棒" checked={showErrorBars} onChange={setShowErrorBars} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          消融实验在患者独立（LOSO）划分下评估。(a) 比较了
          GAT-CMC-Net (Full) 与五种结构性消融在 CHB-MIT 与 TUSZ
          上的事件级灵敏度；(b) 报告了 CHB-MIT 上的每小时虚警率。
          A3（去除 HRF 时移建模）造成的损失最显著，验证了
          时移建模在多模态对齐中的关键作用。
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
          {/* Panel A — paired Event SE */}
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <EditableSvgText
              id={panelATitleId}
              x={innerW / 2}
              y={-30}
              style={panelAStyle}
              textAnchor="middle"
              selected={textOverrides.selectedId === panelATitleId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />
            <YAxis axis={seAxis} offset={0} label="Event sensitivity" gridExtent={innerW} />
            {/* X line */}
            <line
              x1={0}
              x2={innerW}
              y1={innerH}
              y2={innerH}
              stroke="currentColor"
              strokeWidth={1}
            />
            {renderXTicks('a')}

            {/* Bars */}
            {CONDITIONS.map((cond, i) => {
              const cx = xBands[i];
              const seCHB = data.seCHB[i];
              const seTUSZ = data.seTUSZ[i];
              const baseY = seAxis.scale(seAxis.domain[0]);
              const yCHB = seAxis.scale(seCHB);
              const yTUSZ = seAxis.scale(seTUSZ);
              const isFull = cond.isFull && highlightFull;
              return (
                <g key={cond.id}>
                  <rect
                    x={cx - barGroup / 2}
                    y={yCHB}
                    width={subBarW}
                    height={baseY - yCHB}
                    fill={DATASET_BLUE}
                    fillOpacity={cond.isFull ? 1 : 0.92}
                    stroke={isFull ? ACCENT : 'none'}
                    strokeWidth={isFull ? 2.6 : 0}
                  />
                  <rect
                    x={cx - barGroup / 2 + barGroup / 2}
                    y={yTUSZ}
                    width={subBarW}
                    height={baseY - yTUSZ}
                    fill={DATASET_ORANGE}
                    fillOpacity={cond.isFull ? 1 : 0.92}
                    stroke={isFull ? ACCENT : 'none'}
                    strokeWidth={isFull ? 2.6 : 0}
                  />
                  {/* Value labels */}
                  {showValues ? (
                    <>
                      <text
                        x={cx - barGroup / 2 + subBarW / 2}
                        y={yCHB - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fontFamily='"JetBrains Mono", monospace'
                        fill="currentColor"
                      >
                        {seCHB.toFixed(2)}
                      </text>
                      <text
                        x={cx + subBarW / 2}
                        y={yTUSZ - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fontFamily='"JetBrains Mono", monospace'
                        fill="currentColor"
                      >
                        {seTUSZ.toFixed(2)}
                      </text>
                    </>
                  ) : null}
                  {/* Error bars */}
                  {showErrorBars ? (
                    <>
                      <line
                        x1={cx - barGroup / 2 + subBarW / 2}
                        x2={cx - barGroup / 2 + subBarW / 2}
                        y1={seAxis.scale(seCHB - errorMagnitude)}
                        y2={seAxis.scale(seCHB + errorMagnitude)}
                        stroke={DATASET_BLUE}
                        strokeWidth={1.5}
                      />
                      <line
                        x1={cx + subBarW / 2}
                        x2={cx + subBarW / 2}
                        y1={seAxis.scale(seTUSZ - errorMagnitude)}
                        y2={seAxis.scale(seTUSZ + errorMagnitude)}
                        stroke={DATASET_ORANGE}
                        strokeWidth={1.5}
                      />
                    </>
                  ) : null}
                </g>
              );
            })}

            {/* Legend */}
            <g transform={`translate(${innerW - 160}, 10)`}>
              <rect
                x={-8}
                y={-12}
                width={160}
                height={42}
                fill="white"
                fillOpacity={0.94}
                stroke="currentColor"
                strokeOpacity={0.25}
                rx={4}
              />
              <g transform="translate(0, 0)">
                <rect x={0} y={-6} width={14} height={12} fill={DATASET_BLUE} />
                <EditableSvgText
                  id={legendChbId}
                  x={20}
                  y={4}
                  style={legendChbStyle}
                  textAnchor="start"
                  selected={textOverrides.selectedId === legendChbId}
                  onSelect={(id) => textOverrides.selectText(id)}
                  onMove={(id, dx, dy) =>
                    textOverrides.setOverride(id, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              </g>
              <g transform="translate(0, 18)">
                <rect x={0} y={-6} width={14} height={12} fill={DATASET_ORANGE} />
                <EditableSvgText
                  id={legendTuszId}
                  x={20}
                  y={4}
                  style={legendTuszStyle}
                  textAnchor="start"
                  selected={textOverrides.selectedId === legendTuszId}
                  onSelect={(id) => textOverrides.selectText(id)}
                  onMove={(id, dx, dy) =>
                    textOverrides.setOverride(id, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              </g>
            </g>
          </g>

          {/* Panel B — FA/h */}
          <g
            transform={`translate(${margin.left + panelW + panelGap}, ${margin.top})`}
          >
            <EditableSvgText
              id={panelBTitleId}
              x={innerW / 2}
              y={-30}
              style={panelBStyle}
              textAnchor="middle"
              selected={textOverrides.selectedId === panelBTitleId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />
            <YAxis axis={faAxis} offset={0} label="FA / h" gridExtent={innerW} />
            <line
              x1={0}
              x2={innerW}
              y1={innerH}
              y2={innerH}
              stroke="currentColor"
              strokeWidth={1}
            />
            {renderXTicks('b')}

            {CONDITIONS.map((cond, i) => {
              const cx = xBands[i];
              const fa = data.faCHB[i];
              const baseY = faAxis.scale(0);
              const y = faAxis.scale(fa);
              const isFull = cond.isFull && highlightFull;
              const w = barGroup * 0.7;
              return (
                <g key={cond.id}>
                  <rect
                    x={cx - w / 2}
                    y={y}
                    width={w}
                    height={baseY - y}
                    fill={palette[i]}
                    fillOpacity={cond.isFull ? 1 : 0.85}
                    stroke={isFull ? ACCENT : 'none'}
                    strokeWidth={isFull ? 2.6 : 0}
                  />
                  {showValues ? (
                    <text
                      x={cx}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily='"JetBrains Mono", monospace'
                      fill="currentColor"
                    >
                      {fa.toFixed(2)}
                    </text>
                  ) : null}
                  {showErrorBars ? (
                    <line
                      x1={cx}
                      x2={cx}
                      y1={faAxis.scale(Math.max(0, fa - errorMagnitude * 6))}
                      y2={faAxis.scale(fa + errorMagnitude * 6)}
                      stroke={palette[i]}
                      strokeWidth={1.6}
                    />
                  ) : null}
                </g>
              );
            })}

          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'ablation-bars',
  title: '消融实验（LOSO 患者独立）',
  titleEn: 'Ablation Bars · LOSO',
  category: 'evaluation',
  summary:
    '消融实验：双面板分组柱（Event SE on CHB-MIT vs TUSZ；FA/h on CHB-MIT），Full 模型加粗描边。',
  component: AblationBars,
});
