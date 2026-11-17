"""
Grad-CAM for the DenseNet121 + dropout model (Person 2) via Person 3's predictor.

Place at: src/xai/gradcam.py   (and create an empty src/xai/__init__.py)
Run from the PROJECT ROOT:
    python -m src.xai.gradcam path/to/image.jpg
    python -m src.xai.gradcam path/to/image.jpg --target mel
"""
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # project root

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import colormaps

from uncertainty.predictor import MCDropoutPredictor

CLASS_NAMES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]  # verify vs predictor


class GradCAM:
    def __init__(self, predictor: MCDropoutPredictor):
        self.predictor = predictor
        self.model = predictor.model  # DenseNet121, eval mode (dropout OFF)
        self.model.eval()             # never call .train(): it would corrupt BatchNorm

    def explain(self, image, target_class=None, alpha=0.45):
        """
        image: file path, PIL image or numpy RGB array.
        target_class: index (0-6) or name ('mel'); None = model's predicted class.
        Returns dict: cam (224x224 in 0..1), overlay (uint8), background (uint8),
                      class_index, class_name, probability, probabilities.
        """
        bg = np.asarray(self.predictor.preprocess(image))      # 224x224x3 uint8
        x = self.predictor.to_tensor(image).detach().clone()   # (1,3,224,224)
        x.requires_grad_(True)  # guarantees a graph even if weights are frozen

        with torch.enable_grad():
            f = self.model.features(x)          # (1,1024,7,7)
            f.retain_grad()
            out = F.relu(f)                     # not in-place -> hooks stay valid
            pooled = F.adaptive_avg_pool2d(out, 1).flatten(1)
            logits = self.model.classifier(pooled)   # dropout is off in eval mode
            probs = torch.softmax(logits, dim=1)[0].detach()

            if target_class is None:
                idx = int(probs.argmax())
            elif isinstance(target_class, str):
                idx = CLASS_NAMES.index(target_class)
            else:
                idx = int(target_class)

            self.model.zero_grad()
            logits[0, idx].backward()           # backprop the LOGIT, not softmax

        weights = f.grad.mean(dim=(2, 3), keepdim=True)         # channel importance
        cam = F.relu((weights * f).sum(dim=1, keepdim=True))    # (1,1,7,7)
        cam = F.interpolate(cam, size=(224, 224), mode="bilinear", align_corners=False)
        cam = cam[0, 0].detach().cpu().numpy()
        cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)

        heat = (colormaps["jet"](cam)[..., :3] * 255).astype(np.uint8)
        overlay = ((1 - alpha) * bg + alpha * heat).clip(0, 255).astype(np.uint8)

        return {
            "cam": cam,
            "overlay": overlay,
            "background": bg,
            "class_index": idx,
            "class_name": CLASS_NAMES[idx],
            "probability": float(probs[idx]),
            "probabilities": {c: float(p) for c, p in zip(CLASS_NAMES, probs)},
        }


def save_figure(result, out_path, triage=None):
    """Side-by-side: original | heatmap | overlay."""
    fig, ax = plt.subplots(1, 3, figsize=(10, 3.6))
    ax[0].imshow(result["background"]); ax[0].set_title("Input (224x224)")
    ax[1].imshow(result["cam"], cmap="jet"); ax[1].set_title("Grad-CAM")
    ax[2].imshow(result["overlay"])
    title = f"{result['class_name']} ({result['probability']:.1%})"
    if triage:
        title += f" | {triage}"
    ax[2].set_title(title)
    for a in ax:
        a.axis("off")
    plt.tight_layout()
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def explain_gradcam(image, predictor=None, target_class=None):
    """Function for your frontend: returns (overlay_uint8, info_dict)."""
    predictor = predictor or MCDropoutPredictor()
    res = GradCAM(predictor).explain(image, target_class)
    return res["overlay"], {k: res[k] for k in ("class_name", "probability", "probabilities")}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--target", default=None, help="class name or index; default = predicted")
    ap.add_argument("--out", default="figures/xai")
    a = ap.parse_args()

    target = a.target
    if target is not None and target.isdigit():
        target = int(target)

    predictor = MCDropoutPredictor()                 # load once
    pred = predictor.predict(a.image)                # class + triage colour (once)
    res = GradCAM(predictor).explain(a.image, target)

    name = Path(a.image).stem
    out = Path(a.out) / f"gradcam_{name}_{res['class_name']}.png"
    save_figure(res, out, triage=pred["triage"])
    print(f"model: {pred['class_name']} | triage: {pred['triage']} | "
          f"explained class: {res['class_name']} | saved: {out}")
