# Uncertainty Estimation and Evaluation (Person 3)

MC Dropout uncertainty and GREEN/YELLOW/RED triage for the DenseNet121 + Dropout model
(`model/densenet121_ham10000_lesion_dropout.pt`, trained by Person 2).

## How it works
- Dropout (p=0.3) is kept ON at prediction time and the classifier head is run T=50 times.
  Only Dropout layers are in train mode; BatchNorm stays in eval mode.
- The feature extractor is deterministic, so it runs once per image and only the head is
  repeated (mathematically identical to 50 full passes; verified in `run_step4.py`).
- **Uncertainty score** = standard deviation of the predicted class's probability over the 50 passes.
- **Triage** (GREEN = confident, YELLOW = somewhat unsure, RED = very unsure, refer to a doctor):
  built with a validation-only protocol. All thresholds and the melanoma safety rule were selected
  with 5-fold cross-validation inside the validation set (grouped by lesion_id; thresholds fitted on
  4 folds, evaluated on the held-out fold), then fitted once on the full validation set and frozen in
  `triage_config.json` (SHA-256 hash). The test set was evaluated once with the frozen configuration
  (`evaluate_triage_test.py`, protected by a lock file).
- Safety rule: a GREEN image predicted as a non-melanoma class with mean melanoma probability >= 0.03
  is moved to YELLOW.

## Use in the dashboard (Person 4)
```python
from uncertainty.predictor import MCDropoutPredictor
predictor = MCDropoutPredictor()          # load once at app start
result = predictor.predict(image)         # file path, PIL image, or numpy RGB array
# keys: class_name, class_index, confidence, uncertainty, triage ("GREEN"/"YELLOW"/"RED"),
#       message, probabilities (dict of 7 classes), mutual_info, entropy
x = predictor.to_tensor(image)            # (1,3,224,224) normalised tensor, e.g. for Grad-CAM
model = predictor.model                   # DenseNet121; use model.features for Grad-CAM
```
Run from the project root. Same image -> same result (seed derived from image content).
If your script lives in a subfolder (e.g. app/dashboard.py), add the project root to sys.path first.

## Results (lesion-level test set, 2014 images)
- MC-mean accuracy 0.8123, macro F1 0.6567, weighted F1 0.8187 (Person 2's model: 0.8113 / 0.6557)
- GREEN 49.5% of images, accuracy 94.0% | YELLOW 26.1%, 80.4% | RED 24.5%, 56.4%
- 73 of 78 wrongly predicted melanomas fall in YELLOW/RED; 5 remain in GREEN.
- Uncertainty vs plain softmax confidence for spotting errors (AUROC): 0.798 vs 0.779.

## Limitations
- Dropout is only in the last layer, so the model can still be confidently wrong
  (uncertainty cannot flag those cases). This is a screening aid, not a diagnosis.
- An earlier triage version was run on the test set before the protocol was rewritten. The final
  configuration was then rebuilt and frozen using validation data only, but the earlier exposure
  cannot be undone.
- Only one threshold candidate met the protocol's requirements, so the choice is fragile.
- Rare classes (e.g. df, 22 test images) give noisy metrics.
- Triage colour can differ for borderline images between independent runs (about 12% of images at T=50, measured with `check_triage_stability.py` on the validation set).

## Reproduce (from project root, HAM10000 images in data/raw/)
1. `python uncertainty/prepare_data_densenet.py`  (builds cache, reproduces Person 2's test metrics)
2. `python uncertainty/run_step4.py`   (MC Dropout + correctness tests)
3. `python uncertainty/fit_triage_validation.py`   (validation-only triage, writes triage_config.json)
4. `python uncertainty/evaluate_triage_test.py`   (single test evaluation; refuses to run twice)
5. `python uncertainty/run_step6.py`   (metrics table, confusion matrix, histograms -> figures/uncertainty/)
6. `python uncertainty/test_predictor.py`   (single-image predictor tests)
7. `python uncertainty/check_triage_stability.py`   (colour stability between two MC runs, validation set)

Cache files (`uncertainty/cache/`) are large and not committed.