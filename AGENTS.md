# AGENTS.md — 给下一位 AI / 接手者的快速上手文档

最后更新：2026-05-09 by Devin (`devin/1778323252-control-panel-other-categories`)

本仓库是一个交互式矢量图工作室（EEG / fNIRS 神经科学 + GAT-CMC-Net 模型架构 + 评估指标）。
所有图表都是 React + SVG，零栅格，可以在浏览器里实时编辑然后导出 SVG / PNG @ 任意 DPI。

接手前请把这一整页读完。最关键的内容在 **"控制面板基础设施"** 和 **"移植 checklist"** 两节。

---

## 1. 项目快速运行

```bash
nvm use 22  # 或 node ≥ 22 / npm ≥ 10
npm install
npm run dev    # http://localhost:5173/eeg-fnirs-vector-figure-studio/
npm run lint   # 必须 0 error；CI 跑这条
npm run build  # tsc -b && vite build；CI 也跑这条
npm test       # vitest，目前只有 useAutoSave.test.ts
```

线上：https://jason8960.github.io/0508-eeg-fnirs-vector-figure-studio/  
GitHub：https://github.com/jason8960/0508-eeg-fnirs-vector-figure-studio

每张图通过 hash 路由：`/#/chart/<chart-id>`，例如 `/#/chart/method-radar`。

---

## 2. 项目布局（关键文件）

```
src/
  charts/                   每张图独立目录，index.tsx + 偶尔 mesh.ts/data.ts
    <chart-id>/index.tsx    每个 chart 自己 registerChart({...})
    index.ts                barrel：side-effectful import 让所有 registerChart 调用执行
  components/
    ChartShell.tsx          双栏布局；右侧已 sticky（lg:sticky lg:top-2）
    FigureFrame.tsx         SVG 容器；title/caption + 可选 *Override 让标题/说明可点选编辑
    EditableSvgText.tsx     <text> 的可点选/可拖动包装；导出时不出现选择框
    TextOverridePanel.tsx   inspector 子面板：调字号/字重/斜体/颜色/dx/dy/隐藏/文本
    ConfigManager.tsx       手动配置槽：保存/加载/导入/导出（4 张原 main 图共用）
    Controls.tsx            ControlGroup, NumberSlider, Toggle, ColormapSelect, ...
    ExpertPanel.tsx         专家模式 schema 驱动 UI
    InspirationPanel.tsx    预设按钮组
    Axis.tsx                XAxis / YAxis（+ buildLinearAxis from lib/scales）
  lib/
    useTextOverrides.ts     核心 hook：每张图一个文字 override 表（id → 样式 / 位置）
    useChartConfig.ts       通用：自动保存 + 配置槽包装（5 分钟节流，无变化不存）
    useEvalChartConfig.tsx  组合：useTextOverrides + useChartConfig + 渲染 inspector 子面板
    useAutoSave.ts          底层时间命名 auto-#N (YYYY-MM-DD HH:mm) 槽位实现
    figure.ts               DEFAULT_MARGINS, innerSize() ── 所有图共用的 margin 体系
    scales.ts               buildLinearAxis() ── d3-like axis spec
    colormaps.ts            sampleColormap, getColormap, ColormapName 枚举
                            （只能用：viridis | magma | inferno | cividis | plasma | coolwarm | turbo）
    random.ts               mulberry32(seed), randn(rng) ── 所有合成数据必须用这个
    synthetic.ts            通用合成数据生成器
  registry.ts               registerChart({id, title, category, summary, component})
```

类别（src/charts/<id>/index.tsx 里的 `category` 字段）：
- `architecture` (15)：模型架构相关
- `evaluation` (13)：出版级评估指标
- `physiology` (3)：生理信号
- `clinical` (3)：临床应用

---

## 3. 控制面板基础设施（必读）

用户的核心需求是把 GAT-CMC-Net (`gat-cmc-overall`) 那张图的"控制面板"体验复制到所有图。
这套体验包括：

