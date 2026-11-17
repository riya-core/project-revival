"""
uncertainty/run_step6.py - Person 3
Evaluation report WITHOUT triage: metrics table, confusion matrix, histograms.
Outputs go to figures/uncertainty/.
Run from project root:  python uncertainty/run_step6.py
"""
from pathlib import Path
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, classification_report,
                             confusion_matrix, precision_recall_fscore_support)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "uncertainty"))
from densenet_utils import CACHE_DIR, CLASS_NAMES

OUT = ROOT / "figures" / "uncertainty"
OUT.mkdir(parents=True, exist_ok=True)
T = 50

d = dict(np.load(CACHE_DIR / "mc_test.npz"))
y, pred, score = d["y"], d["pred"], d["std_pred"]
correct = pred == y
labels = list(range(7))

# ---------------- 1. metrics table ----------------
print("=== OVERALL (TEST, MC Dropout mean prediction, T=%d) ===" % T)
acc = accuracy_score(y, pred)
print("samples: %d | accuracy: %.4f" % (len(y), acc))
p, r, f, s = precision_recall_fscore_support(y, pred, labels=labels, zero_division=0)
table = pd.DataFrame({"precision": p, "recall": r, "f1": f, "support": s},
                     index=CLASS_NAMES)
for avg in ("macro", "weighted"):
    pa, ra, fa, _ = precision_recall_fscore_support(y, pred, labels=labels,
                                                    average=avg, zero_division=0)
    table.loc[f"{avg} avg"] = [pa, ra, fa, int(s.sum())]
table.loc["accuracy"] = [acc, acc, acc, int(s.sum())]
print("\n=== PER-CLASS METRICS ===")
print(table.round(4).to_string())
table.round(4).to_csv(OUT / "metrics_table.csv")

rep = classification_report(y, pred, labels=labels, target_names=CLASS_NAMES,
                            output_dict=True, zero_division=0)
assert abs(rep["macro avg"]["f1-score"] - table.loc["macro avg", "f1"]) < 1e-9
assert abs(rep["weighted avg"]["f1-score"] - table.loc["weighted avg", "f1"]) < 1e-9

# ---------------- 2. confusion matrix ----------------
cm = confusion_matrix(y, pred, labels=labels)
assert cm.sum() == len(y) and np.trace(cm) == correct.sum()
cm_norm = cm / cm.sum(axis=1, keepdims=True)
fig, axes = plt.subplots(1, 2, figsize=(16, 7))
for ax, M, title, fmt in ((axes[0], cm, "Counts", "d"),
                          (axes[1], cm_norm, "Row-normalised (recall per class)", ".2f")):
    ax.imshow(M, cmap="Blues")
    ax.set_xticks(labels); ax.set_xticklabels(CLASS_NAMES, rotation=45)
    ax.set_yticks(labels); ax.set_yticklabels(CLASS_NAMES)
    ax.set_xlabel("Predicted"); ax.set_ylabel("True"); ax.set_title(title)
    thr = M.max() / 2
    for i in labels:
        for j in labels:
            ax.text(j, i, format(M[i, j], fmt), ha="center", va="center",
                    color="white" if M[i, j] > thr else "black", fontsize=9)
fig.suptitle("DenseNet121 + MC Dropout - Test Confusion Matrix (lesion-level split)")
plt.tight_layout()
plt.savefig(OUT / "confusion_matrix.png", dpi=200, bbox_inches="tight")
plt.close()

off = sorted(((cm[i, j], CLASS_NAMES[i], CLASS_NAMES[j])
              for i in labels for j in labels if i != j), reverse=True)
print("\n=== MOST CONFUSED PAIRS (true -> predicted) ===")
for n, t, pr in off[:5]:
    print(f"  {t:>5} -> {pr:<5}: {n} images")

# ---------------- 3. uncertainty histograms (no triage bands) ----------------
bins = np.linspace(0, score.max() * 1.02, 41)

fig, ax = plt.subplots(figsize=(9, 5))
ax.hist(score, bins=bins, color="steelblue", edgecolor="white")
ax.set_xlabel("Uncertainty score (std of predicted-class probability, T=50)")
ax.set_ylabel("Number of test images")
ax.set_title("Uncertainty distribution (test set)")
plt.tight_layout()
plt.savefig(OUT / "uncertainty_histogram.png", dpi=200); plt.close()

fig, ax = plt.subplots(figsize=(9, 5))
ax.hist(score[correct], bins=bins, alpha=0.65, color="tab:green",
        label=f"correct ({correct.sum()})", density=True)
ax.hist(score[~correct], bins=bins, alpha=0.65, color="tab:red",
        label=f"wrong ({(~correct).sum()})", density=True)
ax.set_xlabel("Uncertainty score"); ax.set_ylabel("Density (each group normalised)")
ax.set_title("Uncertainty: correct vs wrong predictions (test set)")
ax.legend(); plt.tight_layout()
plt.savefig(OUT / "uncertainty_correct_vs_wrong.png", dpi=200); plt.close()

print("\nFiles in", OUT)
for fp in sorted(OUT.iterdir()):
    print("  ", fp.name)
print("\nSTEP6 (no triage) FINISHED")