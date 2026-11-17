"""
uncertainty/triage.py - Person 3
GREEN / YELLOW / RED triage. Pure functions, no file access.
Everything here is fitted on VALIDATION data only (see protocol).
"""
import hashlib
import json

import numpy as np

GREEN, YELLOW, RED = "GREEN", "YELLOW", "RED"


def fit_thresholds(score, correct, green_acc, red_acc,
                   min_green_frac=0.10, min_red_frac=0.05):
    """Return {'t_green','t_red'} or None if the targets cannot be met.
    GREEN: largest group of lowest-score images with accuracy >= green_acc.
    RED  : largest group of highest-score images with accuracy <= red_acc."""
    score = np.asarray(score, float)
    c = np.asarray(correct, float)
    order = np.argsort(score, kind="stable")
    s, c = score[order], c[order]
    n = len(s)
    k = np.arange(1, n + 1)
    acc_low = np.cumsum(c) / k                      # accuracy of lowest-k images
    acc_high = (np.cumsum(c[::-1]) / k)[::-1]       # accuracy of images i..end
    n_tail = n - np.arange(n)

    ok_g = np.where((acc_low >= green_acc) & (k >= min_green_frac * n))[0]
    if len(ok_g) == 0:
        return None
    t_green = float(s[ok_g.max()])
    ok_r = np.where((acc_high <= red_acc) & (n_tail >= min_red_frac * n)
                    & (s > t_green))[0]
    if len(ok_r) == 0:
        return None
    return {"t_green": t_green, "t_red": float(s[ok_r.min()])}


def triage(score, th):
    """score array -> array of 'GREEN' / 'YELLOW' / 'RED'."""
    score = np.asarray(score, float)
    zone = np.full(score.shape, YELLOW, dtype=object)
    zone[score <= th["t_green"]] = GREEN
    zone[score >= th["t_red"]] = RED
    return zone


def apply_melanoma_rule(zone, mean_probs, pred, cutoff, mel_idx):
    """GREEN image predicted as non-melanoma with mean melanoma probability
    >= cutoff is moved to YELLOW. cutoff=None disables the rule."""
    zone = np.array(zone, dtype=object, copy=True)
    if cutoff is None:
        return zone
    risky = (zone == GREEN) & (pred != mel_idx) & (mean_probs[:, mel_idx] >= cutoff)
    zone[risky] = YELLOW
    return zone


def config_hash(cfg):
    """SHA-256 over all config fields except the hash itself."""
    body = {k: v for k, v in cfg.items() if k != "config_sha256"}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()