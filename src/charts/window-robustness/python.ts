/**
 * Python emitter for window-length robustness — two side-by-side
 * panels: event sensitivity vs. window-length and detection
 * latency vs. window-length, one curve per method.
 */
import { pyList, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface WindowRobustnessPythonInput {
  title: string;
  caption: string;
  windows: ReadonlyArray<number>;
  series: ReadonlyArray<{
    name: string;
    sensitivity: ReadonlyArray<number>;
    latency: ReadonlyArray<number>;
    color: string;
    highlight: boolean;
  }>;
  showMarkers: boolean;
  showOursBand: boolean;
}

export function emitWindowRobustnessPython(
  input: WindowRobustnessPythonInput,
): string {
  const { title, caption, windows, series, showMarkers, showOursBand } = input;
  const blocks = series
    .map(
      (s) =>
        `    {"name": ${pyStr(s.name)}, "color": ${pyStr(s.color)}, "highlight": ${s.highlight ? 'True' : 'False'}, "sens": np.array(${pyList(s.sensitivity)}), "lat": np.array(${pyList(s.latency)})},`,
    )
    .join('\n');
  return `${pythonHeader({
    title,
    caption,
    description:
      'Window-length robustness: sensitivity & latency vs. analysis-window length.',
  })}

WINDOWS = np.array(${pyList(windows)})
SERIES = [
${blocks}
]
SHOW_MARKERS = ${showMarkers ? 'True' : 'False'}
SHOW_OURS_BAND = ${showOursBand ? 'True' : 'False'}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}
WIN_LABEL = ${pyStrList(['Analysis window length (s)'])}


def render() -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6), constrained_layout=True)
    ax_se, ax_la = axes
    for s in SERIES:
        marker = "o" if SHOW_MARKERS else None
        lw = 2.5 if s["highlight"] else 1.5
        ls = "-" if s["highlight"] else "--"
        ax_se.plot(WINDOWS, s["sens"], color=s["color"], linewidth=lw, linestyle=ls, marker=marker, label=s["name"])
        if s["highlight"] and SHOW_OURS_BAND:
            band = s["sens"] * 0.04
            ax_se.fill_between(WINDOWS, s["sens"] - band, s["sens"] + band, color=s["color"], alpha=0.15)
        ax_la.plot(WINDOWS, s["lat"], color=s["color"], linewidth=lw, linestyle=ls, marker=marker, label=s["name"])
    ax_se.set_xlabel(WIN_LABEL[0])
    ax_se.set_ylabel("Event sensitivity")
    ax_se.set_title("(a) Sensitivity")
    ax_se.set_ylim(0, 1)
    ax_se.legend(fontsize=9)
    ax_se.grid(alpha=0.2)
    ax_la.set_xlabel(WIN_LABEL[0])
    ax_la.set_ylabel("Detection latency (s)")
    ax_la.set_title("(b) Latency")
    ax_la.legend(fontsize=9)
    ax_la.grid(alpha=0.2)
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
