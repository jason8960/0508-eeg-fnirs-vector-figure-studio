/**
 * Fig. 7  GAT attention weights on a heterogeneous neighbourhood
 *         (single target node i, K = 6 neighbours j₁…j₆).
 *
 * Visual: a star/spoke graph. The centre node hᵢ pulls feature
 * vectors hⱼₖ from its neighbours, weighted by attention coefficients
 * αᵢⱼ that softmax-normalise across k=1..K.
 *
 * Studio integration parity:
 *   - Each node is independently draggable (radial layout used as the
 *     initial seed; saved positions are persisted verbatim).
 *   - All node labels, edge weight labels, formula text, panel headers
 *     and legend entries are KaTeX-editable (live preview).
 *   - α weights are normalised on the fly so the UI stays a valid
 *     softmax distribution; per-edge stroke width / colour follow α.
 *   - Manual + 5-minute auto slot persistence via `useAutoSave`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartShell } from '../../components/ChartShell';
import { FigureFrame } from '../../components/FigureFrame';
import {
  ControlGroup,
  NumberSlider,
  TextArea,
  Toggle,
} from '../../components/Controls';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';
import { type FormatStore, type TextFormatDefaults } from '../../lib/textFormat';
import { useTextFormat } from '../../lib/useTextFormat';
import { TextFormatPopover } from '../../components/TextFormatPopover';
import { EditableForeignText as ForeignText } from '../../components/EditableForeignText';

/* ----------------------------- types ---------------------------------- */

type Align = 'left' | 'center' | 'right';

interface NodeSpec {
  id: string;
  label: string;
  /** Centre coordinates in figure space. */
  x: number;
  y: number;
  /** Fill colour. */
  fill: string;
  /** Modality tag (used to colour the badge). */
  kind: 'eeg' | 'fnirs' | 'hetero';
  /** Logit feeding the softmax for αᵢⱼ. */
  logit: number;
}

interface SavedConfig {
  version: 1;
  title: string;
  formulaTitle: string;
  formula: string;
  centre: NodeSpec;
  neighbours: NodeSpec[];
  /** Edge stroke colour by attention magnitude (top, mid, low). */
  strokeHigh: string;
  strokeMid: string;
  strokeLow: string;
  /** Edge stroke width range (px). */
  strokeMinWidth: number;
  strokeMaxWidth: number;
  showAlphaLabels: boolean;
  showFormula: boolean;
  showLegend: boolean;
  showColorBar: boolean;
  legendPos: { x: number; y: number };
  formulaPos: { x: number; y: number };
  noteText: string;
  noteAlign: Align;
  showNote: boolean;
  notePos: { x: number; y: number };
  titleSize: number;
  nodeLabelSize: number;
  edgeLabelSize: number;
  formulaSize: number;
  legendSize: number;
  noteSize: number;
  formats?: FormatStore;
  textOverrides?: TextOverrideMap;
}

/* ----------------------------- defaults ------------------------------- */

function radialLayout(cx: number, cy: number, R: number, n: number) {
  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < n; k++) {
    const a = (-Math.PI / 2) + (2 * Math.PI * k) / n;
    out.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return out;
}

const CX = 640;
const CY = 320;
const R = 220;

const SEED_NEIGHBOURS = radialLayout(CX, CY, R, 6);
const KIND_FILLS: Record<NodeSpec['kind'], string> = {
  eeg: '#1F77B4',
  fnirs: '#D62728',
  hetero: '#2CA02C',
};

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  title: 'Fig. 7  GAT 注意力权重 αᵢⱼ（六邻居示例）',
  formulaTitle: '注意力计算 (Eq. 9–10)',
  formula:
    '$\\alpha_{ij} = \\dfrac{\\exp\\bigl(\\mathrm{LeakyReLU}(\\mathbf{a}^\\top [Wh_i \\Vert Wh_j])\\bigr)}{\\sum_{k\\in\\mathcal{N}(i)} \\exp\\bigl(\\mathrm{LeakyReLU}(\\mathbf{a}^\\top [Wh_i \\Vert Wh_k])\\bigr)}$',
  centre: {
    id: 'i',
    label: '$h_i$',
    x: CX,
    y: CY,
    fill: '#9467BD',
    kind: 'hetero',
    logit: 0,
  },
  neighbours: [
    { id: 'j1', label: '$h_{j_1}$', x: SEED_NEIGHBOURS[0].x, y: SEED_NEIGHBOURS[0].y, fill: KIND_FILLS.eeg, kind: 'eeg', logit: 1.6 },
    { id: 'j2', label: '$h_{j_2}$', x: SEED_NEIGHBOURS[1].x, y: SEED_NEIGHBOURS[1].y, fill: KIND_FILLS.eeg, kind: 'eeg', logit: 0.6 },
    { id: 'j3', label: '$h_{j_3}$', x: SEED_NEIGHBOURS[2].x, y: SEED_NEIGHBOURS[2].y, fill: KIND_FILLS.fnirs, kind: 'fnirs', logit: -0.4 },
    { id: 'j4', label: '$h_{j_4}$', x: SEED_NEIGHBOURS[3].x, y: SEED_NEIGHBOURS[3].y, fill: KIND_FILLS.fnirs, kind: 'fnirs', logit: -1.2 },
    { id: 'j5', label: '$h_{j_5}$', x: SEED_NEIGHBOURS[4].x, y: SEED_NEIGHBOURS[4].y, fill: KIND_FILLS.eeg, kind: 'eeg', logit: 0.8 },
    { id: 'j6', label: '$h_{j_6}$', x: SEED_NEIGHBOURS[5].x, y: SEED_NEIGHBOURS[5].y, fill: KIND_FILLS.fnirs, kind: 'fnirs', logit: 0.0 },
  ],
  strokeHigh: '#D62728',
  strokeMid: '#FF7F0E',
  strokeLow: '#A0A0A0',
  strokeMinWidth: 1.0,
  strokeMaxWidth: 6.0,
  showAlphaLabels: true,
  showFormula: true,
  showLegend: true,
  showColorBar: true,
  legendPos: { x: 1080, y: 80 },
  formulaPos: { x: 80, y: 580 },
  noteText:
    'αᵢⱼ 是 softmax 概率（按邻居规范化），\n直观映射到边粗细 / 颜色：α↑ → 越粗越红。',
  noteAlign: 'left',
  showNote: true,
  notePos: { x: 80, y: 90 },
  titleSize: 16,
  nodeLabelSize: 14,
  edgeLabelSize: 11,
  formulaSize: 12,
  legendSize: 11,
  noteSize: 11,
  formats: {},
};

