/**
 * Python emitter for training-curves: train/val loss + val
 * AUPRC/AUC across epochs, with the early-stop epoch annotated.
 */
import { pyList, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface TrainingCurvesPythonInput {
  title: string;
  caption: string;
  epochs: ReadonlyArray<number>;
  trainLoss: ReadonlyArray<number>;
  valLoss: ReadonlyArray<number>;
  valAuprc: ReadonlyArray<number>;
  valAuc: ReadonlyArray<number>;
  earlyStopEpoch: number;
  showEarlyStop: boolean;
  showTrainLoss: boolean;
  showValLoss: boolean;
  showAuprc: boolean;
  showAuc: boolean;
  lineWidth: number;
}

export function emitTrainingCurvesPython(
  input: TrainingCurvesPythonInput,
): string {
  const {
    title,
    caption,
    epochs,
    trainLoss,
    valLoss,
    valAuprc,
    valAuc,
    earlyStopEpoch,
    showEarlyStop,
    showTrainLoss,
    showValLoss,
    showAuprc,
    showAuc,
    lineWidth,
  } = input;
  return `${pythonHeader({
    title,
    caption,
    description: 'Training & validation curves with early-stop annotation.',
  })}

EPOCHS = np.array(${pyList(epochs)})
TRAIN_LOSS = np.array(${pyList(trainLoss)})
VAL_LOSS = np.array(${pyList(valLoss)})
VAL_AUPRC = np.array(${pyList(valAuprc)})
VAL_AUC = np.array(${pyList(valAuc)})
EARLY_STOP = ${earlyStopEpoch}
LW = ${lineWidth}
SHOW_ES = ${showEarlyStop ? 'True' : 'False'}
SHOW_TL = ${showTrainLoss ? 'True' : 'False'}
SHOW_VL = ${showValLoss ? 'True' : 'False'}
SHOW_AUPRC = ${showAuprc ? 'True' : 'False'}
SHOW_AUC = ${showAuc ? 'True' : 'False'}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6), constrained_layout=True)
    ax_l, ax_m = axes
    if SHOW_TL:
        ax_l.plot(EPOCHS, TRAIN_LOSS, color="#1f77b4", linewidth=LW, label="Train loss")
    if SHOW_VL:
        ax_l.plot(EPOCHS, VAL_LOSS, color="#ff7f0e", linewidth=LW, label="Val loss")
    if SHOW_ES:
        ax_l.axvline(EARLY_STOP, color="#9ca3af", linestyle="--", label=f"Early stop @ epoch {EARLY_STOP}")
    ax_l.set_xlabel("Epoch")
    ax_l.set_ylabel("Loss")
    ax_l.set_title("Loss")
    ax_l.legend(fontsize=9)
    ax_l.grid(alpha=0.2)

    if SHOW_AUPRC:
        ax_m.plot(EPOCHS, VAL_AUPRC, color="#2ca02c", linewidth=LW, label="Val AUPRC")
    if SHOW_AUC:
        ax_m.plot(EPOCHS, VAL_AUC, color="#9467bd", linewidth=LW, label="Val AUROC")
    if SHOW_ES:
        ax_m.axvline(EARLY_STOP, color="#9ca3af", linestyle="--")
    ax_m.set_xlabel("Epoch")
    ax_m.set_ylabel("Score")
    ax_m.set_ylim(0, 1)
    ax_m.set_title("Validation metrics")
    ax_m.legend(fontsize=9)
    ax_m.grid(alpha=0.2)

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
