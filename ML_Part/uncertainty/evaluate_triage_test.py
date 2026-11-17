"""
uncertainty/evaluate_triage_test.py - Person 3
ONE-TIME evaluation of the frozen triage configuration on the TEST set.
- verifies the config hash (refuses if triage_config.json was edited)
- refuses to run a second time (writes uncertainty/test_evaluation_lock.json)
Run from project root:  python uncertainty/evaluate_triage_test.py
"""
from datetime import datetime
from pathlib import Path
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "uncertainty"))
import triage as tr
from densenet_utils import CACHE_DIR

CFG_PATH = ROOT / "uncertainty/triage_config.json"
LOCK = ROOT / "uncertainty/test_evaluation_lock.json"
OUT = ROOT / "figures/uncertainty"
OUT.mkdir(parents=True, exist_ok=True)

# ---- guards ----
cfg = json.load(open(CFG_PATH))
if tr.config_hash(cfg) != cfg["config_sha256"]:
    sys.exit("STOP: triage_config.json was modified after freezing (hash mismatch).")
if LOCK.exists():
    sys.exit("STOP: the test evaluation was already run:\n" + LOCK.read_text())

# ---- apply the frozen configuration to the test predictions ----
d = dict(np.load(CACHE_DIR / "mc_test.npz"))
y, pred = d["y"], d["pred"]
correct = pred == y
mel = cfg["mel_index"]
zone = tr.triage(d[cfg["score"]], cfg)
zone = tr.apply_melanoma_rule(zone, d["mean_probs"], pred, cfg["melanoma_cutoff"], mel)


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return centre - half, centre + half


n, n_wrong = len(y), int((~correct).sum())
rows = []
for z in (tr.GREEN, tr.YELLOW, tr.RED):
    m = zone == z
    k, cnt = int(correct[m].sum()), int(m.sum())
    lo, hi = wilson(k, cnt)
    rows.append({"zone": z, "images": cnt, "share_%": round(100 * cnt / n, 1),
                 "accuracy": round(k / cnt, 4), "acc_ci95_low": round(lo, 3),
                 "acc_ci95_high": round(hi, 3), "errors": cnt - k,
                 "errors_share_%": round(100 * (cnt - k) / n_wrong, 1)})
tab = pd.DataFrame(rows)
print(f"=== TEST SET, frozen config (hash {cfg['config_sha256'][:12]}...) ===")
print(f"images: {n} | overall accuracy: {correct.mean():.4f}")
print(tab.to_string(index=False))
print("(95% intervals are Wilson intervals; they ignore that several images can "
      "come from one lesion, so they are slightly too narrow)")

is_mel = y == mel
missed = is_mel & ~correct
print("\nMelanoma: total %d | wrongly predicted %d | of these in GREEN %d | "
      "in YELLOW/RED %d" % (is_mel.sum(), missed.sum(),
                            (missed & (zone == tr.GREEN)).sum(),
                            (missed & (zone != tr.GREEN)).sum()))

# ---- save outputs ----
tab.to_csv(OUT / "triage_zones_test.csv", index=False)
colors = ["green", "gold", "red"]
fig, ax = plt.subplots(1, 2, figsize=(11, 4.5))
ax[0].bar(tab["zone"], tab["share_%"], color=colors)
ax[0].set_ylabel("% of test images"); ax[0].set_title("Share of images per zone")
ax[1].bar(tab["zone"], tab["accuracy"] * 100, color=colors)
ax[1].set_ylim(0, 100); ax[1].set_ylabel("Accuracy (%)")
ax[1].set_title("Accuracy per zone (test, frozen config)")
for a, col, mult in ((ax[0], "share_%", 1), (ax[1], "accuracy", 100)):
    for i, v in enumerate(tab[col] * mult):
        a.text(i, v + 1, f"{v:.1f}", ha="center")
plt.tight_layout(); plt.savefig(OUT / "triage_zones_test.png", dpi=200); plt.close()

score = d[cfg["score"]]
bins = np.linspace(0, score.max() * 1.02, 41)
fig, ax = plt.subplots(figsize=(9, 5))
ax.axvspan(0, cfg["t_green"], color="green", alpha=0.12, label="GREEN band")
ax.axvspan(cfg["t_green"], cfg["t_red"], color="gold", alpha=0.18, label="YELLOW band")
ax.axvspan(cfg["t_red"], bins[-1], color="red", alpha=0.12, label="RED band")
ax.hist(score, bins=bins, color="steelblue", edgecolor="white")
ax.set_xlabel("Uncertainty score (std of predicted-class probability, T=50)")
ax.set_ylabel("Number of test images")
ax.set_title("Uncertainty distribution with frozen triage bands (test set)\n"
             "the melanoma safety rule can move extra images from GREEN to YELLOW")
ax.legend(); plt.tight_layout()
plt.savefig(OUT / "uncertainty_histogram_triage.png", dpi=200); plt.close()

LOCK.write_text(json.dumps({"evaluated_at": datetime.now().isoformat(timespec="seconds"),
                            "config_sha256": cfg["config_sha256"]}, indent=2))
print("\nSaved triage_zones_test.csv/.png and uncertainty_histogram_triage.png")
print("Lock file written. This evaluation cannot be run again. STEP D FINISHED")