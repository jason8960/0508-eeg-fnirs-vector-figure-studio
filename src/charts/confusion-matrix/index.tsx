import { useCallback, useMemo, useRef, useState } from 'react';
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
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';

const DEFAULT_LABELS = ['Inter-ictal', 'Pre-ictal', 'Ictal', 'Post-ictal'];

interface CmInputs {
  seed: number;
  n: number;
  labels: string[];
  /** Higher = better classifier. */
  separation: number;
}

function buildConfusionMatrix({
  seed,
  n,
  labels,
  separation,
}: CmInputs): number[][] {
  const k = labels.length;
  const rng = mulberry32(seed);
  const cm: number[][] = Array.from({ length: k }, () =>
    Array.from({ length: k }, () => 0),
  );
  for (let i = 0; i < n; i++) {
    const trueClass = Math.floor(rng() * k);
    // Score the correct class higher; others get small noisy scores.
    const scores = new Array(k).fill(0).map((_, c) => {
      const mu = c === trueClass ? separation : 0;
      return mu + randn(rng);
    });
    let best = 0;
    for (let c = 1; c < k; c++) if (scores[c] > scores[best]) best = c;
    cm[trueClass][best] += 1;
  }
  return cm;
}

const STORAGE_KEY = 'confusion-matrix-configs-v1';

interface SavedConfig {
  version: 1;
  seed: number;
  n: number;
  separation: number;
  normalize: boolean;
  colormap: ColormapName;
  textOverrides?: TextOverrideMap;
}

