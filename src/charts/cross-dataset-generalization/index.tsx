import { useMemo, useRef, useState, useCallback } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
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

// Datasets
const DATASETS = ['CHB-MIT', 'TUSZ', 'SeizIT2'] as const;
type Dataset = (typeof DATASETS)[number];

// Models
const MODELS: Array<{ id: string; name: string; baseAccuracy: number }> = [
  { id: 'eegnet', name: 'EEGNet', baseAccuracy: 0.72 },
  { id: 'ma-mp-gf', name: 'MA-MP-GF', baseAccuracy: 0.78 },
  { id: 'ours', name: 'Ours (GAT-CMC-Net)', baseAccuracy: 0.86 },
];
type ModelId = (typeof MODELS)[number]['id'];

interface GeneralizationMatrix {
  trainDataset: Dataset;
  testDataset: Dataset;
  value: number;
}

function generateGeneralizationData(
  seed: number,
  modelId: ModelId,
): GeneralizationMatrix[] {
  const rng = mulberry32(seed);
  const model = MODELS.find((m) => m.id === modelId)!;
  const results: GeneralizationMatrix[] = [];

  for (const trainDs of DATASETS) {
    for (const testDs of DATASETS) {
      let baseValue = model.baseAccuracy;

      // Same dataset: higher accuracy
      if (trainDs === testDs) {
        baseValue += 0.08;
      } else {
        // Cross-dataset: some degradation based on dataset similarity
        const degradation = 0.05 + randn(rng) * 0.03;
        baseValue -= Math.abs(degradation);
      }

      // Add noise
      baseValue += randn(rng) * 0.015;

      // Clamp
      baseValue = Math.max(0.55, Math.min(0.98, baseValue));

      results.push({
        trainDataset: trainDs,
        testDataset: testDs,
        value: baseValue,
      });
    }
  }

  return results;
}

interface SavedConfig {
  version: 1;
  seed: number;
  colormap: ColormapName;
  showValues: boolean;
  highlightDiagonal: boolean;
  minValue: number;
  maxValue: number;
}

const STORAGE_KEY = 'cross-dataset-generalization-configs-v1';

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

