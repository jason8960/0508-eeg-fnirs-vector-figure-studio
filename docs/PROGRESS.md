# 项目进度备注 / Resume notes

最后更新：2026-05-10 07:06 UTC
负责人：Devin (Cognition AI) + cab pdxp (jason8960@github)

> 这份文件记录项目截至当前的所有重要进展、未完成事项、以及未来要做什么。
> 如果会话中断，下一次任何 Devin / 任何人接手，**只要先读这一份**就能继续。

---

## 0. 仓库 / 链接

| 项 | 链接 |
| --- | --- |
| GitHub repo | https://github.com/jason8960/0508-eeg-fnirs-vector-figure-studio |
| 部署预览 (Pages) | https://jason8960.github.io/0508-eeg-fnirs-vector-figure-studio/ |
| Pages 部署 workflow | https://github.com/jason8960/0508-eeg-fnirs-vector-figure-studio/actions/workflows/pages.yml |
| 当前 Devin 会话 | https://app.devin.ai/sessions/ccaec8c1ca23463c9ad451edd380e3db |
| 论文背景 PR/issues | (无；论文不在此仓库) |

---

## 1. 论文 / 课题背景（**关键**）

- 论文方向：**EEG + fNIRS 多模态癫痫检测**，模型 **GAT-CMC-Net**（异质图 + GAT + 可学习 HRF 软位移 τ_c + 门控融合 g）。
- 论文阶段：**初稿**。
- 数据现状：**用 AI 工具生成的合成数据**，没有真实数据，没有合作者，全是 cab pdxp 一个人在做。
- 算力现状：未确定（待 cab pdxp 答复）。
- 投稿目标：**国外期刊**（待定具体期刊）。

### 🚨 核心风险（Devin 已向用户提出，待用户决策）

> 「AI 工具生成的合成数据 + 国外期刊投稿」**几乎肯定会被拒**。

理由：
1. 癫痫检测属于临床应用，reviewer 第一关检查 Dataset section
2. 「随机 AI 工具生成」不是已发表的 simulation pipeline（Glover HRF / SPM canonical / 标准 forward model），也不是 IRB-approved 临床数据
3. 即便包装为 "preliminary study"，编辑大概率直接 desk reject

**已向用户建议的三条路径**：

| 路径 | 数据 | 范围 | 工作量 | 期刊 |
| --- | --- | --- | --- | --- |
| **A** | CHB-MIT 真实小儿癫痫 EEG（PhysioNet 免费） | 砍掉 fNIRS，纯 GAT EEG seizure detection | 1–2 月 | *Journal of Neural Engineering* / *IEEE EMBC* / *Frontiers in Neuroscience*（IF 2–5） |
| **B** | CHB-MIT 真 EEG + canonical HRF 卷积仿真 fNIRS | 保留多模态卖点，标注 "feasibility study" | 2–3 月 | methodology 类期刊（IF 3–6） |
| **C** | Shin et al. 2018 EEG+fNIRS（公开真实多模态）| 任务从癫痫改为运动想象 / 心算 BCI | 3–4 月（重新 framing） | BCI 领域期刊 |
| ❌ D | 当前 AI 合成数据 | 不变 | — | 不可发 |

**用户决策待回（已设定明天下午 2026-05-11 06:30 UTC ≈ 14:30 北京时间提醒）**：
1. 选 A / B / C 哪条路径？
2. 真实目标：发期刊 / 学位过线 / 申博 portfolio / 自学？
3. 算力：本机 GPU / Colab / vast.ai / 没有？

---

## 2. 已完成（merged 到 main）

按时间顺序，最近 → 最早：

### PR #2 (`b013494` + `6aba543`) · Fig 5-10 六张新图 + 视觉增强
- **6 个新 chart 模块**（全部对齐 `gat-cmc-overall` 的控制面板能力）：
  - `src/charts/hrf-kernel/`         · Fig 5 · HRF 高斯软位移核 + τ 扫描
  - `src/charts/hrf-alignment/`      · Fig 6 · EEG ↔ HbO/HbR 校准前/后 + Pearson ρ
  - `src/charts/gat-attention/`      · Fig 7 · 单节点 6 邻居 + softmax(logit) 滑块
  - `src/charts/gating-fusion/`      · Fig 8 · 6 模块块图 + snap-to-rect 箭头 + g 滑块
  - `src/charts/data-pyramid/`       · Fig 9 · 4 层证据梯形金字塔
  - `src/charts/event-decoding/`     · Fig 10 · 后验 → 阈值 → 闭运算 → 事件窗
