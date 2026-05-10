/**
 * Python emitter for the multi-method qualitative radar plot.
 * Captures per-axis scores for each method + the resolved palette
 * + display flags, and emits a polar-axes matplotlib figure.
 */
import { pyList, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface MethodRadarPythonInput {
  title: string;
  caption: string;
  axes: ReadonlyArray<string>;
  methods: ReadonlyArray<{
    name: string;
    scores: ReadonlyArray<number>;
    highlight: boolean;
    color: string;
  }>;
  showLegend: boolean;
  showLabels: boolean;
  showRings: boolean;
  highlightOnly: boolean;
  opacityOurs: number;
}

export function emitMethodRadarPython(
  input: MethodRadarPythonInput,
): string {
  const {
    title,
    caption,
    axes,
    methods,
    showLegend,
    showLabels,
    showRings,
    highlightOnly,
    opacityOurs,
  } = input;
  const blocks = methods
    .map(
      (m) =>
        `    {"name": ${pyStr(m.name)}, "color": ${pyStr(m.color)}, "highlight": ${m.highlight ? 'True' : 'False'}, "scores": np.array(${pyList(m.scores)})},`,
    )
    .join('\n');
  return `${pythonHeader({
    title,
    caption,
    description: 'Multi-method qualitative radar / spider chart.',
  })}

AXES = ${pyStrList(axes)}
METHODS = [
${blocks}
]
SHOW_LEGEND = ${showLegend ? 'True' : 'False'}
SHOW_LABELS = ${showLabels ? 'True' : 'False'}
SHOW_RINGS = ${showRings ? 'True' : 'False'}
HIGHLIGHT_ONLY = ${highlightOnly ? 'True' : 'False'}
FILL_ALPHA = ${opacityOurs}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    n = len(AXES)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
    angles += angles[:1]
    fig = plt.figure(figsize=(8.0, 7.4), constrained_layout=True)
    ax = fig.add_subplot(111, projection="polar")
    if not SHOW_RINGS:
        ax.set_yticklabels([])
        ax.set_yticks([])
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    if SHOW_LABELS:
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(AXES)
    else:
        ax.set_xticks([])
    ax.set_ylim(0, 1)
    for m in METHODS:
        if HIGHLIGHT_ONLY and not m["highlight"]:
            continue
        scores = np.concatenate([m["scores"], m["scores"][:1]])
        if m["highlight"]:
            ax.plot(angles, scores, color=m["color"], linewidth=2.5, label=m["name"])
            ax.fill(angles, scores, color=m["color"], alpha=FILL_ALPHA)
        else:
            ax.plot(angles, scores, color=m["color"], linewidth=1.2, linestyle="--", label=m["name"])
    if SHOW_LEGEND:
        ax.legend(loc="upper right", bbox_to_anchor=(1.4, 1.05), fontsize=9)
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.02, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
