import { useCallback, useMemo, useRef, useState } from 'react';
import { line as d3line, curveMonotoneX } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import {
  generateEegLikeSeries,
  generateHrfLikeSeries,
} from '../../lib/synthetic';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { useDataset } from '../../lib/useDataset';
import { DataLoader } from '../../components/DataLoader';
import { bandpass, decimate, rmsEnvelope } from '../../lib/signal';
import { registerChart } from '../../registry';
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import { useLatestPythonEmitter, type PythonEmitter } from '../../lib/pythonExport';
import type { TextOverrideMap } from '../../lib/useTextOverrides';
import { emitNvcAlignmentPython } from './python';

interface SavedConfig {
  version: 1;
  duration: number;
  eegFs: number;
  hrfFs: number;
  showBands: boolean;
  eegSeed: number;
  hboSeed: number;
  hbrCoupling: number;
  eegChannel: string;
  showAlphaEnv: boolean;
  alphaWinSec: number;
  textOverrides?: TextOverrideMap;
}

const STORAGE_KEY = 'nvc-alignment-configs-v1';

interface SeizureBand {
  start: number;
  end: number;
  kind: 'inter' | 'pre' | 'ictal';
}

const BANDS: SeizureBand[] = [
  { start: 0, end: 25, kind: 'inter' },
  { start: 25, end: 55, kind: 'pre' },
  { start: 55, end: 90, kind: 'ictal' },
  { start: 90, end: 130, kind: 'pre' },
  { start: 130, end: 180, kind: 'inter' },
];

