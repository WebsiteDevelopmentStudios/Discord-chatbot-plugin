# Intent model

A small feed-forward neural network trained on `data/training.jsonl`. It learns from labeled example messages and predicts a broad intent label. Add varied paraphrases to the JSONL data, keeping one valid JSON object per line with `text` and `label` fields.

Run from the repository root:
```bash
python -m pip install -r api/models/requirements.txt
python api/models/intent/ai.py train
python api/models/intent/ai.py predict "what kind of work do you do"
``

The confidence score is not calibrated. This model is small and its performance is limited by the amount and diversity of training data.