1. **Sticky preview** — 左边 inspector 滚动时右边预览不滚走 → 已在 `ChartShell` 实现，无需每张图改。
2. **每段文字独立可编辑** — 点击 SVG 里任何 `<text>` 选中，inspector 多出"文字编辑"面板可以调字号/字重/斜体/颜色/位置 dx,dy/隐藏/文本内容；选择框 `data-export="false"` 不出现在导出里。
3. **拖动文字** — 选中后直接拖动，dx/dy 写回 override。
4. **5 分钟自动保存** — 配置变化时每 5 分钟生成一个 `auto-#N (YYYY-MM-DD HH:mm)` 命名的快照；空闲不保存；自动槽 ≤ 5 个，FIFO 淘汰；手动槽永不淘汰。
5. **全部 inspector 控件实时刷新** — 任何控件变更立刻反映在预览。

实现这套体验只用三个 hook + 一个组件 + 一组 FigureFrame 新 prop。绝大多数图不需要再写新 hook。

### 3.1 `useEvalChartConfig<SavedConfig>(...)`

一站式入口。每张图调用一次，得到：
- `textOverrides`：可在 SVG 里调用 `resolve()` / `selectText()` / `setOverride()` 操控文字状态。
- `renderInspectorSections(textRefs)`：返回一个 JSX 片段，包含 `TextOverridePanel` 选中文字编辑面板 + `ConfigManager` 配置管理面板。直接放到 `inspector={...}` 末尾。

签名：

```ts
useEvalChartConfig<SavedConfig>({
  storageKey: 'my-chart-configs-v1',           // localStorage key
  buildBaseConfig: () => SavedConfig,           // 不含 textOverrides
  applyBaseConfig: (cfg: SavedConfig) => void,  // 反向：把 cfg 写回 setState
  filename: 'my-chart-config.json',             // 导出 JSON 时的文件名
})
```

### 3.2 `EditableSvgText`

替代 `<text>`：

```tsx
const id = 'panel-a';
const style = textOverrides.resolve(id, {
  text: '默认文本',
  fontSize: 13,
  fontWeight: 600,
  color: '#0d1117', // 可选
});

<EditableSvgText
  id={id}
  x={cx}
  y={cy}
  style={style}
  rotate={-90}                    // 可选；围绕 (x+dx, y+dy) 旋转
  textAnchor="middle"             // 可选
  dominantBaseline="middle"       // 可选
  selected={textOverrides.selectedId === id}
  onSelect={(id) => textOverrides.selectText(id)}
  onMove={(id, dx, dy) => textOverrides.setOverride(id, { dx, dy })}
  svgRef={svgRef}                 // 来自 useRef<SVGSVGElement>(null)
/>
```

⚠️ `EditableSvgText` **不支持 `transform` prop**。如果原 `<text>` 有 `transform="translate(...) rotate(...)"`，把 `translate(tx, ty)` 折成 `x={tx} y={ty}`，把 `rotate(deg)` 折成 `rotate={deg}` 即可。

### 3.3 `FigureFrame` 标题 / 说明的可点选

```tsx
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
  ...
</FigureFrame>
```

### 3.4 `textRefs` 数组喂给 inspector

定义在 `return` 之前：

```ts
const textRefs = useMemo(() => [
  { id: 'title',   label: '主标题',     defaultText: titleDefault,   defaultFontSize: 14, defaultFontWeight: 600 },
  { id: 'caption', label: '说明文字',   defaultText: captionDefault, defaultFontSize: 12 },
  { id: 'panel-a', label: '面板 A 标题', defaultText: 'xxx',          defaultFontSize: 13, defaultFontWeight: 600 },
  // 还有的文字（图例 / 标签 / 注释）按需加
], [titleDefault, captionDefault]);
```

然后在 inspector JSX 末尾插入：

```tsx
inspector={
  <>
    {/* ...原有控件... */}
    {renderInspectorSections(textRefs)}
  </>
}
```

---

## 4. 移植 Checklist（10 步，每张图都按这个走）

⚠️ **`gat-cmc-overall` 是参照样本，不要改**（用户原文："参考 GAT-CMC-Net…"）。

1. **加 imports**
   ```ts
   import { useCallback } from 'react'; // 如果还没导
   import { EditableSvgText } from '../../components/EditableSvgText';
   import { useEvalChartConfig } from '../../lib/useEvalChartConfig';
   import type { TextOverrideMap } from '../../lib/useTextOverrides';
   ```

2. **`SavedConfig` 接口加 `textOverrides?: TextOverrideMap;`** 字段。

3. **删除原有的 `loadStoredConfigs` / `persistConfigs` / `useState<Record<...>>` / `useAutoSave` / 内联 `<ConfigManager .../>` 块**（如果该图已有）。

