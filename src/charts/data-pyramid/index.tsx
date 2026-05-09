/**
 * Fig. 9  Data / evidence pyramid (§4.1).
 *
 * A 4-layer pyramid summarising how the paper escalates evidence:
 *   L1 (base, widest)   原始 EEG / fNIRS 数据 (Bonn / Siena / 自采)
 *   L2 (predictive)     模型预测 / softmax 输出 ŷ
 *   L3 (sanity)         融合模块 sanity check + τ 合理性
 *   L4 (top, narrowest) ρ(τ*,τ̂) 反推验证 / 闭环可解释
 *
 * Each layer is rendered as an isoceles trapezoid, sized so the
 * sequence forms a perfect pyramid; widths and colours follow the
 * "value" slider on each layer (so the user can stretch a layer
 * to emphasise a particular evidence step).
 *
 * Each layer's title / subtitle / KaTeX line is editable. Side-
 * annotation arrows snap to the nearest layer edge automatically.
 * Auto-save + named slot persistence.
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
import { renderInlineLatex } from '../../lib/latex';
import { registerChart } from '../../registry';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';

/* ----------------------------- types ---------------------------------- */

type Align = 'left' | 'center' | 'right';

interface LayerSpec {
  id: string;
  title: string;
  body: string;
  fill: string;
  stroke: string;
  /** Relative width (0..1). Top = 1 - layerIndex/N then scaled by `value`. */
  value: number;
  /** Side annotation drawn from this layer to the right margin. */
  rightAnnotation: string;
  showAnnotation: boolean;
}

interface SavedConfig {
  version: 1;
  title: string;
  subtitle: string;
  layers: LayerSpec[];
  /** Pyramid centre & vertical extent. */
  cx: number;
  topY: number;
  bottomY: number;
  /** Min / max trapezoid widths (bottom-most width = maxWidth). */
  minWidth: number;
  maxWidth: number;
  /** Spacing between trapezoid layers (px). */
  gap: number;
  showAnnotations: boolean;
  annotationPos: { x: number; y: number };
  noteText: string;
  noteAlign: Align;
  showNote: boolean;
  notePos: { x: number; y: number };
  titleSize: number;
  layerTitleSize: number;
  layerBodySize: number;
  annotationSize: number;
  noteSize: number;
  textOverrides?: TextOverrideMap;
}

/* ----------------------------- defaults ------------------------------- */

const DEFAULT_LAYERS: LayerSpec[] = [
  {
    id: 'l4',
    title: '闭环可解释',
    body: '$\\rho(\\tau^*, \\hat{\\tau})$ 反推验证',
    fill: '#9467BD',
    stroke: '#5B3989',
    value: 0.45,
    rightAnnotation: '已知 $\\tau^*$ → 复原 $\\hat{\\tau}$',
    showAnnotation: true,
  },
  {
    id: 'l3',
    title: '融合 sanity check',
    body: '门控 $g\\to\\{0,1\\}$ 时退化为单模态',
    fill: '#2CA02C',
    stroke: '#1F7A1F',
    value: 0.7,
    rightAnnotation: '$g=0/1$ 边界一致',
    showAnnotation: true,
  },
  {
    id: 'l2',
    title: '模型预测 / softmax',
    body: '$\\hat{y}\\in[0,1]$  vs.  ground truth',
    fill: '#FF7F0E',
    stroke: '#C75900',
    value: 0.85,
    rightAnnotation: 'AUC / Sens / FPR/h',
    showAnnotation: true,
  },
  {
    id: 'l1',
    title: '原始多模态数据',
    body: '$X^{\\rm EEG}$ / $X^{\\rm fNIRS}$  (Bonn / Siena / 自采)',
    fill: '#1F77B4',
    stroke: '#15598C',
    value: 1.0,
    rightAnnotation: '基于真实 EEG 合成 (已知 $\\tau^*$)',
    showAnnotation: true,
  },
];

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  title: 'Fig. 9  证据金字塔 (§4.1)',
  subtitle: '从原始数据到闭环可解释，逐层抬升论证强度。',
  layers: DEFAULT_LAYERS,
  cx: 480,
  topY: 100,
  bottomY: 540,
  minWidth: 220,
  maxWidth: 760,
  gap: 6,
  showAnnotations: true,
  annotationPos: { x: 880, y: 100 },
  noteText:
    '宽度 = 数据 / 证据规模；颜色暖→冷 = 证据从粗放到精细。\n滑动各层 value 可强调某一层级的解释力。',
  noteAlign: 'left',
  showNote: true,
  notePos: { x: 80, y: 580 },
  titleSize: 16,
  layerTitleSize: 14,
  layerBodySize: 11,
  annotationSize: 11,
  noteSize: 11,
};

