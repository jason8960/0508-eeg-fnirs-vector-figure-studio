import { useMemo, useRef, useState, useCallback } from 'react';
import { line as d3line } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import { mulberry32, randn } from '../../lib/random';
import type { ExpertSchema } from '../../components/ExpertPanel';
import {
  InspirationPanel,
  type InspirationPreset,
} from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';

interface ScatterPoint {
  groundTruth: number;
  learned: number;
}

interface NoiseCurve {
  noiseLevel: number;
  oursError: number;
  baselineError: number;
}

function generateTauRecoveryData(
  seed: number,
  nPoints: number,
  noiseStd: number,
): ScatterPoint[] {
  const rng = mulberry32(seed);
  const points: ScatterPoint[] = [];

  // Generate points across the range [1.5, 7.5]
  for (let i = 0; i < nPoints; i++) {
    const groundTruth = 1.5 + (6 * i) / (nPoints - 1) + randn(rng) * 0.2;
    // Learned value has small bias and noise
    const bias = 0.27; // empirical bias from screenshot
    const scale = 1.06; // empirical scale from screenshot
    const learned = groundTruth * scale + bias + randn(rng) * noiseStd;
    points.push({ groundTruth, learned });
  }

  return points;
}

function generateNoiseCurveData(seed: number): NoiseCurve[] {
  const rng = mulberry32(seed + 1000);
  const noiseLevels = [0.1, 0.2, 0.3, 0.5, 0.8, 1.0];

  return noiseLevels.map((noise) => {
    // Our method: low error that increases slowly with noise
    const oursBase = 0.2 + noise * 0.5;
    const oursError = Math.max(0.15, oursBase + randn(rng) * 0.05);

    // Baseline: higher error that increases faster
    const baselineBase = 1.6 + noise * 1.2;
    const baselineError = Math.max(1.4, baselineBase + randn(rng) * 0.1);

    return { noiseLevel: noise, oursError, baselineError };
  });
}

interface SavedConfig {
  version: 1;
  seed: number;
  nPoints: number;
  noiseStd: number;
  showIdeal: boolean;
  showFit: boolean;
  showBaseline: boolean;
  showOurs: boolean;
  lineWidth: number;
  markerSize: number;
  textOverrides?: TextOverrideMap;
}

const STORAGE_KEY = 'hrf-tau-recovery-configs-v1';

