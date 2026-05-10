import { useCallback, useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import { mulberry32, randn } from '../../lib/random';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { useDataset } from '../../lib/useDataset';
import { DataLoader } from '../../components/DataLoader';
import type { ParsedDataset } from '../../workers/dataParser.worker';
import { registerChart } from '../../registry';
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import { useLatestPythonEmitter, type PythonEmitter } from '../../lib/pythonExport';
import type { TextOverrideMap } from '../../lib/useTextOverrides';
import {
  EEG_10_20,
  FNIRS_OPTODES,
  FNIRS_PAIRS,
  getOptode,
} from './positions';
import { emitEegFnirsTopomapPython } from './python';

interface SavedConfig {
  version: 1;
  showEeg: boolean;
  showFnirs: boolean;
  eegOpacity: number;
  colormap: ColormapName;
  resolution: number;
  seed: number;
  showLabels: boolean;
  frameSec: number;
  textOverrides?: TextOverrideMap;
}

const STORAGE_KEY = 'eeg-fnirs-topomap-configs-v1';

interface ScalpField {
  /** Activation values for each EEG electrode, normalised to [-1, 1]. */
  values: number[];
}

/**
 * Build a scalp field from a parsed EDF dataset by mapping channel
 * labels onto the 10-20 layout. Only channels whose name matches a
 * 10-20 electrode (case-insensitive) contribute. The value for each
 * electrode is the mean amplitude over a 1-s window centred on
 * `frameSec`.
 */
function scalpFieldFromDataset(
  dataset: ParsedDataset,
  frameSec: number,
): { field: ScalpField; matchedNames: string[] } {
  const byName = new Map<string, (typeof dataset.channels)[number]>();
  for (const c of dataset.channels) {
    byName.set(c.label.toLowerCase(), c);
  }
  const matched: string[] = [];
  const values = EEG_10_20.map((e) => {
    const ch = byName.get(e.name.toLowerCase());
    if (!ch || ch.fs <= 0) return 0;
    const halfWindow = Math.max(1, Math.round(ch.fs / 2));
    const centre = Math.min(
      ch.samples.length - 1,
      Math.max(0, Math.round(frameSec * ch.fs)),
    );
    const lo = Math.max(0, centre - halfWindow);
    const hi = Math.min(ch.samples.length, centre + halfWindow);
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += ch.samples[i];
    matched.push(e.name);
    return sum / Math.max(1, hi - lo);
  });
  const max = Math.max(...values.map(Math.abs));
  return {
    field: { values: values.map((v) => v / (max || 1)) },
    matchedNames: matched,
  };
}

function generateScalpField(seed: number): ScalpField {
  const rng = mulberry32(seed);
  // Two Gaussian sources on the scalp.
  const blobs = [
    { cx: -0.4, cy: 0.4, amp: 1.0, sigma: 0.45 },
    { cx: 0.5, cy: -0.4, amp: -0.8, sigma: 0.5 },
  ];
  const values = EEG_10_20.map((e) => {
    let v = 0;
    for (const b of blobs) {
      const d2 = (e.x - b.cx) ** 2 + (e.y - b.cy) ** 2;
      v += b.amp * Math.exp(-d2 / (2 * b.sigma * b.sigma));
    }
    v += randn(rng) * 0.06;
    return v;
  });
  const max = Math.max(...values.map(Math.abs));
  return { values: values.map((v) => v / (max || 1)) };
}

function interpolateAtPoint(x: number, y: number, field: ScalpField): number {
  // Inverse-distance-weighted interpolation, p=2.
  let num = 0;
  let den = 0;
  for (let i = 0; i < EEG_10_20.length; i++) {
    const e = EEG_10_20[i];
    const d2 = (x - e.x) ** 2 + (y - e.y) ** 2;
    const w = 1 / (d2 + 0.005);
    num += w * field.values[i];
    den += w;
  }
  return num / den;
}

function TopomapChart() {
  const [showEeg, setShowEeg] = useState(true);
  const [showFnirs, setShowFnirs] = useState(true);
  const [eegOpacity, setEegOpacity] = useState(0.6);
  const [colormap, setColormap] = useState<ColormapName>('coolwarm');
  const [resolution, setResolution] = useState(48);
  const [seed, setSeed] = useState(7);
  const [showLabels, setShowLabels] = useState(true);
  const [frameSec, setFrameSec] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      showEeg,
      showFnirs,
      eegOpacity,
      colormap,
      resolution,
      seed,
      showLabels,
      frameSec,
    }),
    [showEeg, showFnirs, eegOpacity, colormap, resolution, seed, showLabels, frameSec],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setShowEeg(cfg.showEeg);
    setShowFnirs(cfg.showFnirs);
    setEegOpacity(cfg.eegOpacity);
    setColormap(cfg.colormap);
    setResolution(cfg.resolution);
    setSeed(cfg.seed);
    setShowLabels(cfg.showLabels);
    setFrameSec(cfg.frameSec);
  }, []);
  const pythonEmitterRef = useRef<PythonEmitter | null>(null);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'eeg-fnirs-topomap-config.json',
    pythonEmitterRef,
    pythonFilename: 'eeg-fnirs-topomap.py',
  });

  const { status } = useDataset();
  const loaded = status.kind === 'loaded' ? status.dataset : null;
  const maxFrame = useMemo(() => {
    if (!loaded) return 0;
    let max = 0;
    for (const c of loaded.channels) {
      if (c.fs > 0) max = Math.max(max, c.samples.length / c.fs);
    }
    return max;
  }, [loaded]);

  const { field, matchedNames } = useMemo(() => {
    if (loaded) {
      return scalpFieldFromDataset(loaded, frameSec);
    }
    return {
      field: generateScalpField(seed),
      matchedNames: [] as string[],
    };
  }, [loaded, frameSec, seed]);

  const expertSchema: ExpertSchema = [
    {
      label: '图层',
      fields: [
        { type: 'toggle', key: 'eeg', label: 'EEG 头皮拓扑层', value: showEeg, onChange: setShowEeg },
        { type: 'toggle', key: 'fnirs', label: 'fNIRS 光极层', value: showFnirs, onChange: setShowFnirs },
        { type: 'toggle', key: 'lbl', label: '通道标签', value: showLabels, onChange: setShowLabels },
      ],
    },
    {
      label: 'EEG 场',
      fields: [
        { type: 'number', key: 'op', label: '不透明度', min: 0, max: 1, step: 0.05, value: eegOpacity, onChange: setEegOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'number', key: 'res', label: '网格分辨率', min: 12, max: 160, step: 2, value: resolution, onChange: setResolution, slider: true },
        { type: 'number', key: 'seed', label: '随机种子', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: '硬件',
      fields: [
        { type: 'info', key: 'eN', label: 'EEG 电极数', value: String(EEG_10_20.length) },
        { type: 'info', key: 'oN', label: 'fNIRS 光极数', value: String(FNIRS_OPTODES.length) },
        { type: 'info', key: 'pN', label: 'fNIRS 源–探测对数', value: String(FNIRS_PAIRS.length) },
      ],
    },
    {
      label: '已加载数据',
      description: loaded
        ? `EDF：${loaded.fileNames.join(', ')}`
        : '未加载 EDF — 使用合成场。',
      fields: loaded
        ? [
            {
              type: 'number',
              key: 'frame',
              label: '时间（秒）',
              min: 0,
              max: Math.max(0, maxFrame - 1),
              step: 0.1,
              value: frameSec,
              onChange: setFrameSec,
              slider: true,
              format: (v: number) => `${v.toFixed(1)} s`,
            },
            {
              type: 'info',
              key: 'matched',
              label: '匹配的 10-20',
              value: `${matchedNames.length} / ${EEG_10_20.length}`,
            },
            {
              type: 'info',
              key: 'duration',
              label: '时长（秒）',
              value: maxFrame.toFixed(1),
            },
          ]
        : [
            { type: 'info', key: 'src', label: '数据源', value: '合成' },
          ],
    },
  ];

  const W = 640;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2 - 24;
  const radius = 240;

  const interp = getColormap(colormap);

  // Build a coarse rectangular grid clipped to the head circle.
  const grid = useMemo(() => {
    const pixels: { x: number; y: number; v: number }[] = [];
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const u = (i + 0.5) / resolution;
        const v = (j + 0.5) / resolution;
        const xUnit = u * 2 - 1;
        const yUnit = v * 2 - 1;
        if (xUnit * xUnit + yUnit * yUnit > 1) continue;
        const value = interpolateAtPoint(xUnit, yUnit, field);
        pixels.push({
          x: cx + xUnit * radius,
          y: cy - yUnit * radius,
          v: value,
        });
      }
    }
    return pixels;
  }, [field, resolution, cx, cy, radius]);

  const cellSize = (2 * radius) / resolution;
  const tFromV = (v: number) => 0.5 + v * 0.5;

  const titleId = 'title';
  const captionId = 'caption';
  const legendSourceId = 'legend-source';
  const legendDetectorId = 'legend-detector';
  const legendPathId = 'legend-path';
  const titleDefault = 'EEG–fNIRS co-registration topomap';
  const captionDefault =
    'Synthetic dipolar scalp field with overlaid 10-20 electrodes and fNIRS optodes.';
  const legendSourceDefault = 'fNIRS source';
  const legendDetectorDefault = 'fNIRS detector';
  const legendPathDefault = 'Photon path (S→D)';
  const titleStyle = textOverrides.resolve(titleId, {
    text: titleDefault,
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: captionDefault,
    fontSize: 12,
  });
  const legendSourceStyle = textOverrides.resolve(legendSourceId, {
    text: legendSourceDefault,
    fontSize: 11,
  });
  const legendDetectorStyle = textOverrides.resolve(legendDetectorId, {
    text: legendDetectorDefault,
    fontSize: 11,
  });
  const legendPathStyle = textOverrides.resolve(legendPathId, {
    text: legendPathDefault,
    fontSize: 11,
  });
  const textRefs = useMemo(
    () => [
      { id: titleId, label: '主标题', defaultText: titleDefault, defaultFontSize: 14, defaultFontWeight: 600 },
      { id: captionId, label: '说明文字', defaultText: captionDefault, defaultFontSize: 12 },
      { id: legendSourceId, label: '图例：光源', defaultText: legendSourceDefault, defaultFontSize: 11 },
      { id: legendDetectorId, label: '图例：探测器', defaultText: legendDetectorDefault, defaultFontSize: 11 },
      { id: legendPathId, label: '图例：光子路径', defaultText: legendPathDefault, defaultFontSize: 11 },
    ],
    [],
  );

  useLatestPythonEmitter(pythonEmitterRef, () =>
    emitEegFnirsTopomapPython({
      title: titleStyle.text,
      caption: captionStyle.text,
      electrodes: EEG_10_20.map((e) => ({ name: e.name, x: e.x, y: e.y })),
      values: field.values,
      optodes: FNIRS_OPTODES.map((o) => ({
        name: o.name,
        x: o.x,
        y: o.y,
        type: o.type,
      })),
      pairs: FNIRS_PAIRS.map((p) => ({ source: p.source, detector: p.detector })),
      showEeg,
      showFnirs,
      eegOpacity,
      showLabels,
      resolution,
      colormapName: colormap,
      legendSource: legendSourceStyle.text,
      legendDetector: legendDetectorStyle.text,
      legendPath: legendPathStyle.text,
    }),
  );

  return (
    <ChartShell
      dataLoader={<DataLoader />}
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'eeg',
              label: '仅 EEG',
              hint: '模态',
              description: '隐藏 fNIRS — 查看 alpha/beta 头皮模式。',
              apply: () => {
                setShowEeg(true);
                setShowFnirs(false);
                setEegOpacity(1);
                setShowLabels(true);
              },
            },
            {
              id: 'fnirs',
              label: '仅 fNIRS',
              hint: '模态',
              description: '隐藏 EEG — 查看 HbO/HbR 光学通道。',
              apply: () => {
                setShowEeg(false);
                setShowFnirs(true);
                setShowLabels(true);
              },
            },
            {
              id: 'fused',
              label: '多模态融合',
              hint: '出版',
              description: '两种模态同时显示，半透明叠加。',
              apply: () => {
                setShowEeg(true);
                setShowFnirs(true);
                setEegOpacity(0.55);
                setShowLabels(true);
              },
            },
            {
              id: 'highres',
              label: '高分辨网格',
              hint: '导出',
              description: '分辨率 96，海报级插值。',
              apply: () => {
                setResolution(96);
              },
            },
          ]}
        />
      }
      filename="eeg-fnirs-topomap"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="图层">
            <Toggle label="显示 EEG 拓扑" checked={showEeg} onChange={setShowEeg} />
            <Toggle label="显示 fNIRS 光极" checked={showFnirs} onChange={setShowFnirs} />
          </ControlGroup>
          <ControlGroup label="EEG 层不透明度">
            <NumberSlider
              label="不透明度"
              value={eegOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={setEegOpacity}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="插值网格">
            <NumberSlider
              label="分辨率"
              value={resolution}
              min={20}
              max={80}
              step={4}
              onChange={setResolution}
            />
          </ControlGroup>
          <ControlGroup label="配色">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          在单位头皮圆盘上使用方位等距投影展示的 10-20 系统。EEG 层为头皮圆裁剪后
          的方形网格上的反距离插值。fNIRS 源–探测对以香蕉形弧线绘制，呈现邻
          近光极之间典型的光子路径。
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
          <defs>
            <clipPath id="head-clip">
              <circle cx={cx} cy={cy} r={radius} />
            </clipPath>
          </defs>

          {/* Head outline + nose + ears */}
          <g fill="none" stroke="#0d1117" strokeWidth={1.5}>
            <circle cx={cx} cy={cy} r={radius} />
            {/* Nose */}
            <polyline
              points={`${cx - 14},${cy - radius + 4} ${cx},${cy - radius - 22} ${cx + 14},${cy - radius + 4}`}
            />
            {/* Ears */}
            <ellipse cx={cx - radius} cy={cy} rx={10} ry={28} />
            <ellipse cx={cx + radius} cy={cy} rx={10} ry={28} />
          </g>

          {/* EEG topomap heat layer */}
          {showEeg ? (
            <g clipPath="url(#head-clip)" opacity={eegOpacity}>
              {grid.map((p, i) => (
                <rect
                  key={i}
                  x={p.x - cellSize / 2}
                  y={p.y - cellSize / 2}
                  width={cellSize + 1}
                  height={cellSize + 1}
                  fill={interp(tFromV(p.v))}
                />
              ))}
            </g>
          ) : null}

          {/* EEG electrodes */}
          {EEG_10_20.map((e, i) => (
            <g
              key={e.name}
              transform={`translate(${cx + e.x * radius}, ${cy - e.y * radius})`}
            >
              <circle r={5} fill="white" stroke="#0d1117" strokeWidth={1} />
              <circle r={3} fill={showEeg ? interp(tFromV(field.values[i])) : '#0d1117'} />
              {showLabels ? (
                <text
                  x={6}
                  y={-6}
                  fontSize={10}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="#0d1117"
                >
                  {e.name}
                </text>
              ) : null}
            </g>
          ))}

          {/* fNIRS optodes + pairs */}
          {showFnirs ? (
            <g>
              {FNIRS_PAIRS.map((p, i) => {
                const a = getOptode(p.source);
                const b = getOptode(p.detector);
                if (!a || !b) return null;
                const ax = cx + a.x * radius;
                const ay = cy - a.y * radius;
                const bx = cx + b.x * radius;
                const by = cy - b.y * radius;
                // Banana-shape: cubic bezier bulging upwards.
                const ux = (by - ay) / Math.hypot(bx - ax, by - ay);
                const uy = -(bx - ax) / Math.hypot(bx - ax, by - ay);
                const bulge = 14;
                const c1 = [ax + ux * bulge, ay + uy * bulge];
                const c2 = [bx + ux * bulge, by + uy * bulge];
                return (
                  <path
                    key={i}
                    d={`M${ax},${ay} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${bx},${by}`}
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    fill="none"
                    opacity={0.5}
                  />
                );
              })}
              {FNIRS_OPTODES.map((o) => (
                <g
                  key={o.name}
                  transform={`translate(${cx + o.x * radius}, ${cy - o.y * radius})`}
                >
                  {o.type === 'source' ? (
                    <rect x={-4} y={-4} width={8} height={8} fill="#dc2626" stroke="white" />
                  ) : (
                    <rect
                      x={-4}
                      y={-4}
                      width={8}
                      height={8}
                      fill="#1d4ed8"
                      stroke="white"
                      transform="rotate(45)"
                    />
                  )}
                  {showLabels ? (
                    <text
                      x={6}
                      y={-6}
                      fontSize={9}
                      fontFamily='"JetBrains Mono", monospace'
                      fill={o.type === 'source' ? '#7f1d1d' : '#1e3a8a'}
                    >
                      {o.name}
                    </text>
                  ) : null}
                </g>
              ))}
            </g>
          ) : null}

          {/* Legend */}
          <g transform={`translate(${cx - radius}, ${cy + radius + 32})`}>
            <g>
              <rect x={0} y={-5} width={10} height={10} fill="#dc2626" />
              <EditableSvgText
                id={legendSourceId}
                x={16}
                y={4}
                style={legendSourceStyle}
                selected={textOverrides.selectedId === legendSourceId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />
            </g>
            <g transform="translate(120, 0)">
              <rect x={0} y={-5} width={10} height={10} fill="#1d4ed8" transform="rotate(45)" />
              <EditableSvgText
                id={legendDetectorId}
                x={16}
                y={4}
                style={legendDetectorStyle}
                selected={textOverrides.selectedId === legendDetectorId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />
            </g>
            <g transform="translate(260, 0)">
              <line x1={0} y1={0} x2={20} y2={0} stroke="#fbbf24" strokeWidth={1.5} />
              <EditableSvgText
                id={legendPathId}
                x={26}
                y={4}
                style={legendPathStyle}
                selected={textOverrides.selectedId === legendPathId}
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
  id: 'eeg-fnirs-topomap',
  title: '脑电-近红外共注册拓扑图',
  titleEn: 'EEG–fNIRS Co-registration Topomap',
  category: 'physiology',
  summary:
    '方位等距投影的 10-20 头皮图，并叠加 fNIRS 源/探测对与香蕉形光子路径。',
  component: TopomapChart,
});
