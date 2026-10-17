"""Shared small NumPy MLP utilities for Zoi's local training experiments."""
from __future__ import annotations
import json
import re
from pathlib import Path
import numpy as np

def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", str(text).lower())

def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc
            if not isinstance(item, dict):
                raise ValueError(f"{path}:{line_no}: each row must be a JSON object")
            rows.append(item)
    return rows

def vectorize(text: str, vocab: dict[str, int]) -> np.ndarray:
    vector = np.zeros(len(vocab), dtype=np.float32)
    for token in tokenize(text):
        index = vocab.get(token)
        if index is not None:
            vector[index] += 1.0
    norm = np.linalg.norm(vector)
    if norm:
        vector /= norm
    return vector

def train_classifier(rows: list[dict], output_dir: Path, *, epochs: int = 450, seed: int = 17) -> dict:
    rows = [r for r in rows if isinstance(r.get("text"), str) and r["text"].strip() and isinstance(r.get("label"), str)]
    if len(rows) < 4:
        raise ValueError("Need at least four labeled training examples.")
    vocab_terms = sorted({t for row in rows for t in tokenize(row["text"])})
    labels = sorted({row["label"] for row in rows})
    if len(vocab_terms) < 2 or len(labels) < 2:
        raise ValueError("Training data must contain multiple terms and labels.")
    vocab = {term: i for i, term in enumerate(vocab_terms)}
    label_ids = {label: i for i, label in enumerate(labels)}
    x = np.stack([vectorize(row["text"], vocab) for row in rows])
    y = np.array([label_ids[row["label"]] for row in rows], dtype=np.int64)
    rng = np.random.default_rng(seed)
    hidden = min(32, max(8, len(vocab) * 2))
    w1 = rng.normal(0, 0.12, (len(vocab), hidden)).astype(np.float32)
    b1 = np.zeros(hidden, dtype=np.float32)
    w2 = rng.normal(0, 0.12, (hidden, len(labels))).astype(np.float32)
    b2 = np.zeros(len(labels), dtype=np.float32)
    lr = 0.08
    for epoch in range(epochs):
        order = rng.permutation(len(rows))
        for start in range(0, len(rows), 16):
            batch = order[start:start + 16]
            xb, yb = x[batch], y[batch]
            h_pre = xb @ w1 + b1
            h = np.maximum(h_pre, 0)
            logits = h @ w2 + b2
            logits -= logits.max(axis=1, keepdims=True)
            probs = np.exp(logits)
            probs /= probs.sum(axis=1, keepdims=True)
            probs[np.arange(len(batch)), yb] -= 1
            probs /= len(batch)
            dw2 = h.T @ probs
            db2 = probs.sum(axis=0)
            dh = (probs @ w2.T) * (h_pre > 0)
            dw1 = xb.T @ dh
            db1 = dh.sum(axis=0)
            w1 -= lr * dw1; b1 -= lr * db1
            w2 -= lr * dw2; b2 -= lr * db2
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact = {
        "format": "zoi-tiny-mlp-v1",
        "vocabulary": vocab,
        "labels": labels,
        "weights": [w1.tolist(), b1.tolist(), w2.tolist(), b2.tolist()],
        "training_examples": len(rows),
        "epochs": epochs,
    }
    (output_dir / "model.json").write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    return {"examples": len(rows), "vocabulary_size": len(vocab), "labels": labels, "epochs": epochs}

def predict_classifier(text: str, model_path: Path) -> dict:
    if not model_path.exists():
        raise FileNotFoundError(f"No trained model at {model_path}. Run this model's ai.py train first.")
    model = json.loads(model_path.read_text(encoding="utf-8"))
    if model.get("format") != "zoi-tiny-mlp-v1":
        raise ValueError("Unsupported model artifact format.")
    vocab = model["vocabulary"]
    w1, b1, w2, b2 = [np.asarray(v, dtype=np.float32) for v in model["weights"]]
    hidden = np.maximum(vectorize(text, vocab) @ w1 + b1, 0)
    logits = hidden @ w2 + b2
    logits -= logits.max()
    probs = np.exp(logits); probs /= probs.sum()
    order = np.argsort(probs)[::-1]
    return {
        "text": text,
        "prediction": model["labels"][int(order[0])],
        "confidence": round(float(probs[order[0]]), 4),
        "alternatives": [{"label": model["labels"][int(i)], "score": round(float(probs[i]), 4)} for i in order[:3]],
        "warning": "Confidence is an uncalibrated model score, not a guarantee of correctness."
    }
