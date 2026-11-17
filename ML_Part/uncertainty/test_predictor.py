"""
uncertainty/test_predictor.py - Person 3
Checks the single-image predictor against the verified batch results.
Run from project root:  python uncertainty/test_predictor.py
"""
from pathlib import Path
import sys
import time

# make the PROJECT ROOT the import root (the uncertainty folder itself must not
# be on the path, otherwise uncertainty.py would shadow the package)
ROOT = Path(__file__).resolve().parents[1]
sys.path = [str(ROOT)] + [p for p in sys.path
                          if Path(p or ".").resolve() != Path(__file__).resolve().parent]

import numpy as np
import pandas as pd
from PIL import Image

from uncertainty.predictor import MCDropoutPredictor, predict_with_uncertainty
import uncertainty.triage as tr

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}")


CACHE = ROOT / "uncertainty/cache"
cached = dict(np.load(CACHE / "mc_test.npz"))
df = pd.read_csv(ROOT / "data/processed/lesion_split/test_metadata.csv")
lookup = {p.stem: p for d in ("HAM10000_images_part_1", "HAM10000_images_part_2")
          for p in (ROOT / "data/raw" / d).glob("*.jpg")}

t0 = time.time()
pred = MCDropoutPredictor()
print(f"model loaded in {time.time() - t0:.1f}s\n=== PREDICTOR TESTS ===")
cfg = pred.cfg
check("config hash valid", tr.config_hash(cfg) == cfg["config_sha256"])

# ---- 1. agreement with the verified batch results (40 random test images) ----
rng = np.random.default_rng(0)
idx = rng.choice(len(df), 40, replace=False)
cached_zone = tr.apply_melanoma_rule(
    tr.triage(cached["std_pred"], cfg), cached["mean_probs"], cached["pred"],
    cfg["melanoma_cutoff"], cfg["mel_index"])

same_cls = same_zone = 0
diffs, secs = [], []
for i in idx:
    t = time.time()
    r = pred.predict(lookup[str(df.iloc[i]["image_id"])])
    secs.append(time.time() - t)
    same_cls += r["class_index"] == int(cached["pred"][i])
    same_zone += r["triage"] == cached_zone[i]
    diffs.append(abs(r["uncertainty"] - float(cached["std_pred"][i])))
check("predicted class agrees with batch run", same_cls >= 38, f"({same_cls}/40)")
check("uncertainty close to batch run", np.mean(diffs) < 0.01,
      f"(mean abs diff {np.mean(diffs):.4f})")
check("triage colour mostly agrees with batch run", same_zone >= 28,
      f"({same_zone}/40; differences near thresholds are expected, T=50 is random)")
print(f"  time per image: {np.mean(secs):.2f}s")

# ---- 2. every input type gives the same answer (same seed) ----
path = lookup[str(df.iloc[0]["image_id"])]
im = Image.open(path)
outs = [pred.predict(path, seed=5), pred.predict(im, seed=5),
        pred.predict(np.array(im.convert("RGB")), seed=5)]
check("path / PIL / numpy input give identical results",
      all(o["probabilities"] == outs[0]["probabilities"] for o in outs[1:]))
check("same image twice gives identical result (no flicker)",
      pred.predict(path) == pred.predict(path))

# ---- 3. unusual inputs do not crash ----
ok = True
try:
    pred.predict(im.convert("L"))
    pred.predict(im.convert("RGBA"))
    pred.predict(np.array(im.convert("RGB")).astype(np.float32) / 255.0)
    pred.predict(Image.new("RGB", (50, 80), (120, 80, 60)))
except Exception as e:
    ok = False
    print("   error:", repr(e))
check("grayscale / RGBA / float / tiny images work", ok)

# ---- 4. output sanity ----
r = pred.predict(path, seed=1)
check("probabilities sum to 1", abs(sum(r["probabilities"].values()) - 1) < 1e-4)
check("class name matches highest probability",
      r["class_name"] == max(r["probabilities"], key=r["probabilities"].get))
check("triage colour valid", r["triage"] in ("GREEN", "YELLOW", "RED"))
check("message present", isinstance(r["message"], str) and len(r["message"]) > 0)
check("model back in eval mode", not any(m.training for m in pred.model.modules()))
check("convenience function works",
      predict_with_uncertainty(path)["class_name"] in pred.class_names)

print("\nExample output:")
for k, v in r.items():
    print(f"  {k}: {v}")
print("\nALL PREDICTOR TESTS PASSED" if all(results)
      else "\nSOME TESTS FAILED - send me this output")