/* ----------------------------- persistence ---------------------------- */

const STORAGE_KEY = 'data-pyramid-configs-v1';

/* ----------------------------- canvas ---------------------------- */

const W_FIG = 1280;
const H_FIG = 660;

/* ============================================================= */

function DataPyramidChart() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cfg, setCfg] = useState<SavedConfig>(() => DEFAULT_CONFIG);

  const patch = useCallback((p: Partial<SavedConfig>) => {
    setCfg((prev) => ({ ...prev, ...p }));
  }, []);

  const patchLayer = useCallback(
    (idx: number, p: Partial<LayerSpec>) => {
      setCfg((prev) => {
        const next = prev.layers.slice();
        next[idx] = { ...next[idx], ...p };
        return { ...prev, layers: next };
      });
    },
    [],
  );

  const buildBaseConfig = useCallback((): SavedConfig => cfg, [cfg]);
  const applyBaseConfig = useCallback((c: SavedConfig) => {
    if (!c || c.version !== 1) return;
    setCfg(c);
  }, []);
  const { renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'data-pyramid-config.json',
  });
  const textRefs = useMemo(() => [], []);

  /* ----------------------- pyramid geometry ------------------------ */
  const layerGeoms = useMemo(() => {
    const N = cfg.layers.length;
    const totalH = cfg.bottomY - cfg.topY;
    const each = (totalH - (N - 1) * cfg.gap) / N;
    // Top trapezoid width grows linearly to maxWidth at the bottom.
    return cfg.layers.map((l, i) => {
      const reverseIdx = N - 1 - i; // 0 at bottom, N-1 at top
      const t = N === 1 ? 0 : reverseIdx / (N - 1);
      const baseTop = cfg.minWidth + (cfg.maxWidth - cfg.minWidth) * (1 - t);
      const baseBot =
        cfg.minWidth + (cfg.maxWidth - cfg.minWidth) * (1 - Math.max(0, (reverseIdx - 1) / (N - 1)));
      const wTop = baseTop * (0.4 + 0.6 * l.value);
      const wBot = baseBot * (0.4 + 0.6 * l.value);
      const yTop = cfg.topY + i * (each + cfg.gap);
      const yBot = yTop + each;
      const x1 = cfg.cx - wTop / 2;
      const x2 = cfg.cx + wTop / 2;
      const x3 = cfg.cx + wBot / 2;
      const x4 = cfg.cx - wBot / 2;
      return {
        d: `M ${x1},${yTop} L ${x2},${yTop} L ${x3},${yBot} L ${x4},${yBot} z`,
        yMid: (yTop + yBot) / 2,
        yTop,
        yBot,
        halfTop: wTop / 2,
        halfBot: wBot / 2,
        xRight: Math.max(x2, x3),
        wAtMid: (wTop + wBot) / 2,
      };
    });
  }, [cfg.layers, cfg.cx, cfg.topY, cfg.bottomY, cfg.minWidth, cfg.maxWidth, cfg.gap]);

  /* ----------------------- expert schema ------------------------ */
  const expertSchema: ExpertSchema = useMemo(
    () => [
      {
        label: '标题',
        fields: [
          { type: 'text', key: 't', label: '主标题', value: cfg.title, multiline: true, onChange: (v) => patch({ title: v }) },
          { type: 'text', key: 'st', label: '副标题', value: cfg.subtitle, multiline: true, onChange: (v) => patch({ subtitle: v }) },
        ],
      },
      ...cfg.layers.map<ExpertSchema[number]>((l, i) => ({
        label: `层 ${i + 1}: ${l.title || l.id}`,
        defaultOpen: false,
        fields: [
          { type: 'text', key: `${l.id}-t`, label: '标题', value: l.title, onChange: (v) => patchLayer(i, { title: v }) },
          { type: 'text', key: `${l.id}-b`, label: '正文 (KaTeX)', value: l.body, multiline: true, rows: 2, onChange: (v) => patchLayer(i, { body: v }) },
          { type: 'text', key: `${l.id}-fl`, label: '填充色', value: l.fill, onChange: (v) => patchLayer(i, { fill: v }) },
          { type: 'text', key: `${l.id}-st`, label: '描边', value: l.stroke, onChange: (v) => patchLayer(i, { stroke: v }) },
          { type: 'number', key: `${l.id}-v`, label: '宽度强调 (0..1)', min: 0.2, max: 1.2, step: 0.01, value: l.value, onChange: (v) => patchLayer(i, { value: v }), slider: true, format: (v) => v.toFixed(2) },
          { type: 'text', key: `${l.id}-an`, label: '右侧注释', value: l.rightAnnotation, onChange: (v) => patchLayer(i, { rightAnnotation: v }) },
          { type: 'toggle', key: `${l.id}-sa`, label: '显示注释', value: l.showAnnotation, onChange: (v) => patchLayer(i, { showAnnotation: v }) },
        ],
      })),
      {
        label: '金字塔几何',
        fields: [
          { type: 'number', key: 'cx', label: 'CX', min: 200, max: W_FIG - 200, step: 1, value: cfg.cx, onChange: (v) => patch({ cx: v }) },
          { type: 'number', key: 'tp', label: '顶 Y', min: 60, max: 300, step: 1, value: cfg.topY, onChange: (v) => patch({ topY: v }) },
          { type: 'number', key: 'bt', label: '底 Y', min: 300, max: H_FIG - 60, step: 1, value: cfg.bottomY, onChange: (v) => patch({ bottomY: v }) },
          { type: 'number', key: 'mn', label: '最窄', min: 80, max: 400, step: 1, value: cfg.minWidth, onChange: (v) => patch({ minWidth: v }) },
          { type: 'number', key: 'mx', label: '最宽', min: 200, max: 1100, step: 1, value: cfg.maxWidth, onChange: (v) => patch({ maxWidth: v }) },
          { type: 'number', key: 'gp', label: '层间距', min: 0, max: 30, step: 1, value: cfg.gap, onChange: (v) => patch({ gap: v }) },
        ],
      },
      {
        label: '装饰 / 注解',
        fields: [
          { type: 'toggle', key: 'sa', label: '显示右侧注释', value: cfg.showAnnotations, onChange: (v) => patch({ showAnnotations: v }) },
          { type: 'toggle', key: 'sn', label: '黄色注释框', value: cfg.showNote, onChange: (v) => patch({ showNote: v }) },
          { type: 'text', key: 'nt', label: '注释文本', value: cfg.noteText, multiline: true, onChange: (v) => patch({ noteText: v }) },
          { type: 'select', key: 'na', label: '注释对齐', value: cfg.noteAlign, options: ALIGN_OPTIONS, onChange: (v) => patch({ noteAlign: v as Align }) },
        ],
      },
      {
        label: '字号',
        fields: [
          { type: 'number', key: 'ts', label: '主标题', min: 10, max: 26, step: 1, value: cfg.titleSize, onChange: (v) => patch({ titleSize: v }), slider: true },
          { type: 'number', key: 'lts', label: '层标题', min: 10, max: 22, step: 1, value: cfg.layerTitleSize, onChange: (v) => patch({ layerTitleSize: v }), slider: true },
          { type: 'number', key: 'lbs', label: '层正文', min: 8, max: 18, step: 1, value: cfg.layerBodySize, onChange: (v) => patch({ layerBodySize: v }), slider: true },
          { type: 'number', key: 'as', label: '右侧注释', min: 8, max: 18, step: 1, value: cfg.annotationSize, onChange: (v) => patch({ annotationSize: v }), slider: true },
          { type: 'number', key: 'ns', label: '黄色注释', min: 8, max: 18, step: 1, value: cfg.noteSize, onChange: (v) => patch({ noteSize: v }), slider: true },
        ],
      },
    ],
    [cfg, patch, patchLayer],
  );

  /* ----------------------- drag handlers ------------------------ */
  const drag = useDragHandlers(svgRef, cfg, patch);

  /* ----------------------- render ------------------------ */
  return (
    <ChartShell
      filename="fig-09-data-pyramid"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="层强调 (宽度倍率)">
            {cfg.layers.map((l, i) => (
              <NumberSlider
                key={l.id}
                label={`L${cfg.layers.length - i}: ${l.title}`}
                value={l.value}
                min={0.2}
                max={1.2}
                step={0.01}
                onChange={(v) => patchLayer(i, { value: v })}
                format={(v) => v.toFixed(2)}
              />
            ))}
          </ControlGroup>
          <ControlGroup label="层正文">
            {cfg.layers.map((l, i) => (
              <TextArea
                key={l.id}
                label={`L${cfg.layers.length - i}: ${l.title}`}
                value={l.body}
                onChange={(v) => patchLayer(i, { body: v })}
                rows={2}
              />
            ))}
          </ControlGroup>
          <ControlGroup label="装饰">
            <Toggle
              label="右侧注释"
              checked={cfg.showAnnotations}
              onChange={(v) => patch({ showAnnotations: v })}
            />
            <Toggle
              label="黄色注释框"
              checked={cfg.showNote}
              onChange={(v) => patch({ showNote: v })}
            />
            <TextArea
              label="注释文本"
              value={cfg.noteText}
              onChange={(v) => patch({ noteText: v })}
              rows={2}
            />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'tall',
              label: '陡峭',
              hint: 'sharp',
              description: '顶层 0.3 / 底层 1.2 — 强调底部数据规模。',
              apply: () => {
                const N = cfg.layers.length;
                cfg.layers.forEach((_, i) =>
                  patchLayer(i, { value: 0.3 + ((N - 1 - i) / (N - 1)) * 0.9 }),
                );
              },
            },
            {
              id: 'flat',
              label: '扁平',
              hint: 'flat',
              description: '所有层 value=0.85 — 弱化层级差。',
              apply: () => {
                cfg.layers.forEach((_, i) => patchLayer(i, { value: 0.85 }));
              },
            },
            {
              id: 'inverted',
              label: '倒置强调',
              hint: 'inv.',
              description: '顶层 1.1 / 底层 0.3 — 反向强调闭环可解释。',
              apply: () => {
                const N = cfg.layers.length;
                cfg.layers.forEach((_, i) =>
                  patchLayer(i, { value: 0.3 + (i / (N - 1)) * 0.9 }),
                );
              },
            },
            {
              id: 'reset',
              label: '复位',
              hint: '默认',
              description: '回到默认四层证据金字塔。',
              apply: () => patch({ layers: DEFAULT_LAYERS }),
            },
          ]}
        />
      }
      notes={
        <div className="space-y-2">
          <p>
            金字塔从下到上逐层抬升论证强度：原始数据 → 模型预测 → 融合
            sanity-check → 反推闭环。
          </p>
          <p>每层右侧注释指向具体的实验编号或表格位置；可拖拽移动整体位置。</p>
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
          <ForeignText
            x={0}
            y={48}
            width={W_FIG}
            height={26}
            value={cfg.subtitle}
            fontSize={cfg.titleSize - 3}
            align="center"
          />

          {/* Trapezoid layers */}
          {cfg.layers.map((l, i) => (
            <g key={l.id}>
              <path
                d={layerGeoms[i].d}
                fill={l.fill}
                fillOpacity={0.85}
                stroke={l.stroke}
                strokeWidth={1.6}
              />
              {/* Layer level badge on the left */}
              <g transform={`translate(${cfg.cx - layerGeoms[i].halfTop - 40}, ${layerGeoms[i].yMid - 16})`}>
                <circle cx={16} cy={16} r={16} fill={l.stroke} stroke="white" strokeWidth={1.6} />
                <ForeignText
                  x={0}
                  y={4}
                  width={32}
                  height={24}
                  value={`L${cfg.layers.length - i}`}
                  fontSize={13}
                  fontWeight={700}
                  align="center"
                  color="white"
                />
              </g>
              {/* Layer icon on the right */}
              <g transform={`translate(${cfg.cx + layerGeoms[i].halfTop + 8}, ${layerGeoms[i].yMid - 14})`}>
                <circle cx={14} cy={14} r={14} fill="white" stroke={l.stroke} strokeWidth={1.6} />
                {(() => {
                  // distinct iconographic shapes per layer (data / model / sanity / loop)
                  const iconColor = l.stroke;
                  if (i === 0) {
                    return (
                      <g>
                        <rect x={6} y={8} width={4} height={12} fill={iconColor} />
                        <rect x={12} y={4} width={4} height={16} fill={iconColor} />
                        <rect x={18} y={10} width={4} height={10} fill={iconColor} />
                      </g>
                    );
                  }
                  if (i === 1) {
                    return (
                      <g>
                        <circle cx={9} cy={10} r={3} fill={iconColor} />
                        <circle cx={19} cy={10} r={3} fill={iconColor} />
                        <circle cx={14} cy={18} r={3} fill={iconColor} />
                        <line x1={9} y1={10} x2={14} y2={18} stroke={iconColor} strokeWidth={1.4} />
                        <line x1={19} y1={10} x2={14} y2={18} stroke={iconColor} strokeWidth={1.4} />
                      </g>
                    );
                  }
                  if (i === 2) {
                    return (
                      <g>
                        <polyline
                          points="6,18 11,12 16,16 22,8"
                          fill="none"
                          stroke={iconColor}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    );
                  }
                  return (
                    <g>
                      <path
                        d="M 8 14 a 6 6 0 1 1 6 6"
                        fill="none"
                        stroke={iconColor}
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                      <polygon points="14,16 18,18 14,22" fill={iconColor} />
                    </g>
                  );
                })()}
              </g>
              <ForeignText
                x={cfg.cx - 280}
                y={layerGeoms[i].yMid - 26}
                width={560}
                height={26}
                value={l.title}
                fontSize={cfg.layerTitleSize}
                fontWeight={600}
                align="center"
                color="white"
              />
              <ForeignText
                x={cfg.cx - 280}
                y={layerGeoms[i].yMid + 0}
                width={560}
                height={28}
                value={l.body}
                fontSize={cfg.layerBodySize}
                align="center"
                color="white"
              />
              {/* Sample-count badge below the body */}
              <g transform={`translate(${cfg.cx - 70}, ${layerGeoms[i].yMid + 28})`}>
                <rect x={0} y={0} width={140} height={18} rx={9} fill="white" fillOpacity={0.85} stroke={l.stroke} strokeWidth={1} />
                <ForeignText
                  x={4}
                  y={2}
                  width={132}
                  height={16}
                  value={(() => {
                    if (i === 0) return `n=10\u2009240 trials`;
                    if (i === 1) return `f1=0.86 \u00B1 0.04`;
                    if (i === 2) return `\u03c1=+0.31 (p<0.01)`;
                    return `\u0394AUC=+5.1%`;
                  })()}
                  fontSize={10}
                  fontWeight={500}
                  align="center"
                  color={l.stroke}
                />
              </g>
            </g>
          ))}

          {/* Flow arrows linking adjacent layers */}
          {cfg.layers.slice(0, -1).map((l, i) => {
            const fromY = layerGeoms[i].yBot ?? layerGeoms[i].yMid + 30;
            const toY = layerGeoms[i + 1].yTop ?? layerGeoms[i + 1].yMid - 30;
            return (
              <g key={`flow-${l.id}`}>
                <line
                  x1={cfg.cx}
                  x2={cfg.cx}
                  y1={fromY + 2}
                  y2={toY - 6}
                  stroke="#444"
                  strokeWidth={1.4}
                  markerEnd="url(#dp-arrow)"
                />
              </g>
            );
          })}

          {/* Right side annotations: arrow from trapezoid right edge to annotation column */}
          {cfg.showAnnotations
            ? cfg.layers.map((l, i) =>
                l.showAnnotation ? (
                  <g key={`an-${l.id}`}>
                    <line
                      x1={layerGeoms[i].xRight + 6}
                      y1={layerGeoms[i].yMid}
                      x2={cfg.annotationPos.x - 6}
                      y2={layerGeoms[i].yMid}
                      stroke="#666"
                      strokeWidth={1.2}
                      markerEnd="url(#dp-arrow)"
                    />
                    <ForeignText
                      x={cfg.annotationPos.x}
                      y={layerGeoms[i].yMid - 14}
                      width={260}
                      height={28}
                      value={l.rightAnnotation}
                      fontSize={cfg.annotationSize}
                      align="left"
                    />
                  </g>
                ) : null,
              )
            : null}

          <defs>
            <marker
              id="dp-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#666" />
            </marker>
          </defs>

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
                width={500}
                height={56}
                rx={6}
                fill="#FFF4CC"
                stroke="#A37C0E"
              />
              <ForeignText
                x={0}
                y={-2}
                width={484}
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

const ALIGN_OPTIONS: ReadonlyArray<{ value: Align; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

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

/* ============================================================= */

registerChart({
  id: 'data-pyramid',
  title: 'Fig. 9 · 证据金字塔',
  titleEn: 'Fig. 9 · Evidence Pyramid',
  category: 'architecture',
  summary:
    '4 层证据金字塔：原始数据 → 模型预测 → 融合 sanity-check → 反推闭环。每层 / 注释独立可编辑。',
  component: DataPyramidChart,
});
