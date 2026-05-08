/**
 * Fig. 10  Event decoding pipeline (§3.7 / §4.5).
 *
 * Three stacked panels that all share the same time axis:
 *   (a) Frame-level posterior ŷ(t) overlaid with the threshold θ_d.
 *   (b) Binary mask after thresholding, then morphological closing
 *       with structuring element of length W_min seconds.
 *   (c) Final detected events (rectangle windows on the time axis).
 *
 * Studio integration parity:
 *   - θ_d slider (panel a) and W_min slider (panel b) drive every
 *     downstream panel live; you literally watch the event windows
 *     appear / merge as you sweep the parameters.
 *   - Editable axis / panel titles / inline KaTeX caption.
 *   - Auto-save + named slot persistence.
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

interface SeedSeg {
  /** Centre of seed bump (seconds). */
  centre: number;
  /** Half-width (seconds). */
  width: number;
  /** Peak posterior probability (0..1). */
  peak: number;
}

interface SavedConfig {
  version: 1;
  title: string;
  subtitleA: string;
  subtitleB: string;
  subtitleC: string;
  axisX: string;
  axisYa: string;
  axisYb: string;
  axisYc: string;
  /** Threshold θ_d. */
  theta: number;
  /** Morphological closing length (seconds). */
  Wmin: number;
  /** Time window. */
  tMin: number;
  tMax: number;
  /** Seed bumps that build the synthetic posterior trace. */
  segs: SeedSeg[];
  /** Random seed for noise. */
  seed: number;
  showGrid: boolean;
  showThresholdLine: boolean;
  noteText: string;
  noteAlign: Align;
  showNote: boolean;
  notePos: { x: number; y: number };
  titleSize: number;
  subtitleSize: number;
  axisLabelSize: number;
  noteSize: number;
}

/* ----------------------------- defaults ------------------------------- */

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  title: 'Fig. 10  事件解码：阈值 + 形态学闭运算 (§3.7)',
  subtitleA: '(a) 帧级后验 $\\hat{y}_{(t)}$ + 阈值 $\\theta_d$',
  subtitleB: '(b) 形态学闭运算 (结构元素 $W_{\\min}$)',
  subtitleC: '(c) 最终事件窗口',
  axisX: '时间 t (s)',
  axisYa: '$\\hat{y}_{(t)}$',
  axisYb: '二值掩膜',
  axisYc: '事件',
  theta: 0.5,
  Wmin: 10,
  tMin: 0,
  tMax: 120,
  segs: [
    { centre: 28, width: 7, peak: 0.78 },
    { centre: 38, width: 4, peak: 0.62 },
    { centre: 60, width: 9, peak: 0.92 },
    { centre: 92, width: 6, peak: 0.55 },
  ],
  seed: 7777,
  showGrid: true,
  showThresholdLine: true,
  noteText:
    '阈值过 0.5 → 取 1，否则取 0；'
    + '\n再用 $W_{\\min}=10$ 秒结构元素做 closing → 合并临近碎片。',
  noteAlign: 'left',
  showNote: true,
  notePos: { x: 80, y: 600 },
  titleSize: 16,
  subtitleSize: 13,
  axisLabelSize: 12,
  noteSize: 11,
};

/* ----------------------------- persistence ---------------------------- */

const STORAGE_KEY = 'chart:event-decoding:slots';

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
const H_FIG = 700;
const PANEL_W = { x0: 80, x1: 1240 };
const PANEL_A = { yTop: 80, yBot: 220 };
const PANEL_B = { yTop: 270, yBot: 380 };
const PANEL_C = { yTop: 430, yBot: 520 };

/* ----------------------------- math ---------------------------- */

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

function bump(t: number, c: number, w: number, peak: number) {
  const z = (t - c) / w;
  return peak * Math.exp(-z * z);
}

/** 1-D morphological closing with a flat structuring element of `kernel`
 *  samples (= dilation followed by erosion). */
