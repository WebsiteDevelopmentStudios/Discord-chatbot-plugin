# Zoi model lab

This directory contains small local neural-network experiments. They require no paid AI API and do not download pretrained model weights.

## Existing experiments

- `intent/`: classifies likely conversational intent from example utterances.
- `knowledge/`: classifies likely subject area to help route a query to knowledge documents.
- `language/`: learns a tiny next-token predictor from a local text corpus. This is an educational toy model, not a GPT-class language model.

The existing Node.js API does not automatically load these Python artifacts. Keep this limitation in mind when evaluating the current live API.

## New GPT training experiment

`gpt/` adds a small byte-level, decoder-only transformer trained from scratch with PyTorch. It is inspired by educational GPT implementations, but it is **not the original picoGPT repository**: picoGPT's original implementation focuses on inference and does not include the training loop needed here. This experiment starts with random weights and no pretrained model or paid AI API.

### Prepare the three sources

Use Python 3.10+:

```bash
python -m pip install -r api/models/gpt/requirements.txt
python api/models/gpt/prepare_data.py --per-source 1000
```

The script streams capped samples from:

- OpenAssistant OASST1: English user/assistant parent-linked examples.
- TinyStories: short stories for language-pattern learning.
- Wikimedia Wikipedia English snapshot: article text for broad factual-language exposure.

It writes `api/models/gpt/data/train.jsonl`, which is ignored by Git because it contains downloaded source text. The default is at most 1,000 usable records per source. Increase the cap gradually after checking disk, RAM, and training time. This is a sample, not a complete download of any dataset.

### Train from scratch

```bash
python api/models/gpt/train.py train --steps 1500 --cpu
python api/models/gpt/train.py generate "User: Why are oranges orange?\nAssistant:"
```

The checkpoint is written to `api/models/gpt/checkpoints/zoi-gpt.pt`, also ignored by Git. Use `--steps`, `--block-size`, `--width`, `--layers`, `--heads`, and `--batch-size` to adjust the experiment. CPU training is supported; a CUDA-enabled PyTorch environment is used automatically unless `--cpu` is supplied.

The training script logs training and validation next-token loss. Lower validation loss indicates better prediction of held-out bytes; it does **not** prove factual correctness or good conversation quality. A tiny byte-level model trained for a few hundred or thousand steps is a prototype, not a capable assistant by itself.

### GitHub Actions experiment

The workflow `.github/workflows/train-zoi-gpt.yml` is manual-only. In GitHub, open **Actions → Prepare and train Zoi GPT → Run workflow**, select this branch, and choose the record cap and training steps. It prepares a bounded sample, trains on CPU, and uploads the resulting checkpoint as a short-lived artifact. It does not deploy the model or change the live API.

### Licensing and data handling

Check each upstream dataset card and license before training or sharing generated artifacts. OASST1 is published under Apache 2.0; TinyStories uses CDLA-Sharing-1.0; Wikipedia text is generally CC BY-SA 4.0. Keep source provenance, comply with attribution/share-alike or other applicable conditions, and do not redistribute the prepared text dataset or trained weights without reviewing the relevant terms. The pipeline keeps prepared text and checkpoints out of Git by default.

### Important integration boundary

This is the **training/data pipeline stage only**. It does not yet connect GPT inference to the live Node.js API, automatically replace existing answers, or automatically train on user conversations. After verifying that preparation works and validation loss improves, model quality and licensing must be evaluated before integrating it into Zoi's live response path.