function CrossDatasetGeneralizationChart() {
  const [seed, setSeed] = useState(42);
  const [colormap, setColormap] = useState<ColormapName>('cividis');
  const [showValues, setShowValues] = useState(true);
  const [highlightDiagonal, setHighlightDiagonal] = useState(true);
  const [minValue, setMinValue] = useState(0.55);
  const [maxValue, setMaxValue] = useState(0.98);

  const svgRef = useRef<SVGSVGElement>(null);

  // Generate data for each model
  const allData = useMemo(() => {
    return MODELS.map((model) => ({
      model,
      data: generateGeneralizationData(seed, model.id),
    }));
  }, [seed]);

  // Config management
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedConfig>>(
    () => loadStoredConfigs(),
  );

  const buildCurrentConfig = useCallback((): SavedConfig => {
    return {
      version: 1,
      seed,
      colormap,
      showValues,
      highlightDiagonal,
      minValue,
      maxValue,
    };
  }, [seed, colormap, showValues, highlightDiagonal, minValue, maxValue]);

  const applyConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setColormap(cfg.colormap);
    setShowValues(cfg.showValues);
    setHighlightDiagonal(cfg.highlightDiagonal);
    setMinValue(cfg.minValue);
    setMaxValue(cfg.maxValue);
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
      label: '数据',
      fields: [
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
      label: '色带',
      fields: [
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'values', label: '显示数值', value: showValues, onChange: setShowValues },
        { type: 'toggle', key: 'diag', label: '高亮对角线', value: highlightDiagonal, onChange: setHighlightDiagonal },
        {
          type: 'number',
          key: 'min',
          label: '最小值',
          min: 0.5,
          max: 0.8,
          step: 0.01,
          value: minValue,
          onChange: setMinValue,
          slider: true,
          format: (v) => v.toFixed(2),
        },
        {
          type: 'number',
          key: 'max',
          label: '最大值',
          min: 0.8,
          max: 1.0,
          step: 0.01,
          value: maxValue,
          onChange: setMaxValue,
          slider: true,
          format: (v) => v.toFixed(2),
        },
      ],
    },
  ];

  const inspirations: InspirationPreset[] = [
    {
      id: 'default',
      label: 'Event Sensitivity 默认',
      hint: '基线',
      description: '三模型跨数据集泛化矩阵，蓝绿色带。',
      apply: () => {
        setSeed(42);
        setColormap('cividis');
        setShowValues(true);
        setHighlightDiagonal(true);
        setMinValue(0.55);
        setMaxValue(0.98);
      },
    },
    {
      id: 'high-contrast',
      label: '高对比度',
      hint: '视觉',
      description: '使用 magma 色带增强对比度。',
      apply: () => {
        setColormap('magma');
        setMinValue(0.6);
        setMaxValue(0.95);
      },
    },
    {
      id: 'no-diagonal',
      label: '隐藏对角线高亮',
      hint: '简洁',
      description: '关闭红色对角线边框。',
      apply: () => {
        setHighlightDiagonal(false);
      },
    },
    {
      id: 'heatmap-only',
      label: '仅热力图',
      hint: '极简',
      description: '隐藏数值，纯热力图展示。',
      apply: () => {
        setShowValues(false);
      },
    },
  ];

  const interp = getColormap(colormap);
  const k = DATASETS.length;

  // Layout - three matrices side by side
  const W = 980;
  const H = 420;
  const margin = { top: 50, right: 40, bottom: 80, left: 70 };
  const matrixSize = 140;
  const gapX = (W - margin.left - margin.right - matrixSize * MODELS.length) / (MODELS.length - 1);


  return (
    <ChartShell
      filename="cross-dataset-generalization"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={<InspirationPanel presets={inspirations} />}
      inspector={
        <>
          <ControlGroup label="数据">
            <NumberSlider label="随机种子" value={seed} min={0} max={9999} step={1} onChange={setSeed} />
          </ControlGroup>
          <ControlGroup label="显示">
            <ColormapSelect value={colormap} onChange={setColormap} />
            <Toggle label="显示数值" checked={showValues} onChange={setShowValues} />
            <Toggle label="高亮对角线" checked={highlightDiagonal} onChange={setHighlightDiagonal} />
            <NumberSlider label="色带最小" value={minValue} min={0.5} max={0.8} step={0.01} onChange={setMinValue} format={(v) => v.toFixed(2)} />
            <NumberSlider label="色带最大" value={maxValue} min={0.8} max={1.0} step={0.01} onChange={setMaxValue} format={(v) => v.toFixed(2)} />
          </ControlGroup>
          <ControlGroup label="配置管理" description="保存/加载/导出配置">
            <ConfigManager
              filename="cross-dataset-config.json"
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
          跨数据集泛化矩阵（Event Sensitivity）。展示三个模型（EEGNet、MA-MP-GF、GAT-CMC-Net）
          在三个数据集（CHB-MIT、TUSZ、SeizIT2）上的交叉训练-测试性能。对角线表示同数据集训练测试，
          非对角线表示跨数据集泛化能力。色带表示 Event Sensitivity 值，支持多种色带与配置保存。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H}
          title="跨数据集泛化矩阵 · Event Sensitivity"
          caption={`三模型×三数据集交叉验证 (seed=${seed}) · 对角线=同数据集，非对角线=跨数据集泛化`}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {allData.map(({ model, data }, modelIdx) => {
              const x = modelIdx * (matrixSize + gapX);

              return (
                <g key={model.id} transform={`translate(${x}, 0)`}>
                  {/* Title */}
                  <text
                    x={matrixSize / 2}
                    y={-20}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill="currentColor"
                  >
                    {model.name}
                  </text>

                  {/* Matrix grid */}
                  {data.map((cell, idx) => {
                    const row = Math.floor(idx / k);
                    const col = idx % k;
                    const cellW = matrixSize / k;
                    const cellH = matrixSize / k;

                    const t = (cell.value - minValue) / (maxValue - minValue);
                    const isDiagonal = row === col;

                    return (
                      <g key={`${row}-${col}`}>
                        <rect
                          x={col * cellW}
                          y={row * cellH}
                          width={cellW}
                          height={cellH}
                          fill={interp(Math.max(0, Math.min(1, t)))}
                          stroke={isDiagonal && highlightDiagonal ? '#dc2626' : 'white'}
                          strokeWidth={isDiagonal && highlightDiagonal ? 2 : 1}
                        />
                        {showValues && (
                          <text
                            x={col * cellW + cellW / 2}
                            y={row * cellH + cellH / 2 + 4}
                            textAnchor="middle"
                            fontSize={isDiagonal ? 12 : 10}
                            fontWeight={isDiagonal ? 700 : 400}
                            fill={t > 0.5 ? '#fff' : '#000'}
                          >
                            {cell.value.toFixed(2)}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Y-axis labels (train datasets) */}
                  <text
                    x={-40}
                    y={matrixSize / 2}
                    textAnchor="middle"
                    fontSize={11}
                    fill="currentColor"
                    transform={`rotate(-90, -40, ${matrixSize / 2})`}
                  >
                    训练集
                  </text>
                  {DATASETS.map((ds, i) => (
                    <text
                      key={`y-${ds}`}
                      x={-8}
                      y={i * (matrixSize / k) + (matrixSize / k) / 2 + 4}
                      textAnchor="end"
                      fontSize={10}
                      fill="currentColor"
                    >
                      {ds}
                    </text>
                  ))}

                  {/* X-axis labels (test datasets) */}
                  <text
                    x={matrixSize / 2}
                    y={matrixSize + 50}
                    textAnchor="middle"
                    fontSize={11}
                    fill="currentColor"
                  >
                    测试集
                  </text>
                  {DATASETS.map((ds, i) => (
                    <text
                      key={`x-${ds}`}
                      x={i * (matrixSize / k) + (matrixSize / k) / 2}
                      y={matrixSize + 20}
                      textAnchor="middle"
                      fontSize={10}
                      fill="currentColor"
                      transform={`rotate(-30, ${i * (matrixSize / k) + (matrixSize / k) / 2}, ${matrixSize + 20})`}
                    >
                      {ds}
                    </text>
                  ))}
                </g>
              );
            })}

            {/* Color bar */}
            <g transform={`translate(${W - margin.left - margin.right + 10}, 20)`}>
              <text x={0} y={-8} fontSize={10} fill="currentColor">Event Sensitivity</text>
              {Array.from({ length: 20 }).map((_, i) => {
                const t = i / 19;
                return (
                  <rect
                    key={i}
                    x={0}
                    y={(1 - t) * 100}
                    width={12}
                    height={100 / 20 + 1}
                    fill={interp(t)}
                  />
                );
              })}
              <rect x={0} y={0} width={12} height={100} fill="none" stroke="currentColor" strokeOpacity={0.3} />
              <text x={18} y={5} fontSize={9} fill="currentColor">{maxValue.toFixed(2)}</text>
              <text x={18} y={100} fontSize={9} fill="currentColor">{minValue.toFixed(2)}</text>
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'cross-dataset-generalization',
  title: '跨数据集泛化矩阵',
  titleEn: 'Cross-dataset Generalization',
  category: 'evaluation',
  summary:
    '三模型（EEGNet、MA-MP-GF、GAT-CMC-Net）在三数据集（CHB-MIT、TUSZ、SeizIT2）上的交叉泛化性能矩阵，支持色带切换与配置保存。',
  component: CrossDatasetGeneralizationChart,
});
