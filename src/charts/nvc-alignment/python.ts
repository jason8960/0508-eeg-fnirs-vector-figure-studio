/**
 * Python emitter for the NVC (neurovascular coupling) alignment figure.
 *
 * The JS chart shows EEG, ΔHbO, and ΔHbR time-series on a dual-axis
 * panel with state-band shading and an optional α-band envelope. The
 * script reproduces this with `twinx()`, `axvspan` for bands and
 * standard `plot()` calls. All four time-series are inlined directly
 * (after JS-side decimation) so the script doesn't need to re-run any
 * filtering pipeline.
 */
import { pyList, pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface NvcBandPython {
  start: number;
  end: number;
  kind: 'inter' | 'pre' | 'ictal';
}

export interface NvcAlignmentPythonInput {
  title: string;
  caption: string;
  duration: number;
  eegT: ReadonlyArray<number>;
  eegV: ReadonlyArray<number>;
  hboT: ReadonlyArray<number>;
  hboV: ReadonlyArray<number>;
  hbrT: ReadonlyArray<number>;
  hbrV: ReadonlyArray<number>;
  /** Optional α-band envelope (decimated to fNIRS axis). */
  alphaT: ReadonlyArray<number> | null;
  alphaV: ReadonlyArray<number> | null;
  showBands: boolean;
  bands: ReadonlyArray<NvcBandPython>;
  legendEeg: string;
  legendHbo: string;
  legendHbr: string;
  legendAlpha: string;
  hbrCoupling: number;
}

export function emitNvcAlignmentPython(input: NvcAlignmentPythonInput): string {
  const {
    title,
    caption,
    duration,
    eegT,
    eegV,
    hboT,
    hboV,
    hbrT,
    hbrV,
    alphaT,
    alphaV,
    showBands,
    bands,
    legendEeg,
    legendHbo,
    legendHbr,
    legendAlpha,
    hbrCoupling,
  } = input;

  const bandLines = bands
    .map(
      (b) =>
        `    {"start": ${pyNum(b.start)}, "end": ${pyNum(b.end)}, "kind": ${pyStr(b.kind)}},`,
    )
    .join('\n');
  const haveAlpha = alphaT !== null && alphaV !== null && alphaT.length > 0;

  return `${pythonHeader({
    title,
    caption,
    description:
      'EEG / ΔHbO / ΔHbR neurovascular coupling alignment with optional α-band envelope and state-band shading.',
  })}DURATION = ${pyNum(duration)}
HBR_COUPLING = ${pyNum(hbrCoupling)}
SHOW_BANDS = ${showBands ? 'True' : 'False'}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}

EEG_T = np.array(${pyList(eegT)})
EEG_V = np.array(${pyList(eegV)})
HBO_T = np.array(${pyList(hboT)})
HBO_V = np.array(${pyList(hboV)})
HBR_T = np.array(${pyList(hbrT)})
HBR_V = np.array(${pyList(hbrV)})
ALPHA_T = np.array(${haveAlpha ? pyList(alphaT as ReadonlyArray<number>) : '[]'})
ALPHA_V = np.array(${haveAlpha ? pyList(alphaV as ReadonlyArray<number>) : '[]'})
HAVE_ALPHA = ${haveAlpha ? 'True' : 'False'}

BANDS = [
${bandLines}
]

BAND_COLORS = {
    "inter": (0.49, 0.83, 0.99, 0.12),
    "pre": (0.98, 0.75, 0.14, 0.18),
    "ictal": (0.94, 0.27, 0.27, 0.20),
}
BAND_LABELS = {"inter": "Inter-ictal", "pre": "Pre-ictal", "ictal": "Ictal"}

LEGEND_EEG = ${pyStr(legendEeg)}
LEGEND_HBO = ${pyStr(legendHbo)}
LEGEND_HBR = ${pyStr(legendHbr)}
LEGEND_ALPHA = ${pyStr(legendAlpha)}


def render() -> None:
    fig, ax_eeg = plt.subplots(figsize=(11.0, 4.6), constrained_layout=True)
    ax_hb = ax_eeg.twinx()

    if SHOW_BANDS:
        for b in BANDS:
            ax_eeg.axvspan(b["start"], b["end"], color=BAND_COLORS[b["kind"]], zorder=0)
            mid = 0.5 * (b["start"] + b["end"])
            ax_eeg.text(
                mid,
                ax_eeg.get_ylim()[1] * 0.96 if False else 0.97,
                BAND_LABELS[b["kind"]],
                ha="center",
                va="top",
                fontsize=9,
                color="#0d1117",
                transform=ax_eeg.get_xaxis_transform(),
                zorder=3,
            )

    ax_eeg.plot(EEG_T, EEG_V, color="#0d1117", linewidth=0.7, alpha=0.85, label=LEGEND_EEG)
    ax_eeg.set_xlabel("Time (s)")
    ax_eeg.set_ylabel(LEGEND_EEG)
    ax_eeg.set_xlim(0, DURATION)
    ax_eeg.spines["top"].set_visible(False)

    ax_hb.plot(HBO_T, HBO_V, color="#dc2626", linewidth=2, label=LEGEND_HBO)
    ax_hb.plot(HBR_T, HBR_V, color="#1d4ed8", linewidth=2, label=LEGEND_HBR)
    ax_hb.set_ylabel("$\\\\Delta$HbO/HbR ($\\\\mu$mol/L)")
    ax_hb.spines["top"].set_visible(False)

    if HAVE_ALPHA:
        ax_hb.plot(
            ALPHA_T,
            ALPHA_V,
            color="#16a34a",
            linewidth=1.6,
            linestyle=(0, (4, 3)),
            label=LEGEND_ALPHA,
        )

    lines_eeg, labels_eeg = ax_eeg.get_legend_handles_labels()
    lines_hb, labels_hb = ax_hb.get_legend_handles_labels()
    ax_eeg.legend(
        lines_eeg + lines_hb,
        labels_eeg + labels_hb,
        loc="upper right",
        fontsize=9,
        framealpha=0.92,
    )

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.02, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
