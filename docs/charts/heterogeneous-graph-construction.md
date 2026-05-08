# Heterogeneous Graph Construction · 模块逐讲

> 对应 chart：`src/charts/heterogeneous-graph-construction/index.tsx`
> 在线预览：<https://githu29988.github.io/eeg-fnirs-vector-figure-studio/#/chart/heterogeneous-graph-construction>

这张图是 paper 的 **Fig 4**：把 EEG 电极和 fNIRS 通道**放进同一张异质图** $G = (V, E)$，并直观地解释三类边为什么必须分开建模。视觉上分成两块：

1. **左侧主画布**：节点 + 三层边 + 两条 banner（$V_E$ / $V_F$）
2. **右侧两块侧栏**：`Edge categories`（图例 + dashed=cross 标注）、`Notation`（公式速查）

---

## 1. 节点（Nodes）

整张图有 **16 个节点 = 9 个 EEG + 7 个 fNIRS**：

| 类别 | id 形式 | 数量 | 排列 | 视觉风格 |
| --- | --- | --- | --- | --- |
| EEG | $E_1 \dots E_9$ | 9 | **上方半圆弧**（用 `buildEegPositions` 按 $\theta = \pi - i\pi/8$ 算，半径 `ARC_RX × ARC_RY`） | 浅蓝填充 `#DCEAFF` + 深蓝描边 `#1F4E79` |
| fNIRS | $F_1 \dots F_7$ | 7 | **下方略带波浪的水平排**（`y = FNIRS_Y + amp · sin(i · 1.3)`，故意微抖防视觉对齐成栅格） | 浅红填充 `#FBE2E2` + 深红描边 `#9B2D2D` |

**为什么数量不一样？** EEG 通道 `N_E = 18` 在论文里是真实的 10-20 蒙太奇规模；这张示意图压成 9 是为了视觉清楚。fNIRS 同理（实际 `N_F = 24`，画 7 个）。这只是示意——实际算法跑的是真实通道数。

**节点节点都可以直接拖**：底层走的是 `usePanelDrag`，3 px 阈值区分 click vs drag，8 px 范围内自动 snap 到邻居/中线，结果存在 `nodeOverrides[id].dx/dy`。

> 顶部 banner $V_E = \{e_1,\dots,e_{N_E}\}$ 和 $V_F = \{f_1,\dots,f_{N_F}\}$ 是为了让读者一眼看到论文里的两个集合记号；它们的文本可以在 Inspector 里 override（`veBannerOverride` / `vfBannerOverride`）。

---

## 2. 三类边（Edge categories）

边是这张图的核心。论文把全部连接拆成 **3 类 × 2 种 intra-modal × 1 种 cross-modal**：

### 2a. Intra-EEG 边 · `kind: 'ee'`

- **几何**：在 `INTRA_EEG_PAIRS` 里硬编码了 18 对 (i, j)：8 条邻接 + 7 条隔一跳 + 3 条隔两跳，跨度大约是 EEG 频带相干性 (coherence) 上常见的"近邻 + 中距 + 长距"三档。
- **画法**：`EdgePath` 在两个端点之间画 quadratic Bezier，`curve = -0.32`（**arch upward**）—— 让所有 EE 边集中在 EEG 半圆**上方**。
- **视觉**：浅蓝 `#5B7BB0`，width 1.6，alpha 0.65，**实线**。
- **物理含义**：channel-channel band-power similarity（k-NN 邻接矩阵 $\mathbf{A}^{EE}$）。

### 2b. Intra-fNIRS 边 · `kind: 'ff'`

- **几何**：`INTRA_FNIRS_PAIRS` 13 对 (i, j)：邻接 6 + 隔一跳 5 + 隔两跳 2。
- **画法**：`curve = +0.40`（**arch downward**）—— 所有 FF 边集中在 fNIRS 行**下方**，跟 EE 边形成镜像。
- **视觉**：浅红 `#B36363`，width 1.6，alpha 0.65，**实线**。
- **为什么要"上下分开"？** 如果 EE 和 FF 的弧线全往上拱，会跟 cross-modal 边交叠成一团黑泥；把 FF 拱向下方等于给三类边开了三个独立的视觉区——这是这张图能看清的关键。

### 2c. Cross-modal 边 · `kind: 'cross'`

