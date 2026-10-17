# Knowledge topic model

This neural network predicts a broad topic label (such as `ai_ml`, `programming`, `science`, or `security`) from a question. It is a router, not a factual knowledge source; the existing Zoi knowledge base must still provide the actual answer.

```bash
python -m pip install -r api/models/requirements.txt
python api/models/knowledge/ai.py train
python api/models/knowledge/ai.py predict "how do language models learn"
```

Add examples that cover varied wording and topics. Do not interpret the highest score as proof that a topic or answer is correct.
