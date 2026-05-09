import { useMemo, useRef, useState, useCallback } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
  Select,
} from '../../components/Controls';
import { mulberry32, randn } from '../../lib/random';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import {
  InspirationPanel,
  type InspirationPreset,
} from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { touchSlot, useAutoSave } from '../../lib/useAutoSave';
import { ConfigManager } from '../../components/ConfigManager';

// Default models matching the screenshot
const DEFAULT_MODELS = [
  { id: 'eegnet', name: 'EEGNet', accuracy: 0.82, fnr: 0.18, fpr: 0.22 },
  { id: 'ma-mp-gf', name: 'MA-MP-GF', accuracy: 0.90, fnr: 0.10, fpr: 0.13 },
  { id: 'ours', name: 'Ours (GAT-CMC-Net)', accuracy: 0.96, fnr: 0.04, fpr: 0.06 },
] as const;

type ModelId = (typeof DEFAULT_MODELS)[number]['id'];

interface ConfusionData {
  tn: number; // true negative (interictal correct)
  fp: number; // false positive
  fn: number; // false negative
  tp: number; // true positive (ictal correct)
}

function generateConfusionMatrix(
  seed: number,
  n: number,
  accuracy: number,
): ConfusionData {
  const rng = mulberry32(seed);
  // For binary classification with given accuracy
  const tpFnRate = 1 - accuracy;
  const tnFpRate = 1 - accuracy;

  const half = Math.floor(n / 2);
  const interictal = half;
  const ictal = n - half;

  // Generate with some noise
  const noise = () => Math.max(0, randn(rng) * 0.02);

  const fnRate = Math.max(0.02, Math.min(0.5, tpFnRate + noise()));
  const fpRate = Math.max(0.02, Math.min(0.5, tnFpRate + noise()));

  const tp = Math.round(ictal * (1 - fnRate));
  const fn = ictal - tp;
  const tn = Math.round(interictal * (1 - fpRate));
  const fp = interictal - tn;

  return { tn, fp, fn, tp };
}

interface SavedConfig {
  version: 1;
  seed: number;
  n: number;
  normalize: boolean;
  colormap: ColormapName;
  highlightModel: ModelId | 'all';
  showMetrics: boolean;
}

const STORAGE_KEY = 'event-confusion-configs-v1';

function loadStoredConfigs(): Record<string, SavedConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedConfig>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistConfigs(slots: Record<string, SavedConfig>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // quota / unavailable
  }
}

