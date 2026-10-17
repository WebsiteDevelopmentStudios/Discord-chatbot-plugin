# Zoi model lab

This directory contains three **small, locally trainable neural-network experiments**. They require no paid AI API and do not download pretrained weights.

## Models

- `intent/`: classifies the likely conversational intent from example utterances.
- `knowledge/`: classifies the likely subject area, which can help route a query to the right knowledge documents.
- `language/`: learns a tiny next-token predictor from a local text corpus. This is an educational toy model, **not** a GPT-class language model.

Each model has its own `ai.py`, `data/` directory, and generated `artifacts/` directory. Training examples are committed; generated weights and vocabularies are local outputs and should not be committed automatically.

## Train locally

Use Python 3.10+ and install NumPy:

```bash
python -m pip install -r api/models/requirements.txt
python api/models/intent/ai.py train
python api/models/knowledge/ai.py train
python api/models/language/ai.py train
```

For classifiers, run `python api/models/intent/ai.py predict "what kind of work do you do"` or the equivalent knowledge command. For the language model, run `python api/models/language/ai.py generate "zoi is"`.

Training only creates model artifacts. The existing Node.js API does **not** automatically load these Python artifacts yet; connecting inference to the live API is a separate integration step. Training from scratch on these small example datasets is a learning baseline, not a substitute for a large pretrained model. Do not claim the model knows facts that are absent from its data.
