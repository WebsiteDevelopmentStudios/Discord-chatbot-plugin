# Tiny language model

This is a real, trainable feed-forward neural network that predicts the next token from the previous token. It is deliberately small and trained from scratch using the local `data/corpus.txt` file.

```bash
python -m pip install -r api/models/requirements.txt
python api/models/language/ai.py train
python api/models/language/ai.py generate "zoi is"
```

This model demonstrates training and inference; it is **not a general-purpose conversational language model**. A one-token context cannot track long-range meaning, and a small corpus cannot teach broad world knowledge. Expect repetitive or inaccurate generated text. Expand and clean the corpus, evaluate on held-out examples, and consider compute and licensing before moving to a larger architecture.
