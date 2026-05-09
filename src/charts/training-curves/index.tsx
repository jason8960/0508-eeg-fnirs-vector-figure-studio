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

interface CurveData {
  epochs: number[];
  trainLoss: number[];
  valLoss: number[];
  valAuprc: number[];
  valAuc: number[];
  earlyStopEpoch: number;
}

function generateTrainingCurves(
  seed: number,
  nEpochs: number,
  convergenceSpeed: number,
  overfitDegree: number,
): CurveData {
  const rng = mulberry32(seed);

  const trainLoss: number[] = [];
  const valLoss: number[] = [];
  const valAuprc: number[] = [];
  const valAuc: number[] = [];

  // Base loss decay with convergence speed
  const baseDecay = (epoch: number) =>
    0.6 * Math.exp(-convergenceSpeed * epoch / nEpochs) + 0.15;

  // Training loss: smooth decay with small noise
  for (let e = 0; e < nEpochs; e++) {
    const base = baseDecay(e);
    const noise = randn(rng) * 0.02;
    trainLoss.push(Math.max(0.12, base + noise));
  }

  // Validation loss: similar but starts diverging after certain epoch (overfitting)
  const divergenceStart = Math.floor(nEpochs * 0.6);
  for (let e = 0; e < nEpochs; e++) {
    const base = baseDecay(e) * 1.05;
    let overfit = 0;
    if (e > divergenceStart) {
      overfit = ((e - divergenceStart) / (nEpochs - divergenceStart)) * overfitDegree * 0.3;
    }
    const noise = randn(rng) * 0.035;
    valLoss.push(Math.max(0.18, base + overfit + noise));
  }

  // Validation AUPRC: starts low and increases
  const auprcBase = 0.58;
  for (let e = 0; e < nEpochs; e++) {
    const progress = e / nEpochs;
    const value = auprcBase + (0.35 * (1 - Math.exp(-5 * progress))) + randn(rng) * 0.01;
    valAuprc.push(Math.max(0, Math.min(1, value)));
  }

  // Validation AUC: similar to AUPRC but higher ceiling
  const aucBase = 0.62;
  for (let e = 0; e < nEpochs; e++) {
    const progress = e / nEpochs;
    const value = aucBase + (0.32 * (1 - Math.exp(-4 * progress))) + randn(rng) * 0.008;
    valAuc.push(Math.max(0, Math.min(1, value)));
  }

  // Find early stop (minimum validation loss)
  let minValLoss = Infinity;
  let earlyStopEpoch = nEpochs - 1;
  for (let e = 0; e < nEpochs; e++) {
    if (valLoss[e] < minValLoss) {
      minValLoss = valLoss[e];
      earlyStopEpoch = e;
    }
  }

  return {
    epochs: Array.from({ length: nEpochs }, (_, i) => i),
    trainLoss,
    valLoss,
    valAuprc,
    valAuc,
    earlyStopEpoch,
  };
}

interface SavedConfig {
  version: 1;
  seed: number;
  nEpochs: number;
  convergenceSpeed: number;
  overfitDegree: number;
  showEarlyStop: boolean;
  showTrainLoss: boolean;
  showValLoss: boolean;
  showAuprc: boolean;
  showAuc: boolean;
  lineWidth: number;
  textOverrides?: TextOverrideMap;
}

const STORAGE_KEY = 'training-curves-configs-v1';

