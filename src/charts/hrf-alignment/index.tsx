/**
 * Fig. 6  HRF time-shift alignment: before vs after the learnable τⱼ
 *         (per-channel) is applied (§3.5 / §4.3).
 *
 * Two stacked time-series panels rendered with synthetic but
 * physiologically plausible traces:
 *   - EEG  (gray line, normalised RMS envelope)
 *   - HbO  (red line, hemodynamic lag w.r.t. neural drive)
 *   - HbR  (blue line, anti-correlated to HbO)
 *
 * Top panel = before alignment; bottom panel = after applying per-
 * channel τⱼ. The highlighted yellow band marks the clinical event
 * (e.g. seizure onset window) and is draggable. Pearson correlations
 * (EEG vs HbO) appear inline above each panel and update live as τⱼ
 * is edited.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { line as d3line, curveMonotoneX } from 'd3';
import { ChartShell } from '../../components/ChartShell';
import { FigureFrame } from '../../components/FigureFrame';
import {
  ControlGroup,
  NumberSlider,
  Select,
  TextArea,
  Toggle,
} from '../../components/Controls';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { renderInlineLatex } from '../../lib/latex';
import { registerChart } from '../../registry';
import { buildLinearAxis } from '../../lib/scales';
import { touchSlot, useAutoSave } from '../../lib/useAutoSave';

/* ----------------------------- types ---------------------------------- */

type Align = 'left' | 'center' | 'right';

interface Box {
  x: number;
  y: number;
}

interface SignalSpec {
  /** Display label (KaTeX-friendly). */
  label: string;
  /** Stroke colour. */
  color: string;
  /** Lag (s) baked into the synthetic trace before alignment. */
  lag: number;
  /** Per-channel learnable τⱼ (s) used by the bottom panel. */
  tau: number;
  /** Sign of the trace (HbR is anti-correlated). */
  sign: 1 | -1;
  /** Visible? */
  visible: boolean;
}

interface SavedConfig {
  version: 1;
  title: string;
  subtitleA: string;
  subtitleB: string;
  axisX: string;
  axisY: string;
  signals: SignalSpec[];
  /** Highlight band (s). */
  bandStart: number;
  bandEnd: number;
  /** Trace random seed (so refresh keeps shape). */
  seed: number;
  /** Time window (s). */
  tMin: number;
  tMax: number;
  showGrid: boolean;
  showLegend: boolean;
  showHighlight: boolean;
  showCorr: boolean;
  legendPos: Box;
  corrAPos: Box;
  corrBPos: Box;
  noteText: string;
  noteAlign: Align;
  showNote: boolean;
  notePos: Box;
  titleSize: number;
  subtitleSize: number;
  axisLabelSize: number;
  legendSize: number;
  noteSize: number;
}

/* ----------------------------- defaults ------------------------------- */

const DEFAULT_SIGNALS: SignalSpec[] = [
  { label: 'EEG (RMS env.)', color: '#5A5A5A', lag: 0, tau: 0, sign: 1, visible: true },
  { label: 'HbO (fNIRS)', color: '#D62728', lag: 4.5, tau: 4.0, sign: 1, visible: true },
  { label: 'HbR (fNIRS)', color: '#1F77B4', lag: 5.0, tau: 4.5, sign: -1, visible: true },
];

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  title: 'Fig. 6  HRF 时移对齐前后对比 (Eq. 18, §4.3)',
  subtitleA: '(a) 对齐前：HbO/HbR 相对 EEG 滞后约 5 s',
  subtitleB: '(b) 对齐后：每通道 τⱼ 已学习收敛',
  axisX: '时间 t (s)',
  axisY: '信号 (a.u.)',
  signals: DEFAULT_SIGNALS,
  bandStart: 38,
  bandEnd: 52,
  seed: 9001,
  tMin: 0,
  tMax: 80,
  showGrid: true,
  showLegend: true,
  showHighlight: true,
  showCorr: true,
  legendPos: { x: 1080, y: 70 },
  corrAPos: { x: 70, y: 70 },
  corrBPos: { x: 70, y: 320 },
  noteText: '黄色带 = 临床事件 (癫痫起始)\nτⱼ 由 sigmoid 重参数化在 [1, 8] s 间训练',
  noteAlign: 'left',
  showNote: true,
  notePos: { x: 800, y: 540 },
  titleSize: 16,
  subtitleSize: 13,
  axisLabelSize: 12,
  legendSize: 11,
  noteSize: 11,
};

/* ----------------------------- persistence ---------------------------- */

const STORAGE_KEY = 'chart:hrf-alignment:slots';

