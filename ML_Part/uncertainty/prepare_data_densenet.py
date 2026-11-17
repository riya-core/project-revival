"""
uncertainty/prepare_data_densenet.py - Person 3
1) Builds val/test caches with Person 2's exact image transform.
2) Re-measures the deterministic test accuracy; it must reproduce
   Person 2's numbers (acc 0.8113, macro F1 0.6557).

Run from project root:  python uncertainty/prepare_data_densenet.py
"""
from pathlib import Path
import sys
import time

import numpy as np
import pandas as pd
import torch
from PIL import Image
from sklearn.metrics import accuracy_score, f1_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "uncertainty"))
from densenet_utils import (CACHE_DIR, CLASS_NAMES, load_densenet,
                            load_cached, to_input)

IMAGE_DIRS = [ROOT / "data/raw/HAM10000_images_part_1",
              ROOT / "data/raw/HAM10000_images_part_2"]
SPLIT_DIR = ROOT / "data/processed/lesion_split"
EXPECTED_N = {"val": 1994, "test": 2014}
EXPECTED_TEST_COUNTS = [68, 100, 205, 22, 222, 1363, 34]
C2I = {c: i for i, c in enumerate(CLASS_NAMES)}


def build_cache(name):
    df = pd.read_csv(SPLIT_DIR / f"{name}_metadata.csv")
    assert len(df) == EXPECTED_N[name], f"{name}: unexpected CSV size"
    lookup = {p.stem: p for d in IMAGE_DIRS for p in d.glob("*.jpg")}
    X = np.empty((len(df), 224, 224, 3), dtype=np.uint8)
    t0 = time.time()
    for i, image_id in enumerate(df["image_id"].astype(str)):
        with Image.open(lookup[image_id]) as im:
            im = im.convert("RGB").resize((224, 224), Image.BILINEAR)
        X[i] = np.asarray(im)
        if (i + 1) % 500 == 0:
            print(f"  [{name}] {i + 1}/{len(df)}  ({time.time() - t0:.0f}s)")
    y = df["dx"].map(C2I).to_numpy(dtype=np.int64)
    assert not np.isnan(y.astype(float)).any()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.save(CACHE_DIR / f"X_{name}_tv.npy", X)
    np.save(CACHE_DIR / f"y_{name}_tv.npy", y)
    print(f"[{name}] saved X{X.shape} y{y.shape}")


def verify():
    model = load_densenet()
    n_dropout = sum(isinstance(m, torch.nn.Dropout) for m in model.modules())
    print("nn.Dropout modules in model:", n_dropout, "(expected 1)")

    X, y = load_cached("test")
    assert np.bincount(y, minlength=7).tolist() == EXPECTED_TEST_COUNTS, \
        "test class counts differ from Person 2's"

    # determinism check (dropout OFF => identical outputs)
    xb = to_input(X[:8])
    with torch.no_grad():
        a, b = model(xb), model(xb)
    print("eval-mode outputs identical:", bool(torch.equal(a, b)))

    preds, t0 = [], time.time()
    with torch.no_grad():
        for i in range(0, len(X), 32):
            preds.append(model(to_input(X[i:i + 32])).argmax(1).numpy())
            if (i // 32) % 10 == 0:
                print(f"  inference {i}/{len(X)}  ({time.time() - t0:.0f}s)")
    preds = np.concatenate(preds)
    acc = accuracy_score(y, preds)
    f1 = f1_score(y, preds, average="macro", zero_division=0)
    print("\n=== DenseNet+Dropout, deterministic, TEST set ===")
    print("accuracy : %.4f   (Person 2 reported 0.8113)" % acc)
    print("macro F1 : %.4f   (Person 2 reported 0.6557)" % f1)
    ok = abs(acc - 0.8113) <= 0.005 and abs(f1 - 0.6557) <= 0.01
    print("MATCHES PERSON 2:", "YES" if ok else "NO - investigate before continuing")


if __name__ == "__main__":
    for s in ("val", "test"):
        build_cache(s)
    verify()
    print("\nPREPARE_DATA_DENSENET FINISHED")