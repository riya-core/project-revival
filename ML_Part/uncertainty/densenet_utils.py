"""
uncertainty/densenet_utils.py - Person 3
Shared helpers: load Person 2's dropout DenseNet121 and prepare inputs
exactly the way it was trained (224x224 bilinear, ImageNet normalisation).
"""
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torchvision import models

ROOT = Path(__file__).resolve().parents[1]
CKPT = ROOT / "model/densenet121_ham10000_lesion_dropout.pt"
CACHE_DIR = ROOT / "uncertainty/cache"
CLASS_NAMES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def load_densenet(device=torch.device("cpu")):
    """Rebuild DenseNet121 + Dropout head and load the fine-tuned weights."""
    ck = torch.load(CKPT, map_location=device, weights_only=True)
    assert ck["architecture"] == "DenseNet121"
    assert ck["class_names"] == CLASS_NAMES, "class order changed!"
    model = models.densenet121(weights=None)
    model.classifier = nn.Sequential(
        nn.Dropout(ck["dropout_probability"]), nn.Linear(1024, 7)
    )
    model.load_state_dict(ck["model_state_dict"], strict=True)
    return model.to(device).eval()


def to_input(x_uint8_nhwc: np.ndarray) -> torch.Tensor:
    """uint8 (N,224,224,3) -> normalised float tensor (N,3,224,224)."""
    x = torch.from_numpy(x_uint8_nhwc).float().div(255.0).permute(0, 3, 1, 2)
    return (x - MEAN) / STD


def load_cached(name: str):
    """Return (X uint8 NHWC, y int64) from the DenseNet cache."""
    X = np.load(CACHE_DIR / f"X_{name}_tv.npy")
    y = np.load(CACHE_DIR / f"y_{name}_tv.npy")
    return X, y