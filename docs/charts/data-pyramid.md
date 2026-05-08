# Data / Evidence Pyramid · 模块逐讲

> 对应 chart：`src/charts/data-pyramid/index.tsx`

论文 **Fig. 9**：4 层证据金字塔，从下到上逐层抬升论证强度。

---

## 1. 元素 (4 层梯形)

| 层 (从底到顶) | id | 内容 |
| --- | --- | --- |
| L1 (底，最宽) | `l1` | 原始多模态数据 (Bonn / Siena / 自采) |
| L2 | `l2` | 模型预测 / softmax $\hat{y}$ |
| L3 | `l3` | 融合 sanity check ($g\to 0/1$ 退化) |
| L4 (顶，最窄) | `l4` | 闭环可解释 ($\rho(\tau^*, \hat{\tau})$ 反推) |

每层是一个等腰梯形，宽度由 `value` 滑块乘以基础宽度——可以"强调"某一层。

每层右侧自动配一条引出线 + KaTeX 注释。

## 2. 控制

- **简单模式**：4 层各自 `value` 滑块 (0.2..1.2)、4 层正文文本
- **专家模式**：每层 (标题 / 正文 / 填充 / 描边 / value / 右侧注释 / 显隐)；金字塔几何 (cx, topY, bottomY, minWidth, maxWidth, gap)；黄色注释框；5 个字号

## 3. 数学

每层底边宽：

$$w_i = (w_{\min} + (w_{\max} - w_{\min}) \cdot (1 - t_i)) \cdot (0.4 + 0.6 \cdot v_i)$$

其中 $t_i$ 是从底到顶的相对位置 (0..1)，$v_i$ 是 value 强调因子。

## 4. Inspector

- 4 层 × 7 字段
- 6 个几何字段
- 装饰：右侧注释总开关 / 黄色注释框
- 5 个字号

## 5. 跟其他图的关系

- 跟论文每张图一一对应：每层右侧注释指向具体图编号 / 实验
- L1 ↔ `eeg-fnirs-topomap` 等数据图
- L2 ↔ `roc-pr` / `confusion-matrix`
- L3 ↔ `gating-fusion` (Fig 8)
- L4 ↔ `hrf-alignment` (Fig 6)

## 6. 常见操作

| 想要 | 操作 |
| --- | --- |
| 强调底部数据规模 | Inspiration → "陡峭" |
| 弱化层级差 | Inspiration → "扁平" (所有 value=0.85) |
| 倒置强调 | Inspiration → "倒置强调" |
| 改某层标题 | Inspector → 「层 X」组 |
| 改右侧引文 | Inspector → 「层 X」→ 「右侧注释」 |

## 7. 代码 anchor

- 梯形几何：`layerGeoms = useMemo(...)`
- 右侧注释引线：`cfg.showAnnotations ? cfg.layers.map(...)` 段