- **几何**：`CROSS_PAIRS` 11 对 (eeg_idx, fnirs_idx)，11 条直线穿越上下两层。
- **画法**：`curve = 0`（**直线**）——cross 边不再拱，避免干扰那两层 intra-modal 的视觉。
- **视觉**：紫色 `#7A4FAE`，width 2.0（比 intra-modal 加粗），alpha 0.9，**虚线** (`dashed: true`)。
- **核心标签**：每条 cross 边末端可以挂一个 $\tau_j$ 文本框 ——**这是论文最重要的信息密度点**：
  - $\tau_j$ = **per-channel learnable HRF time-shift**
  - 默认值放 `'$\tau_j$ HRF shift'`，可在 Inspector 里 override 为 `hrfTagOverride`
  - `toggles.showHrfTag` 一键开关：开 = 显示所有 $\tau_j$ 标签，关 = 收起，画面只剩 dashed 紫线（用于截图给非 multimodal 的读者看）

> Side panel `Edge categories` 提供三色 swatch，并在右侧 banner 显示 `Cross-modal (with $\tau_j$ HRF shift)`，跟主图的 dashed line + tag 形成一对一对照。

### 边样式总表（默认）

```ts
const DEFAULT_EDGE_STYLES: Record<EdgeKind, EdgeKindStyle> = {
  ee:    { color: '#5B7BB0', width: 1.6, alpha: 0.65, dashed: false, curve: -0.32, visible: true },
  ff:    { color: '#B36363', width: 1.6, alpha: 0.65, dashed: false, curve:  0.40, visible: true },
  cross: { color: '#7A4FAE', width: 2.0, alpha: 0.90, dashed: true,  curve:  0.00, visible: true },
};
```

每个字段在 Inspector 里都暴露了：颜色、粗细、不透明度、虚实线、曲率、可见性 → 一键拍出 paper / talk / poster 的不同色阶。

---

## 3. 与论文公式的对照

右侧 `Notation` 侧栏列了 4 个块的核心公式，全是把 chart 上的视觉元素**还原回数学**：

### 3a. 块状邻接矩阵

$$\mathbf{A} = \begin{bmatrix} \mathbf{A}^{EE} & \mathbf{A}^{EF} \\ \mathbf{A}^{FE} & \mathbf{A}^{FF} \end{bmatrix}, \quad \mathbf{A}^{EF} = (\mathbf{A}^{FE})^{\top}$$

- 主对角块 ($\mathbf{A}^{EE}$, $\mathbf{A}^{FF}$) ↔ chart 上的两层 intra-modal 弧线
- 反对角块 ($\mathbf{A}^{EF}$, $\mathbf{A}^{FE}$) ↔ chart 上的紫色 dashed cross 边
- "block-structured by node type" 这行小字是把"邻接矩阵显式分块"这件事说出来——对图神经网络读者是常识，对 EEG/fNIRS 读者可能是第一次看到

### 3b. Per-edge-type GAT 权重

$$\mathbf{W}_r \quad \text{for } r \in \{ EE, FF, EF \}$$

- 三类边各自有**独立的可学习权重矩阵** $\mathbf{W}_r$，意思是 message passing 在三类边上不共享参数——这正是 **heterogeneous graph attention** 跟普通 GAT 的本质差异
- 视觉对应：chart 上三种颜色的边
- 这一行解释了为什么"分三类边"不仅仅是画图好看，而是**模型层面真的要这么搞**

### 3c. Learnable edge gate

$$\gamma_{ij} = \sigma\!\left(\mathbf{u}^{\top} [\mathbf{h}_i \,\Vert\, \mathbf{h}_j]\right)$$

- $\sigma$ = sigmoid，$\mathbf{u}$ = 可学习投影向量，$\Vert$ = concat
- 含义：**每条边都过一道 gate**——给定两个节点的当前 representation $\mathbf{h}_i, \mathbf{h}_j$，先 concat 再投影成 1 维 logit，sigmoid 出 (0, 1) 之间的 "信任度" $\gamma_{ij}$
- 这个 $\gamma_{ij}$ 后面会被乘到 attention 得分上：可疑的边自动被压成 0

### 3d. ℓ₁ regulariser → sparse graph

- 给 $\gamma$ 加 $\ell_1$ 惩罚 → 训练完之后大部分 $\gamma_{ij} \to 0$
- **效果**：模型自己学出"哪些 cross-modal 边其实是噪声、应该剪掉"。chart 上画了 11 条 cross 边其实是个高估，跑完模型可能只剩 3-4 条真正激活
- 这 4 行 notation 加在一起，就把"为什么要把图建成这个样子 + 模型怎么用"说清楚了

---

## 4. Inspector 控制面板

跟其他几张架构图同款的双模 Inspector：

