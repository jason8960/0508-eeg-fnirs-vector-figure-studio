# HRF Kernel · 模块逐讲

> 对应 chart：`src/charts/hrf-kernel/index.tsx`

论文 **Fig. 5**：把 HRF 软位移 $\tau_j$ 的几何意义画出来——同一个 canonical HRF $h_0(t)$，乘上一组可学习的 per-channel 时间偏移 $\tau_j$，得到 $h_j(t) = h_0(t - \tau_j)$。

---

## 1. 节点 / 元素

| 元素 | 说明 |
| --- | --- |
| 中心曲线 (蓝粗) | canonical HRF $h_0(t)$（双 gamma） |
| 多条偏移曲线 (灰渐变) | $h_0(t-\tau)$，按 $\tau$ 在 `[τ_min, τ_max]` 等步长采样 |
| 主轴 | $t$ (s) vs amplitude |
| 红色阈值线 | 当前选中的 $\tau$ 值，鼠标拖动滑块时实时移动 |
| 黄色注释框 | 解释 "$h_j(t) = h_0(t - \tau_j)$ 是端到端可学习的"，可拖动 |

每个文本（标题、副标题、轴标签、注释、曲线名）都从 Inspector 单独编辑。

## 2. 控制

- **简单模式**：$\tau$ 滑块、扫描步长、显示/隐藏曲线族
- **专家模式**：曲线族颜色 / 粗细 / alpha / dashed、$\tau$ 范围、HRF 双 gamma 形状参数 (peak / undershoot / dispersion)、所有文本的字号 + 对齐

## 3. 数学

$$h_0(t) = \frac{t^{a_1-1} e^{-t/b_1}}{b_1^{a_1}\Gamma(a_1)} - c \cdot \frac{t^{a_2-1} e^{-t/b_2}}{b_2^{a_2}\Gamma(a_2)}$$

$$h_j(t) = h_0(t - \tau_j), \quad \tau_j \in [\tau_{\min}, \tau_{\max}]$$

$\tau_j$ 通过反向传播学习，per-channel 独立。

## 4. Inspector

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `tauStep` | 0.5 s | $\tau$ 扫描步长 |
| `tauMin / tauMax` | -3 / 3 | 范围 |
| `peak1 / peak2` | 6 / 16 | 双 gamma 峰位 |
| `dispersion1/2` | 1 / 1 | 双 gamma 形状 |
| `c` | 1/6 | undershoot 系数 |

## 5. 跟其他图的关系

- `hrf-alignment` (Fig 6) 把这里学出来的 $\tau_j$ **应用**到具体通道的 EEG / fNIRS 信号
- `heterogeneous-graph-construction` (Fig 4) 在 cross 边末端挂了 $\tau_j$ 标签——指的就是这里这个量
- `gat-attention` (Fig 7) 不直接用 $\tau$，但 attention 是基于 $\tau$ 已经对齐过的 representation 算的

## 6. 常见操作

| 想要 | 操作 |
| --- | --- |
| 加密 / 稀疏曲线族 | Inspector → `tauStep` 调小 / 调大 |
| 改 HRF 双 gamma 形状 | Inspector → 「HRF 形状」组 |
| 截一张"只有中心曲线"的图 | Inspector → 关掉 family 可见性 |
| 改文字 | Inspector → 「标题 / 副标题 / 注释」组 |
| 导出 SVG | 右上 ExportToolbar |

## 7. 代码 anchor

- HRF 双 gamma 公式：`src/charts/hrf-kernel/index.tsx` `function hrf(...)`
- $\tau$ 扫描渲染：`tauSamples = useMemo(...)` 段
- 滑块联动红色阈值线：`thresholdLine` 段
