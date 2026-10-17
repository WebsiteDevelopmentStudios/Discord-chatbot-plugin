#!/usr/bin/env python3
"""Train and query Zoi's subject-routing neural network."""
from pathlib import Path
import json, sys
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common import load_jsonl, train_classifier, predict_classifier
DATA = HERE / "data" / "training.jsonl"
MODEL = HERE / "artifacts" / "model.json"

def main():
    args = sys.argv[1:]
    command = args[0] if args else "train"
    if command == "train":
        result = train_classifier(load_jsonl(DATA), MODEL.parent, epochs=550, seed=29)
        print(json.dumps({"model":"knowledge-topic", "status":"trained", **result}, indent=2))
    elif command == "predict" and len(args) >= 2:
        print(json.dumps(predict_classifier(" ".join(args[1:]), MODEL), indent=2))
    else:
        raise SystemExit('Usage: python ai.py train | predict "question"')
if __name__ == "__main__":
    main()