/* ----------------------------- persistence ---------------------------- */

const STORAGE_KEY = 'gat-attention-configs-v1';


/* ----------------------------- canvas ---------------------------- */

const W_FIG = 1280;
const H_FIG = 700;

/* ============================================================= */

function GatAttentionChart() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cfg, setCfg] = useState<SavedConfig>(() => DEFAULT_CONFIG);
  const {
    selected,
    handleSelectText,
    handleClearSelection,
    patchFormat: handlePatchFormat,
    resetElementFormat: handleResetElementFormat,
    resetAllFormats: handleResetAllFormats,
  } = useTextFormat<SavedConfig>(setCfg);

  const patch = useCallback((p: Partial<SavedConfig>) => {
    setCfg((prev) => ({ ...prev, ...p }));
  }, []);

  const patchCentre = useCallback(
    (p: Partial<NodeSpec>) => {
      setCfg((prev) => ({ ...prev, centre: { ...prev.centre, ...p } }));
    },
    [],
  );

  const patchNeighbour = useCallback(
    (idx: number, p: Partial<NodeSpec>) => {
      setCfg((prev) => {
        const next = prev.neighbours.slice();
        next[idx] = { ...next[idx], ...p };
        return { ...prev, neighbours: next };
      });
    },
    [],
  );

  /* ----------------------- config persistence ------------------------ */
  const buildBaseConfig = useCallback((): SavedConfig => cfg, [cfg]);
  const applyBaseConfig = useCallback((c: SavedConfig) => {
    if (!c || c.version !== 1) return;
    setCfg(c);
  }, []);
  const { renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'gat-attention-config.json',
  });
  const textRefs = useMemo(() => [], []);

  /* ----------------------- softmax over logits ------------------------ */
  const alphas = useMemo(() => {
    const ls = cfg.neighbours.map((n) => n.logit);
    const m = Math.max(...ls);
    const exps = ls.map((l) => Math.exp(l - m));
    const Z = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / (Z || 1));
  }, [cfg.neighbours]);

  /* ----------------------- inspector schema ------------------------ */
  const expertSchema: ExpertSchema = useMemo(
    () => [
      {
        label: '标题与公式',
        fields: [
          { type: 'text', key: 't', label: '主标题', value: cfg.title, multiline: true, onChange: (v) => patch({ title: v }) },
          { type: 'text', key: 'ft', label: '公式标题', value: cfg.formulaTitle, onChange: (v) => patch({ formulaTitle: v }) },
          { type: 'text', key: 'fa', label: '公式 (KaTeX)', value: cfg.formula, multiline: true, rows: 4, onChange: (v) => patch({ formula: v }) },
          { type: 'toggle', key: 'sf', label: '显示公式', value: cfg.showFormula, onChange: (v) => patch({ showFormula: v }) },
        ],
      },
      {
        label: '中心节点',
        fields: [
          { type: 'text', key: 'cl', label: '标签', value: cfg.centre.label, onChange: (v) => patchCentre({ label: v }) },
          { type: 'text', key: 'cf', label: '填充色', value: cfg.centre.fill, onChange: (v) => patchCentre({ fill: v }) },
          { type: 'number', key: 'cx', label: 'X', min: 0, max: W_FIG, step: 1, value: cfg.centre.x, onChange: (v) => patchCentre({ x: v }) },
          { type: 'number', key: 'cy', label: 'Y', min: 0, max: H_FIG, step: 1, value: cfg.centre.y, onChange: (v) => patchCentre({ y: v }) },
        ],
      },
      {
        label: '邻居节点 (logit + αᵢⱼ)',
        fields: cfg.neighbours.flatMap((n, i) => [
          { type: 'info' as const, key: `a${i}`, label: `${n.id}: αᵢⱼ`, value: alphas[i].toFixed(3) },
          { type: 'text' as const, key: `nl${i}`, label: `${n.id} 标签`, value: n.label, onChange: (v: string) => patchNeighbour(i, { label: v }) },
          { type: 'text' as const, key: `nf${i}`, label: `${n.id} 填充`, value: n.fill, onChange: (v: string) => patchNeighbour(i, { fill: v }) },
          { type: 'select' as const, key: `nk${i}`, label: `${n.id} 模态`, value: n.kind, options: KIND_OPTIONS, onChange: (v: string) => patchNeighbour(i, { kind: v as NodeSpec['kind'] }) },
          { type: 'number' as const, key: `ng${i}`, label: `${n.id} logit`, min: -3, max: 3, step: 0.1, value: n.logit, onChange: (v: number) => patchNeighbour(i, { logit: v }), slider: true, format: (v: number) => v.toFixed(2) },
          { type: 'number' as const, key: `nx${i}`, label: `${n.id} X`, min: 0, max: W_FIG, step: 1, value: n.x, onChange: (v: number) => patchNeighbour(i, { x: v }) },
          { type: 'number' as const, key: `ny${i}`, label: `${n.id} Y`, min: 0, max: H_FIG, step: 1, value: n.y, onChange: (v: number) => patchNeighbour(i, { y: v }) },
        ]),
      },
      {
        label: '边样式',
        fields: [
          { type: 'text', key: 'sh', label: 'α 高 颜色', value: cfg.strokeHigh, onChange: (v) => patch({ strokeHigh: v }) },
          { type: 'text', key: 'sm', label: 'α 中 颜色', value: cfg.strokeMid, onChange: (v) => patch({ strokeMid: v }) },
          { type: 'text', key: 'sl', label: 'α 低 颜色', value: cfg.strokeLow, onChange: (v) => patch({ strokeLow: v }) },
          { type: 'number', key: 'mw', label: '最细 (px)', min: 0.5, max: 5, step: 0.1, value: cfg.strokeMinWidth, onChange: (v) => patch({ strokeMinWidth: v }), slider: true, format: (v) => v.toFixed(1) },
          { type: 'number', key: 'mw2', label: '最粗 (px)', min: 2, max: 14, step: 0.1, value: cfg.strokeMaxWidth, onChange: (v) => patch({ strokeMaxWidth: v }), slider: true, format: (v) => v.toFixed(1) },
          { type: 'toggle', key: 'al', label: '显示 αᵢⱼ 标签', value: cfg.showAlphaLabels, onChange: (v) => patch({ showAlphaLabels: v }) },
        ],
      },
      {
        label: '装饰 / 注解',
        fields: [
          { type: 'toggle', key: 'lg', label: '图例', value: cfg.showLegend, onChange: (v) => patch({ showLegend: v }) },
          { type: 'toggle', key: 'cb', label: '颜色条', value: cfg.showColorBar, onChange: (v) => patch({ showColorBar: v }) },
          { type: 'toggle', key: 'sn', label: '黄色注释框', value: cfg.showNote, onChange: (v) => patch({ showNote: v }) },
          { type: 'text', key: 'nt', label: '注释文本', value: cfg.noteText, multiline: true, onChange: (v) => patch({ noteText: v }) },
          { type: 'select', key: 'na', label: '注释对齐', value: cfg.noteAlign, options: ALIGN_OPTIONS, onChange: (v) => patch({ noteAlign: v as Align }) },
        ],
      },
      {
        label: '字号',
        fields: [
          { type: 'number', key: 'ts', label: '主标题', min: 10, max: 26, step: 1, value: cfg.titleSize, onChange: (v) => patch({ titleSize: v }), slider: true },
          { type: 'number', key: 'nls', label: '节点标签', min: 9, max: 22, step: 1, value: cfg.nodeLabelSize, onChange: (v) => patch({ nodeLabelSize: v }), slider: true },
          { type: 'number', key: 'els', label: '边标签 αᵢⱼ', min: 8, max: 18, step: 1, value: cfg.edgeLabelSize, onChange: (v) => patch({ edgeLabelSize: v }), slider: true },
          { type: 'number', key: 'fs', label: '公式', min: 9, max: 20, step: 1, value: cfg.formulaSize, onChange: (v) => patch({ formulaSize: v }), slider: true },
          { type: 'number', key: 'lgs', label: '图例', min: 8, max: 18, step: 1, value: cfg.legendSize, onChange: (v) => patch({ legendSize: v }), slider: true },
          { type: 'number', key: 'ns', label: '注释', min: 8, max: 18, step: 1, value: cfg.noteSize, onChange: (v) => patch({ noteSize: v }), slider: true },
        ],
      },
    ],
    [cfg, patch, patchCentre, patchNeighbour, alphas],
  );

  /* ----------------------- drag handlers ------------------------ */
  const drag = useDragHandlers(svgRef, cfg, patch, patchCentre, patchNeighbour);

  /* ----------------------- helpers ------------------------ */
  const widthOf = useCallback(
    (a: number) => {
      const t = Math.min(1, Math.max(0, a));
      return cfg.strokeMinWidth + (cfg.strokeMaxWidth - cfg.strokeMinWidth) * t;
    },
    [cfg.strokeMinWidth, cfg.strokeMaxWidth],
  );

  const colourOf = useCallback(
    (a: number) => {
      if (a >= 0.35) return cfg.strokeHigh;
      if (a >= 0.15) return cfg.strokeMid;
      return cfg.strokeLow;
    },
    [cfg.strokeHigh, cfg.strokeMid, cfg.strokeLow],
  );

  /** Snap line endpoints onto each node's bounding circle so the
   *  edge never overlaps the node body — equivalent to "arrow snaps
   *  to module border" in the heterogeneous-graph chart. */
  const edgePath = useCallback(
    (j: NodeSpec) => {
      const dx = j.x - cfg.centre.x;
      const dy = j.y - cfg.centre.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const r0 = NODE_RADIUS_CENTRE;
      const r1 = NODE_RADIUS_NEIGH;
      const sx = cfg.centre.x + ux * r0;
      const sy = cfg.centre.y + uy * r0;
      const ex = j.x - ux * r1;
      const ey = j.y - uy * r1;
      return { sx, sy, ex, ey, mx: (sx + ex) / 2, my: (sy + ey) / 2 };
    },
    [cfg.centre.x, cfg.centre.y],
  );

  /* ----------------------- render ------------------------ */
  return (
    <ChartShell
      filename="fig-07-gat-attention"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="logit (softmax 输入)">
            {cfg.neighbours.map((n, i) => (
              <NumberSlider
                key={n.id}
                label={`${n.id} logit  (α=${alphas[i].toFixed(2)})`}
                value={n.logit}
                min={-3}
                max={3}
                step={0.1}
                onChange={(v) => patchNeighbour(i, { logit: v })}
                format={(v) => v.toFixed(2)}
              />
            ))}
          </ControlGroup>
          <ControlGroup label="边宽度映射">
            <NumberSlider
              label="最细 (px)"
              value={cfg.strokeMinWidth}
              min={0.5}
              max={5}
              step={0.1}
              onChange={(v) => patch({ strokeMinWidth: v })}
              format={(v) => v.toFixed(1)}
            />
            <NumberSlider
              label="最粗 (px)"
              value={cfg.strokeMaxWidth}
              min={2}
              max={14}
              step={0.1}
              onChange={(v) => patch({ strokeMaxWidth: v })}
              format={(v) => v.toFixed(1)}
            />
            <Toggle
              label="显示 αᵢⱼ 标签"
              checked={cfg.showAlphaLabels}
              onChange={(v) => patch({ showAlphaLabels: v })}
            />
          </ControlGroup>
          <ControlGroup label="装饰">
            <Toggle label="公式" checked={cfg.showFormula} onChange={(v) => patch({ showFormula: v })} />
            <Toggle label="图例" checked={cfg.showLegend} onChange={(v) => patch({ showLegend: v })} />
            <Toggle label="颜色条" checked={cfg.showColorBar} onChange={(v) => patch({ showColorBar: v })} />
            <Toggle label="注释框" checked={cfg.showNote} onChange={(v) => patch({ showNote: v })} />
            <TextArea
              label="注释文本"
              value={cfg.noteText}
              onChange={(v) => patch({ noteText: v })}
              rows={2}
            />
          </ControlGroup>
          <ControlGroup label="文字格式">
            <button
              type="button"
              onClick={handleResetAllFormats}
              className="w-full rounded border border-ink-600 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-800"
            >
              重置全部文本格式
            </button>
            <p className="text-[10px] leading-snug text-ink-300">
              逐字段格式覆盖（字号 / 字重 / 斜体 / 行高 / 对齐 / 颜色）。
              点击 SVG 中任一文字打开浮动工具栏。
            </p>
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'sharp',
              label: '尖峰',
              hint: 'argmax',
              description: 'logit 稀疏：αᵢⱼ 几乎集中在 j₁。',
              apply: () => {
                cfg.neighbours.forEach((_, i) =>
                  patchNeighbour(i, { logit: i === 0 ? 4 : -1 }),
                );
              },
            },
            {
              id: 'uniform',
              label: '均匀',
              hint: '1/K',
              description: '所有 logit = 0：等概率分配注意力。',
              apply: () => {
                cfg.neighbours.forEach((_, i) => patchNeighbour(i, { logit: 0 }));
              },
            },
            {
              id: 'cross-modal',
              label: '跨模态',
              hint: 'EEG↔fNIRS',
              description: '提高 fNIRS 邻居 logit，模拟癫痫期跨模态依赖。',
              apply: () => {
                cfg.neighbours.forEach((n, i) =>
                  patchNeighbour(i, {
                    logit: n.kind === 'fnirs' ? 1.4 : -0.2,
                  }),
                );
              },
            },
            {
              id: 'circle',
              label: '重置半径',
              hint: 'R = 220',
              description: '邻居重新放回半径 220 px 的环上。',
              apply: () => {
                const seed = radialLayout(
                  cfg.centre.x,
                  cfg.centre.y,
                  220,
                  cfg.neighbours.length,
                );
                cfg.neighbours.forEach((_, i) =>
                  patchNeighbour(i, seed[i]),
                );
              },
            },
          ]}
        />
      }
      notes={
        <div className="space-y-2">
          <p>
            将 logit 调高某个邻居即模拟"该邻居与 i 高度相关 / 同步发放"。
            softmax 自动确保 ∑αᵢⱼ = 1。
          </p>
          <p>边粗细 / 颜色随 αᵢⱼ 实时变化；红色 = 注意力主导。</p>
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
            kid="title"
            label="主标题"
            format={cfg.formats?.title}
            selected={selected?.key === 'title'}
            onSelect={handleSelectText}
          />

          {/* Edges */}
          {cfg.neighbours.map((n, i) => {
            const e = edgePath(n);
            const a = alphas[i];
            return (
              <line
                key={`edge-${n.id}`}
                x1={e.sx}
                y1={e.sy}
                x2={e.ex}
                y2={e.ey}
                stroke={colourOf(a)}
                strokeWidth={widthOf(a)}
                strokeOpacity={0.8}
                strokeLinecap="round"
              />
            );
          })}

          {/* α labels (KaTeX, draggable midpoint chips) */}
          {cfg.showAlphaLabels
            ? cfg.neighbours.map((n, i) => {
                const e = edgePath(n);
                const a = alphas[i];
                return (
                  <g key={`al-${n.id}`} transform={`translate(${e.mx - 36}, ${e.my - 12})`}>
                    <rect
                      x={0}
                      y={0}
                      width={72}
                      height={22}
                      rx={4}
                      fill="white"
                      fillOpacity={0.92}
                      stroke="#bbb"
                    />
                    <ForeignText
                      x={3}
                      y={2}
                      width={66}
                      height={20}
                      value={`$\\alpha_{ij}$=${a.toFixed(2)}`}
                      fontSize={cfg.edgeLabelSize}
                      align="center"
                      kid={`alpha-${n.id}`}
                      label={`边权 ${n.id}`}
                      format={cfg.formats?.[`alpha-${n.id}`]}
                      selected={selected?.key === `alpha-${n.id}`}
                      onSelect={handleSelectText}
                    />
                  </g>
                );
              })
            : null}

          {/* Centre node */}
          <g
            onMouseDown={(e) =>
              drag.beginNode(e, () => cfg.centre, (b) => patchCentre(b))
            }
            style={{ cursor: 'grab' }}
          >
            <circle
              cx={cfg.centre.x}
              cy={cfg.centre.y}
              r={NODE_RADIUS_CENTRE}
              fill={cfg.centre.fill}
              stroke="#222"
              strokeWidth={1.5}
            />
            <ForeignText
              x={cfg.centre.x - 30}
              y={cfg.centre.y - 14}
              width={60}
              height={26}
              value={cfg.centre.label}
              fontSize={cfg.nodeLabelSize + 2}
              fontWeight={600}
              align="center"
              color="white"
              kid="centre-label"
              label="中心节点标签"
              format={cfg.formats?.['centre-label']}
              selected={selected?.key === 'centre-label'}
              onSelect={handleSelectText}
            />
          </g>

          {/* Neighbour nodes */}
          {cfg.neighbours.map((n, i) => (
            <g
              key={n.id}
              onMouseDown={(e) =>
                drag.beginNode(e, () => n, (b) => patchNeighbour(i, b))
              }
              style={{ cursor: 'grab' }}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={NODE_RADIUS_NEIGH}
                fill={n.fill}
                stroke="#222"
                strokeWidth={1.2}
              />
              <ForeignText
                x={n.x - 26}
                y={n.y - 12}
                width={52}
                height={22}
                value={n.label}
                fontSize={cfg.nodeLabelSize}
                fontWeight={500}
                align="center"
                color="white"
                kid={`node-${n.id}`}
                label={`邻居节点 ${n.id}`}
                format={cfg.formats?.[`node-${n.id}`]}
                selected={selected?.key === `node-${n.id}`}
                onSelect={handleSelectText}
              />
            </g>
          ))}

          {/* Formula box */}
          {cfg.showFormula ? (
            <g
              transform={`translate(${cfg.formulaPos.x}, ${cfg.formulaPos.y})`}
              onMouseDown={drag.beginFormula}
              style={{ cursor: 'grab' }}
            >
              <rect
                x={-8}
                y={-22}
                width={1120}
                height={88}
                rx={6}
                fill="#F5F5F5"
                stroke="#999"
              />
              <ForeignText
                x={4}
                y={-18}
                width={1100}
                height={20}
                value={cfg.formulaTitle}
                fontSize={cfg.formulaSize + 1}
                fontWeight={600}
                align="left"
                kid="formulaTitle"
                label="公式标题"
                format={cfg.formats?.formulaTitle}
                selected={selected?.key === 'formulaTitle'}
                onSelect={handleSelectText}
              />
              <ForeignText
                x={4}
                y={2}
                width={1100}
                height={66}
                value={cfg.formula}
                fontSize={cfg.formulaSize}
                align="left"
                kid="formula"
                label="公式正文"
                format={cfg.formats?.formula}
                selected={selected?.key === 'formula'}
                onSelect={handleSelectText}
              />
            </g>
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
                height={108}
                rx={6}
                fill="white"
                fillOpacity={0.92}
                stroke="#999"
              />
              <ForeignText
                x={2}
                y={-2}
                width={158}
                height={22}
                value="模态色"
                fontSize={cfg.legendSize + 1}
                fontWeight={600}
                align="left"
                kid="legendTitle"
                label="图例标题"
                format={cfg.formats?.legendTitle}
                selected={selected?.key === 'legendTitle'}
                onSelect={handleSelectText}
              />
              {(['eeg', 'fnirs', 'hetero'] as const).map((k, idx) => (
                <g key={k} transform={`translate(0, ${idx * 22 + 24})`}>
                  <circle cx={10} cy={10} r={8} fill={KIND_FILLS[k]} stroke="#222" strokeWidth={1} />
                  <ForeignText
                    x={26}
                    y={-2}
                    width={120}
                    height={22}
                    value={k === 'eeg' ? 'EEG 通道' : k === 'fnirs' ? 'fNIRS 通道' : '异质中心'}
                    fontSize={cfg.legendSize}
                    align="left"
                    kid={`legend-${k}`}
                    label={`图例 ${k}`}
                    format={cfg.formats?.[`legend-${k}`]}
                    selected={selected?.key === `legend-${k}`}
                    onSelect={handleSelectText}
                  />
                </g>
              ))}
            </g>
          ) : null}

          {/* Colour bar (low → mid → high α) */}
          {cfg.showColorBar ? (
            <g transform={`translate(${cfg.legendPos.x}, ${cfg.legendPos.y + 130})`}>
              <ForeignText
                x={-4}
                y={-2}
                width={160}
                height={22}
                value="边色映射 (αᵢⱼ)"
                fontSize={cfg.legendSize + 1}
                fontWeight={600}
                align="left"
                kid="colorBarTitle"
                label="颜色条标题"
                format={cfg.formats?.colorBarTitle}
                selected={selected?.key === 'colorBarTitle'}
                onSelect={handleSelectText}
              />
              {[
                { label: '低 (<0.15)', c: cfg.strokeLow },
                { label: '中 (0.15–0.35)', c: cfg.strokeMid },
                { label: '高 (≥0.35)', c: cfg.strokeHigh },
              ].map((row, i) => (
                <g key={i} transform={`translate(0, ${i * 22 + 24})`}>
                  <line
                    x1={2}
                    x2={28}
                    y1={6}
                    y2={6}
                    stroke={row.c}
                    strokeWidth={3}
                  />
                  <ForeignText
                    x={36}
                    y={-6}
                    width={130}
                    height={22}
                    value={row.label}
                    fontSize={cfg.legendSize}
                    align="left"
                    kid={`colorBar-${i}`}
                    label={`颜色档 ${i}`}
                    format={cfg.formats?.[`colorBar-${i}`]}
                    selected={selected?.key === `colorBar-${i}`}
                    onSelect={handleSelectText}
                  />
                </g>
              ))}
            </g>
          ) : null}

          {/* α distribution bar chart (softmax over neighbours) */}
          {(() => {
            const W = 360;
            const H = 150;
            const X0 = 30;
            const Y0 = 520;
            const padL = 50;
            const padR = 18;
            const padT = 32;
            const padB = 30;
            const innerW = W - padL - padR;
            const innerH = H - padT - padB;
            const n = cfg.neighbours.length;
            const barW = innerW / n * 0.7;
            const gap = innerW / n * 0.3;
            const sumA = alphas.reduce((s, v) => s + v, 0);
            const yScale = (v: number) => Y0 + padT + innerH - v * innerH;
            return (
              <g>
                <rect x={X0} y={Y0} width={W} height={H} rx={6} fill="#FAFAFA" stroke="#CCC" />
                <ForeignText
                  x={X0 + 6}
                  y={Y0 + 6}
                  width={W - 12}
                  height={22}
                  value={`softmax 输出: $\\alpha_{ij}$ 分布 (∑=${sumA.toFixed(3)})`}
                  fontSize={12}
                  fontWeight={600}
                  align="left"
                  kid="distTitle"
                  label="分布图标题"
                  format={cfg.formats?.distTitle}
                  selected={selected?.key === 'distTitle'}
                  onSelect={handleSelectText}
                />
                {/* y-axis ticks at 0, 0.25, 0.5, 0.75, 1.0 */}
                {[0, 0.25, 0.5, 0.75, 1].map((t, k) => (
                  <g key={`ay-${k}`}>
                    <line x1={X0 + padL} x2={X0 + W - padR} y1={yScale(t)} y2={yScale(t)} stroke="#E5E7EB" strokeWidth={0.6} />
                    <ForeignText x={X0 + 4} y={yScale(t) - 8} width={padL - 8} height={14} value={t.toFixed(2)} fontSize={9} align="right" />
                  </g>
                ))}
                {/* Reference line at uniform 1/K */}
                <line
                  x1={X0 + padL}
                  x2={X0 + W - padR}
                  y1={yScale(1 / n)}
                  y2={yScale(1 / n)}
                  stroke="#888"
                  strokeWidth={0.8}
                  strokeDasharray="3 3"
                />
                <ForeignText
                  x={X0 + W - padR - 60}
                  y={yScale(1 / n) - 14}
                  width={60}
                  height={12}
                  value={`uniform $1/K$`}
                  fontSize={9}
                  align="right"
                  kid="distUniform"
                  label="均匀分布标记"
                  format={cfg.formats?.distUniform}
                  selected={selected?.key === 'distUniform'}
                  onSelect={handleSelectText}
                />
                {alphas.map((a, i) => {
                  const xi = X0 + padL + (i + 0.15) * (innerW / n);
                  const h = a * innerH;
                  const y = Y0 + padT + innerH - h;
                  const c = colourOf(a);
                  const n0 = cfg.neighbours[i];
                  return (
                    <g key={`bar-${i}`}>
                      <rect x={xi} y={y} width={barW} height={h} fill={c} fillOpacity={0.85} stroke={c} strokeWidth={0.8} />
                      <ForeignText x={xi - gap / 2} y={y - 16} width={barW + gap} height={14} value={a.toFixed(2)} fontSize={9} align="center" />
                      <ForeignText x={xi - gap / 2} y={Y0 + padT + innerH + 2} width={barW + gap} height={14} value={n0.id} fontSize={10} align="center" />
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Logit→softmax computation panel */}
          {(() => {
            const W = 380;
            const H = 150;
            const X0 = 410;
            const Y0 = 520;
            const ls = cfg.neighbours.map((n) => n.logit);
            const lmax = Math.max(...ls);
            const exps = ls.map((l) => Math.exp(l - lmax));
            const Z = exps.reduce((s, v) => s + v, 0);
            const rowH = 14;
            return (
              <g>
                <rect x={X0} y={Y0} width={W} height={H} rx={6} fill="#FAFAFA" stroke="#CCC" />
                <ForeignText
                  x={X0 + 6}
                  y={Y0 + 6}
                  width={W - 12}
                  height={20}
                  value="softmax 计算 (numerically stable)"
                  fontSize={12}
                  fontWeight={600}
                  align="left"
                  kid="smTitle"
                  label="softmax 计算面板标题"
                  format={cfg.formats?.smTitle}
                  selected={selected?.key === 'smTitle'}
                  onSelect={handleSelectText}
                />
                <ForeignText
                  x={X0 + 6}
                  y={Y0 + 26}
                  width={W - 12}
                  height={20}
                  value={`$\\ell_{\\max}=${lmax.toFixed(2)}$,  $Z = \\sum_k \\exp(\\ell_k - \\ell_{\\max}) = ${Z.toFixed(3)}$`}
                  fontSize={10}
                  align="left"
                  kid="smHeader"
                  label="softmax 面板表头公式"
                  format={cfg.formats?.smHeader}
                  selected={selected?.key === 'smHeader'}
                  onSelect={handleSelectText}
                />
                {/* Header */}
                <ForeignText x={X0 + 8} y={Y0 + 48} width={36} height={12} value="$j_k$" fontSize={9} fontWeight={600} align="center" />
                <ForeignText x={X0 + 50} y={Y0 + 48} width={64} height={12} value="$\\ell_k$" fontSize={9} fontWeight={600} align="center" />
                <ForeignText x={X0 + 122} y={Y0 + 48} width={88} height={12} value="$\\exp(\\ell_k - \\ell_{\\max})$" fontSize={9} fontWeight={600} align="center" />
                <ForeignText x={X0 + 222} y={Y0 + 48} width={150} height={12} value="$\\alpha_k = \\exp(\\cdot)/Z$" fontSize={9} fontWeight={600} align="center" />
                {cfg.neighbours.map((n, i) => {
                  const yy = Y0 + 64 + i * rowH;
                  return (
                    <g key={`row-${n.id}`}>
                      <ForeignText x={X0 + 8} y={yy} width={36} height={12} value={n.id} fontSize={9} align="center" />
                      <ForeignText x={X0 + 50} y={yy} width={64} height={12} value={ls[i].toFixed(2)} fontSize={9} align="center" />
                      <ForeignText x={X0 + 122} y={yy} width={88} height={12} value={exps[i].toFixed(3)} fontSize={9} align="center" />
                      <rect x={X0 + 222} y={yy + 3} width={alphas[i] * 130} height={6} fill={colourOf(alphas[i])} fillOpacity={0.85} />
                      <ForeignText x={X0 + 222 + alphas[i] * 130 + 4} y={yy} width={28} height={12} value={alphas[i].toFixed(2)} fontSize={9} align="left" />
                    </g>
                  );
                })}
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
                width={300}
                height={56}
                rx={6}
                fill="#FFF4CC"
                stroke="#A37C0E"
              />
              <ForeignText
                x={0}
                y={-2}
                width={284}
                height={50}
                value={cfg.noteText}
                fontSize={cfg.noteSize}
                align={cfg.noteAlign}
                kid="note"
                label="黄色注释框"
                format={cfg.formats?.note}
                selected={selected?.key === 'note'}
                onSelect={handleSelectText}
              />
            </g>
          ) : null}

          {selected ? (
            <rect
              x={0}
              y={0}
              width={W_FIG}
              height={H_FIG}
              fill="transparent"
              pointerEvents="all"
              onMouseDown={handleClearSelection}
              data-export="false"
              style={{ cursor: 'default' }}
            />
          ) : null}
          {selected ? (
            (() => {
              const popoverWidth = 280;
              const popoverHeight = 130;
              const margin = 6;
              const ax = Math.max(
                4,
                Math.min(
                  W_FIG - popoverWidth - 4,
                  selected.x + selected.w / 2 - popoverWidth / 2,
                ),
              );
              const ay =
                selected.y + selected.h + margin + popoverHeight > H_FIG
                  ? Math.max(4, selected.y - popoverHeight - margin)
                  : selected.y + selected.h + margin;
              const popoverDefaults: TextFormatDefaults = selected.defaults;
              return (
                <TextFormatPopover
                  anchorX={ax}
                  anchorY={ay}
                  width={popoverWidth}
                  height={popoverHeight}
                  override={cfg.formats?.[selected.key]}
                  defaults={popoverDefaults}
                  label={selected.label}
                  onChange={(p) => handlePatchFormat(selected.key, p)}
                  onReset={() => handleResetElementFormat(selected.key)}
                  onClose={handleClearSelection}
                />
              );
            })()
          ) : null}
        </FigureFrame>
      }
    />
  );
}

/* ============================================================= */

const NODE_RADIUS_CENTRE = 36;
const NODE_RADIUS_NEIGH = 26;

const ALIGN_OPTIONS: ReadonlyArray<{ value: Align; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

const KIND_OPTIONS: ReadonlyArray<{ value: NodeSpec['kind']; label: string }> = [
  { value: 'eeg', label: 'EEG' },
  { value: 'fnirs', label: 'fNIRS' },
  { value: 'hetero', label: '异质中心' },
];

function useDragHandlers(
  svgRef: React.RefObject<SVGSVGElement | null>,
  cfg: SavedConfig,
  patch: (p: Partial<SavedConfig>) => void,
  _patchCentre: (p: Partial<NodeSpec>) => void,
  _patchNeighbour: (i: number, p: Partial<NodeSpec>) => void,
) {
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; });  void _patchCentre;
  void _patchNeighbour;

  const begin = useCallback(
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
    beginNode: (
      e: React.MouseEvent<SVGGElement>,
      get: () => { x: number; y: number },
      set: (b: { x: number; y: number }) => void,
    ) => begin(e, get, set),
    beginLegend: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.legendPos,
        (b) => patch({ legendPos: b }),
      ),
    beginFormula: (e: React.MouseEvent<SVGGElement>) =>
      begin(
        e,
        () => cfgRef.current.formulaPos,
        (b) => patch({ formulaPos: b }),
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

registerChart({
  id: 'gat-attention',
  title: 'Fig. 7 · GAT 注意力权重 αᵢⱼ',
  titleEn: 'Fig. 7 · GAT Attention Weights on Heterogeneous Neighbours',
  category: 'architecture',
  summary:
    '中心-邻居星形图，可拖节点 + 调 logit；softmax 实时刷新 αᵢⱼ，边粗细/颜色随之变化。',
  component: GatAttentionChart,
});
