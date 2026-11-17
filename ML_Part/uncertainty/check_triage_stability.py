"""
uncertainty/check_triage_stability.py - Person 3
How often does the triage colour change between two independent MC Dropout runs?
Uses the frozen config and cached VALIDATION embeddings (no test data).
Run from project root:  python uncertainty/check_triage_stability.py
"""
from pathlib import Path
import json
import sys

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "uncertainty"))
import triage as tr
import uncertainty as unc
from densenet_utils import CACHE_DIR, load_densenet

cfg = json.load(open(ROOT / "uncertainty/triage_config.json"))
assert tr.config_hash(cfg) == cfg["config_sha256"], "config was modified"
model = load_densenet()
emb = np.load(CACHE_DIR / "emb_val.npy")


def run(T, seed):
    torch.manual_seed(seed)
    r = unc.summarize(unc.mc_predict_from_embeddings(model, emb, T=T))
    z = tr.triage(r[cfg["score"]], cfg)
    z = tr.apply_melanoma_rule(z, r["mean_probs"], r["pred"],
                               cfg["melanoma_cutoff"], cfg["mel_index"])
    return z, r["pred"]


print("=== Stability between two independent MC runs (VALIDATION set) ===")
for T in (50, 200):
    za, pa = run(T, 1)
    zb, pb = run(T, 2)
    print("T=%3d: same colour for %.1f%% of images | same class %.1f%%"
          % (T, 100 * (za == zb).mean(), 100 * (pa == pb).mean()))
print("\nSTABILITY CHECK FINISHED")