# HRF Alignment · 模块逐讲

> 对应 chart：`src/charts/hrf-alignment/index.tsx`

论文 **Fig. 6**：双面板对照 $\tau_j$ 校准前 / 后的 EEG ↔ fNIRS 互相关。证明"per-channel 时间偏移"是论文真实需要的。

---

## 1. 元素

- **(a) 校准前**：EEG 真值 + 滞后的 HbO / HbR；右上 Pearson $\rho$ 框
- **(b) 校准后 ($\tau_j$ 应用)**：HbO / HbR 沿时间轴平移 $\tau_j$；$\rho$ 升高
- **公共时间轴**：$t \in [0, T]$
- **左下图例**：颜色 ↔ 信号映射；可拖动
- **黄色注释**：解释"$\tau_j > 0$ 表示血氧响应滞后于 EEG"，可拖动

## 2. 控制

- **简单模式**：$\tau_j$ 滑块（HbO / HbR 各一个）、信号噪声 SNR、随机种子
- **专家模式**：曲线颜色 / 粗细、相关性框位置、字号

## 3. 数学

校准后信号：

$$x^F_j(t) \;\leftarrow\; x^F_j(t - \tau_j)$$

Pearson 相关：

$$\rho(x^E, x^F) = \frac{\sum_t (x^E_t - \bar{x}^E)(x^F_t - \bar{x}^F)}{\sqrt{\sum_t (x^E_t - \bar{x}^E)^2}\sqrt{\sum_t (x^F_t - \bar{x}^F)^2}}$$

## 4. Inspector

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `tauHbO` | 4.0 s | HbO 偏移 |
| `tauHbR` | 4.5 s | HbR 偏移 |
| `snr` | 8 dB | 合成噪声 |
| `seed` | 1234 | Mulberry32 随机种子 |

## 5. 跟其他图的关系

- 上游：`hrf-kernel` (Fig 5) 解释 $\tau_j$ 怎么参数化
- 下游：`gat-attention` (Fig 7) 用对齐后的特征做 attention
- 跟 `nvc-alignment` (内部 viz 图) 互补：那张是同步上的"为什么需要校准"

## 6. 常见操作

| 想要 | 操作 |
| --- | --- |
| 看完美对齐 | $\tau_{HbO}=\tau_{HbR}=0$ → 与默认错位对照 |
| 看强滞后 | $\tau_{HbO}=8, \tau_{HbR}=10$ |
| 换样本 | 改 `seed` |
| 改通道名 | Inspector → 「曲线」组 → 编辑 label |

## 7. 代码 anchor

- 合成 EEG / HbO / HbR：`function syntheticTraces(...)` 段
- Pearson 计算：`function pearson(...)`
- 双面板布局：`PanelChrome` 复用