### Simple 模式
- **Show / hide** 三类边（一键关掉 cross 边 → 只看 intra-modal 拓扑）
- **Show / hide** $\tau_j$ HRF tag（cross 可见时才有效）
- **Show / hide** 两个侧栏（`Edge categories` / `Notation`）
- **Toggle** 副标题 / 顶部 $V_E,V_F$ banner / 中线 divider

### Expert 模式
- 三类边的全部样式：color / width / alpha / dashed / curve（对 cross 来说 curve=0 比较保守，但留了字段）
- 每个 cross 边的 endpoint label（默认 `$\tau_j$`，可独立改成 $\tau_1, \tau_2, \dots$ 比如做某个具体例子）
- 每个节点的 dx/dy override（拖完之后会持久化）
- 每个节点的 label override（默认 `$E_1$ / $F_1$`，可改成 `Fp1 / S1-D1` 这类真实通道名）
- 标题 / 副标题 / 两条 banner / HRF tag 的 text override

### 配置管理（跟其他架构图共享同一套实现）
- **Save slot**：把当前所有调节存为命名 slot（localStorage key `heterogeneous-graph-construction-saved-configs-v1`）
- **Load slot** / **Delete slot**：从下拉里恢复或删除
- **Export / Import JSON**：跨设备 / 跨人共享配置
- **5 分钟自动保存**（PR #16 加进来的 `useAutoSave` hook）：每 5 分钟和上一次快照做 diff，不一样就追加 `auto-#N (YYYY-MM-DD HH:MM)`，下次打开自动 load 最新一份；超过 20 个 auto slot 就开始 LRU 淘汰最老的
- **打开页面就 auto-load 最近一次**：意味着关掉浏览器、第二天再打开，所有调节都还在

---

## 5. 跟 `gat-cmc-overall` 的关系

| 维度 | `gat-cmc-overall` (Fig 1) | `heterogeneous-graph-construction` (Fig 4) |
| --- | --- | --- |
| 解决的问题 | "整张管线长什么样" | "图怎么建出来的" |
| 节点 | 9 个**模块**（EEG Input → … → Classifier） | 16 个**通道**（9 EEG + 7 fNIRS） |
| 边 | 数据流（带数据形状标签） | 邻接关系（按 modality 分三类） |
| 数学密度 | 每个面板 1-2 个 KaTeX 公式 + 一个底部 viz | 主图几乎只有节点和边；公式集中在右侧 Notation 侧栏 |
| 适合放论文 | Method 章节开头的 system overview | Method 章节"Graph Construction"小节 |

两张图在论文里**互补**：Fig 1 解释 "数据从哪进来、最后预测什么"，Fig 4 把其中"图怎么建"这一步拉出来 zoom-in。

---

## 6. 修改这张图的常见操作

| 想要的效果 | 怎么做 |
| --- | --- |
| 改电极名（`E_1` → `Fp1`） | Inspector → **Nodes** → 选中 E1 → 改 label override |
| 关掉所有 cross 边 | Inspector → **Edge styles · cross** → visible: off |
| 把 cross 边改成实线（投稿到只接受实线的期刊） | Inspector → **Edge styles · cross** → dashed: off |
| 截一张"只剩 EEG 拓扑"的图 | 把 ff 和 cross 都设 visible: off |
| 让所有 $\tau$ 显示成 $\tau_1, \tau_2, \dots$ | Inspector → **Cross edges** → 逐条改 label |
| 把图导出 SVG 给排版同事 | 右上 ExportToolbar → SVG（snap guides 已用 `data-export="false"` 排除掉） |
| 想恢复到默认 | Inspector → **Reset all** 或者 Delete 当前所有 slot 后刷新页面 |

---

## 7. 跟代码对应的 anchor

- **节点位置算法**：<ref_snippet file="src/charts/heterogeneous-graph-construction/index.tsx" lines="166-202" />
- **三类边定义**：<ref_snippet file="src/charts/heterogeneous-graph-construction/index.tsx" lines="208-241" />
- **默认样式**：<ref_snippet file="src/charts/heterogeneous-graph-construction/index.tsx" lines="245-270" />
- **Side-panel 内容（Notation 公式）**：<ref_snippet file="src/charts/heterogeneous-graph-construction/index.tsx" lines="347-422" />
- **Save / Load / Auto-save 接线**：<ref_snippet file="src/charts/heterogeneous-graph-construction/index.tsx" lines="525-610" />
- **EdgePath（quadratic Bezier 实现）**：<ref_snippet file="src/charts/heterogeneous-graph-construction/index.tsx" lines="1663-1692" />
