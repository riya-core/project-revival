"""
uncertainty/predictor.py - Person 3
Single-image interface for the dashboard (Person 4).

    from uncertainty.predictor import MCDropoutPredictor
    p = MCDropoutPredictor()              # load once, reuse
    result = p.predict(image)             # path / PIL image / numpy RGB array

Triage uses the configuration frozen on the validation set
(uncertainty/triage_config.json, hash-checked).
"""
import json
import zlib
from pathlib import Path

import numpy as np
import torch
from PIL import Image

try:                                     # normal use
    from . import uncertainty as unc
    from . import triage as tr
    from .densenet_utils import CLASS_NAMES, load_densenet, to_input
except ImportError:                      # fallback if run from inside the folder
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import uncertainty as unc
    import triage as tr
    from densenet_utils import CLASS_NAMES, load_densenet, to_input

CONFIG = Path(__file__).resolve().parent / "triage_config.json"

MESSAGES = {
    "GREEN": "Model is confident. Routine follow-up.",
    "YELLOW": "Model is somewhat unsure. Review by a clinician recommended.",
    "RED": "Model is very unsure. Refer to a doctor.",
}


class MCDropoutPredictor:
    def __init__(self, T=50, device="cpu"):
        self.device = torch.device(device)
        self.model = load_densenet(self.device)      # eval mode, 224x224 input
        self.cfg = json.load(open(CONFIG))
        assert tr.config_hash(self.cfg) == self.cfg["config_sha256"], \
            "triage_config.json was modified after freezing"
        self.T = T
        self.class_names = CLASS_NAMES

    @staticmethod
    def preprocess(image):
        """path / PIL / numpy -> uint8 array (224, 224, 3), RGB."""
        if isinstance(image, (str, Path)):
            im = Image.open(image)
        elif isinstance(image, np.ndarray):
            arr = image
            if arr.dtype != np.uint8:
                arr = np.rint(arr * 255) if arr.max() <= 1.0 else arr
                arr = np.clip(arr, 0, 255).astype(np.uint8)
            im = Image.fromarray(arr)
        elif isinstance(image, Image.Image):
            im = image
        else:
            raise TypeError(f"Unsupported image type: {type(image)}")
        im = im.convert("RGB").resize((224, 224), Image.BILINEAR)
        return np.array(im, dtype=np.uint8)

    def to_tensor(self, image):
        """Normalised (1, 3, 224, 224) tensor, e.g. for Grad-CAM."""
        return to_input(self.preprocess(image)[None])

    def predict(self, image, seed=None):
        x = self.preprocess(image)[None]
        if seed is None:
            seed = zlib.crc32(x.tobytes())          # same image -> same result
        torch.manual_seed(seed)
        emb = unc.extract_embeddings(self.model, x, to_input)
        probs = unc.mc_predict_from_embeddings(self.model, emb, T=self.T)
        r = unc.summarize(probs)

        score = r[self.cfg["score"]]
        zone = tr.triage(score, self.cfg)
        zone = tr.apply_melanoma_rule(zone, r["mean_probs"], r["pred"],
                                      self.cfg["melanoma_cutoff"],
                                      self.cfg["mel_index"])
        color = str(zone[0])
        k = int(r["pred"][0])
        return {
            "class_index": k,
            "class_name": self.class_names[k],
            "confidence": float(r["confidence"][0]),
            "uncertainty": float(r["std_pred"][0]),
            "mutual_info": float(r["mutual_info"][0]),
            "entropy": float(r["entropy"][0]),
            "triage": color,
            "message": MESSAGES[color],
            "probabilities": {c: float(p) for c, p in
                              zip(self.class_names, r["mean_probs"][0])},
        }


_default = None


def predict_with_uncertainty(image):
    """Convenience wrapper: loads the model on first call, then reuses it."""
    global _default
    if _default is None:
        _default = MCDropoutPredictor()
    return _default.predict(image)