4. **写 `buildBaseConfig` + `applyBaseConfig`**：
   ```ts
   const buildBaseConfig = useCallback(
     (): SavedConfig => ({ version: 1, /* ...所有 state */ }),
     [/* 所有 state 依赖 */],
   );
   const applyBaseConfig = useCallback((cfg: SavedConfig) => {
     if (!cfg || cfg.version !== 1) return;
     /* setX(cfg.x); ... */
   }, []);
   ```

5. **调 `useEvalChartConfig`**：
   ```ts
   const { textOverrides, renderInspectorSections } = useEvalChartConfig<SavedConfig>({
     storageKey: 'my-chart-configs-v1',
     buildBaseConfig,
     applyBaseConfig,
     filename: 'my-chart-config.json',
   });
   ```

6. **定义 `titleStyle` / `captionStyle` / 其它 textStyle**（在 `return` 之前）：
   ```ts
   const titleId = 'title';
   const titleDefault = 'My Title';
   const titleStyle = textOverrides.resolve(titleId, { text: titleDefault, fontSize: 14, fontWeight: 600 });
   ```

7. **定义 `textRefs` 数组**（同样在 `return` 之前，用 `useMemo`）。

8. **`FigureFrame`** 把 `title=... caption=...` 改用上面的 `titleStyle.text`/`captionStyle.text`，并加 6 个 `*Override` / `*Selected` / `onSelect*` props。

9. **关键 `<text>` 元素改成 `<EditableSvgText>`**：标题/说明、面板分标题、轴标签、图例、注释、计数文字 ── 越多越好；不重要的小数字标签可以保留 `<text>`。

10. **inspector 末尾加 `{renderInspectorSections(textRefs)}`**。

每张图改完跑：

```bash
npx tsc -b --noEmit
npx eslint src/charts/<chart-id>
```

两者都过再下一张。最后一起跑 `npm run lint && npm run build && npm test`。

---

## 5. 当前进度（2026-05-09）

| 类别 | 数量 | 状态 |
|---|---|---|
| evaluation | 13 / 13 | ✅ 已完成（PR #3 + PR #4 已合并到 main）|
| clinical | 3 / 3 | ✅ 已完成本分支：`dynamic-chord`, `seizure-focus`, `lead-lag-matrix` |
| physiology | 0 / 3 | ⌛ 待做：`cortical-3d`, `eeg-fnirs-topomap`, `nvc-alignment` |
| architecture | 1 / 15 | ⌛ 待做：除 `gat-cmc-overall`（参照样本，**不要改**）外的 14 张 |

**当前分支**：`devin/1778323252-control-panel-other-categories`（基于 main，已有 1 个 commit `5ac91d9` 处理 3 张 clinical 图）

**架构类剩余 14 张**（按代码体量从小到大）：

| Chart | 行数 | 已有 ConfigManager? |
|---|---|---|
| spatiotemporal-cnn | 276 | 否 |
| hegat-map | 335 | 否 |
| fusion-flowchart | 336 | 否 |
| cross-modal-heatmap | 592 | 否（已发表实现，需新增） |
| data-pyramid | 922 | 是（要替换） |
| gating-fusion | 1053 | 是 |
| event-decoding | 1178 | 是 |
| gat-attention | 1179 | 是 |
| hrf-kernel | 1273 | 是 |
| hrf-alignment | 1436 | 是 |
| heterogeneous-graph-construction | 1826 | 是 |
| architecture-overall | 2771 | 是（含 panel/edge 拖动逻辑，要小心保留）|
| eeg-encoder-detail | 3186 | 是 |
| fnirs-encoder-detail | 3306 | 是 |

**生理类剩余 3 张**（都没有 ConfigManager，需要从零加）：
| Chart | 行数 |
|---|---|
| cortical-3d | 294 |
| eeg-fnirs-topomap | 486 |
| nvc-alignment | 527 |

### 推荐推进顺序
1. 先把 3 张生理图做完（小，模式清晰）。
2. 架构按行数从小到大做。
3. **特别小心 `architecture-overall`、`eeg-encoder-detail`、`fnirs-encoder-detail`** 这三张超大文件 ── 它们已经有 panel-drag / edge-drag 等专属逻辑，**只做最小改动**：替换 `useState+useAutoSave+ConfigManager` 为 `useEvalChartConfig` + 包 `FigureFrame` 标题说明 + 几个最关键的面板分标题包成 `EditableSvgText` 即可。**不要尝试**包所有 panel 内的文字 ── 那是 panel 自己的渲染逻辑，会破坏 layout。