function morphClosing(mask: Uint8Array, kernel: number): Uint8Array {
  const k = Math.max(1, Math.floor(kernel));
  const N = mask.length;
  const dilated = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(N - 1, i + k); j++) {
      if (mask[j]) {
        v = 1;
        break;
      }
    }
    dilated[i] = v;
  }
  const eroded = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let v = 1;
    for (let j = Math.max(0, i - k); j <= Math.min(N - 1, i + k); j++) {
      if (!dilated[j]) {
        v = 0;
        break;
      }
    }
    eroded[i] = v;
  }
  return eroded;
}

interface Window {
  start: number;
  end: number;
}

function maskToWindows(mask: Uint8Array, times: number[]): Window[] {
  const out: Window[] = [];
  let s = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && s < 0) s = i;
    if ((!mask[i] || i === mask.length - 1) && s >= 0) {
      const e = mask[i] ? i : i - 1;
      out.push({ start: times[s], end: times[e] });
      s = -1;
    }
  }
  return out;
}

/* ============================================================= */

function EventDecodingChart() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cfg, setCfg] = useState<SavedConfig>(() => DEFAULT_CONFIG);
  const [slots, setSlots] = useState<Record<string, SavedConfig>>(() =>
    loadStoredConfigs(),
  );
  const [slotName, setSlotName] = useState<string>('');

  const patch = useCallback((p: Partial<SavedConfig>) => {
    setCfg((prev) => ({ ...prev, ...p }));
  }, []);

  const patchSeg = useCallback(
    (idx: number, p: Partial<SeedSeg>) => {
      setCfg((prev) => {
        const next = prev.segs.slice();
        next[idx] = { ...next[idx], ...p };
        return { ...prev, segs: next };
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
    downloadJson('event-decoding-config.json', cfg);
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

  const slotOptions = useMemo(() => Object.keys(slots).sort(), [slots]);

  /* ----------------------- math: posterior + masks ------------------------ */
  const N = 600;
  const dt = (cfg.tMax - cfg.tMin) / N;
  const times = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= N; i++) {
      out.push(cfg.tMin + (i / N) * (cfg.tMax - cfg.tMin));
    }
    return out;
  }, [cfg.tMin, cfg.tMax]);

  const posterior = useMemo(() => {
    const r = rng(cfg.seed);
    return times.map((t) => {
      let v = 0;
      for (const s of cfg.segs) {
        v = Math.max(v, bump(t, s.centre, s.width, s.peak));
      }
      v += (r() - 0.5) * 0.06;
      return Math.max(0, Math.min(1, v));
    });
  }, [times, cfg.segs, cfg.seed]);

  const rawMask = useMemo(() => {
    const m = new Uint8Array(posterior.length);
    for (let i = 0; i < posterior.length; i++) {
      m[i] = posterior[i] >= cfg.theta ? 1 : 0;
    }
    return m;
  }, [posterior, cfg.theta]);

  const closedMask = useMemo(() => {
    const k = Math.max(1, Math.round(cfg.Wmin / dt));
    return morphClosing(rawMask, k);
  }, [rawMask, cfg.Wmin, dt]);

  const finalWindows = useMemo(
    () => maskToWindows(closedMask, times),
    [closedMask, times],
  );

  /* ----------------------- axes ------------------------ */
  const axA = buildPanelAxes({
    x0: PANEL_W.x0,
    x1: PANEL_W.x1,
    yTop: PANEL_A.yTop,
    yBot: PANEL_A.yBot,
    xDomain: [cfg.tMin, cfg.tMax],
    yDomain: [0, 1.05],
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: (v) => v.toFixed(1),
  });
  const axB = buildPanelAxes({
    x0: PANEL_W.x0,
    x1: PANEL_W.x1,
    yTop: PANEL_B.yTop,
    yBot: PANEL_B.yBot,
    xDomain: [cfg.tMin, cfg.tMax],
    yDomain: [-0.1, 1.2],
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: (v) => (v < 0.5 ? '0' : '1'),
  });
  const axC = buildPanelAxes({
    x0: PANEL_W.x0,
    x1: PANEL_W.x1,
    yTop: PANEL_C.yTop,
    yBot: PANEL_C.yBot,
    xDomain: [cfg.tMin, cfg.tMax],
    yDomain: [0, 1],
    xTickFmt: (v) => v.toFixed(0),
    yTickFmt: () => '',
  });

  /* ----------------------- inspector schema ------------------------ */
  const expertSchema: ExpertSchema = useMemo(
    () => [
      {
        label: '标题与小标题',
        fields: [
          { type: 'text', key: 't', label: '主标题', value: cfg.title, multiline: true, onChange: (v) => patch({ title: v }) },
          { type: 'text', key: 'sa', label: '(a)', value: cfg.subtitleA, multiline: true, onChange: (v) => patch({ subtitleA: v }) },
          { type: 'text', key: 'sb', label: '(b)', value: cfg.subtitleB, multiline: true, onChange: (v) => patch({ subtitleB: v }) },
          { type: 'text', key: 'sc', label: '(c)', value: cfg.subtitleC, multiline: true, onChange: (v) => patch({ subtitleC: v }) },
          { type: 'text', key: 'ax', label: 'X 轴', value: cfg.axisX, onChange: (v) => patch({ axisX: v }) },
          { type: 'text', key: 'aya', label: 'Y 轴 (a)', value: cfg.axisYa, onChange: (v) => patch({ axisYa: v }) },
          { type: 'text', key: 'ayb', label: 'Y 轴 (b)', value: cfg.axisYb, onChange: (v) => patch({ axisYb: v }) },
          { type: 'text', key: 'ayc', label: 'Y 轴 (c)', value: cfg.axisYc, onChange: (v) => patch({ axisYc: v }) },
        ],
      },
      {
        label: '阈值 / 闭运算',
        fields: [
          { type: 'number', key: 'th', label: '$\\theta_d$', min: 0, max: 1, step: 0.01, value: cfg.theta, onChange: (v) => patch({ theta: v }), slider: true, format: (v) => v.toFixed(2) },
          { type: 'number', key: 'wmin', label: '$W_{\\min}$ (s)', min: 0, max: 30, step: 0.5, value: cfg.Wmin, onChange: (v) => patch({ Wmin: v }), slider: true, format: (v) => v.toFixed(1) },
          { type: 'number', key: 'tmn', label: 't_min (s)', min: 0, max: 200, step: 1, value: cfg.tMin, onChange: (v) => patch({ tMin: v }) },
          { type: 'number', key: 'tmx', label: 't_max (s)', min: 30, max: 600, step: 1, value: cfg.tMax, onChange: (v) => patch({ tMax: v }) },
          { type: 'number', key: 'sd', label: '随机种子', min: 0, max: 99999, step: 1, value: cfg.seed, onChange: (v) => patch({ seed: v }) },
        ],
      },
      {
        label: '种子段 (合成后验源)',
        fields: cfg.segs.flatMap((s, i) => [
          { type: 'number' as const, key: `c${i}`, label: `段 ${i + 1} 中心 (s)`, min: cfg.tMin, max: cfg.tMax, step: 0.5, value: s.centre, onChange: (v: number) => patchSeg(i, { centre: v }), slider: true, format: (v: number) => v.toFixed(1) },
          { type: 'number' as const, key: `w${i}`, label: `段 ${i + 1} 宽度 (s)`, min: 1, max: 30, step: 0.5, value: s.width, onChange: (v: number) => patchSeg(i, { width: v }), slider: true, format: (v: number) => v.toFixed(1) },
          { type: 'number' as const, key: `p${i}`, label: `段 ${i + 1} 峰值`, min: 0.1, max: 1.0, step: 0.01, value: s.peak, onChange: (v: number) => patchSeg(i, { peak: v }), slider: true, format: (v: number) => v.toFixed(2) },
        ]),
      },
      {
        label: '装饰 / 注解',
        fields: [
          { type: 'toggle', key: 'g', label: '网格', value: cfg.showGrid, onChange: (v) => patch({ showGrid: v }) },
          { type: 'toggle', key: 'thl', label: '阈值线', value: cfg.showThresholdLine, onChange: (v) => patch({ showThresholdLine: v }) },
          { type: 'toggle', key: 'sn', label: '注释框', value: cfg.showNote, onChange: (v) => patch({ showNote: v }) },
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
          { type: 'number', key: 'ns', label: '注释', min: 8, max: 18, step: 1, value: cfg.noteSize, onChange: (v) => patch({ noteSize: v }), slider: true },
        ],
      },
    ],
    [cfg, patch, patchSeg],
  );

  /* ----------------------- drag handlers ------------------------ */
  const drag = useDragHandlers(svgRef, cfg, patch);

  /* ----------------------- render ------------------------ */
  return (
    <ChartShell
      filename="fig-10-event-decoding"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="解码参数">
            <NumberSlider
              label="$\\theta_d$ (阈值)"
              value={cfg.theta}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ theta: v })}
              format={(v) => v.toFixed(2)}
            />
            <NumberSlider
              label="$W_{\\min}$ (s)"
              value={cfg.Wmin}
              min={0}
              max={30}
              step={0.5}
              onChange={(v) => patch({ Wmin: v })}
              format={(v) => v.toFixed(1)}
            />
            <p className="text-[11px] leading-snug text-ink-300">
              检测到 {finalWindows.length} 个事件
            </p>
          </ControlGroup>
          <ControlGroup label="时间窗">
            <NumberSlider
              label="t_min (s)"
              value={cfg.tMin}
              min={0}
              max={200}
              step={1}
              onChange={(v) => patch({ tMin: v })}
            />
            <NumberSlider
              label="t_max (s)"
              value={cfg.tMax}
              min={30}
              max={600}
              step={1}
              onChange={(v) => patch({ tMax: v })}
            />
          </ControlGroup>
          <ControlGroup label="装饰">
            <Toggle label="网格" checked={cfg.showGrid} onChange={(v) => patch({ showGrid: v })} />
            <Toggle label="阈值线" checked={cfg.showThresholdLine} onChange={(v) => patch({ showThresholdLine: v })} />
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
              id: 'high-thr',
              label: '高阈值',
              hint: 'θ=0.7',
              description: '只保留强响应窗口；典型癫痫专科首选。',
              apply: () => patch({ theta: 0.7, Wmin: 5 }),
            },
            {
              id: 'merge',
              label: '强合并',
              hint: 'W=20s',
              description: '20 秒结构元素 → 临近碎片合并成大窗。',
              apply: () => patch({ Wmin: 20 }),
            },
            {
              id: 'split',
              label: '弱合并',
              hint: 'W=2s',
              description: '2 秒结构元素 → 短暂事件保持分离。',
              apply: () => patch({ Wmin: 2 }),
            },
            {
              id: 'noise',
              label: '强噪声',
              hint: 'seed shift',
              description: '换种子 + 阈值 0.4 → 看 closing 怎样救场。',
              apply: () => patch({ seed: cfg.seed + 1, theta: 0.4 }),
            },
          ]}
        />
      }
      notes={
        <div className="space-y-2">
          <p>
            (a) 后验：直接来自 softmax 通道。 (b) 二值掩膜：阈值 + 形态学闭运算。
            (c) 最终事件：连通分量 → 矩形窗。
          </p>
          <p>
            θ_d 调高 → 漏报多；W_min 调大 → 窗合并；二者权衡决定 sensitivity /
            FPR 折衷。
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
            y={20}
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
          <ForeignText
            x={PANEL_W.x0}
            y={PANEL_C.yTop - 28}
            width={PANEL_W.x1 - PANEL_W.x0}
            height={24}
            value={cfg.subtitleC}
            fontSize={cfg.subtitleSize}
            fontWeight={500}
            align="left"
          />

          {/* Panel (a) — posterior */}
          <PanelChrome ax={axA} xLabel={cfg.axisX} yLabel={cfg.axisYa} showGrid={cfg.showGrid} axisLabelSize={cfg.axisLabelSize} />
          {/* Ground-truth shaded bands (cfg.segs are the seed bumps = GT) */}
          {cfg.segs.map((s, i) => {
            const halfW = s.width * 1.0;
            const x0 = axA.x.scale(s.centre - halfW);
            const x1 = axA.x.scale(s.centre + halfW);
            return (
              <g key={`gt-${i}`}>
                <rect
                  x={x0}
                  y={axA.yTop}
                  width={Math.max(0, x1 - x0)}
                  height={axA.yBot - axA.yTop}
                  fill="#FFD9A8"
                  fillOpacity={0.45}
                />
                {i === 0 ? (
                  <ForeignText
                    x={x0}
                    y={axA.yTop + 4}
                    width={Math.max(60, x1 - x0)}
                    height={14}
                    value="GT event"
                    fontSize={9}
                    align="left"
                    color="#A37C0E"
                  />
                ) : null}
              </g>
            );
          })}
          {/* Posterior fill under curve */}
          <g opacity={0.18}>
            <path
              d={(() => {
                const yBase = axA.y.scale(0);
                let d = `M ${axA.x.scale(times[0])} ${yBase}`;
                posterior.forEach((v, i) => {
                  d += ` L ${axA.x.scale(times[i])} ${axA.y.scale(v)}`;
                });
                d += ` L ${axA.x.scale(times[posterior.length - 1])} ${yBase} Z`;
                return d;
              })()}
              fill="#1F77B4"
              stroke="none"
            />
          </g>
          <PathLine
            points={posterior.map((v, i) => ({ t: times[i], v }))}
            color="#1F77B4"
            ax={axA}
          />
          {cfg.showThresholdLine ? (
            <g>
              <line
                x1={axA.x0}
                x2={axA.x1}
                y1={axA.y.scale(cfg.theta)}
                y2={axA.y.scale(cfg.theta)}
                stroke="#D62728"
                strokeWidth={1.4}
                strokeDasharray="6 4"
              />
              <ForeignText
                x={axA.x1 - 130}
                y={axA.y.scale(cfg.theta) - 18}
                width={120}
                height={20}
                value={`阈值 $\\theta_d$=${cfg.theta.toFixed(2)}`}
                fontSize={11}
                align="right"
                color="#D62728"
              />
            </g>
          ) : null}

          {/* Panel (b) — closed mask vs raw mask */}
          <PanelChrome ax={axB} xLabel={cfg.axisX} yLabel={cfg.axisYb} showGrid={cfg.showGrid} axisLabelSize={cfg.axisLabelSize} />
          <BinaryStrip mask={rawMask} times={times} ax={axB} color="#cccccc" yShift={0} height={28} label="raw" labelOffset={-22} />
          <BinaryStrip mask={closedMask} times={times} ax={axB} color="#2CA02C" yShift={36} height={28} label={`closing (${cfg.Wmin.toFixed(1)} s)`} labelOffset={-22} />

          {/* Panel (c) — windows with TP / FP / FN colouring */}
          <PanelChrome ax={axC} xLabel={cfg.axisX} yLabel={cfg.axisYc} showGrid={cfg.showGrid} axisLabelSize={cfg.axisLabelSize} />
          {/* Compute TP / FP / FN against GT */}
          {(() => {
            const gt = cfg.segs.map((s) => ({
              start: s.centre - s.width,
              end: s.centre + s.width,
            }));
            const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
              Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) > 0;
            const detTP: boolean[] = finalWindows.map((w) => gt.some((g) => overlaps(w, g)));
            const gtHit: boolean[] = gt.map((g) => finalWindows.some((w) => overlaps(w, g)));
            const TP = detTP.filter(Boolean).length;
            const FP = detTP.filter((b) => !b).length;
            const FN = gtHit.filter((b) => !b).length;
            const precision = TP + FP === 0 ? 0 : TP / (TP + FP);
            const recall = TP + FN === 0 ? 0 : TP / (TP + FN);
            const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
            return (
              <g>
                {/* GT band on panel C bottom strip */}
                {gt.map((g, i) => (
                  <rect
                    key={`gtc-${i}`}
                    x={axC.x.scale(g.start)}
                    y={axC.yBot - 12}
                    width={Math.max(2, axC.x.scale(g.end) - axC.x.scale(g.start))}
                    height={8}
                    fill={gtHit[i] ? '#2CA02C' : '#D62728'}
                    fillOpacity={0.85}
                  />
                ))}
                <ForeignText
                  x={PANEL_W.x0 - 60}
                  y={axC.yBot - 14}
                  width={56}
                  height={12}
                  value="GT"
                  fontSize={10}
                  align="right"
                  color="#666"
                />
                {/* Detected windows: TP green, FP red */}
                {finalWindows.map((w, i) => (
                  <g key={`fw-${i}`}>
                    <rect
                      x={axC.x.scale(w.start)}
                      y={axC.yTop + 16}
                      width={Math.max(2, axC.x.scale(w.end) - axC.x.scale(w.start))}
                      height={axC.yBot - axC.yTop - 36}
                      fill={detTP[i] ? '#2CA02C' : '#D62728'}
                      fillOpacity={0.65}
                      stroke={detTP[i] ? '#1B6E1B' : '#A0211D'}
                      strokeWidth={1.2}
                    />
                    <ForeignText
                      x={axC.x.scale(w.start)}
                      y={axC.yTop - 6}
                      width={Math.max(50, axC.x.scale(w.end) - axC.x.scale(w.start))}
                      height={18}
                      value={`#${i + 1} ${detTP[i] ? 'TP' : 'FP'}: ${w.start.toFixed(1)}\u2013${w.end.toFixed(1)}`}
                      fontSize={10}
                      align="left"
                      color={detTP[i] ? '#1B6E1B' : '#A0211D'}
                    />
                  </g>
                ))}
                {/* Metrics badge top-right */}
                <g transform={`translate(${PANEL_W.x1 - 320}, ${PANEL_C.yTop - 28})`}>
                  <rect x={0} y={-6} width={310} height={26} rx={6} fill="#FAFAFA" stroke="#CCC" />
                  <ForeignText x={6} y={-4} width={300} height={20} value={`TP=${TP} · FP=${FP} · FN=${FN}`} fontSize={11} fontWeight={600} align="left" />
                </g>
                {/* Metrics bars below the windows */}
                <g transform={`translate(${PANEL_W.x0}, ${PANEL_C.yBot + 12})`}>
                  {([
                    ['Precision', precision, '#2CA02C'],
                    ['Recall', recall, '#1F77B4'],
                    ['F1', f1, '#9467BD'],
                  ] as const).map(([name, v, c], k) => (
                    <g key={k} transform={`translate(${k * 220}, 0)`}>
                      <ForeignText x={0} y={-2} width={70} height={14} value={String(name)} fontSize={11} fontWeight={600} align="left" />
                      <rect x={70} y={4} width={120} height={6} fill="#E5E7EB" />
                      <rect x={70} y={4} width={(v as number) * 120} height={6} fill={c as string} />
                      <ForeignText x={196} y={-2} width={28} height={14} value={(v as number).toFixed(2)} fontSize={10} align="left" />
                    </g>
                  ))}
                </g>
              </g>
            );
          })()}

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
                width={520}
                height={62}
                rx={6}
                fill="#FFF4CC"
                stroke="#A37C0E"
              />
              <ForeignText
                x={0}
                y={-2}
                width={504}
                height={56}
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
      tickCount: 4,
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
            <line key={`gx${i}`} x1={t.position} x2={t.position} y1={ax.yTop} y2={ax.yBot} stroke="#cdd1d8" strokeWidth={1} />
          ))}
          {ax.y.ticks.map((t, i) => (
            <line key={`gy${i}`} x1={ax.x0} x2={ax.x1} y1={t.position} y2={t.position} stroke="#cdd1d8" strokeWidth={1} />
          ))}
        </g>
      ) : null}
      <rect x={ax.x0} y={ax.yTop} width={ax.x1 - ax.x0} height={ax.yBot - ax.yTop} fill="white" stroke="#222" strokeWidth={1} />
      {ax.x.ticks.map((t, i) => (
        <g key={`xt${i}`} transform={`translate(${t.position}, ${ax.yBot})`}>
          <line y1={0} y2={5} stroke="#222" strokeWidth={1} />
          <text y={18} textAnchor="middle" fontSize={11} fill="#222" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{t.label}</text>
        </g>
      ))}
      {ax.y.ticks.map((t, i) => (
        <g key={`yt${i}`} transform={`translate(${ax.x0}, ${t.position})`}>
          <line x1={-5} x2={0} stroke="#222" strokeWidth={1} />
          <text x={-9} y={4} textAnchor="end" fontSize={11} fill="#222" style={{ fontFamily: '"JetBrains Mono", monospace' }}>{t.label}</text>
        </g>
      ))}
      <ForeignText x={ax.x0} y={ax.yBot + 26} width={ax.x1 - ax.x0} height={26} value={xLabel} fontSize={axisLabelSize} align="center" />
      <g transform={`translate(${ax.x0 - 50}, ${(ax.yTop + ax.yBot) / 2}) rotate(-90)`}>
        <ForeignText x={-90} y={-14} width={180} height={24} value={yLabel} fontSize={axisLabelSize} align="center" />
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
    />
  );
}

