#!/usr/bin/env python3
"""Train a small byte-level GPT-style transformer from prepared local text.

This is a new, trainable implementation inspired by educational GPT projects. It is
not the original picoGPT code and it does not use pretrained weights or paid APIs.
"""
from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Any

import torch
from torch import nn
from torch.nn import functional as F

HERE = Path(__file__).resolve().parent
DEFAULT_DATA = HERE / "data" / "train.jsonl"
DEFAULT_CHECKPOINT = HERE / "checkpoints" / "zoi-gpt.pt"
VOCAB_SIZE = 257  # token 0 = end-of-record; bytes 0..255 are shifted by +1


def encode(text: str) -> list[int]:
    return [byte + 1 for byte in text.encode("utf-8", errors="replace")]


def load_records(path: Path, max_records: int = 0) -> tuple[list[int], dict[str, int]]:
    if not path.exists():
        raise FileNotFoundError(
            f"Training data not found at {path}. Run prepare_data.py first."
        )
    tokens = [0]
    counts: dict[str, int] = {}
    records = 0
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: invalid JSONL record") from exc
            text = item.get("text")
            source = item.get("source", "unknown")
            if not isinstance(text, str) or not text.strip():
                continue
            tokens.extend(encode(text))
            tokens.append(0)
            counts[source] = counts.get(source, 0) + 1
            records += 1
            if max_records and records >= max_records:
                break
    if len(tokens) < 512:
        raise ValueError("Need at least 512 byte tokens; prepare more training text.")
    return tokens, counts


class CausalSelfAttention(nn.Module):
    def __init__(self, width: int, heads: int, dropout: float):
        super().__init__()
        if width % heads:
            raise ValueError("embedding width must be divisible by attention heads")
        self.heads = heads
        self.head_width = width // heads
        self.qkv = nn.Linear(width, width * 3)
        self.proj = nn.Linear(width, width)
        self.dropout = dropout

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch, length, width = x.shape
        q, k, v = self.qkv(x).split(width, dim=-1)
        shape = (batch, length, self.heads, self.head_width)
        q = q.view(shape).transpose(1, 2)
        k = k.view(shape).transpose(1, 2)
        v = v.view(shape).transpose(1, 2)
        attended = F.scaled_dot_product_attention(
            q, k, v, dropout_p=self.dropout if self.training else 0.0, is_causal=True
        )
        attended = attended.transpose(1, 2).contiguous().view(batch, length, width)
        return self.proj(attended)


class Block(nn.Module):
    def __init__(self, width: int, heads: int, dropout: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(width)
        self.attn = CausalSelfAttention(width, heads, dropout)
        self.ln2 = nn.LayerNorm(width)
        self.mlp = nn.Sequential(
            nn.Linear(width, width * 4),
            nn.GELU(),
            nn.Linear(width * 4, width),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln1(x))
        return x + self.mlp(self.ln2(x))


class ZoiGPT(nn.Module):
    def __init__(self, *, block_size: int = 128, width: int = 128,
                 layers: int = 4, heads: int = 4, dropout: float = 0.1):
        super().__init__()
        self.block_size = block_size
        self.token_embedding = nn.Embedding(VOCAB_SIZE, width)
        self.position_embedding = nn.Embedding(block_size, width)
        self.dropout = nn.Dropout(dropout)
        self.blocks = nn.Sequential(*(Block(width, heads, dropout) for _ in range(layers)))
        self.final_norm = nn.LayerNorm(width)
        self.lm_head = nn.Linear(width, VOCAB_SIZE, bias=False)
        self.lm_head.weight = self.token_embedding.weight
        self.apply(self._init_weights)

    @staticmethod
    def _init_weights(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, ids: torch.Tensor, targets: torch.Tensor | None = None):
        _, length = ids.shape
        if length > self.block_size:
            raise ValueError("input exceeds configured block size")
        positions = torch.arange(length, device=ids.device)
        x = self.dropout(self.token_embedding(ids) + self.position_embedding(positions))
        x = self.blocks(x)
        logits = self.lm_head(self.final_norm(x))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), targets.reshape(-1))
        return logits, loss