function NVCChart() {
  const [duration, setDuration] = useState(180);
  const [eegFs, setEegFs] = useState(120);
  const [hrfFs, setHrfFs] = useState(10);
  const [showBands, setShowBands] = useState(true);
  const [eegSeed, setEegSeed] = useState(11);
  const [hboSeed, setHboSeed] = useState(13);
  const [hbrCoupling, setHbrCoupling] = useState(0.7);
  const [eegChannel, setEegChannel] = useState<string>('');
  const [showAlphaEnv, setShowAlphaEnv] = useState(true);
  const [alphaWinSec, setAlphaWinSec] = useState(1.0);
  const svgRef = useRef<SVGSVGElement>(null);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      duration,
      eegFs,
      hrfFs,
      showBands,
      eegSeed,
      hboSeed,
      hbrCoupling,
      eegChannel,
      showAlphaEnv,
      alphaWinSec,
    }),
    [duration, eegFs, hrfFs, showBands, eegSeed, hboSeed, hbrCoupling, eegChannel, showAlphaEnv, alphaWinSec],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setDuration(cfg.duration);
    setEegFs(cfg.eegFs);
    setHrfFs(cfg.hrfFs);
    setShowBands(cfg.showBands);
    setEegSeed(cfg.eegSeed);
    setHboSeed(cfg.hboSeed);
    setHbrCoupling(cfg.hbrCoupling);
    setEegChannel(cfg.eegChannel);
    setShowAlphaEnv(cfg.showAlphaEnv);
    setAlphaWinSec(cfg.alphaWinSec);
  }, []);
  const pythonEmitterRef = useRef<PythonEmitter | null>(null);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'nvc-alignment-config.json',
    pythonEmitterRef,
    pythonFilename: 'nvc-alignment.py',
  });

  const { status } = useDataset();
  const loaded = status.kind === 'loaded' ? status.dataset : null;

  // EEG channels available for selection. When a dataset is loaded
  // we expose its channels as the selection set; otherwise the
  // synthetic single channel is the only option.
  const eegChannels = useMemo(() => {
    if (!loaded) return [];
    return loaded.channels.filter((c) => {
      const t = c.type.toLowerCase();
      return t === '' || t === 'eeg' || t === 'unknown';
    });
  }, [loaded]);

  // Pick the active EEG channel: explicit selection > Pz default > first.
  const activeEeg = useMemo(() => {
    if (eegChannels.length === 0) return null;
    const byName = eegChannels.find(
      (c) => c.label.toLowerCase() === eegChannel.toLowerCase(),
    );
    if (byName) return byName;
    const pz = eegChannels.find((c) => c.label.toLowerCase() === 'pz');
    return pz ?? eegChannels[0];
  }, [eegChannels, eegChannel]);

  const eeg = useMemo(() => {
    if (activeEeg) {
      // Decimate raw samples to the chart's display fs and clip to
      // the user-chosen window length so the dual-axis stays
      // synchronised with the (still-synthetic) HbO trace.
      const factor = Math.max(1, Math.round(activeEeg.fs / eegFs));
      const decimated = decimate(activeEeg.samples, factor);
      const dispFs = activeEeg.fs / factor;
      const maxSamples = Math.min(
        decimated.length,
        Math.round(duration * dispFs),
      );
      const t = new Array<number>(maxSamples);
      const v = new Array<number>(maxSamples);
      for (let i = 0; i < maxSamples; i++) {
        t[i] = i / dispFs;
        v[i] = decimated[i];
      }
      return { t, v };
    }
    return generateEegLikeSeries(eegSeed, duration, eegFs);
  }, [activeEeg, duration, eegFs, eegSeed]);

  // α-band envelope is computed at the channel's native fs so
  // bandpass cut-offs stay well below Nyquist, then decimated to
  // the fNIRS axis for plotting.
  const alphaEnv = useMemo(() => {
    if (!activeEeg || !showAlphaEnv) return null;
    const fs = activeEeg.fs;
    const lo = 8;
    const hi = Math.min(13, fs * 0.45);
    if (hi <= lo) return null;
    const filtered = bandpass(activeEeg.samples, fs, lo, hi);
    const env = rmsEnvelope(filtered, fs, alphaWinSec);
    const factor = Math.max(1, Math.round(fs / hrfFs));
    const decimated = decimate(env, factor);
    const dispFs = fs / factor;
    const maxSamples = Math.min(
      decimated.length,
      Math.round(duration * dispFs),
    );
    const t = new Array<number>(maxSamples);
    const v = new Array<number>(maxSamples);
    for (let i = 0; i < maxSamples; i++) {
      t[i] = i / dispFs;
      v[i] = decimated[i];
    }
    return { t, v };
  }, [activeEeg, showAlphaEnv, alphaWinSec, hrfFs, duration]);

  const expertSchema: ExpertSchema = [
    {
      label: '记录',
      fields: [
        { type: 'number', key: 'd', label: '时长（s）', min: 30, max: 600, step: 5, value: duration, onChange: setDuration, slider: true },
        { type: 'number', key: 'eFs', label: 'EEG 采样率（Hz）', min: 32, max: 1024, step: 8, value: eegFs, onChange: setEegFs, slider: true },
        { type: 'number', key: 'hFs', label: 'fNIRS 采样率（Hz）', min: 1, max: 50, step: 1, value: hrfFs, onChange: setHrfFs, slider: true },
      ],
    },
    {
      label: '合成种子',
      fields: [
        { type: 'number', key: 'es', label: 'EEG 种子', min: 0, max: 9999, step: 1, value: eegSeed, onChange: setEegSeed },
        { type: 'number', key: 'hs', label: 'HbO 种子', min: 0, max: 9999, step: 1, value: hboSeed, onChange: setHboSeed },
        { type: 'number', key: 'cp', label: 'HbR 耦合（−HbO）', min: 0, max: 1.5, step: 0.05, value: hbrCoupling, onChange: setHbrCoupling, slider: true, format: (v) => v.toFixed(2) },
      ],
    },
    {
      label: '已加载数据',
      fields: activeEeg
        ? [
            {
              type: 'info',
              key: 'src',
              label: '来源',
              value: `EDF · ${loaded?.fileNames[0] ?? '?'}`,
            },
            {
              type: 'select',
              key: 'ch',
              label: 'EEG 通道',
              value: activeEeg.label,
              options: eegChannels.map((c) => ({
                value: c.label,
                label: `${c.label} · ${c.fs.toFixed(0)} Hz`,
              })),
              onChange: setEegChannel,
            },
            {
              type: 'info',
              key: 'fs',
              label: '原始采样率',
              value: `${activeEeg.fs.toFixed(0)} Hz`,
            },
            {
              type: 'info',
              key: 'len',
              label: '时长',
              value: `${(activeEeg.samples.length / activeEeg.fs).toFixed(1)} s`,
            },
            {
              type: 'toggle',
              key: 'aenv',
              label: 'α 波包络（8–13 Hz）',
              value: showAlphaEnv,
              onChange: setShowAlphaEnv,
            },
            {
              type: 'number',
              key: 'aw',
              label: 'α-RMS 窗口（s）',
              min: 0.25,
              max: 4,
              step: 0.25,
              value: alphaWinSec,
              onChange: setAlphaWinSec,
              slider: true,
              format: (v) => v.toFixed(2),
            },
          ]
        : [
            {
              type: 'info',
              key: 'src',
              label: '来源',
              value: '合成（未加载 EDF）',
            },
          ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'b', label: '发作条带', value: showBands, onChange: setShowBands },
      ],
    },
  ];

  const hbo = useMemo(
    () => generateHrfLikeSeries(hboSeed, duration, hrfFs),
    [hboSeed, duration, hrfFs],
  );
  const hbr = useMemo(() => {
    // HbR roughly anti-correlates with HbO with a small lag.
    const out = generateHrfLikeSeries(hboSeed + 4, duration, hrfFs);
    return { t: out.t, v: out.v.map((v) => -v * hbrCoupling) };
  }, [hboSeed, duration, hrfFs, hbrCoupling]);

  const W = 820;
  const H = 460;
  const margin = { top: 36, right: 70, bottom: 60, left: 70 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const xAxis = buildLinearAxis({
    domain: [0, duration],
    range: [0, innerW],
    tickCount: 8,
    format: (v) => `${v.toFixed(0)}s`,
  });

  const eegMax = Math.max(...eeg.v.map(Math.abs));
  const eegAxis = buildLinearAxis({
    domain: [-eegMax, eegMax],
    range: [innerH, 0],
    tickCount: 5,
    format: (v) => v.toFixed(1),
  });

  const hbMax = Math.max(
    ...hbo.v.map(Math.abs),
    ...hbr.v.map(Math.abs),
  );
  const hbAxis = buildLinearAxis({
    domain: [-hbMax, hbMax],
    range: [innerH, 0],
    tickCount: 5,
    format: (v) => v.toFixed(2),
  });

  const eegLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => eegAxis.scale(d.v));
  const hboLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => hbAxis.scale(d.v))
    .curve(curveMonotoneX);
  const hbrLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => hbAxis.scale(d.v))
    .curve(curveMonotoneX);

  const bandColors: Record<SeizureBand['kind'], string> = {
    inter: 'rgba(125, 211, 252, 0.12)',
    pre: 'rgba(251, 191, 36, 0.18)',
    ictal: 'rgba(239, 68, 68, 0.20)',
  };
  const bandLabels: Record<SeizureBand['kind'], string> = {
    inter: 'Inter-ictal',
    pre: 'Pre-ictal',
    ictal: 'Ictal',
  };

  const eegPoints = useMemo(
    () => eeg.t.map((t, i) => ({ t, v: eeg.v[i] })),
    [eeg.t, eeg.v],
  );
  const hboPoints = useMemo(
    () => hbo.t.map((t, i) => ({ t, v: hbo.v[i] })),
    [hbo.t, hbo.v],
  );
  const hbrPoints = useMemo(
    () => hbr.t.map((t, i) => ({ t, v: hbr.v[i] })),
    [hbr.t, hbr.v],
  );

  // α-envelope is in EEG units (μV); to plot it on the same right
  // axis as HbO/HbR we normalise it to [0, hbMax] so the *shape*
  // (peaks/troughs vs the hemodynamic response) is what's visible.
  const alphaEnvPoints = useMemo(() => {
    if (!alphaEnv || alphaEnv.v.length === 0) return null;
    let envMax = 0;
    for (const v of alphaEnv.v) if (v > envMax) envMax = v;
    if (envMax <= 0) return null;
    return alphaEnv.t.map((t, i) => ({
      t,
      v: (alphaEnv.v[i] / envMax) * hbMax,
    }));
  }, [alphaEnv, hbMax]);

  const alphaEnvLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => hbAxis.scale(d.v))
    .curve(curveMonotoneX);

  const titleId = 'title';
  const captionId = 'caption';
  const rightAxisLabelId = 'right-axis-label';
  const legendEegId = 'legend-eeg';
  const legendHboId = 'legend-hbo';
  const legendHbrId = 'legend-hbr';
  const legendAlphaId = 'legend-alpha';
  const titleDefault = 'Neurovascular coupling alignment';
  const captionDefault =
    'EEG (μV) on the left axis · $\\Delta$HbO/HbR (μmol/L) on the right axis.';
  const rightAxisLabelDefault = 'ΔHbO/HbR (μmol/L)';
  const legendEegDefault = 'EEG (μV)';
  const legendHboDefault = 'ΔHbO';
  const legendHbrDefault = 'ΔHbR';
  const legendAlphaDefault = 'α-env (8–13 Hz, norm.)';
  const titleStyle = textOverrides.resolve(titleId, {
    text: titleDefault,
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: captionDefault,
    fontSize: 12,
  });
  const rightAxisLabelStyle = textOverrides.resolve(rightAxisLabelId, {
    text: rightAxisLabelDefault,
    fontSize: 12,
  });
  const legendEegStyle = textOverrides.resolve(legendEegId, {
    text: legendEegDefault,
    fontSize: 11,
  });
  const legendHboStyle = textOverrides.resolve(legendHboId, {
    text: legendHboDefault,
    fontSize: 11,
  });
  const legendHbrStyle = textOverrides.resolve(legendHbrId, {
    text: legendHbrDefault,
    fontSize: 11,
  });
  const legendAlphaStyle = textOverrides.resolve(legendAlphaId, {
    text: legendAlphaDefault,
    fontSize: 11,
  });
  const textRefs = useMemo(
    () => [
      { id: titleId, label: '主标题', defaultText: titleDefault, defaultFontSize: 14, defaultFontWeight: 600 },
      { id: captionId, label: '说明文字', defaultText: captionDefault, defaultFontSize: 12 },
      { id: rightAxisLabelId, label: '右轴标签', defaultText: rightAxisLabelDefault, defaultFontSize: 12 },
      { id: legendEegId, label: '图例：EEG', defaultText: legendEegDefault, defaultFontSize: 11 },
      { id: legendHboId, label: '图例：HbO', defaultText: legendHboDefault, defaultFontSize: 11 },
      { id: legendHbrId, label: '图例：HbR', defaultText: legendHbrDefault, defaultFontSize: 11 },
      { id: legendAlphaId, label: '图例：α包络', defaultText: legendAlphaDefault, defaultFontSize: 11 },
    ],
    [],
  );

  useLatestPythonEmitter(pythonEmitterRef, () =>
    emitNvcAlignmentPython({
      title: titleStyle.text,
      caption: captionStyle.text,
      duration,
      eegT: eeg.t,
      eegV: eeg.v,
      hboT: hbo.t,
      hboV: hbo.v,
      hbrT: hbr.t,
      hbrV: hbr.v,
      alphaT: alphaEnv ? alphaEnv.t : null,
      alphaV: alphaEnv ? alphaEnv.v : null,
      showBands,
      bands: BANDS,
      legendEeg: legendEegStyle.text,
      legendHbo: legendHboStyle.text,
      legendHbr: legendHbrStyle.text,
      legendAlpha: legendAlphaStyle.text,
      hbrCoupling,
    }),
  );

  return (
    <ChartShell
      dataLoader={<DataLoader />}
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'short',
              label: '短窗口',
              hint: '单轮',
              description: '60 秒窗口、密集条带 — 单轮查看。',
              apply: () => {
                setDuration(60);
                setShowBands(true);
              },
            },
            {
              id: 'long',
              label: '长记录',
              hint: '会话',
              description: '300 秒 — 可见多个 HRF 周期。',
              apply: () => {
                setDuration(300);
                setShowBands(true);
              },
            },
            {
              id: 'tightcoupling',
              label: '紧密 HbR 耦合',
              hint: '生理',
              description: 'HbO/HbR 强负相关。',
              apply: () => {
                setHbrCoupling(0.9);
              },
            },
            {
              id: 'looser',
              label: '松散耦合',
              hint: '噪声',
              description: '较弱耦合 — 血动力学噪声较大。',
              apply: () => {
                setHbrCoupling(0.3);
              },
            },
          ]}
        />
      }
      filename="nvc-alignment"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="记录">
            <NumberSlider
              label="时长（s）"
              value={duration}
              min={60}
              max={240}
              step={10}
              onChange={setDuration}
            />
            <NumberSlider
              label="EEG 采样率（Hz）"
              value={eegFs}
              min={32}
              max={250}
              step={2}
              onChange={setEegFs}
            />
            <NumberSlider
              label="fNIRS 采样率（Hz）"
              value={hrfFs}
              min={2}
              max={20}
              step={1}
              onChange={setHrfFs}
            />
          </ControlGroup>
          <ControlGroup label="标注">
            <Toggle
              label="显示发作条带"
              checked={showBands}
              onChange={setShowBands}
            />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <div className="space-y-2">
          <p>
            共享时间轴的双轴时序。EEG（左轴）保留原始尖峰，HbO/HbR（右轴）经单调三次
            样条平滑，以便与缓慢的神经血管响应在视觉上可区分。背景条带标记发作间期、
            发作前与发作期。
          </p>
          <p>
            将 EDF（可选 BIDS sidecar）拖到“数据接入”面板，即可从真实记录驱动 EEG
            轨迹。选中通道会被 8–13 Hz 带通滤波，其 RMS 包络（绿色虚线，已归一化到
            右轴）作为 α 波能量与血动力学响应对比的快速代理。SNIRF 收入上线前，HbO/HbR
            仍为合成数据。
          </p>
        </div>
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
            {/* Seizure bands */}
            {showBands
              ? BANDS.map((b, i) => (
                  <g key={i}>
                    <rect
                      x={xAxis.scale(b.start)}
                      width={xAxis.scale(b.end) - xAxis.scale(b.start)}
                      y={0}
                      height={innerH}
                      fill={bandColors[b.kind]}
                    />
                    <text
                      x={(xAxis.scale(b.start) + xAxis.scale(b.end)) / 2}
                      y={-8}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#0d1117"
                    >
                      {bandLabels[b.kind]}
                    </text>
                  </g>
                ))
              : null}

            <YAxis axis={eegAxis} offset={0} label="EEG (μV)" gridExtent={innerW} />
            <XAxis axis={xAxis} offset={innerH} label="Time (s)" gridExtent={innerH} />

            {/* Right axis (no grid) */}
            <g transform={`translate(${innerW}, 0)`}>
              <line x1={0} x2={0} y1={0} y2={innerH} stroke="currentColor" strokeWidth={1} />
              {hbAxis.ticks.map((t, i) => (
                <g key={i} transform={`translate(0, ${t.position})`}>
                  <line x1={0} x2={5} stroke="currentColor" strokeWidth={1} />
                  <text x={9} y={4} fontSize={11} fontFamily='"JetBrains Mono", monospace' fill="currentColor">
                    {t.label}
                  </text>
                </g>
              ))}
              <EditableSvgText
                id={rightAxisLabelId}
                x={48}
                y={innerH / 2}
                style={rightAxisLabelStyle}
                rotate={-90}
                textAnchor="middle"
                selected={textOverrides.selectedId === rightAxisLabelId}
                onSelect={(id) => textOverrides.selectText(id)}
                onMove={(id, dx, dy) =>
                  textOverrides.setOverride(id, { dx, dy })
                }
                svgRef={svgRef}
              />
            </g>

            <path d={eegLine(eegPoints) ?? undefined} stroke="#0d1117" strokeWidth={0.7} fill="none" opacity={0.85} />
            <path d={hboLine(hboPoints) ?? undefined} stroke="#dc2626" strokeWidth={2} fill="none" />
            <path d={hbrLine(hbrPoints) ?? undefined} stroke="#1d4ed8" strokeWidth={2} fill="none" />
            {alphaEnvPoints ? (
              <path
                d={alphaEnvLine(alphaEnvPoints) ?? undefined}
                stroke="#16a34a"
                strokeWidth={1.6}
                strokeDasharray="4 3"
                fill="none"
                opacity={0.95}
              />
            ) : null}

            {/* Legend */}
            <g transform={`translate(${innerW - 220}, 12)`}>
              <rect width={220} height={alphaEnvPoints ? 76 : 56} rx={4} fill="white" fillOpacity={0.92} stroke="currentColor" strokeOpacity={0.3} />
              <g transform="translate(10, 18)">
                <line x1={0} x2={20} y1={0} y2={0} stroke="#0d1117" strokeWidth={0.7} />
                <EditableSvgText
                  id={legendEegId}
                  x={26}
                  y={4}
                  style={legendEegStyle}
                  selected={textOverrides.selectedId === legendEegId}
                  onSelect={(id) => textOverrides.selectText(id)}
                  onMove={(id, dx, dy) =>
                    textOverrides.setOverride(id, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              </g>
              <g transform="translate(10, 36)">
                <line x1={0} x2={20} y1={0} y2={0} stroke="#dc2626" strokeWidth={2} />
                <EditableSvgText
                  id={legendHboId}
                  x={26}
                  y={4}
                  style={legendHboStyle}
                  selected={textOverrides.selectedId === legendHboId}
                  onSelect={(id) => textOverrides.selectText(id)}
                  onMove={(id, dx, dy) =>
                    textOverrides.setOverride(id, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              </g>
              <g transform="translate(120, 36)">
                <line x1={0} x2={20} y1={0} y2={0} stroke="#1d4ed8" strokeWidth={2} />
                <EditableSvgText
                  id={legendHbrId}
                  x={26}
                  y={4}
                  style={legendHbrStyle}
                  selected={textOverrides.selectedId === legendHbrId}
                  onSelect={(id) => textOverrides.selectText(id)}
                  onMove={(id, dx, dy) =>
                    textOverrides.setOverride(id, { dx, dy })
                  }
                  svgRef={svgRef}
                />
              </g>
              {alphaEnvPoints ? (
                <g transform="translate(10, 56)">
                  <line x1={0} x2={20} y1={0} y2={0} stroke="#16a34a" strokeWidth={1.6} strokeDasharray="4 3" />
                  <EditableSvgText
                    id={legendAlphaId}
                    x={26}
                    y={4}
                    style={legendAlphaStyle}
                    selected={textOverrides.selectedId === legendAlphaId}
                    onSelect={(id) => textOverrides.selectText(id)}
                    onMove={(id, dx, dy) =>
                      textOverrides.setOverride(id, { dx, dy })
                    }
                    svgRef={svgRef}
                  />
                </g>
              ) : null}
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'nvc-alignment',
  title: '神经血管耦合对齐时序图',
  titleEn: 'Neurovascular Coupling Alignment',
  category: 'physiology',
  summary:
    '共享时间轴的 EEG 与 HbO/HbR 双轴时序，叠加发作阶段阴影。',
  component: NVCChart,
});