function BinaryStrip({
  mask,
  times,
  ax,
  color,
  yShift,
  height,
  label,
  labelOffset,
}: {
  mask: Uint8Array;
  times: number[];
  ax: PanelAxes;
  color: string;
  yShift: number;
  height: number;
  label: string;
  labelOffset: number;
}) {
  const stripY = ax.yTop + 6 + yShift;
  const segs = useMemo(() => {
    const out: Array<{ start: number; end: number }> = [];
    let s = -1;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && s < 0) s = i;
      if ((!mask[i] || i === mask.length - 1) && s >= 0) {
        const e = mask[i] ? i : i - 1;
        out.push({ start: times[s], end: times[e] });
        s = -1;
      }
    }
    return out;
  }, [mask, times]);
  return (
    <g>
      <ForeignText x={ax.x0} y={stripY + labelOffset} width={120} height={18} value={label} fontSize={11} align="left" />
      {segs.map((s, i) => (
        <rect
          key={i}
          x={ax.x.scale(s.start)}
          y={stripY}
          width={Math.max(2, ax.x.scale(s.end) - ax.x.scale(s.start))}
          height={height}
          fill={color}
          stroke="#666"
          strokeWidth={0.6}
        />
      ))}
    </g>
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
  cfg: SavedConfig,
  patch: (p: Partial<SavedConfig>) => void,
) {
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; });  const begin = useCallback(
    (
      e: React.MouseEvent<SVGGElement>,
      get: () => { x: number; y: number },
      set: (b: { x: number; y: number }) => void,
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
    beginNote: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.notePos,
        (b) => patch({ notePos: b }),
      ),
  };
}

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
        <button type="button" onClick={onSave} className="rounded bg-accent px-2 py-1 text-xs font-semibold text-ink-900 hover:opacity-90">保存</button>
      </div>
      <Select
        label="槽位（含 auto-#…）"
        value={selected}
        options={[{ value: '', label: '— 选择 —' }, ...slotOptions.map((n) => ({ value: n, label: n }))]}
        onChange={setSelected}
      />
      <div className="flex gap-2">
        <button type="button" onClick={() => selected && onLoad(selected)} disabled={!selected} className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100 disabled:opacity-50">载入</button>
        <button type="button" onClick={() => selected && onDelete(selected)} disabled={!selected} className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100 disabled:opacity-50">删除</button>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onExport} className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100">导出 JSON</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-100">导入</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImport} />
      </div>
      <button type="button" onClick={onReset} className="w-full rounded border border-ink-600 px-2 py-1 text-xs text-ink-100">恢复默认</button>
      <p className="text-[10px] leading-snug text-ink-300">每 5 分钟自动比对快照；改动会写入 auto-#N 槽位（最多 20 条）。</p>
    </ControlGroup>
  );
}

/* ============================================================= */

registerChart({
  id: 'event-decoding',
  title: 'Fig. 10 · 事件解码 (阈值 + 闭运算)',
  titleEn: 'Fig. 10 · Event Decoding Pipeline',
  category: 'architecture',
  summary:
    '后验 → 阈值 → 形态学闭运算 → 最终事件窗口的三联板；θ_d / W_min 实时驱动。',
  component: EventDecodingChart,
});