def batch_from(data: torch.Tensor, batch_size: int, block_size: int,
               device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    if len(data) <= block_size + 1:
        raise ValueError("training corpus is shorter than the context window")
    starts = torch.randint(0, len(data) - block_size - 1, (batch_size,))
    x = torch.stack([data[i:i + block_size] for i in starts.tolist()])
    y = torch.stack([data[i + 1:i + block_size + 1] for i in starts.tolist()])
    return x.to(device), y.to(device)


@torch.no_grad()
def estimate_loss(model: ZoiGPT, data: torch.Tensor, batch_size: int,
                  block_size: int, device: torch.device, batches: int = 8) -> float:
    model.eval()
    losses = []
    for _ in range(batches):
        x, y = batch_from(data, batch_size, block_size, device)
        _, loss = model(x, y)
        losses.append(float(loss.item()))
    model.train()
    return sum(losses) / len(losses)


def train(args: argparse.Namespace) -> dict[str, Any]:
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    all_tokens, source_counts = load_records(args.data, args.max_records)
    split = max(args.block_size + 2, int(len(all_tokens) * 0.95))
    split = min(split, len(all_tokens) - args.block_size - 2)
    train_data = torch.tensor(all_tokens[:split], dtype=torch.long)
    val_data = torch.tensor(all_tokens[split:], dtype=torch.long)
    if len(val_data) <= args.block_size + 1:
        raise ValueError("Not enough data for validation; prepare a larger dataset.")
    model = ZoiGPT(block_size=args.block_size, width=args.width,
                   layers=args.layers, heads=args.heads, dropout=args.dropout).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    initial_loss = estimate_loss(model, val_data, args.batch_size, args.block_size, device)
    model.train()
    for step in range(1, args.steps + 1):
        x, y = batch_from(train_data, args.batch_size, args.block_size, device)
        _, loss = model(x, y)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        if step == 1 or step % args.log_every == 0 or step == args.steps:
            print(json.dumps({"step": step, "steps": args.steps,
                              "train_loss": round(float(loss.item()), 4),
                              "validation_loss": round(estimate_loss(
                                  model, val_data, args.batch_size, args.block_size, device
                              ), 4)}), flush=True)

    final_loss = estimate_loss(model, val_data, args.batch_size, args.block_size, device)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = {
        "format": "zoi-gpt-byte-v1",
        "model_config": {"block_size": args.block_size, "width": args.width,
                         "layers": args.layers, "heads": args.heads, "dropout": args.dropout},
        "model_state_dict": model.cpu().state_dict(),
        "vocab_size": VOCAB_SIZE,
        "token_encoding": "UTF-8 bytes shifted by one; token 0 is record separator",
        "source_counts": source_counts,
        "training_tokens": len(all_tokens),
        "steps": args.steps,
        "initial_validation_loss": initial_loss,
        "final_validation_loss": final_loss,
        "seed": args.seed,
        "trained_from_scratch": True,
    }
    torch.save(checkpoint, args.output)
    result = {
        "status": "trained",
        "architecture": "small byte-level GPT-style decoder transformer",
        "device": str(device),
        "parameters": sum(p.numel() for p in model.parameters()),
        "source_records": source_counts,
        "training_tokens": len(all_tokens),
        "steps": args.steps,
        "initial_validation_loss": round(initial_loss, 4),
        "final_validation_loss": round(final_loss, 4),
        "checkpoint": str(args.output),
        "note": "A lower validation loss indicates better next-byte prediction, not factual accuracy.",
    }
    print(json.dumps(result, indent=2))
    return result


def generate(checkpoint_path: Path, prompt: str, max_new_tokens: int,
             temperature: float, top_k: int, cpu: bool) -> str:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")
    # Only load checkpoints produced by this project's own training script.
    try:
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    except TypeError:  # Compatibility with older PyTorch versions.
        checkpoint = torch.load(checkpoint_path, map_location="cpu")
    if checkpoint.get("format") != "zoi-gpt-byte-v1":
        raise ValueError("Unsupported checkpoint format")
    config = checkpoint["model_config"]
    device = torch.device("cuda" if torch.cuda.is_available() and not cpu else "cpu")
    model = ZoiGPT(**config)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device).eval()
    ids = torch.tensor([encode(prompt)], dtype=torch.long, device=device)
    if ids.shape[1] == 0:
        ids = torch.zeros((1, 1), dtype=torch.long, device=device)
    with torch.no_grad():
        for _ in range(max(0, min(max_new_tokens, 1000))):
            context = ids[:, -model.block_size:]
            logits, _ = model(context)
            logits = logits[:, -1, :] / max(temperature, 0.05)
            if top_k > 0:
                values, _ = torch.topk(logits, min(top_k, logits.shape[-1]))
                logits[logits < values[:, [-1]]] = -float("inf")
            next_id = torch.multinomial(torch.softmax(logits, dim=-1), num_samples=1)
            if int(next_id.item()) == 0:
                break
            ids = torch.cat((ids, next_id), dim=1)
    generated = ids[0, len(encode(prompt)):].tolist()
    raw = bytes(token - 1 for token in generated if 1 <= token <= 256)
    return raw.decode("utf-8", errors="replace")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    fit = sub.add_parser("train", help="train from prepared JSONL")
    fit.add_argument("--data", type=Path, default=DEFAULT_DATA)
    fit.add_argument("--output", type=Path, default=DEFAULT_CHECKPOINT)
    fit.add_argument("--steps", type=int, default=1500)
    fit.add_argument("--max-records", type=int, default=0,
                     help="optional cap across input records; 0 means all")
    fit.add_argument("--block-size", type=int, default=128)
    fit.add_argument("--width", type=int, default=128)
    fit.add_argument("--layers", type=int, default=4)
    fit.add_argument("--heads", type=int, default=4)
    fit.add_argument("--dropout", type=float, default=0.1)
    fit.add_argument("--batch-size", type=int, default=16)
    fit.add_argument("--learning-rate", type=float, default=3e-4)
    fit.add_argument("--log-every", type=int, default=100)
    fit.add_argument("--seed", type=int, default=41)
    fit.add_argument("--cpu", action="store_true")
    sample = sub.add_parser("generate", help="sample text from a trained checkpoint")
    sample.add_argument("prompt")
    sample.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    sample.add_argument("--max-new-tokens", type=int, default=160)
    sample.add_argument("--temperature", type=float, default=0.8)
    sample.add_argument("--top-k", type=int, default=40)
    sample.add_argument("--cpu", action="store_true")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "train":
        if args.steps < 1 or args.block_size < 16 or args.width < 16:
            parser.error("steps must be positive; block-size and width must be at least 16")
        if args.layers < 1 or args.heads < 1 or args.batch_size < 1 or args.log_every < 1:
            parser.error("layers, heads, batch-size, and log-every must be positive")
        train(args)
    else:
        print(generate(args.checkpoint, args.prompt, args.max_new_tokens,
                       args.temperature, args.top_k, args.cpu))


if __name__ == "__main__":
    main()
