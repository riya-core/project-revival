"""
uncertainty/uncertainty.py - Person 3
MC Dropout uncertainty estimation for the DenseNet121 + Dropout model.

Idea: keep Dropout ON at prediction time, run T stochastic passes, and use the
spread of the T predictions as the uncertainty. Only Dropout layers are
switched on; BatchNorm layers stay in eval mode.

Because the only dropout is in the classifier head, the (expensive) feature
extractor is run once and only the head is repeated T times. This is
mathematically identical to T full forward passes.
"""
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

T_DEFAULT = 50
EPS = 1e-12


def enable_mc_dropout(module: nn.Module) -> int:
    """eval() everything, then switch ONLY Dropout layers to train mode.
    Returns the number of Dropout layers switched on."""
    module.eval()
    n = 0
    for m in module.modules():
        if isinstance(m, (nn.Dropout, nn.Dropout2d, nn.Dropout3d)):
            m.train()
            n += 1
    return n


@torch.no_grad()
def extract_embeddings(model, X_uint8, to_input_fn, batch_size=32):
    """Run the feature extractor once (deterministic). Returns (N, 1024)."""
    model.eval()
    out = []
    for i in range(0, len(X_uint8), batch_size):
        f = model.features(to_input_fn(X_uint8[i:i + batch_size]))
        f = F.adaptive_avg_pool2d(F.relu(f), (1, 1)).flatten(1)
        out.append(f.numpy())
    return np.concatenate(out)


@torch.no_grad()
def mc_predict_from_embeddings(model, emb, T=T_DEFAULT, batch_size=512):
    """T stochastic passes through the Dropout head. Returns probs (T, N, C)."""
    head = model.classifier
    assert enable_mc_dropout(head) >= 1, "model has no Dropout layer!"
    emb_t = torch.from_numpy(np.ascontiguousarray(emb)).float()
    N = emb_t.shape[0]
    C = head(emb_t[:1]).shape[1]
    probs = torch.empty(T, N, C)
    for t in range(T):
        for i in range(0, N, batch_size):
            probs[t, i:i + batch_size] = F.softmax(head(emb_t[i:i + batch_size]), dim=1)
    head.eval()                                    # restore normal mode
    return probs.numpy()


def summarize(probs):
    """probs (T, N, C) -> dict of per-image prediction + uncertainty scores."""
    P = np.asarray(probs, dtype=np.float64)
    T, N, C = P.shape
    mean = P.mean(axis=0)                          # (N, C)
    pred = mean.argmax(axis=1)
    std_pred = P.std(axis=0)[np.arange(N), pred]   # std of predicted class prob
    entropy = -(mean * np.log(mean + EPS)).sum(1)  # total uncertainty
    exp_entropy = -(P * np.log(P + EPS)).sum(2).mean(0)
    mutual_info = np.maximum(entropy - exp_entropy, 0.0)   # model uncertainty
    return {
        "mean_probs": mean, "pred": pred, "confidence": mean.max(axis=1),
        "std_pred": std_pred, "entropy": entropy, "mutual_info": mutual_info,
    }


