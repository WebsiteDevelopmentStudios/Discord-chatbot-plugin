#!/usr/bin/env python3
"""Prepare capped, deduplicated training text from OASST1, TinyStories, and Wikipedia.

Downloads are streamed from Hugging Face and the resulting dataset stays local.
Review each source's current license and terms before redistributing derived data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

from datasets import load_dataset

HERE = Path(__file__).resolve().parent
DEFAULT_OUTPUT = HERE / "data" / "train.jsonl"
MAX_TEXT_CHARS = 4000


def clean_text(value: Any, limit: int = MAX_TEXT_CHARS) -> str:
    if not isinstance(value, str):
        return ""
    text = value.replace("\x00", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].strip()


def dataset_stream(name: str, *, config: str | None = None):
    kwargs: dict[str, Any] = {"split": "train", "streaming": True}
    if config:
        kwargs["name"] = config
    return load_dataset(name, **kwargs)


def rows_oasst(limit: int) -> Iterable[str]:
    """Build user/assistant pairs from OASST parent links."""
    messages: dict[str, dict[str, Any]] = {}
    try:
        stream = dataset_stream("OpenAssistant/oasst1")
        iterator = iter(stream)
        try:
            for item in iterator:
                if len(messages) >= max(limit * 8, 2000):
                    break
                if str(item.get("lang", "en")).lower() not in {"en", "eng", "english"}:
                    continue
                message_id = item.get("message_id")
                if message_id is None:
                    continue
                messages[str(message_id)] = item
        finally:
            # IterableDataset uses a background HTTP/parquet iterator. Close it
            # explicitly when we stop after a bounded sample; otherwise some
            # versions leave downloader threads alive during interpreter exit.
            close = getattr(iterator, "close", None)
            if callable(close):
                close()
            del iterator
            del stream
    except Exception as exc:
        raise RuntimeError(
            "Could not stream OpenAssistant/oasst1. Check network access and the "
            "dataset identifier, then retry."
        ) from exc

    emitted = 0
    for item in messages.values():
        role = str(item.get("role", "")).lower()
        if role not in {"assistant"}:
            continue
        parent_id = item.get("parent_id")
        parent = messages.get(str(parent_id)) if parent_id is not None else None
        if not parent or str(parent.get("role", "")).lower() not in {"prompter", "user"}:
            continue
        question = clean_text(parent.get("text"))
        answer = clean_text(item.get("text"))
        if len(question) < 3 or len(answer) < 3:
            continue
        yield f"User: {question}\nAssistant: {answer}"
        emitted += 1
        if emitted >= limit:
            return

    if emitted == 0:
        raise RuntimeError(
            "OASST1 streamed but no English parent-linked user/assistant pairs "
            "were found. The dataset schema may have changed; refusing to silently "
            "substitute unrelated text."
        )


def rows_tinystories(limit: int) -> Iterable[str]:
    try:
        stream = dataset_stream("roneneldan/TinyStories")
        iterator = iter(stream)
        emitted = 0
        try:
            for item in iterator:
                text = clean_text(item.get("text"))
                if len(text) < 40:
                    continue
                yield text
                emitted += 1
                if emitted >= limit:
                    return
        finally:
            # Ensure bounded sampling shuts down the stream's downloader.
            close = getattr(iterator, "close", None)
            if callable(close):
                close()
            del iterator
            del stream
    except Exception as exc:
        raise RuntimeError("Could not stream roneneldan/TinyStories.") from exc
    raise RuntimeError("TinyStories stream ended before any usable stories were found.")


def rows_wikipedia(limit: int) -> Iterable[str]:
    """Stream a bounded sample of English Wikipedia articles from Hugging Face."""
    try:
        stream = dataset_stream("wikimedia/wikipedia", config="20231101.en")
        iterator = iter(stream)
        emitted = 0
        try:
            for item in iterator:
                title = clean_text(item.get("title"), 300)
                article = clean_text(item.get("text"))
                if not title or len(article) < 100:
                    continue
                yield f"Article: {title}\n{article}"
                emitted += 1
                if emitted >= limit:
                    return
        finally:
            # Close the bounded stream before Python finalizes downloader threads.
            close = getattr(iterator, "close", None)
            if callable(close):
                close()
            del iterator
            del stream
    except Exception as exc:
        raise RuntimeError("Could not stream English Wikipedia articles from wikimedia/wikipedia.") from exc

    if emitted == 0:
        raise RuntimeError("Wikipedia stream ended before any usable articles were found.")


def prepare(output: Path, per_source: int) -> dict[str, Any]:
    if per_source < 1:
        raise ValueError("--per-source must be at least 1")
    source_factories = (
        ("oasst1", lambda: rows_oasst(per_source)),
        ("tinystories", lambda: rows_tinystories(per_source)),
        ("wikipedia", lambda: rows_wikipedia(per_source)),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    counts: dict[str, int] = {}
    total_bytes = 0
    with output.open("w", encoding="utf-8") as handle:
        for source, factory in source_factories:
            count = 0
            for text in factory():
                normalized = re.sub(r"\s+", " ", text).strip().casefold()
                digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
                if digest in seen:
                    continue
                seen.add(digest)
                record = {"source": source, "text": text}
                line = json.dumps(record, ensure_ascii=False)
                handle.write(line + "\n")
                total_bytes += len(line.encode("utf-8"))
                count += 1
                if count >= per_source:
                    break
            counts[source] = count
            if count == 0:
                raise RuntimeError(f"No usable records prepared for source: {source}")
    result = {
        "status": "prepared",
        "output": str(output),
        "records_by_source": counts,
        "total_records": sum(counts.values()),
        "file_bytes": total_bytes,
        "max_records_per_source": per_source,
        "note": "Streaming subset only; not a complete copy of any upstream dataset.",
    }
    print(json.dumps(result, indent=2))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-source", type=int, default=1000,
                        help="maximum usable records from each dataset (default: 1000)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    prepare(args.output, args.per_source)


if __name__ == "__main__":
    main()