function EventConfusionChart() {
  const [seed, setSeed] = useState(42);
  const [n, setN] = useState(500);
  const [normalize, setNormalize] = useState(true);
  const [colormap, setColormap] = useState<ColormapName>('cividis');
  const [highlightModel, setHighlightModel] = useState<ModelId | 'all'>('all');
  const [showMetrics, setShowMetrics] = useState(true);

  const svgRef = useRef<SVGSVGElement>(null);

  // Generate confusion matrices for each model
  const matrices = useMemo(() => {
    return DEFAULT_MODELS.map((model, i) => {
      const data = generateConfusionMatrix(seed + i * 100, n, model.accuracy);
      return { model, data };
    });
  }, [seed, n]);

  // Config management
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedConfig>>(
    () => loadStoredConfigs(),
  );

  const buildCurrentConfig = useCallback((): SavedConfig => {
    return {
      version: 1,
      seed,
      n,
      normalize,
      colormap,
      highlightModel,
      showMetrics,
    };
  }, [seed, n, normalize, colormap, highlightModel, showMetrics]);

  const applyConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setN(cfg.n);
    setNormalize(cfg.normalize);
    setColormap(cfg.colormap);
    setHighlightModel(cfg.highlightModel);
    setShowMetrics(cfg.showMetrics);
  }, []);

  const persistAndSetSlots = useCallback((next: Record<string, SavedConfig>) => {
    setSavedConfigs(next);
    persistConfigs(next);
  }, []);

  const saveConfigToSlot = useCallback(
    (name: string) => {
      if (!name.trim()) return;
      setSavedConfigs((prev) => {
        const next = { ...prev, [name]: buildCurrentConfig() };
        persistConfigs(next);
        return next;
      });
      touchSlot(STORAGE_KEY, name);
    },
    [buildCurrentConfig],
  );

  const deleteConfigSlot = useCallback((name: string) => {
    setSavedConfigs((prev) => {
      if (!(name in prev)) return prev;
      const rest = { ...prev };
      delete rest[name];
      persistConfigs(rest);
      return rest;
    });
  }, []);

  // Auto-save hook
  useAutoSave<SavedConfig>({
    storageKey: STORAGE_KEY,
    current: buildCurrentConfig(),
    slots: savedConfigs,
    onPersistSlots: persistAndSetSlots,
    applyConfig,
  });

  const expertSchema: ExpertSchema = [
    {
      label: '样本',
      fields: [
        {
          type: 'number',
          key: 'n',
          label: '样本量 n',
          min: 100,
          max: 2000,
          step: 50,
          value: n,
          onChange: setN,
          slider: true,
        },
        {
          type: 'number',
          key: 'seed',
          label: '随机种子',
          min: 0,
          max: 9999,
          step: 1,
          value: seed,
          onChange: setSeed,
        },
      ],
    },
    {
      label: '显示',
      fields: [
        {
          type: 'toggle',
          key: 'norm',
          label: '归一化显示（概率）',
          value: normalize,
          onChange: setNormalize,
        },
        {
          type: 'toggle',
          key: 'metrics',
          label: '显示指标文本',
          value: showMetrics,
          onChange: setShowMetrics,
        },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: '高亮',
      fields: [
        {
          type: 'select',
          key: 'highlight',
          label: '高亮模型',
          value: highlightModel,
          options: [
            { value: 'all', label: '全部显示' },
            { value: 'eegnet', label: 'EEGNet' },
            { value: 'ma-mp-gf', label: 'MA-MP-GF' },
            { value: 'ours', label: 'Ours (GAT-CMC-Net)' },
          ],
          onChange: (v) => setHighlightModel(v as ModelId | 'all'),
        },
      ],
    },
  ];

  const inspirations: InspirationPreset[] = [
    {
      id: 'default',
      label: 'CHB-MIT LOSO 默认',
      hint: '基线',
      description: '默认三模型对比，蓝调色带。',
      apply: () => {
        setSeed(42);
        setN(500);
        setNormalize(true);
        setColormap('cividis');
        setHighlightModel('all');
        setShowMetrics(true);
      },
    },
    {
      id: 'focus-ours',
      label: '聚焦 GAT-CMC-Net',
      hint: '最佳',
      description: '仅高亮我们的模型，展示最佳性能。',
      apply: () => {
        setHighlightModel('ours');
        setColormap('viridis');
      },
    },
    {
      id: 'counts',
      label: '原始计数视图',
      hint: '数值',
      description: '关闭归一化，显示原始样本计数。',
      apply: () => {
        setNormalize(false);
        setN(1000);
      },
    },
    {
      id: 'green',
      label: '绿色主题',
      hint: '色彩',
      description: '切换为绿色调色带，适合PPT展示。',
      apply: () => {
        setColormap('viridis');
      },
    },
  ];

  const interp = getColormap(colormap);

  // Layout
  const W = 900;
  const H = 400;
  const margin = { top: 40, right: 40, bottom: 60, left: 80 };
  const matrixSize = 140;
  const gapX = (W - margin.left - margin.right - matrixSize * 3) / 2;

  // Filter models based on highlight
  const displayModels =
    highlightModel === 'all'
      ? matrices
      : matrices.filter((m) => m.model.id === highlightModel);


  return (
    <ChartShell
      filename="event-confusion"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={<InspirationPanel presets={inspirations} />}
      inspector={
        <>
          <ControlGroup label="样本">
            <NumberSlider label="样本量 n" value={n} min={100} max={2000} step={50} onChange={setN} />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle label="归一化显示" checked={normalize} onChange={setNormalize} />
            <Toggle label="显示指标" checked={showMetrics} onChange={setShowMetrics} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          <ControlGroup label="模型">
            <Select
              label="高亮模型"
              value={highlightModel}
              options={[
                { value: 'all', label: '全部显示' },
                { value: 'eegnet', label: 'EEGNet' },
                { value: 'ma-mp-gf', label: 'MA-MP-GF' },
                { value: 'ours', label: 'Ours' },
              ]}
              onChange={(v) => setHighlightModel(v as ModelId | 'all')}
            />
          </ControlGroup>
          <ControlGroup label="配置管理" description="保存/加载/导出配置">
            <ConfigManager
              filename="event-confusion-config.json"
              savedConfigs={savedConfigs}
              buildCurrentConfig={buildCurrentConfig}
              applyConfig={applyConfig}
              saveConfigToSlot={saveConfigToSlot}
              deleteConfigSlot={deleteConfigSlot}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          事件级混淆矩阵对比（CHB-MIT LOSO）。展示三个模型（EEGNet、MA-MP-GF、GAT-CMC-Net）
          在发作间期（interictal）与发作期（ictal）二分类任务上的性能。每个矩阵显示真阴性（TN）、
          假阳性（FP）、假阴性（FN）、真阳性（TP）的比例或计数。支持归一化视图和多种色带。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H}
          title="事件级混淆矩阵 · CHB-MIT LOSO"
          caption={`合成数据 (n=${n}, seed=${seed}) · ${normalize ? '归一化概率' : '原始计数'}`}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {displayModels.map(({ model, data }, idx) => {
              const x = idx * (matrixSize + gapX);
              const total = data.tn + data.fp + data.fn + data.tp;

              const vals = normalize
                ? {
                    tn: data.tn / (data.tn + data.fp),
                    fp: data.fp / (data.tn + data.fp),
                    fn: data.fn / (data.fn + data.tp),
                    tp: data.tp / (data.fn + data.tp),
                  }
                : {
                    tn: data.tn / total,
                    fp: data.fp / total,
                    fn: data.fn / total,
                    tp: data.tp / total,
                  };

              const cells = [
                { v: vals.tn, label: normalize ? vals.tn.toFixed(2) : data.tn.toString(), row: 0, col: 0 },
                { v: vals.fp, label: normalize ? vals.fp.toFixed(2) : data.fp.toString(), row: 0, col: 1 },
                { v: vals.fn, label: normalize ? vals.fn.toFixed(2) : data.fn.toString(), row: 1, col: 0 },
                { v: vals.tp, label: normalize ? vals.tp.toFixed(2) : data.tp.toString(), row: 1, col: 1 },
              ];

              return (
                <g key={model.id} transform={`translate(${x}, 0)`}>
                  {/* Title */}
                  <text
                    x={matrixSize / 2}
                    y={-16}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill="currentColor"
                  >
                    {model.name}
                  </text>

                  {/* Matrix */}
                  {cells.map((cell) => (
                    <g key={`${cell.row}-${cell.col}`}>
                      <rect
                        x={cell.col * (matrixSize / 2)}
                        y={cell.row * (matrixSize / 2)}
                        width={matrixSize / 2}
                        height={matrixSize / 2}
                        fill={interp(cell.v)}
                        stroke="white"
                        strokeWidth={2}
                      />
                      {showMetrics && (
                        <text
                          x={cell.col * (matrixSize / 2) + matrixSize / 4}
                          y={cell.row * (matrixSize / 2) + matrixSize / 4 + 4}
                          textAnchor="middle"
                          fontSize={14}
                          fontWeight={600}
                          fill={cell.v > 0.5 ? '#fff' : '#000'}
                        >
                          {cell.label}
                        </text>
                      )}
                    </g>
                  ))}

                  {/* Row labels */}
                  <text x={-8} y={matrixSize / 4 + 4} textAnchor="end" fontSize={10} fill="currentColor">
                    interictal
                  </text>
                  <text x={-8} y={(matrixSize * 3) / 4 + 4} textAnchor="end" fontSize={10} fill="currentColor">
                    ictal
                  </text>
                  <text
                    x={-50}
                    y={matrixSize / 2}
                    textAnchor="middle"
                    fontSize={11}
                    fill="currentColor"
                    transform={`rotate(-90, -50, ${matrixSize / 2})`}
                  >
                    真实
                  </text>

                  {/* Col labels */}
                  <text
                    x={matrixSize / 4}
                    y={matrixSize + 18}
                    textAnchor="middle"
                    fontSize={10}
                    fill="currentColor"
                  >
                    interictal
                  </text>
                  <text
                    x={(matrixSize * 3) / 4}
                    y={matrixSize + 18}
                    textAnchor="middle"
                    fontSize={10}
                    fill="currentColor"
                  >
                    ictal
                  </text>
                  <text
                    x={matrixSize / 2}
                    y={matrixSize + 36}
                    textAnchor="middle"
                    fontSize={11}
                    fill="currentColor"
                  >
                    预测
                  </text>
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
  id: 'event-confusion',
  title: '事件级混淆矩阵',
  titleEn: 'Event-level Confusion Matrix',
  category: 'evaluation',
  summary:
    '三模型（EEGNet、MA-MP-GF、GAT-CMC-Net）事件级分类混淆矩阵对比，支持归一化/计数视图、色带切换与配置保存。',
  component: EventConfusionChart,
});