function ConfusionMatrixChart() {
  const [n, setN] = useState(720);
  const [separation, setSeparation] = useState(1.6);
  const [normalize, setNormalize] = useState(true);
  const [colormap, setColormap] = useState<ColormapName>('viridis');
  const [seed, setSeed] = useState(42);
  const svgRef = useRef<SVGSVGElement>(null);

  const labels = DEFAULT_LABELS;

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      n,
      separation,
      normalize,
      colormap,
    }),
    [seed, n, separation, normalize, colormap],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setN(cfg.n);
    setSeparation(cfg.separation);
    setNormalize(cfg.normalize);
    setColormap(cfg.colormap);
  }, []);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<
    SavedConfig
  >({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'confusion-matrix-config.json',
  });
  const cm = useMemo(
    () => buildConfusionMatrix({ seed, n, labels, separation }),
    [seed, n, labels, separation],
  );

  const expertSchema: ExpertSchema = [
    {
      label: '样本',
      fields: [
        { type: 'number', key: 'n', label: '样本量 n', min: 40, max: 20000, step: 10, value: n, onChange: setN, slider: true },
        { type: 'number', key: 'seed', label: '随机种子', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
      ],
    },
    {
      label: '分类器',
      fields: [
        { type: 'number', key: 'sep', label: 'μ 分隔度', min: 0, max: 6, step: 0.01, value: separation, onChange: setSeparation, slider: true, format: (v) => v.toFixed(2) },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'norm', label: '按行归一化（召回率视图）', value: normalize, onChange: setNormalize },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
        { type: 'info', key: 'classes', label: '类别数 k', value: String(labels.length) },
      ],
    },
  ];

  const W = 640;
  const H = 480;
  const margin = { top: 36, right: 64, bottom: 80, left: 110 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const k = labels.length;
  const cellW = innerW / k;
  const cellH = innerH / k;

  const interp = getColormap(colormap);
  const rowSums = cm.map((row) => row.reduce((a, b) => a + b, 0));

  const cellValue = (i: number, j: number) =>
    normalize && rowSums[i] > 0 ? cm[i][j] / rowSums[i] : cm[i][j];
  const maxVal = Math.max(
    ...cm.flatMap((row, i) => row.map((_, j) => cellValue(i, j))),
  );

  const titleId = 'title';
  const captionId = 'caption';
  const trueLabelId = 'true-label';
  const predictedLabelId = 'predicted-label';
  const titleStyle = textOverrides.resolve(titleId, {
    text: `Confusion matrix · $\\mu = ${separation.toFixed(2)}$`,
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: `Synthetic 4-class data, n=${n}.`,
    fontSize: 12,
  });
  const trueLabelStyle = textOverrides.resolve(trueLabelId, {
    text: 'True label',
    fontSize: 12,
    fontWeight: 600,
  });
  const predictedLabelStyle = textOverrides.resolve(predictedLabelId, {
    text: 'Predicted label',
    fontSize: 12,
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
        defaultText: `Confusion matrix · $\\mu = ${separation.toFixed(2)}$`,
        defaultFontSize: 14,
        defaultFontWeight: 600,
      },
      {
        id: captionId,
        label: '说明文字',
        defaultText: `Synthetic 4-class data, n=${n}.`,
        defaultFontSize: 12,
      },
      {
        id: trueLabelId,
        label: '坐标轴：True label',
        defaultText: 'True label',
        defaultFontSize: 12,
        defaultFontWeight: 600,
      },
      {
        id: predictedLabelId,
        label: '坐标轴：Predicted label',
        defaultText: 'Predicted label',
        defaultFontSize: 12,
        defaultFontWeight: 600,
      },
    ];
    labels.forEach((l, i) => {
      refs.push({
        id: `row-${i}`,
        label: `行标签：${l}`,
        defaultText: l,
        defaultFontSize: 11,
      });
      refs.push({
        id: `col-${i}`,
        label: `列标签：${l}`,
        defaultText: l,
        defaultFontSize: 11,
      });
    });
    return refs;
  }, [labels, n, separation]);

  const inspirations: InspirationPreset[] = [
    {
      id: 'strong',
      label: '强分类器',
      hint: '基线',
      description: '高类别分隔、大样本、viridis 色带。',
      apply: () => {
        setN(2000);
        setSeparation(2.6);
        setNormalize(true);
        setColormap('viridis');
      },
    },
    {
      id: 'borderline',
      label: '临界分类器',
      hint: '复审',
      description: '类别易混淆 — 对角线召回率下降。',
      apply: () => {
        setN(1200);
        setSeparation(0.6);
        setNormalize(true);
        setColormap('viridis');
      },
    },
    {
      id: 'tiny',
      label: '小样本试点',
      hint: '警示',
      description: 'n=160 且使用原始计数，暴露样本量噪声。',
      apply: () => {
        setN(160);
        setSeparation(1.6);
        setNormalize(false);
        setColormap('viridis');
      },
    },
    {
      id: 'magma',
      label: 'Magma 色带',
      hint: '色彩',
      description: '同一模型切换为 magma，呈现热力图风格。',
      apply: () => {
        setColormap('magma');
      },
    },
  ];

  return (
    <ChartShell
      filename="confusion-matrix"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={<InspirationPanel presets={inspirations} />}
      inspector={
        <>
          <ControlGroup label="样本量">
            <NumberSlider
              label="n"
              value={n}
              min={120}
              max={4000}
              step={40}
              onChange={setN}
            />
          </ControlGroup>
          <ControlGroup label="分类器强度">
            <NumberSlider
              label="μ 分隔度"
              value={separation}
              min={0}
              max={4}
              step={0.05}
              onChange={setSeparation}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle
              label="按行归一化（召回率视图）"
              checked={normalize}
              onChange={setNormalize}
            />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          面向合成 4 状态发作期分类器的多类混淆矩阵。每个单元格根据开关编码
          <code>按行归一化的召回率</code>或原始计数。单元格数值以纯文本形式渲染，
          以保证可访问性（读屏器与黑白打印）。
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
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {labels.map((_, i) =>
              labels.map((_, j) => {
                const v = cellValue(i, j);
                const t = maxVal === 0 ? 0 : v / maxVal;
                const luminance = t;
                const cellId = `cell-${i}-${j}`;
                const cellText = normalize
                  ? v.toFixed(2)
                  : Math.round(v).toString();
                const cellStyle = textOverrides.resolve(cellId, {
                  text: cellText,
                  fontSize: 12,
                  color: luminance > 0.55 ? '#0d1117' : '#eef0f5',
                });
                return (
                  <g key={`${i}-${j}`}>
                    <rect
                      x={j * cellW}
                      y={i * cellH}
                      width={cellW}
                      height={cellH}
                      fill={interp(t)}
                      stroke="white"
                      strokeWidth={1}
                    />
                    <EditableSvgText
                      id={cellId}
                      x={j * cellW + cellW / 2}
                      y={i * cellH + cellH / 2 + 4}
                      style={cellStyle}
                      textAnchor="middle"
                      fontFamily='"JetBrains Mono", monospace'
                      selected={textOverrides.selectedId === cellId}
                      onSelect={(id) => textOverrides.selectText(id)}
                      onMove={(id, dx, dy) =>
                        textOverrides.setOverride(id, { dx, dy })
                      }
                      svgRef={svgRef}
                    />
                  </g>
                );
              }),
            )}

            {/* Axis labels */}
            {labels.map((l, i) => {
              const id = `row-${i}`;
              const style = textOverrides.resolve(id, {
                text: l,
                fontSize: 11,
              });
              return (
                <EditableSvgText
                  key={id}
                  id={id}
                  x={-8}
                  y={i * cellH + cellH / 2 + 4}
                  style={style}
                  textAnchor="end"
                  selected={textOverrides.selectedId === id}
                  onSelect={(idd) => textOverrides.selectText(idd)}
                  onMove={(idd, dx, dy) =>
                    textOverrides.setOverride(idd, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              );
            })}
            {labels.map((l, j) => {
              const id = `col-${j}`;
              const style = textOverrides.resolve(id, {
                text: l,
                fontSize: 11,
              });
              return (
                <EditableSvgText
                  key={id}
                  id={id}
                  x={j * cellW + cellW / 2}
                  y={innerH + 22}
                  style={style}
                  textAnchor="middle"
                  rotate={-30}
                  selected={textOverrides.selectedId === id}
                  onSelect={(idd) => textOverrides.selectText(idd)}
                  onMove={(idd, dx, dy) =>
                    textOverrides.setOverride(idd, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              );
            })}

            <EditableSvgText
              id={trueLabelId}
              x={-72}
              y={innerH / 2}
              style={trueLabelStyle}
              textAnchor="middle"
              rotate={-90}
              selected={textOverrides.selectedId === trueLabelId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />
            <EditableSvgText
              id={predictedLabelId}
              x={innerW / 2}
              y={innerH + 56}
              style={predictedLabelStyle}
              textAnchor="middle"
              selected={textOverrides.selectedId === predictedLabelId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />

            {/* Colour bar */}
            <ColorBar
              x={innerW + 18}
              y={0}
              w={14}
              h={innerH}
              interp={interp}
              max={maxVal}
              format={normalize ? (v: number) => v.toFixed(2) : (v: number) => Math.round(v).toString()}
            />
          </g>
        </FigureFrame>
      }
    />
  );
}

function ColorBar({
  x,
  y,
  w,
  h,
  interp,
  max,
  format,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  interp: (t: number) => string;
  max: number;
  format: (v: number) => string;
}) {
  const stops = 32;
  return (
    <g transform={`translate(${x}, ${y})`}>
      {Array.from({ length: stops }).map((_, i) => {
        const t = i / (stops - 1);
        return (
          <rect
            key={i}
            x={0}
            y={(1 - t) * h - h / stops}
            width={w}
            height={h / stops + 1}
            fill={interp(t)}
          />
        );
      })}
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="currentColor" strokeOpacity={0.4} />
      {[0, 0.5, 1].map((t) => (
        <text
          key={t}
          x={w + 4}
          y={(1 - t) * h + 3}
          fontSize={10}
          fill="currentColor"
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        >
          {format(t * max)}
        </text>
      ))}
    </g>
  );
}

registerChart({
  id: 'confusion-matrix',
  title: '混淆矩阵',
  titleEn: 'Confusion Matrix',
  category: 'evaluation',
  summary: '多类发作期分类器的混淆矩阵，支持按行归一化的召回率视图、感知均匀色带与可读单元格标签。',
  component: ConfusionMatrixChart,
});