function HrfTauRecoveryChart() {
  const [seed, setSeed] = useState(2024);
  const [nPoints, setNPoints] = useState(25);
  const [noiseStd, setNoiseStd] = useState(0.25);
  const [showIdeal, setShowIdeal] = useState(true);
  const [showFit, setShowFit] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [showOurs, setShowOurs] = useState(true);
  const [lineWidth, setLineWidth] = useState(2);
  const [markerSize, setMarkerSize] = useState(6);

  const svgRef = useRef<SVGSVGElement>(null);

  const scatterData = useMemo(
    () => generateTauRecoveryData(seed, nPoints, noiseStd),
    [seed, nPoints, noiseStd],
  );

  const noiseCurveData = useMemo(() => generateNoiseCurveData(seed), [seed]);

  // Compute metrics
  const metrics = useMemo(() => {
    const n = scatterData.length;
    const sumX = scatterData.reduce((acc, p) => acc + p.groundTruth, 0);
    const sumY = scatterData.reduce((acc, p) => acc + p.learned, 0);
    const sumXY = scatterData.reduce((acc, p) => acc + p.groundTruth * p.learned, 0);
    const sumXX = scatterData.reduce((acc, p) => acc + p.groundTruth * p.groundTruth, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Pearson correlation
    const meanX = sumX / n;
    const meanY = sumY / n;
    const ssX = scatterData.reduce((acc, p) => acc + Math.pow(p.groundTruth - meanX, 2), 0);
    const ssY = scatterData.reduce((acc, p) => acc + Math.pow(p.learned - meanY, 2), 0);
    const spXY = scatterData.reduce(
      (acc, p) => acc + (p.groundTruth - meanX) * (p.learned - meanY),
      0,
    );
    const r = spXY / Math.sqrt(ssX * ssY);

    // MAE
    const mae = scatterData.reduce((acc, p) => acc + Math.abs(p.learned - p.groundTruth), 0) / n;

    return { slope, intercept, r, mae };
  }, [scatterData]);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      nPoints,
      noiseStd,
      showIdeal,
      showFit,
      showBaseline,
      showOurs,
      lineWidth,
      markerSize,
    }),
    [seed, nPoints, noiseStd, showIdeal, showFit, showBaseline, showOurs, lineWidth, markerSize],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setNPoints(cfg.nPoints);
    setNoiseStd(cfg.noiseStd);
    setShowIdeal(cfg.showIdeal);
    setShowFit(cfg.showFit);
    setShowBaseline(cfg.showBaseline);
    setShowOurs(cfg.showOurs);
    setLineWidth(cfg.lineWidth);
    setMarkerSize(cfg.markerSize);
  }, []);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<
    SavedConfig
  >({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'hrf-tau-recovery-config.json',
  });

  const expertSchema: ExpertSchema = [
    {
      label: '数据',
      fields: [
        {
          type: 'number',
          key: 'seed',
          label: '随机种子',
          min: 0,
          max: 99999,
          step: 1,
          value: seed,
          onChange: setSeed,
        },
        {
          type: 'number',
          key: 'n',
          label: '散点数量',
          min: 10,
          max: 50,
          step: 5,
          value: nPoints,
          onChange: setNPoints,
          slider: true,
        },
        {
          type: 'number',
          key: 'noise',
          label: '噪声标准差',
          min: 0.1,
          max: 0.8,
          step: 0.05,
          value: noiseStd,
          onChange: setNoiseStd,
          slider: true,
          format: (v) => v.toFixed(2),
        },
      ],
    },
    {
      label: '回归线',
      fields: [
        { type: 'toggle', key: 'ideal', label: '理想线 (y=x)', value: showIdeal, onChange: setShowIdeal },
        { type: 'toggle', key: 'fit', label: '拟合线', value: showFit, onChange: setShowFit },
      ],
    },
    {
      label: '噪声曲线',
      fields: [
        { type: 'toggle', key: 'baseline', label: '固定 sHRF baseline', value: showBaseline, onChange: setShowBaseline },
        { type: 'toggle', key: 'ours', label: 'Ours (可学习τ)', value: showOurs, onChange: setShowOurs },
      ],
    },
    {
      label: '样式',
      fields: [
        {
          type: 'number',
          key: 'lw',
          label: '线宽',
          min: 1,
          max: 4,
          step: 0.5,
          value: lineWidth,
          onChange: setLineWidth,
          slider: true,
        },
        {
          type: 'number',
          key: 'ms',
          label: '标记大小',
          min: 3,
          max: 10,
          step: 1,
          value: markerSize,
          onChange: setMarkerSize,
          slider: true,
        },
      ],
    },
  ];

  const inspirations: InspirationPreset[] = [
    {
      id: 'l3-default',
      label: 'L3 应力测试默认',
      hint: '基线',
      description: 'HRF时移反推验证，25个点，适中噪声。',
      apply: () => {
        setSeed(2024);
        setNPoints(25);
        setNoiseStd(0.25);
        setShowIdeal(true);
        setShowFit(true);
        setShowBaseline(true);
        setShowOurs(true);
        setLineWidth(2);
        setMarkerSize(6);
      },
    },
    {
      id: 'high-precision',
      label: '高精度模式',
      hint: '理想',
      description: '更少噪声，更小散点，展示理想相关性。',
      apply: () => {
        setNoiseStd(0.1);
        setNPoints(30);
        setMarkerSize(5);
      },
    },
    {
      id: 'no-baseline',
      label: '隐藏基线对比',
      hint: '聚焦',
      description: '仅显示我们的方法，去除基线对比。',
      apply: () => {
        setShowBaseline(false);
      },
    },
    {
      id: 'scatter-only',
      label: '仅散点图',
      hint: '简洁',
      description: '隐藏右侧噪声曲线，仅展示回归分析。',
      apply: () => {
        setShowBaseline(false);
        setShowOurs(false);
      },
    },
  ];

  // Layout - two panels side by side
  const W = 960;
  const H = 420;
  const margin = { top: 40, right: 40, bottom: 60, left: 70 };
  const panelGap = 60;
  const panelW = (W - margin.left - margin.right - panelGap) / 2;
  const panelH = H - margin.top - margin.bottom;

  // Left panel: scatter
  const scatterXAxis = buildLinearAxis({
    domain: [1, 8],
    range: [0, panelW],
    ticks: [1, 2, 3, 4, 5, 6, 7, 8],
    format: (v) => v.toFixed(0),
  });
  const scatterYAxis = buildLinearAxis({
    domain: [1, 8],
    range: [panelH, 0],
    ticks: [1, 2, 3, 4, 5, 6, 7, 8],
    format: (v) => v.toFixed(0),
  });

  // Right panel: noise curve
  const noiseXAxis = buildLinearAxis({
    domain: [0, 1.1],
    range: [0, panelW],
    ticks: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
    format: (v) => v.toFixed(1),
  });
  const noiseYAxis = buildLinearAxis({
    domain: [0, 3.2],
    range: [panelH, 0],
    ticks: [0, 0.5, 1, 1.5, 2, 2.5, 3],
    format: (v) => v.toFixed(1),
  });

  const lineGen = d3line<{ x: number; y: number }>()
    .x((d) => d.x)
    .y((d) => d.y);

  const titleId = 'title';
  const captionId = 'caption';
  const panelAId = 'panel-a';
  const panelBId = 'panel-b';
  const titleDefault = 'L3 应力测试：HRF 时移反推验证';
  const captionDefault = `Pearson r=${metrics.r.toFixed(3)}, MAE=${metrics.mae.toFixed(2)}s · 合成 fNIRS (seed=${seed})`;
  const panelADefault = '(a) τ 反推验证 (L3, 合成 fNIRS)';
  const panelBDefault = '(b) 不同噪声下 τ 恢复准确性';
  const titleStyle = textOverrides.resolve(titleId, {
    text: titleDefault,
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: captionDefault,
    fontSize: 12,
  });
  const panelAStyle = textOverrides.resolve(panelAId, {
    text: panelADefault,
    fontSize: 13,
    fontWeight: 600,
  });
  const panelBStyle = textOverrides.resolve(panelBId, {
    text: panelBDefault,
    fontSize: 13,
    fontWeight: 600,
  });
  const textRefs = useMemo(() => {
    return [
      { id: titleId, label: '主标题', defaultText: titleDefault, defaultFontSize: 14, defaultFontWeight: 600 },
      { id: captionId, label: '说明文字', defaultText: captionDefault, defaultFontSize: 12 },
      { id: panelAId, label: '面板 A 标题', defaultText: panelADefault, defaultFontSize: 13, defaultFontWeight: 600 },
      { id: panelBId, label: '面板 B 标题', defaultText: panelBDefault, defaultFontSize: 13, defaultFontWeight: 600 },
    ];
  }, [titleDefault, captionDefault]);


  return (
    <ChartShell
      filename="hrf-tau-recovery"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={<InspirationPanel presets={inspirations} />}
      inspector={
        <>
          <ControlGroup label="数据">
            <NumberSlider label="散点数量" value={nPoints} min={10} max={50} step={5} onChange={setNPoints} />
            <NumberSlider label="噪声σ" value={noiseStd} min={0.1} max={0.8} step={0.05} onChange={setNoiseStd} format={(v) => v.toFixed(2)} />
            <NumberSlider label="随机种子" value={seed} min={0} max={99999} step={1} onChange={setSeed} />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle label="理想线" checked={showIdeal} onChange={setShowIdeal} />
            <Toggle label="拟合线" checked={showFit} onChange={setShowFit} />
            <Toggle label="固定sHRF基线" checked={showBaseline} onChange={setShowBaseline} />
            <Toggle label="我们的方法" checked={showOurs} onChange={setShowOurs} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          L3 应力测试：HRF 时移反推验证。左图展示学习到的时移 tau-hat 与真实时移 tau* 的相关性，
          包含理想线（虚线）和线性拟合线（实线）。右图展示在不同 Rician 噪声水平下，
          我们的可学习 tau 方法与固定 sHRF 基线的 MAE 对比。支持散点数量、噪声水平调节与配置保存。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 60}
          title={titleStyle.text}
          caption={captionStyle.text}
          titleOverride={textOverrides.overrides[titleId]}
          titleSelected={textOverrides.selectedId === titleId}
          onSelectTitle={() => textOverrides.selectText(titleId)}
          captionOverride={textOverrides.overrides[captionId]}
          captionSelected={textOverrides.selectedId === captionId}
          onSelectCaption={() => textOverrides.selectText(captionId)}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Left panel: Scatter plot */}
            <g>
              <EditableSvgText
                id={panelAId}
                x={panelW / 2}
                y={-16}
                style={panelAStyle}
                textAnchor="middle"
                selected={textOverrides.selectedId === panelAId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />

              <YAxis axis={scatterYAxis} offset={0} label="学到的 tau-hat (s)" gridExtent={panelW} />
              <XAxis axis={scatterXAxis} offset={panelH} label="Ground-truth tau* (s)" gridExtent={panelH} />

              {/* Ideal line y=x */}
              {showIdeal && (
                <line
                  x1={scatterXAxis.scale(1)}
                  y1={scatterYAxis.scale(1)}
                  x2={scatterXAxis.scale(8)}
                  y2={scatterYAxis.scale(8)}
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              )}

              {/* Fitted line */}
              {showFit && (
                <line
                  x1={scatterXAxis.scale(1)}
                  y1={scatterYAxis.scale(metrics.slope * 1 + metrics.intercept)}
                  x2={scatterXAxis.scale(8)}
                  y2={scatterYAxis.scale(metrics.slope * 8 + metrics.intercept)}
                  stroke="#2563eb"
                  strokeWidth={lineWidth}
                />
              )}

              {/* Scatter points */}
              {scatterData.map((p, i) => (
                <circle
                  key={i}
                  cx={scatterXAxis.scale(p.groundTruth)}
                  cy={scatterYAxis.scale(p.learned)}
                  r={markerSize / 2}
                  fill="#ea580c"
                  stroke="#fff"
                  strokeWidth={1}
                />
              ))}

              {/* Metrics box */}
              <g transform={`translate(10, 10)`}>
                <rect x={0} y={0} width={100} height={48} fill="#dcfce7" stroke="#22c55e" strokeWidth={1} rx={4} />
                <text x={50} y={20} textAnchor="middle" fontSize={11} fontWeight={600} fill="#166534">
                  Pearson r≈{metrics.r.toFixed(3)}
                </text>
                <text x={50} y={38} textAnchor="middle" fontSize={11} fill="#166534">
                  MAE = {metrics.mae.toFixed(2)} s
                </text>
              </g>

              {/* Legend */}
              <g transform={`translate(10, ${panelH - 50})`}>
                {showIdeal && (
                  <g>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" />
                    <text x={26} y={3} fontSize={9} fill="currentColor">ideal τ̂ = τ*</text>
                  </g>
                )}
                {showFit && (
                  <g transform={`translate(0, ${showIdeal ? 14 : 0})`}>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#2563eb" strokeWidth={lineWidth} />
                    <text x={26} y={3} fontSize={9} fill="currentColor">
                      拟合 τ̂ = {metrics.slope.toFixed(2)} τ* + {metrics.intercept.toFixed(2)}
                    </text>
                  </g>
                )}
              </g>
            </g>

            {/* Right panel: Noise curve */}
            <g transform={`translate(${panelW + panelGap}, 0)`}>
              <EditableSvgText
                id={panelBId}
                x={panelW / 2}
                y={-16}
                style={panelBStyle}
                textAnchor="middle"
                selected={textOverrides.selectedId === panelBId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />

              <YAxis axis={noiseYAxis} offset={0} label="MAE(τ*, τ̂) (s)" gridExtent={panelW} />
              <XAxis axis={noiseXAxis} offset={panelH} label="合成 fNIRS 噪声水平 (Rician σ)" gridExtent={panelH} />

              {/* Ours line */}
              {showOurs && (
                <path
                  d={lineGen(
                    noiseCurveData.map((d) => ({
                      x: noiseXAxis.scale(d.noiseLevel),
                      y: noiseYAxis.scale(d.oursError),
                    })),
                  ) ?? undefined}
                  fill="none"
                  stroke="#ea580c"
                  strokeWidth={lineWidth}
                />
              )}

              {/* Ours markers */}
              {showOurs &&
                noiseCurveData.map((d, i) => (
                  <circle
                    key={`ours-${i}`}
                    cx={noiseXAxis.scale(d.noiseLevel)}
                    cy={noiseYAxis.scale(d.oursError)}
                    r={markerSize / 2}
                    fill="#ea580c"
                  />
                ))}

              {/* Baseline line */}
              {showBaseline && (
                <path
                  d={lineGen(
                    noiseCurveData.map((d) => ({
                      x: noiseXAxis.scale(d.noiseLevel),
                      y: noiseYAxis.scale(d.baselineError),
                    })),
                  ) ?? undefined}
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth={lineWidth}
                  strokeDasharray="6 4"
                />
              )}

              {/* Baseline markers (squares) */}
              {showBaseline &&
                noiseCurveData.map((d, i) => (
                  <rect
                    key={`base-${i}`}
                    x={noiseXAxis.scale(d.noiseLevel) - markerSize / 2}
                    y={noiseYAxis.scale(d.baselineError) - markerSize / 2}
                    width={markerSize}
                    height={markerSize}
                    fill="#6b7280"
                  />
                ))}

              {/* Legend */}
              <g transform={`translate(10, ${panelH - 50})`}>
                <rect x={-8} y={-8} width={200} height={50} fill="white" fillOpacity={0.9} rx={4} />
                {showOurs && (
                  <g>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#ea580c" strokeWidth={lineWidth} />
                    <circle cx={10} cy={0} r={markerSize / 2} fill="#ea580c" />
                    <text x={26} y={3} fontSize={10} fill="currentColor">Ours (可学习 τ)</text>
                  </g>
                )}
                {showBaseline && (
                  <g transform={`translate(0, ${showOurs ? 20 : 0})`}>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#6b7280" strokeWidth={lineWidth} strokeDasharray="4 2" />
                    <rect x={4} y={-3} width={markerSize - 2} height={markerSize - 2} fill="#6b7280" />
                    <text x={26} y={3} fontSize={10} fill="currentColor">固定 sHRF baseline ([10] 风格)</text>
                  </g>
                )}
              </g>
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'hrf-tau-recovery',
  title: 'HRF 时移反推验证',
  titleEn: 'HRF Tau Recovery Validation',
  category: 'evaluation',
  summary:
    'L3应力测试：HRF时移反推验证，包含τ回归分析与不同噪声下的恢复准确性对比，支持参数调节与配置保存。',
  component: HrfTauRecoveryChart,
});
