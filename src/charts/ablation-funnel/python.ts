/**
 * Python emitter for the ablation contribution funnel.
 * Each step is rendered as a horizontal trapezoid whose width
 * scales with accuracy. Colours use a viridis-like ramp by
 * default, but the live colormap pick is captured as a list of
 * resolved hex strings so the script doesn't need scipy / cmap libs.
 */
import { pyList, pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface AblationFunnelPythonInput {
  title: string;
  caption: string;
  stepLabels: ReadonlyArray<string>;
  stepAccuracies: ReadonlyArray<number>;
  palette: ReadonlyArray<string>;
  fillOpacity: number;
}

export function emitAblationFunnelPython(
  input: AblationFunnelPythonInput,
): string {
  const { title, caption, stepLabels, stepAccuracies, palette, fillOpacity } =
    input;
  return `${pythonHeader({
    title,
    caption,
    description: 'Ablation funnel — trapezoid widths proportional to accuracy.',
  })}

LABELS = ${pyStrList(stepLabels)}
ACC = np.array(${pyList(stepAccuracies)})
PALETTE = ${pyStrList(palette)}
FILL_OPACITY = ${pyNum(fillOpacity)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, ax = plt.subplots(figsize=(9.0, 0.85 * len(LABELS) + 1.4), constrained_layout=True)
    max_acc = float(ACC.max())
    for i, (lab, a, c) in enumerate(zip(LABELS, ACC, PALETTE)):
        w_top = (a / max_acc) if i == 0 else (ACC[i] / max_acc)
        w_bot = (ACC[i + 1] / max_acc) if i + 1 < len(ACC) else w_top * 0.95
        y_top = -i
        y_bot = -i - 0.92
        x0_top = (1 - w_top) / 2
        x0_bot = (1 - w_bot) / 2
        poly = plt.Polygon(
            [(x0_top, y_top), (1 - x0_top, y_top), (1 - x0_bot, y_bot), (x0_bot, y_bot)],
            facecolor=c,
            edgecolor="#0d1117",
            linewidth=0.8,
            alpha=FILL_OPACITY,
        )
        ax.add_patch(poly)
        ax.text(0.5, (y_top + y_bot) / 2, f"{a:.3f}", ha="center", va="center", fontsize=12, fontweight="bold", color="white")
        ax.text(1.05, (y_top + y_bot) / 2, lab, ha="left", va="center", fontsize=10)
    ax.set_xlim(-0.05, 1.6)
    ax.set_ylim(-len(LABELS), 0.4)
    ax.axis("off")
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