- 每张含：每行字体可编辑 / 对齐 / 5 分钟自动保存 / 启动 auto-load / 箭头自动吸附 / 模块可拖 / 命名 slot / KaTeX 实时 + MathJax 导出 / Simple+Expert Inspector / Save·Load·Export·Import·Reset。
- 视觉增强：FWHM 带、α 条形图、logit→softmax 计算面板、gate heatmap (16维)、composition bar、L1-L4 层徽章 + icon、GT 阴影带、TP/FP/FN 着色、F1/Precision/Recall 徽章。
- `src/components/ExpertPanel.tsx` 加 `TextField` 类型（单行+多行可编辑）。
- 注册进 `src/charts/index.ts`，docs 各一份模块逐讲。

### PR #1 (`1e90f49`) · auto-save LRU + 测试 + 推广
- `src/lib/useAutoSave.ts` 加 LRU（默认 20 条 auto slot），按 meta timestamp + numeric `#N` 双路排序淘汰，手动 slot 永不淘汰
- vitest 基础设施（`vitest.config.ts` 绕开 mathjax-full ESM JSON import 坑）+ `src/lib/useAutoSave.test.ts` 11 条单测
- 把 `useAutoSave` 推广到 5 张 paper-arch 图（`gat-cmc-overall` / `architecture-overall` / `eeg-encoder-detail` / `fnirs-encoder-detail` / `heterogeneous-graph-construction`）
- 写完 `docs/charts/heterogeneous-graph-construction.md`（同款模块逐讲）
- README catalogue v1 (14) → v2 (19)，加 *Slot persistence & auto-save* 段、docs 索引、`npm test`、roadmap 加入 "Phase 3 — Paper figures"

### 历史更早（来自之前会话，已 merge）
- `#16` Heterogeneous Graph Construction Fig 4 + 全局 useAutoSave hook
- `#15` `gat-cmc-overall` 模块逐讲 markdown
- `#14` GAT-CMC-Net v2 装饰（adjacency / lollipop / HRF kernel / gate / event-output 8 种 viz）
- `#13` GAT-CMC-Net Fig 1 骨架
- `#12` 边路径中点拖拽 + waypoint 插入 + snap-to-edge
- 更早：figure studio v1 14 张图、KaTeX → MathJax 导出 path、ChartShell 两栏骨架、ExportToolbar、usePanelDrag、PR #1-#11

---

## 3. 进行中（**当前会话**，已实现，待 push）

### 分支：`devin/1778244006-editable-text-format`

### 目标
让 Fig 5-10 六张图的**预览里每行文字 / 字符 / 标签都可单独点击选中**，并通过浮动工具栏调整：字号 / 字重 / 斜体 / 行距 / 对齐 / 颜色。

### 已完成
- ✅ `src/lib/textFormat.ts` 新建：`TextFormat` 类型 + `FormatStore` map + `resolveTextFormat` / `patchFormat` / `clearFormat` / `clearAllFormats` 辅助函数。
- ✅ `src/components/TextFormatPopover.tsx` 新建：浮动工具栏组件（字号 +/− 步进、行距 +/− 步进、B/I 切换、L/C/R 对齐、颜色选择器、单元素重置、Esc 关闭、`data-export="false"` 不进 SVG 导出）。
- ✅ `src/components/EditableForeignText.tsx` 新建：共享 `<foreignObject>`-backed 文本组件，封装 per-element 格式覆盖、选中态、`onSelect` 回调，渲染选中虚线框 + 透明 click-catcher（全部 `data-export="false"`）。
- ✅ `src/lib/useTextFormat.ts` 新建：通用 hook，封装 `selected` state + `handleSelectText` / `handleClearSelection` / `patchFormat` / `resetElementFormat` / `resetAllFormats` 回调。`useTextFormat<C>(setCfg)` 对 `C extends { formats?: FormatStore }` 泛型。
- ✅ 6 张图全部完成 refactor（用 `EditableForeignText as ForeignText` 替换本地 `ForeignText`，`useTextFormat` 替换手写 state）：
  - ✅ `src/charts/hrf-kernel/index.tsx`（Fig 5）— title / subtitle A/B / panel A/B 轴 / 图例条目 / 信息框
  - ✅ `src/charts/hrf-alignment/index.tsx`（Fig 6）— title / subtitle A/B / panel A/B 轴 / Pearson ρ 徽章 / lag-corr / τ shift markers / note
  - ✅ `src/charts/gat-attention/index.tsx`（Fig 7）— title / α 标签 / centre + node 标签 / 公式 / 图例 / color bar / softmax 面板 / note
  - ✅ `src/charts/gating-fusion/index.tsx`（Fig 8）— title / 6 模块 block 标题 / 公式 / 图例 / heatmap 标签 / note
  - ✅ `src/charts/data-pyramid/index.tsx`（Fig 9）— title / subtitle / 4 层 L1-L4 标题 + 注解 / icon 标签 / note
  - ✅ `src/charts/event-decoding/index.tsx`（Fig 10）— title / subtitle a/b/c / 三联板各 X/Y 轴 / 阈值线 / GT 标签 / TP/FP/FN 徽章 / Precision/Recall/F1 名+值 / raw/closing 标签 / note