---

## 6. 已知坑 / 务必避免

1. **不要在 render 里创建组件**。`react-hooks/static-components` 规则会把这种代码 lint 失败。
   坏例：`function MyChart() { const ConfigManager = () => {...}; ... }`  
   好例：用模块顶层 `function ConfigManager(...) {}` 或者已经抽好的 `<ConfigManager .../>` 组件。

2. **不要解构 `_` 变量**。`@typescript-eslint/no-unused-vars` 在主项目里会报 `_` 没用。
   坏例：`const { [name]: _, ...rest } = obj;`
   好例：`const rest = { ...obj }; delete rest[name];`

3. **不要用 ColormapName 枚举之外的色板名**。CI 会 typecheck fail。
   不存在：`'YlGnBu' | 'blues' | 'greens' | 'jet' | 'rainbow'`
   合法：`'viridis' | 'magma' | 'inferno' | 'cividis' | 'plasma' | 'coolwarm' | 'turbo'`

4. **EditableSvgText 不接受 `transform` prop**。把 `transform="translate(x,y) rotate(d)"` 拆成 `x y rotate` 三个 prop。

5. **不要修改 `gat-cmc-overall`**。它是用户的参照样本，作为对比保留原样。

6. **不要 force-push 到 main / master**。本仓库主分支保护开了；新工作开新分支 + PR。

7. **PR 描述里不需要写 session url 或 requester 信息**，系统会自动追加。

8. **CI 必须绿才报告完成**。lint + tsc + build + test 全过 + GitHub Pages 部署成功。

9. **导入路径用相对路径**。仓库没配 path alias。`from '../../lib/...'`、`from '../../components/...'`。

10. **localStorage key 命名约定**：`<chart-id>-configs-v1`。增字段时升到 `-v2`，并在 `applyBaseConfig` 里做 version migration。

---

## 7. PR 流程（自动化部分）

```
1. git checkout -b devin/<timestamp>-short-name
2. （改代码）
3. npm run lint && npm run build && npm test  # 必须全过
4. git add -A && git commit -m "feat(...): ..."
5. git push
6. 通过 git_pr 工具：fetch_template → create
7. 通过 git 工具：pr_checks(wait_mode="all") 等 CI
8. CI 绿 → 报告 PR 链接 + 部署 URL
```

---

## 8. 用户偏好（重要）

- 用户希望 **autonomous（自主完成）**，不需要中途确认。
- 用户希望 **不需要测试** ─ "把网址给我就行"。但 CI 必须绿。
- 用户偏好 **中文交流**，PR 描述可英文，commit message 可英文。
- 重大决策选项可以用 `content_type="user_question"` 列出来，让用户点选。
- 不要 emoji（除非用户明确要）。
- 简短直接，链接代替陈述（"PR" → 链接）。

---

## 9. 如何快速验证基础设施仍能工作

随便选一张已完成的评估图，例如 `/#/chart/method-radar`：
1. 点标题 → inspector 多出"文字编辑"段。
2. 拖标题 → 标题位移；inspector 里 dx/dy 同步变化。
3. 改字号滑块 → 标题字号实时变。
4. 等 5 分钟（或改 `useChartConfig.ts` 的 `intervalMs`）→ `配置管理` 出现 `auto-#N (...)` 槽。
5. 导出 SVG → 选择框 / 拖动手柄 **不应**出现在导出文件里。

如果第 5 项失败，说明 `data-export="false"` 没起作用 ── 检查 `ChartShell` 的导出函数是否过滤了这些节点。

---

## 10. 联系上下文

- 上一个 Devin session：https://app.devin.ai/sessions/dae72a2f0e6d471aad549980e3171d9f
- 已合并 PR：#3（评估类原图实现 + 修 main 上 lint）、#4（评估类全部接入控制面板）
- 当前分支 PR：本分支待开（架构 + 生理 + 临床 控制面板移植）

如果接手时发现 main 又往前走了，先 `git rebase origin/main`，解决 `src/charts/index.ts` 的 barrel 冲突（保留两边新增的 chart import），然后再继续。
