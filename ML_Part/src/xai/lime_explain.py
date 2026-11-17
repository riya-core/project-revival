"""
LIME for the DenseNet121 + dropout model, via Person 3's predictor.

Place at: src/xai/lime_explain.py   (NOT lime.py: that name would shadow the 'lime' package)
Install:  pip install lime scikit-image
Run from the PROJECT ROOT:
    python -m src.xai.lime_explain path/to/image.jpg --samples 100   # quick test
    python -m src.xai.lime_explain path/to/image.jpg                 # 500 samples
    python -m src.xai.lime_explain path/to/image.jpg --target mel
"""
import sys
import time
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # project root

import numpy as np
import torch
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from lime import lime_image
from skimage.segmentation import mark_boundaries, slic

from uncertainty.predictor import MCDropoutPredictor
from uncertainty.densenet_utils import to_input
from src.xai.gradcam import CLASS_NAMES

SEED = 42


class LimeExplainer:
    def __init__(self, predictor: MCDropoutPredictor, batch_size=32):
        self.predictor = predictor
        self.model = predictor.model  # eval mode: dropout OFF (never call .train())
        self.model.eval()
        self.batch_size = batch_size
        self.explainer = lime_image.LimeImageExplainer(random_state=SEED)

    def _classifier_fn(self, batch):
        """LIME calls this with (N,224,224,3) perturbed images -> (N,7) probabilities."""
        batch = np.clip(np.asarray(batch), 0, 255).astype(np.uint8)
        out = []
        with torch.no_grad():
            for i in range(0, len(batch), self.batch_size):
                x = to_input(batch[i:i + self.batch_size])
                out.append(torch.softmax(self.model(x), dim=1).cpu().numpy())
        return np.concatenate(out, axis=0)

    @staticmethod
    def _segment(img):
        return slic(img, n_segments=50, compactness=10, sigma=1, start_label=1)

    def explain(self, image, target_class=None, num_samples=500, num_features=5):
        bg = np.asarray(self.predictor.preprocess(image))  # 224x224x3 uint8
        t0 = time.time()
        exp = self.explainer.explain_instance(
            bg,
            self._classifier_fn,
            top_labels=3,
            hide_color=0,
            num_samples=num_samples,
            batch_size=self.batch_size,
            segmentation_fn=self._segment,
            random_seed=SEED,
        )
        seconds = time.time() - t0

        if target_class is None:
            label = int(exp.top_labels[0])
        elif isinstance(target_class, str):
            label = CLASS_NAMES.index(target_class)
        else:
            label = int(target_class)

        # LIME only fits top_labels; if the requested class is not among them, refit for it
        if label not in exp.local_exp:
            exp = self.explainer.explain_instance(
                bg, self._classifier_fn, labels=(label,), hide_color=0,
                num_samples=num_samples, batch_size=self.batch_size,
                segmentation_fn=self._segment, random_seed=SEED,
            )

        img_pos, mask_pos = exp.get_image_and_mask(
            label, positive_only=True, num_features=num_features, hide_rest=False)
        img_both, mask_both = exp.get_image_and_mask(
            label, positive_only=False, num_features=10, hide_rest=False)

        prob = float(self._classifier_fn(bg[None])[0][label])
        return {
            "background": bg,
            "positive_overlay": (mark_boundaries(img_pos / 255.0, mask_pos) * 255).astype(np.uint8),
            "pos_neg_overlay": (mark_boundaries(img_both / 255.0, mask_both) * 255).astype(np.uint8),
            "class_index": label,
            "class_name": CLASS_NAMES[label],
            "probability": prob,
            "seconds": seconds,
            "num_samples": num_samples,
        }


def save_figure(res, out_path, triage=None):
    fig, ax = plt.subplots(1, 3, figsize=(10, 3.6))
    ax[0].imshow(res["background"]); ax[0].set_title("Input (224x224)")
    ax[1].imshow(res["positive_overlay"]); ax[1].set_title("LIME: supports class")
    ax[2].imshow(res["pos_neg_overlay"]); ax[2].set_title("LIME: green=for, red=against")
    title = f"{res['class_name']} ({res['probability']:.1%}) | {res['num_samples']} samples"
    if triage:
        title += f" | {triage}"
    fig.suptitle(title, fontsize=10)
    for a in ax:
        a.axis("off")
    plt.tight_layout()
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def explain_lime(image, predictor=None, target_class=None, num_samples=500):
    """Function for the backend/frontend later."""
    predictor = predictor or MCDropoutPredictor()
    return LimeExplainer(predictor).explain(image, target_class, num_samples)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--target", default=None, help="class name or index; default = predicted")
    ap.add_argument("--samples", type=int, default=500)
    ap.add_argument("--out", default="figures/xai")
    a = ap.parse_args()

    target = int(a.target) if a.target and a.target.isdigit() else a.target

    predictor = MCDropoutPredictor()
    pred = predictor.predict(a.image)  # triage computed once, for the original image
    res = LimeExplainer(predictor).explain(a.image, target, a.samples)

    out = Path(a.out) / f"lime_{Path(a.image).stem}_{res['class_name']}_{a.samples}.png"
    save_figure(res, out, triage=pred["triage"])
    print(f"model: {pred['class_name']} | triage: {pred['triage']} | explained: {res['class_name']} "
          f"| {res['seconds']:.0f}s | saved: {out}")
