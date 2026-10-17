#!/usr/bin/env python3
"""Train a tiny next-token neural network from the local corpus."""
from pathlib import Path
import json, re, sys
import numpy as np

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "data" / "corpus.txt"
MODEL = HERE / "artifacts" / "model.json"
def tokenize(text):
    return re.findall(r"[a-z0-9']+|[.!?,]", text.lower())

def train():
    corpus = CORPUS.read_text(encoding="utf-8")
    sequences = [tokenize(line) for line in corpus.splitlines() if line.strip()]
    tokens = [t for seq in sequences for t in seq]
    vocab_list = sorted(set(tokens))
    if len(vocab_list) < 4 or len(tokens) < 30:
        raise ValueError("Corpus is too small; add more sentences to data/corpus.txt.")
    vocab = {token:i for i, token in enumerate(vocab_list)}
    pairs = [(vocab[a], vocab[b]) for seq in sequences for a,b in zip(seq, seq[1:])]
    if len(pairs) < 20:
        raise ValueError("Need more adjacent-token examples to train.")
    x_ids = np.array([a for a,_ in pairs], dtype=np.int64)
    y_ids = np.array([b for _,b in pairs], dtype=np.int64)
    size = len(vocab)
    rng = np.random.default_rng(41)
    hidden_size = min(48, max(12, size))
    w1 = rng.normal(0, .12, (size, hidden_size)).astype(np.float32)
    b1 = np.zeros(hidden_size, dtype=np.float32)
    w2 = rng.normal(0, .12, (hidden_size, size)).astype(np.float32)
    b2 = np.zeros(size, dtype=np.float32)
    lr = .04
    epochs = 300
    for _ in range(epochs):
        order = rng.permutation(len(pairs))
        for start in range(0, len(order), 24):
            batch = order[start:start+24]
            ids, targets = x_ids[batch], y_ids[batch]
            xb = np.zeros((len(batch), size), dtype=np.float32)
            xb[np.arange(len(batch)), ids] = 1.0
            pre = xb @ w1 + b1
            h = np.maximum(pre, 0)
            logits = h @ w2 + b2
            logits -= logits.max(axis=1, keepdims=True)
            probs = np.exp(logits); probs /= probs.sum(axis=1, keepdims=True)
            probs[np.arange(len(batch)), targets] -= 1
            probs /= len(batch)
            dw2 = h.T @ probs; db2 = probs.sum(axis=0)
            dh = (probs @ w2.T) * (pre > 0)
            dw1 = xb.T @ dh; db1 = dh.sum(axis=0)
            w1 -= lr*dw1; b1 -= lr*db1
            w2 -= lr*dw2; b2 -= lr*db2
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    artifact = {"format":"zoi-tiny-next-token-mlp-v1","vocabulary":vocab_list,
                "weights":[w1.tolist(),b1.tolist(),w2.tolist(),b2.tolist()],
                "training_tokens":len(tokens),"training_pairs":len(pairs),"epochs":epochs}
    MODEL.write_text(json.dumps(artifact,separators=(",",":")),encoding="utf-8")
    print(json.dumps({"model":"tiny-language","status":"trained","vocabulary_size":size,
                      "tokens":len(tokens),"training_pairs":len(pairs),"epochs":epochs,
                      "artifact":str(MODEL)},indent=2))

def generate(prompt, count=24):
    if not MODEL.exists():
        raise FileNotFoundError(f"No trained model at {MODEL}. Run: python ai.py train")
    model = json.loads(MODEL.read_text(encoding="utf-8"))
    if model.get("format") != "zoi-tiny-next-token-mlp-v1":
        raise ValueError("Unsupported model artifact format.")
    vocab_list = model["vocabulary"]; vocab = {t:i for i,t in enumerate(vocab_list)}
    w1,b1,w2,b2 = [np.asarray(v,dtype=np.float32) for v in model["weights"]]
    words = tokenize(prompt)
    if not words:
        words = ["zoi"]
    result = list(words)
    current = vocab.get(words[-1], vocab.get("zoi", 0))
    for _ in range(max(1,min(int(count),80))):
        x = np.zeros((1,len(vocab_list)),dtype=np.float32); x[0,current] = 1
        hidden = np.maximum(x @ w1 + b1, 0)
        logits = (hidden @ w2 + b2)[0]
        # Prefer learned likely transitions; deterministic greedy output keeps tests repeatable.
        current = int(np.argmax(logits))
        result.append(vocab_list[current])
        if vocab_list[current] in {".","!","?"} and len(result) > len(words)+4:
            break
    print(json.dumps({"prompt":prompt,"generated_text":" ".join(result),
                      "warning":"Toy next-token model trained only on this small corpus; output may be repetitive or inaccurate."},indent=2))

if __name__ == "__main__":
    args=sys.argv[1:]
    command=args[0] if args else "train"
    if command=="train": train()
    elif command=="generate" and len(args)>=2: generate(" ".join(args[1:]))
    else: raise SystemExit('Usage: python ai.py train | generate "starting text"')