function loadStoredConfigs(): Record<string, SavedConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedConfig>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistConfigs(slots: Record<string, SavedConfig>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    /* quota — silent */
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ----------------------------- canvas ---------------------------- */

const W_FIG = 1280;
const H_FIG = 620;
const TITLE_Y = 28;
const PANEL_W = { x0: 80, x1: 1240 };
const PANEL_A = { yTop: 80, yBot: 290 };
const PANEL_B = { yTop: 340, yBot: 550 };

/* ----------------------------- math ---------------------------- */

/** Mulberry32 PRNG so traces are deterministic for a given seed. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A single Gaussian envelope at peakT with sigma. */
function gauss(t: number, peakT: number, sigma: number) {
  const z = (t - peakT) / sigma;
  return Math.exp(-0.5 * z * z);
}

/** Synthetic EEG envelope: bursty + small noise. */
function buildEegEnvelope(times: number[], peakT: number, seed: number) {
  const r = rng(seed);
  return times.map((t) => {
    const main = gauss(t, peakT, 5) * 1.0 + gauss(t, peakT + 9, 3) * 0.5;
    return Math.max(0, main + (r() - 0.5) * 0.18);
  });
}

/** Hemodynamic response: shift of the EEG envelope by lag, low-pass. */
function buildHrfTrace(
  times: number[],
  peakT: number,
  lag: number,
  sign: 1 | -1,
  seed: number,
) {
  const r = rng(seed);
  return times.map((t) => {
    const tShift = t - lag;
    const main =
      gauss(tShift, peakT, 6.5) * 1.0 + gauss(tShift, peakT + 10, 4) * 0.45;
    return sign * (main + (r() - 0.5) * 0.06);
  });
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da <= 0 || db <= 0) return 0;
  return num / Math.sqrt(da * db);
}

/* ============================================================= */