- ✅ 所有图都有 popover + 透明顶层 click-catcher（点空白处取消选中）+ ConfigManager「重置全部文本格式」按钮。
- ✅ `npm run lint` / `npm run build` / `npm test`（11/11）全绿。

### 待做
- ⬜ `git add -A && git commit && git push -u origin devin/1778244006-editable-text-format`
- ⬜ `git_create_pr`，等 CI（repo 没接 PR CI）
- ⬜ 把 PR 链接发给用户 + 提议录 dev-server 演示视频

---

## 4. 未来要做（按优先级，**待用户决策路径 A/B/C 后启动**）

### P1 · 论文真数据训练 repo
依赖：用户选 A/B/C 之后。

| 任务 | 输出 | 说明 |
| --- | --- | --- |
| `gat-cmc-net-train`（新仓库） | data loader + model + train/eval/ablation | 数据集见路径选择 |
| CHB-MIT 数据 loader | `data/chbmit.py` | windowing + bipolar montage + ICA + per-patient split |
| GAT-only baseline | `models/gat_eeg.py` | 路径 A/B 共用 |
| HRF 卷积仿真模块 | `data/hrf_simulator.py` | 仅路径 B |
| Shin 2018 loader | `data/shin2018.py` | 仅路径 C |
| Train script | `train.py` | + W&B 实验跟踪 |
| Reproduce 脚本 | `reproduce.py --table 2` | 让 reviewer 一行复现 |
| Ablation sweep yaml | `sweeps/ablation.yaml` | 4 ablation × 5 seed |

### P2 · Streamlit 可解释性 demo
依赖：要么有真模型 forward 输出，要么先用 mock data。

| 任务 | 输出 |
| --- | --- |
| 仓库（新仓库 `gat-cmc-net-demo` 或合并进 train repo） | `app.py` |
| Mock 数据生成器（合成 EEG + canonical HRF 卷积 fNIRS） | `src/mock_data.py` |
| α 注意力热图可视化 | `src/plots.py` |
| 学到的 τ_c 柱状图 + g_t 时序 + 后验曲线 + GT 阴影 | `src/plots.py` |
| 时间轴拖动联动 | `app.py` |
| 部署 HuggingFace Spaces / Streamlit Cloud | 论文 supplementary 链接 |

### P3 · 论文 LaTeX 模板 + figure 自动化
依赖：选定目标期刊。

| 任务 | 输出 |
| --- | --- |
| Overleaf 项目骨架（IEEE TMI / NeuroImage / TBME / J Neural Eng 至少 2 个） | `paper/` |
| `make figs` 从 figure studio 拉 SVG → PDF | `Makefile` |
| Bibliography 同步（zotero-better-bibtex） | `paper/refs.bib` |

### P4 · 项目主页 + 投稿后 arXiv
依赖：论文写完。

---

## 5. 已知问题 / 风险

