import { useCallback, useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { sampleColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { EditableSvgText } from '../../components/EditableSvgText';
import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
import type { TextOverrideMap } from '../../lib/useTextOverrides';

interface SavedConfig {
  version: 1;
  showShapes: boolean;
  colSpacing: number;
  colormap: ColormapName;
  rowSpacing: number;
  showLabels: boolean;
  textOverrides?: TextOverrideMap;
}

const STORAGE_KEY = 'fusion-flowchart-configs-v1';

interface BlockSpec {
  id: string;
  label: string;
  /** Tensor shape annotation rendered next to outgoing edges. */
  shape: string;
  group: 'eeg' | 'fnirs' | 'fusion' | 'head';
  col: number;
  row: number;
}

interface EdgeSpec {
  from: string;
  to: string;
  /** Optional override label; otherwise the source block's `shape` is used. */
  label?: string;
}

const BLOCKS: BlockSpec[] = [
  { id: 'eeg-in', label: 'EEG raw', shape: 'T × 32', group: 'eeg', col: 0, row: 0 },
  { id: 'eeg-conv', label: 'Conv1D × 3', shape: 'T × 64', group: 'eeg', col: 1, row: 0 },
  { id: 'eeg-tcn', label: 'Temporal CNN', shape: 'T × 128', group: 'eeg', col: 2, row: 0 },

  { id: 'fnirs-in', label: 'fNIRS Δ[HbO,HbR]', shape: 'T × 24', group: 'fnirs', col: 0, row: 2 },
  { id: 'fnirs-gat', label: 'GAT × 2', shape: 'T × 96', group: 'fnirs', col: 1, row: 2 },
  { id: 'fnirs-pool', label: 'Temporal pool', shape: 'T × 96', group: 'fnirs', col: 2, row: 2 },

  { id: 'cross-attn', label: 'Cross-modal attention', shape: 'T × 224', group: 'fusion', col: 3, row: 1 },
  { id: 'concat', label: 'Concatenate', shape: 'T × 224', group: 'fusion', col: 4, row: 1 },
  { id: 'mlp', label: 'MLP head', shape: '4', group: 'head', col: 5, row: 1 },
];

const EDGES: EdgeSpec[] = [
  { from: 'eeg-in', to: 'eeg-conv' },
  { from: 'eeg-conv', to: 'eeg-tcn' },
  { from: 'eeg-tcn', to: 'cross-attn' },
  { from: 'fnirs-in', to: 'fnirs-gat' },
  { from: 'fnirs-gat', to: 'fnirs-pool' },
  { from: 'fnirs-pool', to: 'cross-attn' },
  { from: 'cross-attn', to: 'concat' },
  { from: 'concat', to: 'mlp', label: 'logits' },
];

function FlowchartChart() {
  const [showShapes, setShowShapes] = useState(true);
  const [colSpacing, setColSpacing] = useState(150);
  const [colormap, setColormap] = useState<ColormapName>('cividis');
  const [rowSpacingState, setRowSpacing] = useState(110);
  const [showLabels, setShowLabels] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const buildBaseConfig = useCallback(
    (): SavedConfig => ({
      version: 1,
      showShapes,
      colSpacing,
      colormap,
      rowSpacing: rowSpacingState,
      showLabels,
    }),
    [showShapes, colSpacing, colormap, rowSpacingState, showLabels],
  );
  const applyBaseConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setShowShapes(cfg.showShapes);
    setColSpacing(cfg.colSpacing);
    setColormap(cfg.colormap);
    setRowSpacing(cfg.rowSpacing);
    setShowLabels(cfg.showLabels);
  }, []);
  const { textOverrides, renderInspectorSections } = useEvalChartConfig<SavedConfig>({
    storageKey: STORAGE_KEY,
    buildBaseConfig,
    applyBaseConfig,
    filename: 'fusion-flowchart-config.json',
  });

  const expertSchema: ExpertSchema = [
    {
      label: '布局',
      fields: [
        { type: 'number', key: 'col', label: '列间距', min: 100, max: 260, step: 2, value: colSpacing, onChange: setColSpacing, slider: true },
        { type: 'number', key: 'row', label: '行间距', min: 60, max: 200, step: 2, value: rowSpacingState, onChange: setRowSpacing, slider: true },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'shp', label: '张量形状标签', value: showShapes, onChange: setShowShapes },
        { type: 'toggle', key: 'lbl', label: '区块标签', value: showLabels, onChange: setShowLabels },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: '拓扑',
      fields: [
        { type: 'info', key: 'b', label: '区块数', value: String(BLOCKS.length) },
        { type: 'info', key: 'e', label: '边数', value: String(EDGES.length) },
      ],
    },
  ];

  const palette = sampleColormap(colormap, 4);
  const colorByGroup: Record<BlockSpec['group'], string> = {
    eeg: palette[0],
    fnirs: palette[1],
    fusion: palette[2],
    head: palette[3],
  };

  const W = 960;
  const H = 460;
  const margin = { top: 56, right: 32, bottom: 64, left: 24 };
  const blockW = 144;
  const blockH = 64;
  const rowSpacing = rowSpacingState;

  const positions = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    BLOCKS.forEach((b) => {
      out.set(b.id, {
        x: margin.left + b.col * colSpacing,
        y: margin.top + b.row * rowSpacing,
      });
    });
    return out;
  }, [colSpacing, rowSpacing, margin.left, margin.top]);

  const arrowPath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) * 0.45;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };

  const titleId = 'title';
  const captionId = 'caption';
  const branchEegId = 'branch-eeg';
  const branchFnirsId = 'branch-fnirs';
  const titleDefault = 'Bimodal feature fusion flowchart';
  const captionDefault = 'Layered DAG. Tensor shapes annotate each edge.';
  const branchEegDefault = 'EEG branch';
  const branchFnirsDefault = 'fNIRS branch';
  const titleStyle = textOverrides.resolve(titleId, {
    text: titleDefault,
    fontSize: 14,
    fontWeight: 600,
  });
  const captionStyle = textOverrides.resolve(captionId, {
    text: captionDefault,
    fontSize: 12,
  });
  const branchEegStyle = textOverrides.resolve(branchEegId, {
    text: branchEegDefault,
    fontSize: 11,
    fontWeight: 600,
    color: colorByGroup.eeg,
  });
  const branchFnirsStyle = textOverrides.resolve(branchFnirsId, {
    text: branchFnirsDefault,
    fontSize: 11,
    fontWeight: 600,
    color: colorByGroup.fnirs,
  });
  const textRefs = useMemo(
    () => {
      const refs: Array<{
        id: string;
        label: string;
        defaultText: string;
        defaultFontSize: number;
        defaultFontWeight?: number;
      }> = [
        { id: titleId, label: '主标题', defaultText: titleDefault, defaultFontSize: 14, defaultFontWeight: 600 },
        { id: captionId, label: '说明文字', defaultText: captionDefault, defaultFontSize: 12 },
        { id: branchEegId, label: '分支：EEG', defaultText: branchEegDefault, defaultFontSize: 11, defaultFontWeight: 600 },
        { id: branchFnirsId, label: '分支：fNIRS', defaultText: branchFnirsDefault, defaultFontSize: 11, defaultFontWeight: 600 },
      ];
      BLOCKS.forEach((b) => {
        refs.push({
          id: `block-${b.id}-label`,
          label: `区块：${b.label}`,
          defaultText: b.label,
          defaultFontSize: 12,
          defaultFontWeight: 600,
        });
      });
      return refs;
    },
    [],
  );

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'pres',
              label: '演示网格',
              hint: '幻灯片',
              description: '更宽的列、更大的标签间距。',
              apply: () => {
                setColSpacing(180);
                setRowSpacing(130);
                setShowShapes(true);
                setShowLabels(true);
              },
            },
            {
              id: 'compact',
              label: '紧凑示意',
              hint: '论文',
              description: '较紧的间距，适合期刊栏宽插图。',
              apply: () => {
                setColSpacing(120);
                setRowSpacing(86);
                setShowShapes(true);
                setShowLabels(true);
              },
            },
            {
              id: 'arrows',
              label: '仅箭头',
              hint: '极简',
              description: '隐藏区块填充 — 突出数据流边。',
              apply: () => {
                setShowShapes(false);
                setShowLabels(true);
              },
            },
            {
              id: 'magma',
              label: 'Magma 色带',
              hint: '色彩',
              description: 'Cividis 之外的暖色变体。',
              apply: () => {
                setColormap('magma');
              },
            },
          ]}
        />
      }
      filename="fusion-flowchart"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="布局">
            <NumberSlider
              label="列间距"
              value={colSpacing}
              min={120}
              max={220}
              step={4}
              onChange={setColSpacing}
            />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle label="显示张量形状" checked={showShapes} onChange={setShowShapes} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
          {renderInspectorSections(textRefs)}
        </>
      }
      notes={
        <p>
          双模态融合网络的分层 DAG。张量形状标签沿每条边漂浮显示，以便读出
          维度变化。编辑 <code>fusion-flowchart/index.tsx</code> 中的区块
          列表，可适配新架构。
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
          {/* Arrows */}
          <defs>
            <marker
              id="ff-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill="#0d1117" />
            </marker>
          </defs>

          <g>
            {EDGES.map((e, i) => {
              const a = positions.get(e.from)!;
              const b = positions.get(e.to)!;
              const x1 = a.x + blockW;
              const y1 = a.y + blockH / 2;
              const x2 = b.x;
              const y2 = b.y + blockH / 2;
              const block = BLOCKS.find((bl) => bl.id === e.from)!;
              const label = e.label ?? block.shape;
              return (
                <g key={i}>
                  <path
                    d={arrowPath(x1, y1, x2, y2)}
                    fill="none"
                    stroke="#0d1117"
                    strokeWidth={1.4}
                    markerEnd="url(#ff-arrow)"
                  />
                  {showShapes ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily='"JetBrains Mono", monospace'
                      fill="#334155"
                    >
                      {label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* Blocks */}
          <g>
            {BLOCKS.map((b) => {
              const pos = positions.get(b.id)!;
              const blockLabelId = `block-${b.id}-label`;
              const blockLabelStyle = textOverrides.resolve(blockLabelId, {
                text: b.label,
                fontSize: 12,
                fontWeight: 600,
                color: 'white',
              });
              return (
                <g key={b.id} transform={`translate(${pos.x}, ${pos.y})`}>
                  <rect
                    width={blockW}
                    height={blockH}
                    rx={8}
                    fill={colorByGroup[b.group]}
                    fillOpacity={0.85}
                    stroke="#0d1117"
                    strokeWidth={1}
                  />
                  {showLabels ? (
                    <EditableSvgText
                      id={blockLabelId}
                      x={blockW / 2}
                      y={blockH / 2 - 4}
                      style={blockLabelStyle}
                      textAnchor="middle"
                      selected={textOverrides.selectedId === blockLabelId}
                      onSelect={(id) => textOverrides.selectText(id)}
                      onMove={(id, dx, dy) =>
                        textOverrides.setOverride(id, { dx, dy })
                      }
                      svgRef={svgRef}
                    />
                  ) : null}
                  <text
                    x={blockW / 2}
                    y={blockH / 2 + 14}
                    textAnchor="middle"
                    fontSize={10}
                    fill="white"
                    fillOpacity={0.85}
                    fontFamily='"JetBrains Mono", monospace'
                  >
                    {b.shape}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Branch labels */}
          <EditableSvgText
            id={branchEegId}
            x={margin.left}
            y={margin.top - 18}
            style={branchEegStyle}
            selected={textOverrides.selectedId === branchEegId}
            onSelect={(id) => textOverrides.selectText(id)}
            onMove={(id, dx, dy) =>
              textOverrides.setOverride(id, { dx, dy })
            }
            svgRef={svgRef}
          />
          <EditableSvgText
            id={branchFnirsId}
            x={margin.left}
            y={margin.top + 2 * rowSpacing - 12}
            style={branchFnirsStyle}
            selected={textOverrides.selectedId === branchFnirsId}
            onSelect={(id) => textOverrides.selectText(id)}
            onMove={(id, dx, dy) =>
              textOverrides.setOverride(id, { dx, dy })
            }
            svgRef={svgRef}
          />
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'fusion-flowchart',
  title: '双模态特征融合流程图',
  titleEn: 'Bimodal Feature Fusion Flowchart',
  category: 'architecture',
  summary:
    'EEG/fNIRS 融合网络的分层 DAG，边上标注张量形状。',
  component: FlowchartChart,
});
