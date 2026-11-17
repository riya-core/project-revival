"""
uncertainty/run_step4.py - Person 3
Step 4: embeddings -> correctness tests -> MC Dropout (T=50) on val and test.
Run from project root:  python uncertainty/run_step4.py
"""
from pathlib import Path
import sys
import time

import numpy as np
import torch
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "uncertainty"))
import uncertainty as unc
from densenet_utils import CACHE_DIR, load_densenet, load_cached, to_input

T = 50
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}")


model = load_densenet()
data = {s: load_cached(s) for s in ("val", "test")}

# ---------- 1. embeddings (slow part, cached) ----------
emb = {}
for s, (X, y) in data.items():
    path = CACHE_DIR / f"emb_{s}.npy"
    if path.exists():
        emb[s] = np.load(path)
        print(f"[{s}] embeddings loaded from cache")
    else:
        print(f"[{s}] extracting embeddings (~6 min)...")
        t0 = time.time()
        emb[s] = unc.extract_embeddings(model, X, to_input)
        np.save(path, emb[s])
        print(f"[{s}] done in {time.time() - t0:.0f}s")
    assert emb[s].shape == (len(X), 1024)

# ---------- 2. correctness tests ----------
print("\n=== CORRECTNESS TESTS ===")
Xt, yt = data["test"]
e8 = emb["test"][:8]

# T1: embedding path == full model forward
with torch.no_grad():
    full = model(to_input(Xt[:8]))
    fast = model.classifier(torch.from_numpy(e8).float())
check("embedding path equals full model forward",
      torch.allclose(full, fast, atol=1e-3),
      f"(max diff {(full - fast).abs().max():.2e})")

# T2: only Dropout in train mode, BatchNorm stays eval
n_on = unc.enable_mc_dropout(model)
bn_train = [m for m in model.modules()
            if isinstance(m, torch.nn.BatchNorm2d) and m.training]
dr_train = [m for m in model.modules()
            if isinstance(m, torch.nn.Dropout) and m.training]
check("MC mode: Dropout ON, all BatchNorm OFF",
      n_on == 1 and len(bn_train) == 0 and len(dr_train) == 1,
      f"(dropout on={len(dr_train)}, BN in train mode={len(bn_train)})")
model.eval()

# T3: dropout OFF gives identical repeated outputs
with torch.no_grad():
    a = model.classifier(torch.from_numpy(e8).float())
    b = model.classifier(torch.from_numpy(e8).float())
check("dropout OFF -> repeated outputs identical", torch.equal(a, b))

# T4: MC passes: shape, sum to 1, passes differ, reproducible with seed
torch.manual_seed(0)
p1 = unc.mc_predict_from_embeddings(model, emb["test"][:64], T=T)
torch.manual_seed(0)
p2 = unc.mc_predict_from_embeddings(model, emb["test"][:64], T=T)
check("shape is (T, N, 7)", p1.shape == (T, 64, 7), f"{p1.shape}")
check("probabilities sum to 1", np.allclose(p1.sum(2), 1.0, atol=1e-4))
check("MC passes differ from each other",
      np.abs(p1[0] - p1[1]).max() > 1e-3,
      f"(max diff {np.abs(p1[0] - p1[1]).max():.3f})")
check("same seed -> same result", np.array_equal(p1, p2))
check("head back in eval mode afterwards", not model.classifier[0].training)

# T5: fast method agrees statistically with FULL-model MC dropout
print("  ... comparing with full-network MC on 4 images (~1 min)")
torch.manual_seed(1)
xb = to_input(Xt[:4])
unc.enable_mc_dropout(model)
with torch.no_grad():
    full_mc = torch.stack([torch.softmax(model(xb), 1) for _ in range(100)])
model.eval()
fast_mc = unc.mc_predict_from_embeddings(model, emb["test"][:4], T=1000)
diff = np.abs(full_mc.mean(0).numpy() - fast_mc.mean(0)).max()
check("fast MC matches full-network MC", diff < 0.05, f"(max mean diff {diff:.4f})")

if not all(results):
    sys.exit("\nSOME TESTS FAILED - do not continue, send me this output.")
print("ALL TESTS PASSED")

# ---------- 3. real MC Dropout runs ----------
print("\n=== MC DROPOUT, T=%d ===" % T)
for i, s in enumerate(("val", "test")):
    torch.manual_seed(100 + i)
    probs = unc.mc_predict_from_embeddings(model, emb[s], T=T)
    r = unc.summarize(probs)
    y = data[s][1]
    np.savez_compressed(CACHE_DIR / f"mc_{s}.npz", y=y, **r)
    print(f"saved mc_{s}.npz")

# ---------- 4. quick look at test results ----------
r = dict(np.load(CACHE_DIR / "mc_test.npz"))
y, pred = r["y"], r["pred"]
wrong = pred != y
print("\n=== TEST SET SUMMARY ===")
print("MC-mean accuracy : %.4f" % accuracy_score(y, pred))
print("MC-mean macro F1 : %.4f" % f1_score(y, pred, average="macro", zero_division=0))
print("correct: %d | wrong: %d" % ((~wrong).sum(), wrong.sum()))
for k in ("std_pred", "entropy", "mutual_info"):
    v = r[k]
    print("%-12s mean=%.4f  median=%.4f  max=%.4f | correct=%.4f  wrong=%.4f"
          % (k, v.mean(), np.median(v), v.max(), v[~wrong].mean(), v[wrong].mean()))
print("\nAUROC for spotting wrong predictions (0.5 = useless, 1.0 = perfect):")
scores = {"std_pred": r["std_pred"], "entropy": r["entropy"],
          "mutual_info": r["mutual_info"], "1-confidence (plain softmax)": 1 - r["confidence"]}
for k, v in scores.items():
    print("  %-30s %.4f" % (k, roc_auc_score(wrong, v)))
print("\nSTEP4 FINISHED")