function TrainingCurvesChart() {
  const [seed, setSeed] = useState(2024);
  const [nEpochs, setNEpochs] = useState(100);
  const [convergenceSpeed, setConvergenceSpeed] = useState(3.5);
  const [overfitDegree, setOverfitDegree] = useState(0.6);
  const [showEarlyStop, setShowEarlyStop] = useState(true);
  const [showTrainLoss, setShowTrainLoss] = useState(true);
  const [showValLoss, setShowValLoss] = useState(true);
  const [showAuprc, setShowAuprc] = useState(true);
  const [showAuc, setShowAuc] = useState(true);
  const [lineWidth, setLineWidth] = useState(2);

  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(
    () => generateTrainingCurves(seed, nEpochs, convergenceSpeed, overfitDegree),
    [seed, nEpochs, convergenceSpeed, overfitDegree],
  );

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      nEpochs,
      convergenceSpeed,
      overfitDegree,
      showEarlyStop,
      showTrainLoss,
      showValLoss,
      showAuprc,
      showAuc,
      lineWidth,
    }),
    [seed, nEpochs, convergenceSpeed, overfitDegree, showEarlyStop, showTrainLoss, showValLoss, showAuprc, showAuc, lineWidth],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setNEpochs(cfg.nEpochs);
    setConvergenceSpeed(cfg.convergenceSpeed);
    setOverfitDegree(cfg.overfitDegree);
    setShowEarlyStop(cfg.showEarlyStop);
    setShowTrainLoss(cfg.showTrainLoss);
    setShowValLoss(cfg.showValLoss);
    setShowAuprc(cfg.showAuprc);
    setShowAuc(cfg.showAuc);
    setLineWidth(cfg.lineWidth);
  }, []);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<
    SavedConfig
  >({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'training-curves-config.json',
  });

  const expertSchema: ExpertSchema = [
    {
      label: '训练',
      fields: [
        {
          type: 'number',
          key: 'epochs',
          label: 'Epoch 数量',
          min: 50,
          max: 200,
          step: 10,
          value: nEpochs,
          onChange: setNEpochs,
          slider: true,
        },
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
      ],
    },
    {
      label: '模型行为',
      fields: [
        {
          type: 'number',
          key: 'convergence',
          label: '收敛速度',
          min: 1,
          max: 8,
          step: 0.1,
          value: convergenceSpeed,
          onChange: setConvergenceSpeed,
          slider: true,
          format: (v) => v.toFixed(1),
        },
        {
          type: 'number',
          key: 'overfit',
          label: '过拟合程度',
          min: 0,
          max: 2,
          step: 0.1,
          value: overfitDegree,
          onChange: setOverfitDegree,
          slider: true,
          format: (v) => v.toFixed(1),
        },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'early', label: '显示早停线', value: showEarlyStop, onChange: setShowEarlyStop },
        { type: 'toggle', key: 'train', label: '训练损失', value: showTrainLoss, onChange: setShowTrainLoss },
        { type: 'toggle', key: 'val', label: '验证损失', value: showValLoss, onChange: setShowValLoss },
        { type: 'toggle', key: 'auprc', label: 'Val AUPRC', value: showAuprc, onChange: setShowAuprc },
        { type: 'toggle', key: 'auc', label: 'Val AUC', value: showAuc, onChange: setShowAuc },
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
      ],
    },
  ];

  const inspirations: InspirationPreset[] = [
    {
      id: 'chb-mit',
      label: 'CHB-MIT LOSO 默认',
      hint: '基线',
      description: '默认100 epoch，适中收敛与过拟合。',
      apply: () => {
        setSeed(2024);
        setNEpochs(100);
        setConvergenceSpeed(3.5);
        setOverfitDegree(0.6);
        setShowEarlyStop(true);
        setShowTrainLoss(true);
        setShowValLoss(true);
        setShowAuprc(true);
        setShowAuc(true);
      },
    },
    {
      id: 'fast-converge',
      label: '快速收敛',
      hint: '训练',
      description: '更快收敛，轻微过拟合。',
      apply: () => {
        setConvergenceSpeed(5.5);
        setOverfitDegree(0.3);
        setNEpochs(80);
      },
    },
    {
      id: 'severe-overfit',
      label: '严重过拟合',
      hint: '警示',
      description: '展示验证损失明显上升的过拟合模式。',
      apply: () => {
        setOverfitDegree(1.5);
        setConvergenceSpeed(4);
      },
    },
    {
      id: 'metrics-only',
      label: '仅指标曲线',
      hint: '简洁',
      description: '隐藏损失，仅显示AUPRC/AUC。',
      apply: () => {
        setShowTrainLoss(false);
        setShowValLoss(false);
        setShowAuprc(true);
        setShowAuc(true);
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

  // Scales for loss panel (left)
  const lossXAxis = buildLinearAxis({
    domain: [0, nEpochs - 1],
    range: [0, panelW],
    ticks: [0, 20, 40, 60, 80, 100],
    format: (v) => String(Math.round(v)),
  });
  const lossYAxis = buildLinearAxis({
    domain: [0, 0.7],
    range: [panelH, 0],
    ticks: [0, 0.2, 0.4, 0.6],
    format: (v) => v.toFixed(1),
  });

  // Scales for metrics panel (right)
  const metricXAxis = buildLinearAxis({
    domain: [0, nEpochs - 1],
    range: [0, panelW],
    ticks: [0, 20, 40, 60, 80, 100],
    format: (v) => String(Math.round(v)),
  });
  const metricYAxis = buildLinearAxis({
    domain: [0.4, 1.0],
    range: [panelH, 0],
    ticks: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    format: (v) => v.toFixed(1),
  });

  const lineGen = d3line<number>().x((_, i) => lossXAxis.scale(i));

  const titleId = 'title';
  const captionId = 'caption';
  const panelAId = 'panel-a';
  const panelBId = 'panel-b';
  const titleDefault = 'GAT-CMC-Net 训练曲线 · CHB-MIT LOSO';
  const captionDefault = `合成训练过程 (seed=${seed}, epochs=${nEpochs}) · ${showEarlyStop ? `早停@epoch ${data.earlyStopEpoch}` : ''}`;
  const panelADefault = '(a) 训练 / 验证损失';
  const panelBDefault = '(b) 验证集 AUPRC / AUC';
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
      filename="training-curves"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={<InspirationPanel presets={inspirations} />}
      inspector={
        <>
          <ControlGroup label="训练">
            <NumberSlider label="Epoch 数" value={nEpochs} min={50} max={200} step={10} onChange={setNEpochs} />
            <NumberSlider label="收敛速度" value={convergenceSpeed} min={1} max={8} step={0.1} onChange={setConvergenceSpeed} format={(v) => v.toFixed(1)} />
            <NumberSlider label="过拟合度" value={overfitDegree} min={0} max={2} step={0.1} onChange={setOverfitDegree} format={(v) => v.toFixed(1)} />
          </ControlGroup>
          <ControlGroup label="曲线显示">
            <Toggle label="训练损失" checked={showTrainLoss} onChange={setShowTrainLoss} />
            <Toggle label="验证损失" checked={showValLoss} onChange={setShowValLoss} />
            <Toggle label="Val AUPRC" checked={showAuprc} onChange={setShowAuprc} />
            <Toggle label="Val AUC" checked={showAuc} onChange={setShowAuc} />
            <Toggle label="早停标记" checked={showEarlyStop} onChange={setShowEarlyStop} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          GAT-CMC-Net 训练曲线（CHB-MIT, LOSO 一折）。左图展示训练/验证损失随 epoch 的变化，
          右图展示验证集 AUPRC 与 AUC 指标。支持调整收敛速度、过拟合程度参数生成不同形态的曲线，
          并可开关各曲线显示。早停线标记验证损失最低点。所有配置支持命名保存与自动保存。
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
            {/* Left panel: Loss curves */}
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

              <YAxis axis={lossYAxis} offset={0} label="Loss" gridExtent={panelW} />
              <XAxis axis={lossXAxis} offset={panelH} label="Epoch" gridExtent={panelH} />

              {/* Train loss */}
              {showTrainLoss && (
                <path
                  d={lineGen.y((d) => lossYAxis.scale(d))(data.trainLoss) ?? undefined}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={lineWidth}
                />
              )}

              {/* Val loss */}
              {showValLoss && (
                <path
                  d={lineGen.y((d) => lossYAxis.scale(d))(data.valLoss) ?? undefined}
                  fill="none"
                  stroke="#ea580c"
                  strokeWidth={lineWidth}
                  strokeDasharray="6 4"
                />
              )}

              {/* Legend */}
              <g transform={`translate(${panelW - 100}, 20)`}>
                <rect x={-8} y={-12} width={108} height={44} fill="white" fillOpacity={0.9} rx={4} />
                {showTrainLoss && (
                  <g>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#2563eb" strokeWidth={lineWidth} />
                    <text x={26} y={3} fontSize={10} fill="currentColor">Train loss</text>
                  </g>
                )}
                {showValLoss && (
                  <g transform={`translate(0, ${showTrainLoss ? 18 : 0})`}>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#ea580c" strokeWidth={lineWidth} strokeDasharray="4 2" />
                    <text x={26} y={3} fontSize={10} fill="currentColor">Val loss</text>
                  </g>
                )}
              </g>
            </g>

            {/* Right panel: Metric curves */}
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

              <YAxis axis={metricYAxis} offset={0} label="指标" gridExtent={panelW} />
              <XAxis axis={metricXAxis} offset={panelH} label="Epoch" gridExtent={panelH} />

              {/* Early stop line */}
              {showEarlyStop && (
                <g>
                  <line
                    x1={metricXAxis.scale(data.earlyStopEpoch)}
                    x2={metricXAxis.scale(data.earlyStopEpoch)}
                    y1={0}
                    y2={panelH}
                    stroke="#dc2626"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                  />
                  <text
                    x={metricXAxis.scale(data.earlyStopEpoch) + 6}
                    y={panelH - 10}
                    fontSize={9}
                    fill="#dc2626"
                  >
                    Early stop ({data.earlyStopEpoch})
                  </text>
                </g>
              )}

              {/* Val AUPRC */}
              {showAuprc && (
                <path
                  d={lineGen.y((d) => metricYAxis.scale(d))(data.valAuprc) ?? undefined}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={lineWidth}
                />
              )}

              {/* Val AUC */}
              {showAuc && (
                <path
                  d={lineGen.y((d) => metricYAxis.scale(d))(data.valAuc) ?? undefined}
                  fill="none"
                  stroke="#9333ea"
                  strokeWidth={lineWidth}
                  strokeDasharray="6 4"
                />
              )}

              {/* Legend */}
              <g transform={`translate(${panelW - 100}, panelH - 60)`}>
                <rect x={-8} y={-8} width={104} height={52} fill="white" fillOpacity={0.9} rx={4} />
                {showAuprc && (
                  <g>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#16a34a" strokeWidth={lineWidth} />
                    <text x={26} y={3} fontSize={10} fill="currentColor">Val AUPRC</text>
                  </g>
                )}
                {showAuc && (
                  <g transform={`translate(0, ${showAuprc ? 18 : 0})`}>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#9333ea" strokeWidth={lineWidth} strokeDasharray="4 2" />
                    <text x={26} y={3} fontSize={10} fill="currentColor">Val AUC</text>
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
  id: 'training-curves',
  title: 'GAT-CMC-Net 训练曲线',
  titleEn: 'Training Curves',
  category: 'evaluation',
  summary:
    'GAT-CMC-Net 训练过程可视化，包含损失曲线与验证指标（AUPRC/AUC），支持参数化生成不同训练模式与配置保存。',
  component: TrainingCurvesChart,
});
