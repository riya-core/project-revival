"""
uncertainty/fit_triage_validation.py - Person 3
Builds the triage from VALIDATION data only, following the written protocol,
and freezes it in uncertainty/triage_config.json.
This script never opens any test file.
Run from project root:  python uncertainty/fit_triage_validation.py
"""
from datetime import datetime
from pathlib import Path
import json
import sys

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "uncertainty"))
import triage as tr
from densenet_utils import CACHE_DIR, CLASS_NAMES

# ---------------- protocol constants (fixed in advance) ----------------
SCORE, T, N_FOLDS = "std_pred", 50, 5
G_GRID = [0.90, 0.93, 0.95, 0.97]
R_GRID = [0.50, 0.60, 0.70]
CUTOFFS = [None, 0.20, 0.10, 0.05, 0.03, 0.02]
MIN_G, MIN_Y, MIN_R = 0.40, 0.15, 0.10     # minimum zone shares (out-of-fold)
TOL, GAP, MIN_GAIN = 0.02, 0.05, 2
MEL = CLASS_NAMES.index("mel")
C2I = {c: i for i, c in enumerate(CLASS_NAMES)}

# ---------------- load VALIDATION data only ----------------
val = dict(np.load(CACHE_DIR / "mc_val.npz"))
df = pd.read_csv(ROOT / "data/processed/lesion_split/val_metadata.csv")
assert "lesion_id" in df.columns, "val_metadata.csv has no lesion_id column"
assert len(df) == len(val["y"]), "metadata and cache differ in length"
assert (df["dx"].map(C2I).to_numpy() == val["y"]).all(), "row order mismatch"
groups = df["lesion_id"].to_numpy()
y, pred = val["y"], val["pred"]
score, probs = val[SCORE], val["mean_probs"]
correct = pred == y
n = len(y)
print(f"validation images: {n} | lesions: {len(set(groups))} | "
      f"accuracy: {correct.mean():.4f}")


def summarize(zone):
    out = {}
    for z in (tr.GREEN, tr.YELLOW, tr.RED):
        m = zone == z
        out[z + "_share"] = round(float(m.mean()), 3)
        out[z + "_acc"] = round(float(correct[m].mean()), 3) if m.any() else np.nan
    out["mel_missed_in_GREEN"] = int(((y == MEL) & ~correct & (zone == tr.GREEN)).sum())
    return out


def oof_zone(g, r, cutoff):
    """Out-of-fold triage: thresholds fitted on 4 folds, applied to the 5th."""
    zone = np.empty(n, dtype=object)
    folds = GroupKFold(n_splits=N_FOLDS).split(np.zeros((n, 1)), groups=groups)
    for tr_idx, te_idx in folds:
        th = tr.fit_thresholds(score[tr_idx], correct[tr_idx], g, r)
        if th is None:
            return None
        z = tr.triage(score[te_idx], th)
        zone[te_idx] = tr.apply_melanoma_rule(z, probs[te_idx], pred[te_idx],
                                              cutoff, MEL)
    return zone


# ---------------- stage 1: thresholds ----------------
rows = []
for g in G_GRID:
    for r in R_GRID:
        zone = oof_zone(g, r, None)
        if zone is None:
            rows.append({"g": g, "r": r, "valid": False, "why": "target not reachable"})
            continue
        s = summarize(zone)
        ok = (s["GREEN_share"] >= MIN_G and s["YELLOW_share"] >= MIN_Y
              and s["RED_share"] >= MIN_R and s["GREEN_acc"] >= g - TOL
              and s["GREEN_acc"] - s["YELLOW_acc"] >= GAP
              and s["YELLOW_acc"] - s["RED_acc"] >= GAP)
        rows.append({"g": g, "r": r, "valid": bool(ok), **s})
cand = pd.DataFrame(rows)
print("\n=== STAGE 1: candidates (out-of-fold, validation only) ===")
print(cand.to_string(index=False))
OUT = ROOT / "figures/uncertainty"
OUT.mkdir(parents=True, exist_ok=True)
cand.to_csv(OUT / "triage_validation_candidates.csv", index=False)

valid = cand[cand["valid"]]
if valid.empty:
    sys.exit("\nNO candidate meets the protocol requirements. Stopping - "
             "do NOT change the rules silently; discuss with the team.")
best = valid.sort_values(["GREEN_share", "g"], ascending=False).iloc[0]
g, r = float(best["g"]), float(best["r"])
print(f"\nSELECTED thresholds targets: green={g}, red={r}")

# ---------------- stage 2: melanoma safety cutoff ----------------
rows = []
for cut in CUTOFFS:
    s = summarize(oof_zone(g, r, cut))
    rows.append({"cutoff": "none" if cut is None else cut, **s})
mel = pd.DataFrame(rows)
print("\n=== STAGE 2: melanoma cutoff (out-of-fold, validation only) ===")
print(mel.to_string(index=False))
mel.to_csv(OUT / "triage_validation_melanoma.csv", index=False)

base_missed = int(mel.iloc[0]["mel_missed_in_GREEN"])
ok = mel.iloc[1:][(mel.iloc[1:]["mel_missed_in_GREEN"] <= base_missed - MIN_GAIN)
                  & (mel.iloc[1:]["GREEN_share"] >= MIN_G)]
if ok.empty:
    cutoff = None
else:
    best_missed = ok["mel_missed_in_GREEN"].min()
    cutoff = float(ok[ok["mel_missed_in_GREEN"] == best_missed]["cutoff"].max())
print("\nSELECTED melanoma cutoff:", cutoff)

# ---------------- freeze ----------------
th = tr.fit_thresholds(score, correct, g, r)
assert th is not None
cfg = {"protocol": "validation-only v2", "score": SCORE, "T": T,
       "green_acc_target": g, "red_acc_target": r,
       "t_green": th["t_green"], "t_red": th["t_red"],
       "melanoma_cutoff": cutoff, "mel_index": MEL, "class_names": CLASS_NAMES,
       "n_validation_images": n, "fitted_on": "validation only",
       "created": datetime.now().isoformat(timespec="seconds")}
cfg["config_sha256"] = tr.config_hash(cfg)
json.dump(cfg, open(ROOT / "uncertainty/triage_config.json", "w"), indent=2)

zone = tr.apply_melanoma_rule(tr.triage(score, th), probs, pred, cutoff, MEL)
print("\n=== FROZEN CONFIG (fitted on the full validation set) ===")
print(json.dumps({k: cfg[k] for k in ("t_green", "t_red", "melanoma_cutoff",
                                      "green_acc_target", "red_acc_target",
                                      "config_sha256")}, indent=2))
print("in-sample validation zones:", summarize(zone))
print("out-of-fold (honest) zones :", summarize(oof_zone(g, r, cutoff)))
print("\nSTEP C FINISHED - config frozen. Do not edit triage_config.json.")