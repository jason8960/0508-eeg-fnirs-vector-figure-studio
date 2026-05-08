# Event Decoding · 模块逐讲

> 对应 chart：`src/charts/event-decoding/index.tsx`

论文 **Fig. 10**：把"帧级 softmax → 阈值 → 形态学闭运算 → 事件窗口"的解码三步走画成 3 联板。

---

## 1. 元素 (3 个面板)

| 面板 | 内容 |
| --- | --- |
| (a) | 帧级后验 $\hat{y}_{(t)}$ + 红色虚线阈值 $\theta_d$ |
| (b) | 二值掩膜：raw（灰色）+ closing 后（绿色） |
| (c) | 最终事件窗口（紫色矩形）+ 编号 + 起止时间 |

3 个面板共享 X 时间轴。

## 2. 控制

- **简单模式**：$\theta_d$ 滑块 (0..1)、$W_{\min}$ 滑块 (0..30 s)、时间窗 t_min/t_max、网格 / 阈值线 / 注释开关
- **专家模式**：标题 / 3 个子标题 / 4 个轴标签；每个种子段 (中心 / 宽度 / 峰值)；随机种子；5 个字号

侧栏底部实时显示"检测到 N 个事件"。

## 3. 数学

阈值化：

$$m(t) = \mathbb{1}[\hat{y}(t) \geq \theta_d]$$

形态学闭运算 (dilation → erosion，结构元素长度 $W_{\min}$ 秒)：

$$m'(t) = (m \oplus B_{W_{\min}}) \ominus B_{W_{\min}}$$

事件窗：$m'$ 的连通分量 → 区间 $[t_s, t_e]$。

## 4. Inspector

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `theta` | 0.5 | 阈值 |
| `Wmin` | 10 s | closing 长度 |
| `tMin / tMax` | 0 / 120 | 时间窗 |
| `segs[]` | 4 段 | 种子段（合成 GT 后验源） |
| `seed` | 7777 | 噪声种子 |

## 5. 跟其他图的关系

- 上游：`gating-fusion` (Fig 8) 的 $\hat{y}$ 进 (a)
- 跟 `roc-pr` 互补：那张是按阈值汇总；这张是单条 trace
- 跟 `confusion-matrix` 互补：那张是事件级 TP/FP；这张展示事件是怎么形成的

## 6. 常见操作

| 想要 | 操作 |
| --- | --- |
| 高阈值少漏报 | Inspiration → "高阈值" (θ=0.7, W=5) |
| 强合并 | Inspiration → "强合并" (W=20) |
| 弱合并保留碎片 | Inspiration → "弱合并" (W=2) |
| 看 closing 救场 | Inspiration → "强噪声" (换种子 + 降阈) |
| 改子标题 | Expert → 「标题与小标题」 |
| 改种子段 | Expert → 「种子段」 |

## 7. 代码 anchor

- 形态学闭运算：`function morphClosing(...)`
- 后验合成：`posterior = useMemo(...)` + `function bump(...)`
- 事件提取：`function maskToWindows(...)`
