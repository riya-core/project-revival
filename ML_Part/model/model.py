"""
model/model.py  —  Person 2: Model Architecture & Training Lead
Backend: PyTorch + CUDA  (gpu_env: torch 2.5.1+cu121)

SHARED CONSTANTS  (importable by Person 3 and Person 4)
    CLASS_NAMES   : list[str]       fixed alphabetical order
    label_to_idx  : dict[str, int]
    idx_to_label  : dict[int, str]
    NUM_CLASSES   : int  (7)
    INPUT_SHAPE   : tuple (224, 224, 3)   H×W×C  (Person 1 convention)

PUBLIC API
    get_device()                        -> torch.device
    build_model(...)                    -> HAM10000CNN  (on device)
    encode_labels(labels)               -> np.ndarray int64
    compute_weights(y_int, device)      -> torch.Tensor
    get_train_transform()               -> T.Compose
    get_val_transform()                 -> T.Compose
    make_dataloaders(...)               -> (train_loader, val_loader)
    train_model(...)                    -> (model, history_dict)
    plot_history(history, save_dir)     -> None   (saves figures)
    save_history_csv(history, path)     -> None   (saves CSV)
    save_model(model, path)             -> None   (state-dict .pt)
    save_checkpoint(...)                -> None   (full checkpoint .pt)
    save_class_mapping(path)            -> None   (class_mapping.json)
    save_model_config(path, ...)        -> None   (model_config.json)
    load_model(path, device)            -> HAM10000CNN  (eval mode)

MC-Dropout note  (Person 3)
    model.train()          ← activates head_dropout stochastically
    with torch.no_grad():
        logits = model(x)  ← stochastic due to dropout
    probs = torch.softmax(logits, dim=1)

    model.eval()           ← deterministic predictions (dropout off)

Grad-CAM note  (Person 4)
    hook target : model.last_conv   (nn.Conv2d, 128 filters)
    model.last_conv.register_forward_hook(your_hook_fn)
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.utils.class_weight import compute_class_weight

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import torchvision.transforms as T


def get_device() -> torch.device:
    """Return CUDA device if available, else CPU."""
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


CLASS_NAMES: List[str] = [
    "akiec",   # 0  Actinic keratoses
    "bcc",     # 1  Basal cell carcinoma
    "bkl",     # 2  Benign keratosis
    "df",      # 3  Dermatofibroma
    "mel",     # 4  Melanoma
    "nv",      # 5  Melanocytic nevi
    "vasc",    # 6  Vascular lesions
]

label_to_idx: Dict[str, int] = {cls: i for i, cls in enumerate(CLASS_NAMES)}
idx_to_label: Dict[int, str] = {i: cls for i, cls in enumerate(CLASS_NAMES)}

NUM_CLASSES: int                  = len(CLASS_NAMES)   # 7
INPUT_SHAPE: Tuple[int, int, int] = (224, 224, 3)      # H × W × C


def encode_labels(labels: np.ndarray) -> np.ndarray:
    """
    Convert string labels from load_data() → int64 numpy array (0–6).

    Parameters
    labels : np.ndarray of str   e.g. ["nv", "mel", ...]

    Returns
    np.ndarray of int64, shape (N,)
    """
    return np.array([label_to_idx[lbl] for lbl in labels], dtype=np.int64)


def compute_weights(
    y_int: np.ndarray,
    device: Optional[torch.device] = None,
) -> torch.Tensor:
    """
    Balanced class weights via sklearn → float32 tensor on device.

    Pass the result directly to nn.CrossEntropyLoss(weight=...).
    """
    if device is None:
        device = get_device()
    classes = np.arange(NUM_CLASSES)
    weights = compute_class_weight(
        class_weight="balanced",
        classes=classes,
        y=y_int,
    )
    return torch.tensor(weights, dtype=torch.float32, device=device)


def get_train_transform() -> T.Compose:
    """
    Training augmentation pipeline.
    Input  : (H, W, C) float32 numpy [0, 1]
    Output : (C, H, W) float32 tensor [0, 1]
    """
    return T.Compose([
        T.ToTensor(),                                        # numpy HWC → tensor CHW
        T.RandomHorizontalFlip(),
        T.RandomVerticalFlip(),
        T.RandomRotation(degrees=10, fill=0),
        T.RandomAffine(degrees=0, translate=(0.05, 0.05), fill=0),
        T.ColorJitter(brightness=0.1, contrast=0.1),
    ])


def get_val_transform() -> T.Compose:
    """
    Validation / test transform — only numpy → tensor, no augmentation.
    """
    return T.Compose([T.ToTensor()])


class HAM10000Dataset(torch.utils.data.Dataset):
    """Wrap pre-loaded numpy arrays with per-sample transforms."""

    def __init__(
        self,
        images: np.ndarray,
        labels: np.ndarray,
        transform: Optional[T.Compose] = None,
    ) -> None:
        self.images    = images
        self.labels    = labels
        self.transform = transform

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int):
        img = self.images[idx]          # (H, W, C) float32
        lbl = int(self.labels[idx])
        if self.transform is not None:
            img = self.transform(img)   # → (C, H, W) tensor
        else:
            img = torch.from_numpy(img.transpose(2, 0, 1))
        return img, lbl


def make_dataloaders(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    batch_size: int = 32,
    num_workers: int = 0,
) -> Tuple[DataLoader, DataLoader]:
    """Build train + val DataLoaders with appropriate transforms."""
    train_ds = HAM10000Dataset(X_train, y_train, transform=get_train_transform())
    val_ds   = HAM10000Dataset(X_val,   y_val,   transform=get_val_transform())

    pin = torch.cuda.is_available()
    train_loader = DataLoader(
        train_ds, batch_size=batch_size,
        shuffle=True,  num_workers=num_workers, pin_memory=pin,
    )
    val_loader = DataLoader(
        val_ds,   batch_size=batch_size,
        shuffle=False, num_workers=num_workers, pin_memory=pin,
    )
    return train_loader, val_loader


class HAM10000CNN(nn.Module):
    """
    3-block CNN for HAM10000 7-class skin-lesion classification.

    Input shape  : (B, 3, 224, 224)   — PyTorch CHW convention
    Output shape : (B, 7)             — raw logits

    Blocks
    ──────
    Block 1 : Conv2d(  3→ 32, 3×3) → BN → ReLU → MaxPool(2) → Dropout2d(0.25)
    Block 2 : Conv2d( 32→ 64, 3×3) → BN → ReLU → MaxPool(2) → Dropout2d(0.25)
    Block 3 : Conv2d( 64→128, 3×3) → BN → ReLU → MaxPool(2) → Dropout2d(0.25)
              ↑  self.last_conv  ← Grad-CAM hook target (Person 4)

    Head
    ────
    AdaptiveAvgPool2d(1)  → Flatten → Dropout(0.4) → Linear(128) → ReLU → Linear(7)
    ↑  self.gap                          ↑  self.head_dropout  (MC-Dropout, Person 3)

    MC-Dropout (Person 3)
        model.train()              # dropout active
        with torch.no_grad():
            probs = softmax(model(x))

    Grad-CAM (Person 4)
        model.last_conv.register_forward_hook(hook_fn)
    """

    def __init__(
        self,
        num_classes: int = NUM_CLASSES,
        head_dropout_rate: float = 0.4,
    ) -> None:
        super().__init__()

        self.block1 = nn.Sequential(
            nn.Conv2d(3, 32, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.25),
        )

        self.block2 = nn.Sequential(
            nn.Conv2d(32, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.25),
        )

        self.last_conv      = nn.Conv2d(64, 128, kernel_size=3, padding=1, bias=False)
        self.block3_bn      = nn.BatchNorm2d(128)
        self.block3_relu    = nn.ReLU(inplace=True)
        self.block3_pool    = nn.MaxPool2d(2)
        self.block3_dropout = nn.Dropout2d(0.25)

        self.gap          = nn.AdaptiveAvgPool2d(1)         # GlobalAveragePooling
        self.head_dropout = nn.Dropout(head_dropout_rate)   # MC-Dropout (Person 3)
        self.head_dense   = nn.Linear(128, 128)
        self.predictions  = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.block1(x)
        x = self.block2(x)

        x = self.last_conv(x)
        x = self.block3_bn(x)
        x = self.block3_relu(x)
        x = self.block3_pool(x)
        x = self.block3_dropout(x)

        x = self.gap(x)                    # (B, 128, 1, 1)
        x = x.view(x.size(0), -1)          # (B, 128)
        x = self.head_dropout(x)           # stochastic in train mode → MC-Dropout
        x = torch.relu(self.head_dense(x))
        x = self.predictions(x)            # (B, 7)  raw logits
        return x


def build_model(
    num_classes: int = NUM_CLASSES,
    head_dropout_rate: float = 0.4,
    device: Optional[torch.device] = None,
) -> HAM10000CNN:
    """Instantiate and move HAM10000CNN to the target device."""
    if device is None:
        device = get_device()
    return HAM10000CNN(
        num_classes=num_classes,
        head_dropout_rate=head_dropout_rate,
    ).to(device)


def train_model(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    epochs: int = 30,
    batch_size: int = 32,
    learning_rate: float = 1e-3,
    head_dropout_rate: float = 0.4,
    lr_factor: float = 0.5,
    lr_patience: int = 5,
    lr_min: float = 1e-6,
    es_patience: int = 12,
    device: Optional[torch.device] = None,
) -> Tuple[HAM10000CNN, Dict]:
    """
    Build, compile, and train the CNN.
    Best model selected by minimum validation loss (not final epoch).

    Returns
    -------
    model   : HAM10000CNN restored to best-val-loss weights
    history : {train_loss, val_loss, train_acc, val_acc,
               best_epoch, best_val_loss, best_val_acc}
    """
    if device is None:
        device = get_device()

    train_loader, val_loader = make_dataloaders(
        X_train, y_train, X_val, y_val, batch_size=batch_size,
    )

    model     = build_model(head_dropout_rate=head_dropout_rate, device=device)
    criterion = nn.CrossEntropyLoss(weight=compute_weights(y_train, device=device))
    optimizer = optim.Adam(model.parameters(), lr=learning_rate)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min",
        factor=lr_factor, patience=lr_patience, min_lr=lr_min, verbose=True,
    )

    history: Dict[str, List] = {
        "train_loss": [], "val_loss": [],
        "train_acc":  [], "val_acc":  [],
    }

    best_val_loss  = float("inf")
    best_val_acc   = 0.0
    best_epoch     = 0
    best_state     = None          # CPU copy of best weights
    best_optim     = None          # CPU copy of optimizer state at best epoch
    no_improve     = 0

    for epoch in range(1, epochs + 1):

        model.train()
        run_loss, correct, total = 0.0, 0, 0
        for imgs, lbls in train_loader:
            imgs, lbls = imgs.to(device, non_blocking=True), \
                         lbls.to(device, non_blocking=True)
            optimizer.zero_grad()
            logits = model(imgs)
            loss   = criterion(logits, lbls)
            loss.backward()
            optimizer.step()
            run_loss += loss.item() * imgs.size(0)
            correct  += (logits.argmax(1) == lbls).sum().item()
            total    += imgs.size(0)

        train_loss = run_loss / total
        train_acc  = correct  / total

        model.eval()
        v_loss, v_correct, v_total = 0.0, 0, 0
        with torch.no_grad():
            for imgs, lbls in val_loader:
                imgs, lbls = imgs.to(device, non_blocking=True), \
                             lbls.to(device, non_blocking=True)
                logits  = model(imgs)
                v_loss += criterion(logits, lbls).item() * imgs.size(0)
                v_correct += (logits.argmax(1) == lbls).sum().item()
                v_total   += imgs.size(0)

        val_loss = v_loss    / v_total
        val_acc  = v_correct / v_total

        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        history["train_acc"].append(train_acc)
        history["val_acc"].append(val_acc)

        scheduler.step(val_loss)
        current_lr = optimizer.param_groups[0]["lr"]
        print(
            f"Epoch {epoch:03d}/{epochs}  "
            f"train_loss={train_loss:.4f}  train_acc={train_acc:.4f}  "
            f"val_loss={val_loss:.4f}  val_acc={val_acc:.4f}  "
            f"lr={current_lr:.2e}"
        )

        if val_loss < best_val_loss - 1e-5:
            best_val_loss = val_loss
            best_val_acc  = val_acc
            best_epoch    = epoch
            best_state    = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            best_optim    = {k: (v.cpu().clone() if isinstance(v, torch.Tensor) else v)
                             for k, v in optimizer.state_dict().items()
                             if k != "state"}   # skip large param-state
            no_improve    = 0
            print(f"   New best val_loss={best_val_loss:.4f}  (epoch {best_epoch})")
        else:
            no_improve += 1
            if no_improve >= es_patience:
                print(f"EarlyStopping after {es_patience} non-improving epochs.")
                break

    # Restore best weights
    if best_state is not None:
        model.load_state_dict({k: v.to(device) for k, v in best_state.items()})
        print(f"Restored best weights from epoch {best_epoch}.")

    history["best_epoch"]    = best_epoch
    history["best_val_loss"] = best_val_loss
    history["best_val_acc"]  = best_val_acc

    return model, history


def plot_history(
    history: Dict,
    save_dir: Optional[Path | str] = None,
) -> None:
    """
    Plot and save loss_curve.png + accuracy_curve.png.

    Parameters
    history  : dict returned by train_model()
    save_dir : e.g. PROJECT_ROOT / "figures" / "training"
    """
    if save_dir is not None:
        save_dir = Path(save_dir)
        save_dir.mkdir(parents=True, exist_ok=True)

    n_epochs = len(history["train_loss"])
    epochs   = range(1, n_epochs + 1)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(epochs, history["train_loss"], label="Train loss")
    ax.plot(epochs, history["val_loss"],   label="Val loss")
    if "best_epoch" in history:
        ax.axvline(history["best_epoch"], color="gray",
                   linestyle="--", alpha=0.7, label=f"Best epoch {history['best_epoch']}")
    ax.set_title("Training vs Validation Loss")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Loss")
    ax.legend()
    ax.grid(True, linestyle="--", alpha=0.5)
    plt.tight_layout()
    if save_dir is not None:
        p = save_dir / "loss_curve.png"
        fig.savefig(p, dpi=150)
        print(f"Saved: {p}")
    plt.show()
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(epochs, history["train_acc"], label="Train accuracy")
    ax.plot(epochs, history["val_acc"],   label="Val accuracy")
    if "best_epoch" in history:
        ax.axvline(history["best_epoch"], color="gray",
                   linestyle="--", alpha=0.7, label=f"Best epoch {history['best_epoch']}")
    ax.set_title("Training vs Validation Accuracy")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Accuracy")
    ax.legend()
    ax.grid(True, linestyle="--", alpha=0.5)
    plt.tight_layout()
    if save_dir is not None:
        p = save_dir / "accuracy_curve.png"
        fig.savefig(p, dpi=150)
        print(f"Saved: {p}")
    plt.show()
    plt.close(fig)


def save_history_csv(
    history: Dict,
    save_path: Path | str,
) -> None:
    """
    Save per-epoch metrics to a CSV file.

    Columns: epoch, train_loss, val_loss, train_acc, val_acc

    Parameters
    history   : dict returned by train_model()
    save_path : e.g. PROJECT_ROOT / "figures" / "training" / "training_history.csv"
    """
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    n = len(history["train_loss"])
    with open(save_path, "w", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["epoch", "train_loss", "val_loss", "train_acc", "val_acc"]
        )
        writer.writeheader()
        for i in range(n):
            writer.writerow({
                "epoch":      i + 1,
                "train_loss": f"{history['train_loss'][i]:.6f}",
                "val_loss":   f"{history['val_loss'][i]:.6f}",
                "train_acc":  f"{history['train_acc'][i]:.6f}",
                "val_acc":    f"{history['val_acc'][i]:.6f}",
            })
    print(f"Saved: {save_path}")


def save_model(model: HAM10000CNN, save_path: Path | str) -> None:
    """
    Save the model state-dict only to a .pt file.
    Loadable by torch.load() + model.load_state_dict().
    Used for lightweight inference loading by Person 3 and Person 4.
    """
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), save_path)
    print(f"Saved: {save_path}")


def save_checkpoint(
    model: HAM10000CNN,
    optimizer: torch.optim.Optimizer,
    history: Dict,
    save_path: Path | str,
    head_dropout_rate: float = 0.4,
) -> None:
    """
    Save a full training checkpoint containing everything needed to
    resume training or fully reconstruct the model for Person 3/4.

    Checkpoint keys
    model_state_dict    : model weights (best epoch, by val_loss)
    optimizer_state_dict: optimizer state at best epoch
    epoch               : best epoch number
    best_val_loss       : best validation loss
    best_val_accuracy   : validation accuracy at best epoch
    class_names         : CLASS_NAMES list
    input_shape         : [224, 224, 3]
    num_classes         : 7
    model_config        : architecture hyperparameters dict
    train_loss          : full per-epoch list
    val_loss            : full per-epoch list
    train_acc           : full per-epoch list
    val_acc             : full per-epoch list

    Parameters
    model             : trained HAM10000CNN (already at best weights)
    optimizer         : optimizer object at end of training
    history           : dict returned by train_model()
    save_path         : e.g. PROJECT_ROOT / "model" / "model_checkpoint.pt"
    head_dropout_rate : value used when building the model
    """
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint = {
        "model_state_dict":     {k: v.cpu() for k, v in model.state_dict().items()},
        "optimizer_state_dict": optimizer.state_dict(),
        "epoch":                history.get("best_epoch", len(history["train_loss"])),
        "best_val_loss":        history.get("best_val_loss", min(history["val_loss"])),
        "best_val_accuracy":    history.get("best_val_acc",
                                            history["val_acc"][
                                                history["val_loss"].index(
                                                    min(history["val_loss"]))]),
        "class_names":          CLASS_NAMES,
        "input_shape":          list(INPUT_SHAPE),
        "num_classes":          NUM_CLASSES,
        "model_config": {
            "architecture":       "HAM10000CNN",
            "blocks":             3,
            "filters":            [32, 64, 128],
            "kernel_size":        3,
            "pooling":            "AdaptiveAvgPool2d",
            "head_units":         128,
            "head_dropout_rate":  head_dropout_rate,
            "last_conv_name":     "last_conv",
            "head_dropout_name":  "head_dropout",
        },
        "train_loss": history["train_loss"],
        "val_loss":   history["val_loss"],
        "train_acc":  history["train_acc"],
        "val_acc":    history["val_acc"],
    }
    torch.save(checkpoint, save_path)
    print(f"Saved: {save_path}")


def save_class_mapping(save_path: Path | str) -> None:
    """
    Save label_to_idx as class_mapping.json.

    Content
    { "akiec": 0, "bcc": 1, "bkl": 2, "df": 3,
      "mel": 4, "nv": 5, "vasc": 6 }
    """
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    with open(save_path, "w") as f:
        json.dump(label_to_idx, f, indent=2)
    print(f"Saved: {save_path}")


def save_model_config(
    save_path: Path | str,
    head_dropout_rate: float = 0.4,
) -> None:
    """
    Save model_config.json with architecture details needed by Person 3/4.

    Content
    input_shape, num_classes, architecture details,
    last_conv layer name, head_dropout layer name.
    """
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    config = {
        "input_shape":        list(INPUT_SHAPE),   # [224, 224, 3]
        "num_classes":         NUM_CLASSES,
        "class_names":         CLASS_NAMES,
        "architecture":        "HAM10000CNN",
        "backend":             "PyTorch",
        "blocks":              3,
        "block_filters":       [32, 64, 128],
        "kernel_size":         3,
        "block_dropout":       0.25,
        "pooling":             "AdaptiveAvgPool2d",
        "head_units":          128,
        "head_dropout_rate":   head_dropout_rate,
        "last_conv_name":      "last_conv",
        "head_dropout_name":   "head_dropout",
        "notes": {
            "grad_cam":    "Register forward hook on model.last_conv",
            "mc_dropout":  "Call model.train() then torch.no_grad() for stochastic passes",
            "deterministic": "Call model.eval() for deterministic predictions",
        },
    }
    with open(save_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"Saved: {save_path}")


def load_model(
    save_path: Path | str,
    device: Optional[torch.device] = None,
    head_dropout_rate: float = 0.4,
) -> HAM10000CNN:
    """
    Load ham10000_cnn.pt (state-dict) into a fresh HAM10000CNN.

    Parameters
    save_path         : path to .pt file written by save_model()
    device            : defaults to get_device()
    head_dropout_rate : must match the training value (default 0.4)

    Returns
    HAM10000CNN in eval() mode on device
    """
    if device is None:
        device = get_device()
    model = build_model(head_dropout_rate=head_dropout_rate, device=device)
    state = torch.load(save_path, map_location=device)
    model.load_state_dict(state)
    model.eval()
    print(f"Loaded: {save_path}  →  device={device}")
    return model


def load_checkpoint(
    save_path: Path | str,
    device: Optional[torch.device] = None,
) -> Tuple[HAM10000CNN, Dict]:
    """
    Load a full checkpoint saved by save_checkpoint().

    Returns
    (model, checkpoint_dict)
    model is in eval() mode on device.
    """
    if device is None:
        device = get_device()
    ckpt  = torch.load(save_path, map_location=device)
    cfg   = ckpt["model_config"]
    model = build_model(
        num_classes=ckpt["num_classes"],
        head_dropout_rate=cfg["head_dropout_rate"],
        device=device,
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    print(f"Loaded checkpoint: {save_path}  (best epoch={ckpt['epoch']}, "
          f"best_val_loss={ckpt['best_val_loss']:.4f})")
    return model, ckpt
