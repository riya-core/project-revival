import io, sys, base64, threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from matplotlib import colormaps
from PIL import Image

from uncertainty.predictor import MCDropoutPredictor
from uncertainty.densenet_utils import CLASS_NAMES
from src.xai.gradcam import GradCAM
from src.xai.lime_explain import LimeExplainer

app = FastAPI(title="Skin lesion API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5173", "http://127.0.0.1:5173",
        "*"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

predictor = MCDropoutPredictor()
gradcam = GradCAM(predictor)
lime_explainer = LimeExplainer(predictor)
model_lock = threading.Lock()   # model + torch seed are shared state


def read_image(upload: UploadFile) -> Image.Image:
    try:
        return Image.open(io.BytesIO(upload.file.read())).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image file")


def to_b64_png(arr) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def check_target(target):
    if target and target not in CLASS_NAMES:
        raise HTTPException(400, detail=f"target must be one of {CLASS_NAMES}")
    return target or None


@app.get("/health")
def health():
    return {"status": "ok", "classes": CLASS_NAMES}


@app.post("/predict")
def predict(file: UploadFile = File(...)):
    img = read_image(file)
    with model_lock:
        r = predictor.predict(img)
    return {
        "class_name": r["class_name"],
        "class_index": int(r["class_index"]),
        "confidence": float(r["confidence"]),
        "uncertainty": float(r["uncertainty"]),
        "mutual_info": float(r["mutual_info"]),
        "entropy": float(r["entropy"]),
        "triage": r["triage"],            # GREEN | YELLOW | RED
        "message": r["message"],
        "probabilities": {k: float(v) for k, v in r["probabilities"].items()},
    }


@app.post("/explain/gradcam")
def explain_gradcam(file: UploadFile = File(...), target: str | None = Form(None)):
    target = check_target(target)
    img = read_image(file)
    with model_lock:
        res = gradcam.explain(img, target_class=target)
    heat = (colormaps["jet"](res["cam"])[..., :3] * 255).astype("uint8")
    return {
        "class_name": res["class_name"],
        "probability": res["probability"],
        "original": to_b64_png(res["background"]),
        "overlay": to_b64_png(res["overlay"]),
        "heatmap_only": to_b64_png(heat),
    }


@app.post("/explain/lime")
def explain_lime(
    file: UploadFile = File(...),
    target: str | None = Form(None),
    num_samples: int = Form(100),
):
    target = check_target(target)
    num_samples = max(50, min(num_samples, 500))
    img = read_image(file)
    with model_lock:
        res = lime_explainer.explain(img, target_class=target, num_samples=num_samples)
    return {
        "class_name": res["class_name"],
        "probability": res["probability"],
        "seconds": res["seconds"],
        "num_samples": res["num_samples"],
        "original": to_b64_png(res["background"]),
        "positive_overlay": to_b64_png(res["positive_overlay"]),
        "pos_neg_overlay": to_b64_png(res["pos_neg_overlay"]),
    }