function HrfAlignmentChart() {
  const svgRef = useRef<SVGSVGElement>(null);

  const [cfg, setCfg] = useState<SavedConfig>(() => DEFAULT_CONFIG);
  const [slots, setSlots] = useState<Record<string, SavedConfig>>(() =>
    loadStoredConfigs(),
  );
  const [slotName, setSlotName] = useState<string>('');

  const patch = useCallback((p: Partial<SavedConfig>) => {
    setCfg((prev) => ({ ...prev, ...p }));
  }, []);

  const patchSig = useCallback(
    (idx: number, p: Partial<SignalSpec>) => {
      setCfg((prev) => {
        const next = prev.signals.slice();
        next[idx] = { ...next[idx], ...p };
        return { ...prev, signals: next };
      });
    },
    [],
  );

  const persistAndSet = useCallback(
    (next: Record<string, SavedConfig>) => {
      persistConfigs(next);
      setSlots(next);
    },
    [],
  );

  const handleSaveSlot = useCallback(() => {
    const trimmed = slotName.trim();
    if (!trimmed) return;
    const next = { ...slots, [trimmed]: cfg };
    persistAndSet(next);
    touchSlot(STORAGE_KEY, trimmed);
  }, [slotName, slots, cfg, persistAndSet]);

  const handleLoadSlot = useCallback(
    (name: string) => {
      const v = slots[name];
      if (!v) return;
      setCfg(v);
      touchSlot(STORAGE_KEY, name);
    },
    [slots],
  );

  const handleDeleteSlot = useCallback(
    (name: string) => {
      const next = { ...slots };
      delete next[name];
      persistAndSet(next);
    },
    [slots, persistAndSet],
  );

  const handleExportConfig = useCallback(() => {
    downloadJson('hrf-alignment-config.json', cfg);
  }, [cfg]);

  const handleImportConfig = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as SavedConfig;
          if (parsed && parsed.version === 1) setCfg(parsed);
        } catch {
          /* ignore */
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [],
  );

  const handleResetAll = useCallback(() => {
    setCfg(DEFAULT_CONFIG);
  }, []);

  useAutoSave<SavedConfig>({
    storageKey: STORAGE_KEY,
    current: cfg,
    slots,
    onPersistSlots: persistAndSet,
    applyConfig: setCfg,
  });

  /* ----------------------- math: traces ------------------------ */
  const peakT = (cfg.tMin + cfg.tMax) / 2 - 5;
  const N = 280;

  const times = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= N; i++) {
      out.push(cfg.tMin + (i / N) * (cfg.tMax - cfg.tMin));
    }
    return out;
  }, [cfg.tMin, cfg.tMax]);

  const eeg = useMemo(
    () => buildEegEnvelope(times, peakT, cfg.seed),
    [times, peakT, cfg.seed],
  );

  const tracesBefore = useMemo(() => {
    return cfg.signals.map((s, i) =>
      i === 0
        ? eeg
        : buildHrfTrace(times, peakT, s.lag, s.sign, cfg.seed + i * 17),
    );
  }, [cfg.signals, eeg, times, peakT, cfg.seed]);

  // After alignment: subtract the channel-wise τⱼ from the lag to
  // simulate the soft-shift correcting it. lag_eff = lag - tau.
  const tracesAfter = useMemo(() => {
    return cfg.signals.map((s, i) =>
      i === 0
        ? eeg
        : buildHrfTrace(
            times,
            peakT,
            Math.max(0, s.lag - s.tau),
            s.sign,
            cfg.seed + i * 17,
          ),
    );
  }, [cfg.signals, eeg, times, peakT, cfg.seed]);

  // Pearson against EEG, only for visible signals (excluding EEG itself).
  const corrBefore = useMemo(() => {
    const lines: string[] = [];
    cfg.signals.forEach((s, i) => {
      if (i === 0 || !s.visible) return;
      const r = pearson(eeg, tracesBefore[i]);
      lines.push(`r(EEG, ${s.label.split(' ')[0]}) = ${r.toFixed(2)}`);
    });
    return lines.join('\n');
  }, [cfg.signals, eeg, tracesBefore]);

  const corrAfter = useMemo(() => {
    const lines: string[] = [];
    cfg.signals.forEach((s, i) => {
      if (i === 0 || !s.visible) return;
      const r = pearson(eeg, tracesAfter[i]);
      lines.push(`r(EEG, ${s.label.split(' ')[0]}) = ${r.toFixed(2)}`);
    });
    return lines.join('\n');
  }, [cfg.signals, eeg, tracesAfter]);

  /* ----------------------- axes ------------------------ */
  const axA = buildPanelAxes({
    x0: PANEL_W.x0,
    x1: PANEL_W.x1,
    yTop: PANEL_A.yTop,
    yBot: PANEL_A.yBot,
    xDomain: [cfg.tMin, cfg.tMax],
    yDomain: [-1.4, 1.4],
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: (v) => v.toFixed(1),
  });
  const axB = buildPanelAxes({
    x0: PANEL_W.x0,
    x1: PANEL_W.x1,
    yTop: PANEL_B.yTop,
    yBot: PANEL_B.yBot,
    xDomain: [cfg.tMin, cfg.tMax],
    yDomain: [-1.4, 1.4],
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: (v) => v.toFixed(1),
  });

  const slotOptions = useMemo(() => Object.keys(slots).sort(), [slots]);

  /* ----------------------- inspector schema ------------------------ */
  const expertSchema: ExpertSchema = useMemo(
    () => [
      {
        label: '标题与小标题',
        fields: [
          { type: 'text', key: 't', label: '主标题', value: cfg.title, multiline: true, onChange: (v) => patch({ title: v }) },
          { type: 'text', key: 'sa', label: '(a) 子标题', value: cfg.subtitleA, multiline: true, onChange: (v) => patch({ subtitleA: v }) },
          { type: 'text', key: 'sb', label: '(b) 子标题', value: cfg.subtitleB, multiline: true, onChange: (v) => patch({ subtitleB: v }) },
          { type: 'text', key: 'ax', label: 'X 轴', value: cfg.axisX, onChange: (v) => patch({ axisX: v }) },
          { type: 'text', key: 'ay', label: 'Y 轴', value: cfg.axisY, onChange: (v) => patch({ axisY: v }) },
        ],
      },
      {
        label: '信号通道',
        fields: cfg.signals.flatMap((s, i) => [
          { type: 'text' as const, key: `l${i}`, label: `通道 ${i + 1} 标签`, value: s.label, onChange: (v: string) => patchSig(i, { label: v }) },
          { type: 'text' as const, key: `c${i}`, label: `通道 ${i + 1} 颜色`, value: s.color, onChange: (v: string) => patchSig(i, { color: v }) },
          ...(i === 0
            ? []
            : [
                { type: 'number' as const, key: `lag${i}`, label: `通道 ${i + 1} 滞后 (s)`, min: 0, max: 12, step: 0.1, value: s.lag, onChange: (v: number) => patchSig(i, { lag: v }), slider: true, format: (v: number) => v.toFixed(1) },
                { type: 'number' as const, key: `tau${i}`, label: `通道 ${i + 1} τⱼ (s)`, min: 0, max: 12, step: 0.1, value: s.tau, onChange: (v: number) => patchSig(i, { tau: v }), slider: true, format: (v: number) => v.toFixed(1) },
              ]),
          { type: 'toggle' as const, key: `v${i}`, label: `通道 ${i + 1} 显示`, value: s.visible, onChange: (v: boolean) => patchSig(i, { visible: v }) },
        ]),
      },
      {
        label: '时间窗 / 高亮带',
        fields: [
          { type: 'number', key: 'tmn', label: 't_min (s)', min: 0, max: 60, step: 1, value: cfg.tMin, onChange: (v) => patch({ tMin: v }), slider: true },
          { type: 'number', key: 'tmx', label: 't_max (s)', min: 20, max: 200, step: 1, value: cfg.tMax, onChange: (v) => patch({ tMax: v }), slider: true },
          { type: 'number', key: 'bs', label: '带起 (s)', min: 0, max: 200, step: 0.5, value: cfg.bandStart, onChange: (v) => patch({ bandStart: v }), slider: true },
          { type: 'number', key: 'be', label: '带止 (s)', min: 0, max: 200, step: 0.5, value: cfg.bandEnd, onChange: (v) => patch({ bandEnd: v }), slider: true },
          { type: 'number', key: 'sd', label: '随机种子', min: 0, max: 99999, step: 1, value: cfg.seed, onChange: (v) => patch({ seed: v }) },
        ],
      },
      {
        label: '装饰 / 注解',
        fields: [
          { type: 'toggle', key: 'g', label: '网格', value: cfg.showGrid, onChange: (v) => patch({ showGrid: v }) },
          { type: 'toggle', key: 'l', label: '图例', value: cfg.showLegend, onChange: (v) => patch({ showLegend: v }) },
          { type: 'toggle', key: 'h', label: '高亮带', value: cfg.showHighlight, onChange: (v) => patch({ showHighlight: v }) },
          { type: 'toggle', key: 'rho', label: '相关系数文本', value: cfg.showCorr, onChange: (v) => patch({ showCorr: v }) },
          { type: 'toggle', key: 'sn', label: '黄色注释框', value: cfg.showNote, onChange: (v) => patch({ showNote: v }) },
          { type: 'text', key: 'nt', label: '注释文本', value: cfg.noteText, multiline: true, onChange: (v) => patch({ noteText: v }) },
          { type: 'select', key: 'na', label: '注释对齐', value: cfg.noteAlign, options: ALIGN_OPTIONS, onChange: (v) => patch({ noteAlign: v as Align }) },
        ],
      },
      {
        label: '字号',
        fields: [
          { type: 'number', key: 'ts', label: '主标题', min: 10, max: 26, step: 1, value: cfg.titleSize, onChange: (v) => patch({ titleSize: v }), slider: true },
          { type: 'number', key: 'ss', label: '子标题', min: 9, max: 22, step: 1, value: cfg.subtitleSize, onChange: (v) => patch({ subtitleSize: v }), slider: true },
          { type: 'number', key: 'as', label: '坐标轴标签', min: 8, max: 20, step: 1, value: cfg.axisLabelSize, onChange: (v) => patch({ axisLabelSize: v }), slider: true },
          { type: 'number', key: 'ls', label: '图例', min: 8, max: 18, step: 1, value: cfg.legendSize, onChange: (v) => patch({ legendSize: v }), slider: true },
          { type: 'number', key: 'ns', label: '注释', min: 8, max: 18, step: 1, value: cfg.noteSize, onChange: (v) => patch({ noteSize: v }), slider: true },
        ],
      },
    ],
    [cfg, patch, patchSig],
  );

  /* ----------------------- drag handlers ------------------------ */
  const drag = useDragHandlers(svgRef, patch, cfg);

  /* ----------------------- render ------------------------ */
  return (
    <ChartShell
      filename="fig-06-hrf-alignment"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="时间窗">
            <NumberSlider
              label="t_min (s)"
              value={cfg.tMin}
              min={0}
              max={60}
              step={1}
              onChange={(v) => patch({ tMin: v })}
            />
            <NumberSlider
              label="t_max (s)"
              value={cfg.tMax}
              min={20}
              max={200}
              step={1}
              onChange={(v) => patch({ tMax: v })}
            />
          </ControlGroup>
          <ControlGroup label="τⱼ (per-channel)">
            {cfg.signals.slice(1).map((s, i) => (
              <NumberSlider
                key={i + 1}
                label={`${s.label} τⱼ (s)`}
                value={s.tau}
                min={0}
                max={12}
                step={0.1}
                onChange={(v) => patchSig(i + 1, { tau: v })}
                format={(v) => v.toFixed(2)}
              />
            ))}
          </ControlGroup>
          <ControlGroup label="高亮事件带">
            <NumberSlider
              label="带起 (s)"
              value={cfg.bandStart}
              min={cfg.tMin}
              max={cfg.tMax}
              step={0.5}
              onChange={(v) => patch({ bandStart: v })}
            />
            <NumberSlider
              label="带止 (s)"
              value={cfg.bandEnd}
              min={cfg.tMin}
              max={cfg.tMax}
              step={0.5}
              onChange={(v) => patch({ bandEnd: v })}
            />
            <Toggle
              label="显示高亮带"
              checked={cfg.showHighlight}
              onChange={(v) => patch({ showHighlight: v })}
            />
          </ControlGroup>
          <ControlGroup label="装饰">
            <Toggle label="网格" checked={cfg.showGrid} onChange={(v) => patch({ showGrid: v })} />
            <Toggle label="图例" checked={cfg.showLegend} onChange={(v) => patch({ showLegend: v })} />
            <Toggle label="相关系数文本" checked={cfg.showCorr} onChange={(v) => patch({ showCorr: v })} />
            <Toggle label="注释框" checked={cfg.showNote} onChange={(v) => patch({ showNote: v })} />
            <TextArea
              label="注释文本"
              value={cfg.noteText}
              onChange={(v) => patch({ noteText: v })}
              rows={2}
            />
          </ControlGroup>
          <ConfigManager
            slotOptions={slotOptions}
            slotName={slotName}
            setSlotName={setSlotName}
            onSave={handleSaveSlot}
            onLoad={handleLoadSlot}
            onDelete={handleDeleteSlot}
            onExport={handleExportConfig}
            onImport={handleImportConfig}
            onReset={handleResetAll}
          />
        </>
      }
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'no-shift',
              label: '尚未对齐',
              hint: 'τⱼ = 0',
              description: '所有 τⱼ 强制 0：再现"未对齐"基线。',
              apply: () => {
                cfg.signals.forEach((_, i) => i > 0 && patchSig(i, { tau: 0 }));
              },
            },
            {
              id: 'oracle',
              label: '理想对齐',
              hint: 'τⱼ = lag',
              description: '理想 τⱼ = 真实滞后；HbO/HbR 与 EEG 完全对齐。',
              apply: () => {
                cfg.signals.forEach((s, i) => i > 0 && patchSig(i, { tau: s.lag }));
              },
            },
            {
              id: 'overshoot',
              label: '过度补偿',
              hint: 'τⱼ + 2',
              description: 'τⱼ 比真实滞后多 2 s — 反向相关变差。',
              apply: () => {
                cfg.signals.forEach((s, i) => i > 0 && patchSig(i, { tau: s.lag + 2 }));
              },
            },
            {
              id: 'wider-band',
              label: '扩展事件带',
              hint: '20 s',
              description: '把高亮带扩展到 20 秒，覆盖整个 ictal 窗口。',
              apply: () =>
                patch({
                  bandStart: Math.max(cfg.tMin, peakT - 10),
                  bandEnd: Math.min(cfg.tMax, peakT + 10),
                }),
            },
          ]}
        />
      }
      notes={
        <div className="space-y-2">
          <p>
            上下两板共享 EEG 包络曲线（灰）。HbO/HbR 由 EEG 时移 +
            高斯平滑得到，下板用每通道 τⱼ 校正了滞后。
          </p>
          <p>
            相关系数 r 在两板上方实时刷新；理想 τⱼ 对齐时 r 接近 1（HbO）/ -1
            (HbR)。
          </p>
        </div>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W_FIG}
          height={H_FIG}
          framePadding={{ top: 0, bottom: 0 }}
        >
          {/* Title */}
          <ForeignText
            x={0}
            y={TITLE_Y - 20}
            width={W_FIG}
            height={36}
            value={cfg.title}
            fontSize={cfg.titleSize}
            fontWeight={700}
            align="center"
          />

          {/* Subtitles */}
          <ForeignText
            x={PANEL_W.x0}
            y={PANEL_A.yTop - 28}
            width={PANEL_W.x1 - PANEL_W.x0}
            height={24}
            value={cfg.subtitleA}
            fontSize={cfg.subtitleSize}
            fontWeight={500}
            align="left"
          />
          <ForeignText
            x={PANEL_W.x0}
            y={PANEL_B.yTop - 28}
            width={PANEL_W.x1 - PANEL_W.x0}
            height={24}
            value={cfg.subtitleB}
            fontSize={cfg.subtitleSize}
            fontWeight={500}
            align="left"
          />

          {/* Panel (a) */}
          <PanelChrome
            ax={axA}
            xLabel={cfg.axisX}
            yLabel={cfg.axisY}
            showGrid={cfg.showGrid}
            axisLabelSize={cfg.axisLabelSize}
          />
          {cfg.showHighlight ? (
            <rect
              x={axA.x.scale(cfg.bandStart)}
              y={axA.yTop}
              width={Math.max(0, axA.x.scale(cfg.bandEnd) - axA.x.scale(cfg.bandStart))}
              height={axA.yBot - axA.yTop}
              fill="#FFE7C2"
              fillOpacity={0.5}
              stroke="#E0B070"
              strokeWidth={0.7}
            />
          ) : null}
          {/* Event centre guide */}
          <line
            x1={axA.x.scale(peakT)}
            x2={axA.x.scale(peakT)}
            y1={axA.yTop}
            y2={axA.yBot}
            stroke="#444"
            strokeWidth={0.9}
            strokeDasharray="4 4"
            opacity={0.6}
          />
          <ForeignText
            x={axA.x.scale(peakT) - 60}
            y={axA.yTop - 16}
            width={120}
            height={14}
            value={`event $t_e$`}
            fontSize={10}
            align="center"
          />
          {/* Channel τ shift markers (peakT + lag for each non-EEG signal) */}
          {cfg.signals.map((s, i) => {
            if (i === 0 || !s.visible) return null;
            const tShift = peakT + s.lag;
            if (tShift < cfg.tMin || tShift > cfg.tMax) return null;
            return (
              <g key={`shift-a-${i}`}>
                <line
                  x1={axA.x.scale(tShift)}
                  x2={axA.x.scale(tShift)}
                  y1={axA.yBot - 14}
                  y2={axA.yBot}
                  stroke={s.color}
                  strokeWidth={2}
                />
                <polygon
                  points={`${axA.x.scale(tShift) - 4},${axA.yBot - 14} ${axA.x.scale(tShift) + 4},${axA.yBot - 14} ${axA.x.scale(tShift)},${axA.yBot - 20}`}
                  fill={s.color}
                />
              </g>
            );
          })}
          {cfg.signals.map((s, i) =>
            s.visible ? (
              <PathLine
                key={i}
                points={tracesBefore[i].map((v, k) => ({ t: times[k], v }))}
                color={s.color}
                ax={axA}
              />
            ) : null,
          )}

          {/* Panel (b) */}
          <PanelChrome
            ax={axB}
            xLabel={cfg.axisX}
            yLabel={cfg.axisY}
            showGrid={cfg.showGrid}
            axisLabelSize={cfg.axisLabelSize}
          />
          {cfg.showHighlight ? (
            <rect
              x={axB.x.scale(cfg.bandStart)}
              y={axB.yTop}
              width={Math.max(0, axB.x.scale(cfg.bandEnd) - axB.x.scale(cfg.bandStart))}
              height={axB.yBot - axB.yTop}
              fill="#FFE7C2"
              fillOpacity={0.5}
              stroke="#E0B070"
              strokeWidth={0.7}
            />
          ) : null}
          {/* Event centre guide on panel (b) */}
          <line
            x1={axB.x.scale(peakT)}
            x2={axB.x.scale(peakT)}
            y1={axB.yTop}
            y2={axB.yBot}
            stroke="#444"
            strokeWidth={0.9}
            strokeDasharray="4 4"
            opacity={0.6}
          />
          {/* After τ correction: residual lag = lag - tau */}
          {cfg.signals.map((s, i) => {
            if (i === 0 || !s.visible) return null;
            const tShift = peakT + Math.max(0, s.lag - s.tau);
            if (tShift < cfg.tMin || tShift > cfg.tMax) return null;
            return (
              <g key={`shift-b-${i}`}>
                <line
                  x1={axB.x.scale(tShift)}
                  x2={axB.x.scale(tShift)}
                  y1={axB.yBot - 14}
                  y2={axB.yBot}
                  stroke={s.color}
                  strokeWidth={2}
                />
                <polygon
                  points={`${axB.x.scale(tShift) - 4},${axB.yBot - 14} ${axB.x.scale(tShift) + 4},${axB.yBot - 14} ${axB.x.scale(tShift)},${axB.yBot - 20}`}
                  fill={s.color}
                />
              </g>
            );
          })}
          {cfg.signals.map((s, i) =>
            s.visible ? (
              <PathLine
                key={i}
                points={tracesAfter[i].map((v, k) => ({ t: times[k], v }))}
                color={s.color}
                ax={axB}
              />
            ) : null,
          )}

          {/* Δρ improvement bars — per channel mini bar chart */}
          {(() => {
            const items = cfg.signals
              .map((s, i) => ({ s, i }))
              .filter((it) => it.i > 0 && it.s.visible);
            if (items.length === 0) return null;
            const groupX = PANEL_W.x1 - 220;
            const groupY = PANEL_B.yBot + 10;
            const rowH = 18;
            const labelW = 60;
            const barMax = 100;
            return (
              <g transform={`translate(${groupX}, ${groupY})`}>
                <rect
                  x={-8}
                  y={-12}
                  width={228}
                  height={items.length * rowH + 22}
                  rx={6}
                  fill="#FAFAFA"
                  stroke="#CCC"
                />
                <ForeignText
                  x={0}
                  y={-12}
                  width={228}
                  height={14}
                  value={`$|\\rho|$ before $\\to$ after`}
                  fontSize={11}
                  align="left"
                />
                {items.map(({ s, i }, k) => {
                  const rb = Math.abs(pearson(eeg, tracesBefore[i]));
                  const ra = Math.abs(pearson(eeg, tracesAfter[i]));
                  const wb = rb * barMax;
                  const wa = ra * barMax;
                  const y = k * rowH + 6;
                  return (
                    <g key={`drho-${i}`} transform={`translate(0, ${y})`}>
                      <ForeignText
                        x={0}
                        y={-2}
                        width={labelW}
                        height={14}
                        value={s.label.split(' ')[0]}
                        fontSize={10}
                        align="left"
                      />
                      <rect x={labelW} y={4} width={barMax} height={3} fill="#E5E7EB" />
                      <rect x={labelW} y={4} width={wb} height={3} fill={s.color} fillOpacity={0.4} />
                      <rect x={labelW} y={9} width={wa} height={3} fill={s.color} />
                      <ForeignText
                        x={labelW + barMax + 4}
                        y={-2}
                        width={50}
                        height={14}
                        value={`$\\Delta=${(ra - rb >= 0 ? '+' : '') + (ra - rb).toFixed(2)}$`}
                        fontSize={10}
                        align="left"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Correlation labels */}
          {cfg.showCorr ? (
            <>
              <g
                transform={`translate(${cfg.corrAPos.x}, ${cfg.corrAPos.y})`}
                onMouseDown={drag.beginCorrA}
                style={{ cursor: 'grab' }}
              >
                <rect
                  x={-6}
                  y={-6}
                  width={210}
                  height={50}
                  rx={4}
                  fill="white"
                  fillOpacity={0.92}
                  stroke="#bbb"
                />
                <ForeignText
                  x={0}
                  y={-2}
                  width={196}
                  height={44}
                  value={corrBefore || '—'}
                  fontSize={cfg.legendSize}
                  align="left"
                />
              </g>
              <g
                transform={`translate(${cfg.corrBPos.x}, ${cfg.corrBPos.y})`}
                onMouseDown={drag.beginCorrB}
                style={{ cursor: 'grab' }}
              >
                <rect
                  x={-6}
                  y={-6}
                  width={210}
                  height={50}
                  rx={4}
                  fill="white"
                  fillOpacity={0.92}
                  stroke="#bbb"
                />
                <ForeignText
                  x={0}
                  y={-2}
                  width={196}
                  height={44}
                  value={corrAfter || '—'}
                  fontSize={cfg.legendSize}
                  align="left"
                />
              </g>
            </>
          ) : null}

          {/* Legend */}
          {cfg.showLegend ? (
            <g
              transform={`translate(${cfg.legendPos.x}, ${cfg.legendPos.y})`}
              onMouseDown={drag.beginLegend}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={-6}
                y={-6}
                width={170}
                height={cfg.signals.length * 22 + 14}
                rx={6}
                fill="white"
                fillOpacity={0.92}
                stroke="#999"
              />
              {cfg.signals.map((s, i) => (
                <g key={i} transform={`translate(0, ${i * 22 + 8})`}>
                  <line
                    x1={2}
                    x2={28}
                    y1={6}
                    y2={6}
                    stroke={s.color}
                    strokeWidth={2.6}
                  />
                  <ForeignText
                    x={36}
                    y={-6}
                    width={130}
                    height={22}
                    value={s.label}
                    fontSize={cfg.legendSize}
                    align="left"
                  />
                </g>
              ))}
            </g>
          ) : null}

          {/* Yellow note */}
          {cfg.showNote ? (
            <g
              transform={`translate(${cfg.notePos.x}, ${cfg.notePos.y})`}
              onMouseDown={drag.beginNote}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={-8}
                y={-8}
                width={420}
                height={56}
                rx={6}
                fill="#FFF4CC"
                stroke="#A37C0E"
              />
              <ForeignText
                x={0}
                y={-2}
                width={404}
                height={50}
                value={cfg.noteText}
                fontSize={cfg.noteSize}
                align={cfg.noteAlign}
              />
            </g>
          ) : null}
        </FigureFrame>
      }
    />
  );
}

/* ============================================================= */
/*                       small subcomponents                      */
/* ============================================================= */

const ALIGN_OPTIONS: ReadonlyArray<{ value: Align; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

interface PanelAxes {
  x: ReturnType<typeof buildLinearAxis>;
  y: ReturnType<typeof buildLinearAxis>;
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
}

function buildPanelAxes(opts: {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xTickFmt?: (v: number) => string;
  yTickFmt?: (v: number) => string;
}): PanelAxes {
  return {
    x: buildLinearAxis({
      domain: opts.xDomain,
      range: [opts.x0, opts.x1],
      tickCount: 8,
      format: opts.xTickFmt,
    }),
    y: buildLinearAxis({
      domain: opts.yDomain,
      range: [opts.yBot, opts.yTop],
      tickCount: 5,
      format: opts.yTickFmt,
    }),
    x0: opts.x0,
    x1: opts.x1,
    yTop: opts.yTop,
    yBot: opts.yBot,
  };
}

function PanelChrome({
  ax,
  xLabel,
  yLabel,
  showGrid,
  axisLabelSize,
}: {
  ax: PanelAxes;
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  axisLabelSize: number;
}) {
  return (
    <g>
      {showGrid ? (
        <g opacity={0.4}>
          {ax.x.ticks.map((t, i) => (
            <line
              key={`gx${i}`}
              x1={t.position}
              x2={t.position}
              y1={ax.yTop}
              y2={ax.yBot}
              stroke="#cdd1d8"
              strokeWidth={1}
            />
          ))}
          {ax.y.ticks.map((t, i) => (
            <line
              key={`gy${i}`}
              x1={ax.x0}
              x2={ax.x1}
              y1={t.position}
              y2={t.position}
              stroke="#cdd1d8"
              strokeWidth={1}
            />
          ))}
        </g>
      ) : null}
      <rect
        x={ax.x0}
        y={ax.yTop}
        width={ax.x1 - ax.x0}
        height={ax.yBot - ax.yTop}
        fill="white"
        stroke="#222"
        strokeWidth={1}
      />
      {ax.x.ticks.map((t, i) => (
        <g key={`xt${i}`} transform={`translate(${t.position}, ${ax.yBot})`}>
          <line y1={0} y2={5} stroke="#222" strokeWidth={1} />
          <text
            y={18}
            textAnchor="middle"
            fontSize={11}
            fill="#222"
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}
      {ax.y.ticks.map((t, i) => (
        <g key={`yt${i}`} transform={`translate(${ax.x0}, ${t.position})`}>
          <line x1={-5} x2={0} stroke="#222" strokeWidth={1} />
          <text
            x={-9}
            y={4}
            textAnchor="end"
            fontSize={11}
            fill="#222"
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}
      <ForeignText
        x={ax.x0}
        y={ax.yBot + 26}
        width={ax.x1 - ax.x0}
        height={26}
        value={xLabel}
        fontSize={axisLabelSize}
        align="center"
      />
      <g transform={`translate(${ax.x0 - 50}, ${(ax.yTop + ax.yBot) / 2}) rotate(-90)`}>
        <ForeignText
          x={-90}
          y={-14}
          width={180}
          height={24}
          value={yLabel}
          fontSize={axisLabelSize}
          align="center"
        />
      </g>
    </g>
  );
}

function PathLine({
  points,
  color,
  ax,
}: {
  points: Array<{ t: number; v: number }>;
  color: string;
  ax: PanelAxes;
}) {
  const gen = d3line<{ t: number; v: number }>()
    .x((d) => ax.x.scale(d.t))
    .y((d) => ax.y.scale(d.v))
    .curve(curveMonotoneX);
  const d = gen(points);
  if (!d) return null;
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
      strokeLinecap="round"
      clipPath={`inset(${ax.yTop}px ${0}px ${ax.yBot}px ${0}px)`}
    />
  );
}

function ForeignText({
  x,
  y,
  width,
  height,
  value,
  fontSize,
  fontWeight,
  align = 'left',
  color,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  fontSize: number;
  fontWeight?: number;
  align?: Align;
  color?: string;
}) {
  const lines = value.split('\n');
  const justify =
    align === 'center'
      ? 'center'
      : align === 'right'
      ? 'flex-end'
      : 'flex-start';
  return (
    <foreignObject
      x={x}
      y={y}
      width={width}
      height={Math.max(height, lines.length * (fontSize + 4))}
      data-latex={value}
      data-latex-font-size={fontSize}
      data-latex-font-weight={fontWeight ?? 400}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: justify,
          textAlign: align as 'left' | 'center' | 'right',
          fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
          fontSize,
          fontWeight: fontWeight ?? 400,
          color: color ?? '#1c1c1c',
          lineHeight: 1.3,
        }}
        dangerouslySetInnerHTML={{
          __html: lines
            .map((l) => `<div>${l ? renderInlineLatex(l) : '&nbsp;'}</div>`)
            .join(''),
        }}
      />
    </foreignObject>
  );
}

function useDragHandlers(
  svgRef: React.RefObject<SVGSVGElement | null>,
  patch: (p: Partial<SavedConfig>) => void,
  cfg: SavedConfig,
) {
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; });
  const begin = useCallback(
    (
      e: React.MouseEvent<SVGGElement>,
      get: () => Box,
      set: (b: Box) => void,
    ) => {
      const svg = svgRef.current;
      if (!svg) return;
      const start = get();
      const sx = e.clientX;
      const sy = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scale = 1 / ctm.a;
      const onMove = (ev: MouseEvent) => {
        set({
          x: start.x + (ev.clientX - sx) * scale,
          y: start.y + (ev.clientY - sy) * scale,
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [svgRef],
  );

  return {
    beginLegend: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.legendPos,
        (b) => patch({ legendPos: b }),
      ),
    beginCorrA: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.corrAPos,
        (b) => patch({ corrAPos: b }),
      ),
    beginCorrB: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.corrBPos,
        (b) => patch({ corrBPos: b }),
      ),
    beginNote: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.notePos,
        (b) => patch({ notePos: b }),
      ),
  };
}

/* ============================================================= */

function ConfigManager({
  slotOptions,
  slotName,
  setSlotName,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImport,
  onReset,
}: {
  slotOptions: string[];
  slotName: string;
  setSlotName: (s: string) => void;
  onSave: () => void;
  onLoad: (n: string) => void;
  onDelete: (n: string) => void;
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <ControlGroup label="配置管理 / 自动存档">
      <div className="flex gap-2">
        <input
          type="text"
          value={slotName}
          onChange={(e) => setSlotName(e.target.value)}
          placeholder="新槽位名"
          className="flex-1 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-ink-50"
        />
        <button
          type="button"
          onClick={onSave}
          className="rounded bg-accent px-2 py-1 text-xs font-semibold text-ink-900 hover:opacity-90"
        >
          保存
        </button>
      </div>
      <Select
        label="槽位（含 auto-#…）"
        value={selected}
        options={[
          { value: '', label: '— 选择 —' },
          ...slotOptions.map((n) => ({ value: n, label: n })),
        ]}
        onChange={setSelected}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => selected && onLoad(selected)}
          disabled={!selected}
          className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100 disabled:opacity-50"
        >
          载入
        </button>
        <button
          type="button"
          onClick={() => selected && onDelete(selected)}
          disabled={!selected}
          className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100 disabled:opacity-50"
        >
          删除
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onExport}
          className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100"
        >
          导出 JSON
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100"
        >
          导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={onImport}
        />
      </div>
      <button
        type="button"
        onClick={onReset}
        className="w-full rounded border border-ink-600 px-2 py-1 text-xs text-ink-100"
      >
        恢复默认
      </button>
      <p className="text-[10px] leading-snug text-ink-300">
        每 5 分钟自动比对快照；若有改动则新建 auto-#N 槽位（最多保留 20 条）。
      </p>
    </ControlGroup>
  );
}

/* ============================================================= */

registerChart({
  id: 'hrf-alignment',
  title: 'Fig. 6 · HRF 时移对齐前后',
  titleEn: 'Fig. 6 · HRF Time-Shift Alignment Before/After',
  category: 'architecture',
  summary:
    'EEG/HbO/HbR 的对齐前后两板，可拖拽事件高亮带、调每通道 τⱼ，相关系数实时刷新。',
  component: HrfAlignmentChart,
});
