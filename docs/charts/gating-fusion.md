# Gating Fusion · 模块逐讲

> 对应 chart：`src/charts/gating-fusion/index.tsx`

论文 **Fig. 8**：把 §3.6 门控融合公式画成块图。

---

## 1. 元素 (6 个模块)

| id | 内容 |
| --- | --- |
| `eeg` | 输入 $h^E$ (Eq. 22) |
| `fnirs` | 输入 $h^F$ (Eq. 22) |
| `concat` | $[h^E \Vert h^F]$ |
| `gate` | $g = \sigma(W_g[h^E\Vert h^F]+b_g)$ |
| `fuse` | $h^{\rm fuse} = g\odot h^E + (1-g)\odot h^F$ |
| `head` | $\hat{y} \in [0, 1]$ |

5 条带箭头连接，**自动吸附**到模块矩形最近边的中点（snap-to-rect）：拖任何模块，箭头自动重新对齐——不用手动调路径。

## 2. 控制

- **简单模式**：$g$ 滑块 (0..1)、6 个模块标题、底部图例开关
- **专家模式**：每个模块的标题 / 正文 (KaTeX) / 填充 / 描边 / 坐标 / 尺寸；EEG / fNIRS 边色；底部图例文本 + 对齐；字号

随 $g$ 实时变化：
- EEG 箭头颜色 → $g\to 1$ 时变深，$g\to 0$ 时灰化
- fNIRS 箭头颜色 → 反向
- 底部图例右侧自动写"EEG 主导 / fNIRS 主导 / 互补融合"

## 3. 数学

$$g = \sigma(W_g[h^E \Vert h^F] + b_g)$$

$$h^{\rm fuse} = g \odot h^E + (1 - g) \odot h^F$$

退化情况：
- $g \to 1$ → $h^{\rm fuse} = h^E$ (EEG only)
- $g \to 0$ → $h^{\rm fuse} = h^F$ (fNIRS only)
- $g = 0.5$ → 等权融合

## 4. Inspector

- $g$ slider (0..1, step 0.01)
- 每个模块 6 字段
- EEG / fNIRS 边色
- 底部图例 (文本 / 对齐 / 显隐)
- 5 个字号 (主标题 / 模块标题 / 模块正文 / 边标签 / 图例)

## 5. 跟其他图的关系

- 上游：`gat-attention` (Fig 7) 输出 → 这里的 $h^E$
- 下游：`event-decoding` (Fig 10) 取 $\hat{y}$ → 阈值 → 闭运算
- 跟 `architecture-overall` (Fig 1) 一致：这是 Fig 1 中"Fusion"那一格的 zoom-in

## 6. 常见操作

| 想要 | 操作 |
| --- | --- |
| 重排模块 | 拖任意模块 → 5 条箭头自动跟 |
| 复位布局 | Inspiration → "复位布局" |
| EEG 主导 截图 | Inspiration → "EEG 主导" (g=0.9) |
| 改模块颜色 | Expert → 模块 → 「填充色 / 描边色」 |
| 改公式 | Expert → 模块 → 「正文」(支持 KaTeX) |

## 7. 代码 anchor

- snap-to-rect：`function snapToRect(...)` `function midOf(...)`
- 边几何：`arrowGeoms = useMemo(...)`
- 颜色混合：`function mixHex(...)`
