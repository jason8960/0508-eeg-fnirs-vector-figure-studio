# GAT Attention · 模块逐讲

> 对应 chart：`src/charts/gat-attention/index.tsx`

论文 **Fig. 7**：放大一个 GAT 节点 $i$ 和它的 $K$ 个邻居 $j_1, \dots, j_K$，把 attention $\alpha_{ij}$ 怎么算 + 怎么用都画出来。

---

## 1. 元素

- **中心节点 $h_i$**：圆形高亮
- **6 个邻居 $h_{j_1} \dots h_{j_6}$**：环绕一圈
- **6 条边**：粗细 ∝ $\alpha_{ij}$，颜色随 $\alpha$ 渐变（灰→紫）
- **每条边的 KaTeX 标签**：$\alpha_{i,j_k}$ 数值
- **公式框** (可拖)：softmax + attention 公式（默认在右侧）
- **图例 + 颜色条**：alpha → color；可拖动
- **黄色注释**：可编辑文字注解

每个节点位置独立保存 → 拖动会持久化。

## 2. 控制

- **简单模式**：每条边的 logit 滑块；调一条立刻看到 softmax 重新归一化
- **专家模式**：节点位置、半径、颜色；公式框文本；图例位置；字号

## 3. 数学

$$\alpha_{ij} = \frac{\exp(\mathrm{LeakyReLU}(\mathbf{a}^{\top}[\mathbf{W}h_i \,\Vert\, \mathbf{W}h_j]))}{\sum_{k\in\mathcal{N}(i)}\exp(\mathrm{LeakyReLU}(\mathbf{a}^{\top}[\mathbf{W}h_i \,\Vert\, \mathbf{W}h_k]))}$$

聚合：

$$h_i' = \sigma\!\left(\sum_{j\in\mathcal{N}(i)} \alpha_{ij} \mathbf{W} h_j\right)$$

数值稳定 softmax：先减最大 logit 再 exp。

## 4. Inspector

- 6 路 logit (滑块, [-4, 4])
- 中心节点坐标 + 半径
- 6 个邻居各自的 (cx, cy, r, label)
- 边样式：基础宽 / α-增益 / 最低 alpha
- 颜色条：min / max 颜色

## 5. 跟其他图的关系

- 跟 `heterogeneous-graph-construction` (Fig 4) 配对：那张是"图建出来的样子"，这张是"GAT 一层在某个节点上做了什么"
- 跟 `gating-fusion` (Fig 8) 配对：attention 输出聚合 → 进入门控融合
- 跟 `hegat-map` 互补：前者是单节点 zoom-in，后者是整张图 attention heatmap

## 6. 常见操作

| 想要 | 操作 |
| --- | --- |
| 改邻居数 | 这一版固定 K=6；要改去 `DEFAULT_NEIGHBOURS` 数组 |
| 让某条边主导 | 把它的 logit 调到 +4，其他 -2 |
| 看 uniform attention | 所有 logit 同值 → α=1/6 |
| 改节点名 | Inspector → 「邻居」组 → label |
| 截屏 | ExportToolbar → SVG |

## 7. 代码 anchor

- softmax：`function softmax(...)`
- 边几何：`edgeGeoms = useMemo(...)`
- 颜色映射：`function alphaToColour(...)`