1. **当前合成数据不可发表**（见 §1）。
2. **figure studio 的 `gat-cmc-overall/index.tsx` 已 4234 行**，建议拆分；但拆之前必须先有 SVG 导出字节级回归测试，否则视觉容易回归。
3. **此 repo CI 未接**，PR merge 时不会跑 lint/build/test，需要本地跑。
4. **GitHub Pages 部署**：用户已点 Source = GitHub Actions（确认），但每次 PR merge 后要去 https://github.com/jason8960/0508-eeg-fnirs-vector-figure-studio/actions 看 deploy workflow 是否成功。
5. **localStorage 限额**：每张图最多 20 条 auto slot + N 条手动 slot；已加 LRU，但若用户手动 slot 起名极多仍会撑爆。
6. **MathJax-full ESM JSON 导入坑**：`vitest.config.ts` 已绕开，但下次升级 mathjax-full 可能复发，看 `src/lib/mathjax.ts` 注释。

---

## 6. 命令速查

```bash
# Working dir
cd /home/ubuntu/repos/0508-eeg-fnirs-vector-figure-studio

# Dev
npm run dev               # http://localhost:5173
npm run lint
npm run build
npm test                  # vitest

# Branch info
git branch --show-current # devin/1778244006-editable-text-format
git status

# Push (后续)
git add -A
git commit -m "feat(text-format): per-element text formatting toolbar across Fig 5-10"
git push -u origin devin/1778244006-editable-text-format
```

---

## 7. 下次接手的 Devin / 我自己的 checklist

1. 读这份 `docs/PROGRESS.md`（你正在看的）
2. `cd /home/ubuntu/repos/0508-eeg-fnirs-vector-figure-studio && git status`
3. 看 §3 「待做」逐条
4. 等明天下午（2026-05-11 06:30 UTC）的 schedule 提醒到时候，用户回路径决定，**那时候才启动 §4 的 P1**

---

## 8. Schedule（已设）

- **Tomorrow PM reminder · 2026-05-11 06:30 UTC ≈ 14:30 北京时间**：one-time 自动开新会话提醒用户做 A/B/C/数据/算力 决定。Schedule ID: `sched-cdd21831a44d4e9bb88b306409017b5f`。

---

## 9. 文本格式系统架构速查（本次实现）

### 数据流
```
SavedConfig.formats?: Record<elementKey, TextFormat>
        ^
        | patchFormat / clearFormat
        |
useTextFormat<SavedConfig>(setCfg)
        |
        v
{ selected, handleSelectText, handleClearSelection,
  patchFormat, resetElementFormat, resetAllFormats }
        |
        v
EditableForeignText { kid, format, selected, onSelect }
        |
        v
foreignObject (data-export="false" 元素被 SVG 导出剥离)
```

### TextFormat schema
```ts
type TextFormat = {
  fontSize?: number;
  fontWeight?: number;       // 400 / 500 / 600 / 700
  italic?: boolean;
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
};
```

### 关键规则
- `format` 字段全部可选；`undefined` = "用默认值"（来自 chart 自己传的 fontSize / fontWeight / align / color）。
- 渲染时由 `EditableForeignText` 内部用 default ?? override 合并。
- 用 `kid` 唯一标识；点击文本 → onSelect(anchor) → useTextFormat.selected → popover 展示 → patchFormat 写回。
- Click-catcher 透明 rect 点空白处取消选中（`data-export="false"` 不进导出）。

### 给新图加 text-format 的最小步骤
1. `import { EditableForeignText as ForeignText, type SelectedTextAnchor } from '../../components/EditableForeignText';`
2. `import { useTextFormat } from '../../lib/useTextFormat';`
3. `import { TextFormatPopover } from '../../components/TextFormatPopover';`
4. `import { type FormatStore, type TextFormatDefaults } from '../../lib/textFormat';`
5. `SavedConfig` interface 加 `formats?: FormatStore;`，`DEFAULT_CONFIG` 加 `formats: {}`。
6. 在 chart function 顶部 `const { selected, handleSelectText, handleClearSelection, patchFormat, resetElementFormat, resetAllFormats } = useTextFormat<SavedConfig>(setCfg);`
7. 每个 ForeignText 加 `kid="..."`、`label="人类可读"`、`format={cfg.formats?.[kid]}`、`selected={selected?.key === kid}`、`onSelect={handleSelectText}`。
8. 在 SVG 末尾加：(a) 透明 click-catcher rect（`onMouseDown={handleClearSelection}`）；(b) 如果 `selected` 不为 null，渲染 `<TextFormatPopover ... />`。
9. ConfigManager 加 `onResetAllFormats?: () => void` 参数 + 「重置全部文本格式」按钮。

---

_End of PROGRESS.md — 维护者：每次重大变更同步这份文件，特别是 §3 的进行中项和 §4 的下一步。_
