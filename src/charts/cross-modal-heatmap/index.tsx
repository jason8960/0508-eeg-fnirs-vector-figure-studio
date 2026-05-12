import { useCallback, useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import {
  getColormap,
  type ColormapName,
} from '../../lib/colormaps';
import { mulberry32 } from '../../lib/random';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';

interface SavedConfig {
  version: 1;
  seed: number;
  spread: number;
  noise: number;
  secondaryBand: number;
  colormap: ColormapName;
  showRegionTags: boolean;
  showLabels: boolean;
  highlightDiagonal: boolean;
  textOverrides?: TextOverrideMap;
}

const STORAGE_KEY = 'cross-modal-heatmap-configs-v1';

/**
 * Cross-modal attention heatmap (EEG → fNIRS).
 *
 * Dense matrix $\alpha^{E \to F} \in [0, 1]^{N_E \times N_F}$ produced
 * by the cross-modal attention head of GAT-CMC-Net. Rows are EEG
 * sensors (10–20 layout); columns are fNIRS optodes. The expected
 * structure is a soft *retinotopic-like* diagonal: anterior EEG
 * channels attend to anterior fNIRS optodes, central → central, and
 * posterior → posterior, with a controllable spread that encodes how
 * spatially-localised the cross-modal binding is.
 */

const EEG_CHANNELS = [
  'Fp1',
  'Fp2',
  'F7',
  'F3',
  'Fz',
  'F4',
  'F8',
  'T3',
  'C3',
  'Cz',
  'C4',
  'T4',
  'T5',
  'P3',
  'Pz',
  'P4',
  'T6',
  'O1',
  'O2',
];

const FNIRS_CHANNELS = Array.from(
  { length: 20 },
  (_, i) => `F${(i + 1).toString().padStart(2, '0')}`,
);

interface AttentionParams {
  seed: number;
  spread: number;
  noise: number;
  /** Controls strength of secondary off-diagonal attention bands. */
  secondaryBand: number;
}

function buildAttention({
  seed,
  spread,
  noise,
  secondaryBand,
}: AttentionParams): number[][] {
  const rng = mulberry32(seed);
  const ne = EEG_CHANNELS.length;
  const nf = FNIRS_CHANNELS.length;
  const M: number[][] = Array.from({ length: ne }, () =>
    Array.from({ length: nf }, () => 0),
  );
  for (let i = 0; i < ne; i++) {
    // Map EEG row index linearly to a centre column on the fNIRS axis.
    const centre = (i / (ne - 1)) * (nf - 1);
    for (let j = 0; j < nf; j++) {
      // Primary diagonal lobe.
      const main = Math.exp(-((j - centre) ** 2) / (2 * spread * spread));
      // Secondary contralateral band — a softer echo offset.
      const echo =
        secondaryBand *
        Math.exp(
          -((j - (nf - 1 - centre)) ** 2) / (2 * (spread * 1.6) ** 2),
        );
      const n = (rng() - 0.5) * noise;
      M[i][j] = Math.max(0, Math.min(1, main + echo + n));
    }
  }

  // Per-row softmax-ish renormalisation so the colour scale is meaningful.
  for (let i = 0; i < ne; i++) {
    const row = M[i];
    const max = Math.max(...row);
    if (max > 0) {
      for (let j = 0; j < nf; j++) row[j] = row[j] / max;
    }
  }
  return M;
}

/**
 * Anatomical region colour key for the brackets that flag frontal,
 * central / temporal, and parieto-occipital sensor groups along the
 * EEG and fNIRS axes. Values are sampled from the studio's accent
 * palette so the brackets stay distinct on both light and dark frames.
 */
const REGION_COLOR = {
  frontal: '#fbbf24',
  central: '#7dd3fc',
  posterior: '#fda4af',
};

function CrossModalHeatmap() {
  const [seed, setSeed] = useState(7);
  const [spread, setSpread] = useState(2.6);
  const [noise, setNoise] = useState(0.18);
  const [secondaryBand, setSecondaryBand] = useState(0.16);
  const [colormap, setColormap] = useState<ColormapName>('magma');
  const [showRegionTags, setShowRegionTags] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [highlightDiagonal, setHighlightDiagonal] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      seed,
      spread,
      noise,
      secondaryBand,
      colormap,
      showRegionTags,
      showLabels,
      highlightDiagonal,
    }),
    [seed, spread, noise, secondaryBand, colormap, showRegionTags, showLabels, highlightDiagonal],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setSeed(cfg.seed);
    setSpread(cfg.spread);
    setNoise(cfg.noise);
    setSecondaryBand(cfg.secondaryBand);
    setColormap(cfg.colormap);
    setShowRegionTags(cfg.showRegionTags);
    setShowLabels(cfg.showLabels);
    setHighlightDiagonal(cfg.highlightDiagonal);
  }, []);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'cross-modal-heatmap-config.json',
  });

  const matrix = useMemo(
    () => buildAttention({ seed, spread, noise, secondaryBand }),
    [seed, spread, noise, secondaryBand],
  );

  const ne = EEG_CHANNELS.length;
  const nf = FNIRS_CHANNELS.length;
  const interp = getColormap(colormap);

  const titleId = 'title';
  const captionId = 'caption';
  const eegAxisId = 'axis-eeg';
  const fnirsAxisId = 'axis-fnirs';
  const colorbarLabelId = 'colorbar-label';
  const titleDefault = 'Cross-modal attention $\\alpha^{E \\to F}$ · EEG → fNIRS';
  const captionDefault = '';
  const eegAxisDefault = 'EEG channel';
  const fnirsAxisDefault = 'fNIRS channel';
  const colorbarLabelDefault = 'attention weight';
  const titleStyle = textOverrides.resolve(titleId, {
    text: titleDefault,
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: captionDefault,
    fontSize: 12,
  });
  const eegAxisStyle = textOverrides.resolve(eegAxisId, {
    text: eegAxisDefault,
    fontSize: 11.5,
    fontWeight: 500,
  });
  const fnirsAxisStyle = textOverrides.resolve(fnirsAxisId, {
    text: fnirsAxisDefault,
    fontSize: 11.5,
    fontWeight: 500,
  });
  const colorbarLabelStyle = textOverrides.resolve(colorbarLabelId, {
    text: colorbarLabelDefault,
    fontSize: 11,
  });
  const textRefs = useMemo(
    () => [
      { id: titleId, label: '主标题', defaultText: titleDefault, defaultFontSize: 14, defaultFontWeight: 600 },
      { id: captionId, label: '说明文字', defaultText: captionDefault, defaultFontSize: 12 },
      { id: eegAxisId, label: 'EEG 轴标题', defaultText: eegAxisDefault, defaultFontSize: 11.5, defaultFontWeight: 500 },
      { id: fnirsAxisId, label: 'fNIRS 轴标题', defaultText: fnirsAxisDefault, defaultFontSize: 11.5, defaultFontWeight: 500 },
      { id: colorbarLabelId, label: '色条标签', defaultText: colorbarLabelDefault, defaultFontSize: 11 },
    ],
    [],
  );

  const W = 820;
  const H = 480;
  const margin = { top: 36, right: 110, bottom: 70, left: 92 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const cellW = innerW / nf;
  const cellH = innerH / ne;

  const expertSchema: ExpertSchema = [
    {
      label: '注意力结构',
      description: '控制 $\\alpha^{E\\to F}$ 的分布形态。',
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
          key: 'sp',
          label: '主对角带宽 σ（列）',
          min: 0.6,
          max: 6,
          step: 0.1,
          value: spread,
          onChange: setSpread,
          slider: true,
          format: (v) => v.toFixed(2),
        },
        {
          type: 'number',
          key: 'sb',
          label: '副对角带强度',
          min: 0,
          max: 0.5,
          step: 0.01,
          value: secondaryBand,
          onChange: setSecondaryBand,
          slider: true,
          format: (v) => v.toFixed(2),
        },
        {
          type: 'number',
          key: 'ns',
          label: '附加噪声',
          min: 0,
          max: 0.5,
          step: 0.01,
          value: noise,
          onChange: setNoise,
          slider: true,
          format: (v) => v.toFixed(2),
        },
      ],
    },
    {
      label: '显示',
      fields: [
        {
          type: 'colormap',
          key: 'cm',
          value: colormap,
          onChange: setColormap,
        },
        {
          type: 'toggle',
          key: 'rt',
          label: '区域分组色块（前/中/后）',
          value: showRegionTags,
          onChange: setShowRegionTags,
        },
        {
          type: 'toggle',
          key: 'lb',
          label: '通道标签',
          value: showLabels,
          onChange: setShowLabels,
        },
        {
          type: 'toggle',
          key: 'hd',
          label: '高亮主对角带轨迹',
          value: highlightDiagonal,
          onChange: setHighlightDiagonal,
        },
      ],
    },
    {
      label: '维度',
      fields: [
        {
          type: 'info',
          key: 'ne',
          label: 'EEG 通道',
          value: `${ne}（10–20 标准）`,
        },
        {
          type: 'info',
          key: 'nf',
          label: 'fNIRS 通道',
          value: `${nf}`,
        },
      ],
    },
  ];

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'sharp',
              label: '锐利对角',
              hint: '可解释',
              description: '窄主带 + 弱噪声，干净的跨模态对应。',
              apply: () => {
                setSpread(1.4);
                setNoise(0.06);
                setSecondaryBand(0.04);
              },
            },
            {
              id: 'diffuse',
              label: '弥散注意',
              hint: '多源',
              description: '宽主带 + 较强副带，模拟前驱期发散注意。',
              apply: () => {
                setSpread(3.6);
                setNoise(0.18);
                setSecondaryBand(0.32);
              },
            },
            {
              id: 'contralateral',
              label: '对侧响应',
              hint: '生理',
              description: '副对角带主导，刻画 NVC 对侧投射。',
              apply: () => {
                setSpread(2.0);
                setSecondaryBand(0.5);
                setNoise(0.12);
              },
            },
            {
              id: 'noisy',
              label: '高噪声',
              hint: '稳健',
              description: '加噪后仍可读，用以审查鲁棒性。',
              apply: () => {
                setNoise(0.4);
              },
            },
            {
              id: 'cividis',
              label: 'Cividis 配色',
              hint: '色盲',
              description: '色盲友好，适合无障碍排版。',
              apply: () => {
                setColormap('cividis');
              },
            },
          ]}
        />
      }
      filename="cross-modal-heatmap"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="对角带宽">
            <NumberSlider
              label="σ（列）"
              value={spread}
              min={0.8}
              max={5}
              step={0.1}
              onChange={setSpread}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="配色">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle
              label="主对角带高亮"
              checked={highlightDiagonal}
              onChange={setHighlightDiagonal}
            />
            <Toggle
              label="区域分组色块"
              checked={showRegionTags}
              onChange={setShowRegionTags}
            />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          每个单元 <code>(i, j)</code> 表示第 i 路 EEG 通道对第 j 路 fNIRS
          通道的注意力权重 <code>α<sup>E→F</sup></code>。每行已按行最大值
          归一化以便比较。前/中/后区域分组沿用 10–20 国际标准
          划分；主对角带反映了模型学到的位置先验，副对角带刻画对侧投射。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={titleStyle.text}
          caption={captionStyle.text || `${ne} × ${nf} attention matrix; row-normalised, seed=${seed}.`}
          titleOverride={textOverrides.overrides[titleId]}
          titleSelected={textOverrides.selectedId === titleId}
          onSelectTitle={() => textOverrides.selectText(titleId)}
          captionOverride={textOverrides.overrides[captionId]}
          captionSelected={textOverrides.selectedId === captionId}
          onSelectCaption={() => textOverrides.selectText(captionId)}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Cells */}
            {matrix.map((row, i) =>
              row.map((v, j) => (
                <rect
                  key={`${i}-${j}`}
                  x={j * cellW}
                  y={i * cellH}
                  width={cellW + 0.4}
                  height={cellH + 0.4}
                  fill={interp(v)}
                  shapeRendering="crispEdges"
                />
              )),
            )}

            {/* Region group rectangles (frontal / central / posterior) */}
            {showRegionTags ? (
              <g opacity={0.85}>
                {/* EEG row brackets on the left */}
                {[
                  { from: 0, to: 6, label: 'Frontal', region: 'frontal' as const },
                  {
                    from: 7,
                    to: 11,
                    label: 'Central / Temporal',
                    region: 'central' as const,
                  },
                  {
                    from: 12,
                    to: 18,
                    label: 'Parieto-occipital',
                    region: 'posterior' as const,
                  },
                ].map((g) => (
                  <g key={g.label}>
                    <rect
                      x={-32}
                      y={g.from * cellH + 1}
                      width={6}
                      height={(g.to - g.from + 1) * cellH - 2}
                      fill={REGION_COLOR[g.region]}
                      rx={2}
                    />
                  </g>
                ))}
                {/* fNIRS column brackets on the bottom */}
                {[
                  { from: 0, to: 5, region: 'frontal' as const },
                  { from: 6, to: 13, region: 'central' as const },
                  { from: 14, to: 19, region: 'posterior' as const },
                ].map((g) => (
                  <rect
                    key={g.region}
                    x={g.from * cellW + 1}
                    y={innerH + 24}
                    width={(g.to - g.from + 1) * cellW - 2}
                    height={6}
                    fill={REGION_COLOR[g.region]}
                    rx={2}
                  />
                ))}
              </g>
            ) : null}

            {/* Diagonal trace */}
            {highlightDiagonal ? (
              <g pointerEvents="none">
                <path
                  d={(() => {
                    const pts = matrix.map((_, i) => {
                      const cx = (i / (ne - 1)) * (nf - 1);
                      return [cx * cellW + cellW / 2, i * cellH + cellH / 2];
                    });
                    return (
                      'M' +
                      pts
                        .map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`)
                        .join(' L')
                    );
                  })()}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity={0.55}
                  strokeWidth={1.4}
                  strokeDasharray="3 3"
                />
              </g>
            ) : null}

            {/* Frame */}
            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeWidth={1}
            />

            {/* Y labels (EEG channels) */}
            {showLabels &&
              EEG_CHANNELS.map((label, i) => (
                <text
                  key={`row-${i}`}
                  x={-10}
                  y={i * cellH + cellH / 2 + 3}
                  textAnchor="end"
                  fontSize={9.5}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="currentColor"
                >
                  {label}
                </text>
              ))}

            {/* X labels (fNIRS channels) — rotated */}
            {showLabels &&
              FNIRS_CHANNELS.map((label, j) => (
                <text
                  key={`col-${j}`}
                  x={j * cellW + cellW / 2}
                  y={innerH + 14}
                  textAnchor="end"
                  fontSize={9.5}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="currentColor"
                  transform={`rotate(-50, ${j * cellW + cellW / 2}, ${innerH + 14})`}
                >
                  {label}
                </text>
              ))}

            {/* Axis titles */}
            <EditableSvgText
              id={eegAxisId}
              x={-72}
              y={innerH / 2}
              style={eegAxisStyle}
              rotate={-90}
              textAnchor="middle"
              selected={textOverrides.selectedId === eegAxisId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />
            <EditableSvgText
              id={fnirsAxisId}
              x={innerW / 2}
              y={innerH + 56}
              style={fnirsAxisStyle}
              textAnchor="middle"
              selected={textOverrides.selectedId === fnirsAxisId}
              onSelect={(id) => textOverrides.selectText(id)}
              onMove={(id, dx, dy) =>
                textOverrides.setOverride(id, { dx, dy })
              }
              svgRef={svgRef}
            />

            {/* Colour bar */}
            <g transform={`translate(${innerW + 24}, 0)`}>
              <defs>
                <linearGradient
                  id="cmh-grad"
                  x1="0"
                  x2="0"
                  y1="1"
                  y2="0"
                >
                  {Array.from({ length: 16 }).map((_, k) => {
                    const t = k / 15;
                    return (
                      <stop
                        key={k}
                        offset={`${(t * 100).toFixed(2)}%`}
                        stopColor={interp(t)}
                      />
                    );
                  })}
                </linearGradient>
              </defs>
              <rect
                x={0}
                y={0}
                width={14}
                height={innerH}
                fill="url(#cmh-grad)"
                stroke="currentColor"
                strokeOpacity={0.4}
              />
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <g key={t}>
                  <line
                    x1={14}
                    x2={18}
                    y1={(1 - t) * innerH}
                    y2={(1 - t) * innerH}
                    stroke="currentColor"
                    strokeOpacity={0.55}
                  />
                  <text
                    x={22}
                    y={(1 - t) * innerH + 3.5}
                    fontSize={10}
                    fontFamily='"JetBrains Mono", monospace'
                    fill="currentColor"
                  >
                    {t.toFixed(2)}
                  </text>
                </g>
              ))}
              <EditableSvgText
                id={colorbarLabelId}
                x={66}
                y={innerH / 2}
                style={colorbarLabelStyle}
                rotate={-90}
                textAnchor="middle"
                selected={textOverrides.selectedId === colorbarLabelId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'cross-modal-heatmap',
  title: '跨模态注意力热图（EEG → fNIRS）',
  titleEn: 'Cross-modal Attention Heatmap',
  category: 'architecture',
  summary:
    'EEG 与 fNIRS 通道之间的 α^{E→F} 注意力矩阵；行归一化、可控对角带宽与对侧响应。',
  component: CrossModalHeatmap,
});
