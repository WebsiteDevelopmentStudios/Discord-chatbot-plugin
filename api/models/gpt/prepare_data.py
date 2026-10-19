#!/usr/bin/env python3
"""Prepare capped, deduplicated training text from OASST1, TinyStories, and Wikipedia.

Downloads are streamed from the Hugging Face Dataset Viewer API and the resulting dataset stays local.
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


def dataset_metadata(dataset: str, config_hint: str | None = None) -> tuple[str, str]:
    """Resolve a dataset config and train split through Hugging Face Dataset Viewer API."""
    import time
    import urllib.error
    import urllib.parse
    import urllib.request

    url = "https://datasets-server.huggingface.co/splits?" + urllib.parse.urlencode({"dataset": dataset})
    request = urllib.request.Request(url, headers={"User-Agent": "ZoiIntelligenceTraining/1.0"})
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            splits = payload.get("splits", [])
            candidates = [row for row in splits if row.get("split") == "train"]
            if config_hint:
                candidates = [row for row in candidates if row.get("config") == config_hint]
            if not candidates:
                raise RuntimeError(f"No matching train split found for dataset {dataset}.")
            chosen = next((row for row in candidates if row.get("config") == "default"), candidates[0])
            return str(chosen["config"]), str(chosen["split"])
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 4:
                break
            try:
                delay = float(exc.headers.get("Retry-After", ""))
            except (TypeError, ValueError):
                delay = min(20.0, 2.0 ** attempt)
            time.sleep(max(1.0, min(delay, 20.0)))
        except Exception as exc:
            last_error = exc
            if attempt == 4:
                break
            time.sleep(min(10.0, 2.0 ** attempt))
    raise RuntimeError(f"Could not resolve Hugging Face dataset split for {dataset}.") from last_error


def dataset_rows(dataset: str, config: str, split: str, *, max_rows: int):
    """Yield rows from the Dataset Viewer API in bounded pages, without native streaming threads."""
    import time
    import urllib.error
    import urllib.parse
    import urllib.request

    offset = 0
    while offset < max_rows:
        length = min(100, max_rows - offset)
        params = urllib.parse.urlencode({
            "dataset": dataset, "config": config, "split": split,
            "offset": str(offset), "length": str(length)
        })
        request = urllib.request.Request(
            "https://datasets-server.huggingface.co/rows?" + params,
            headers={"User-Agent": "ZoiIntelligenceTraining/1.0"}
        )
        payload = None
        last_error: Exception | None = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 4:
                    break
                try:
                    delay = float(exc.headers.get("Retry-After", ""))
                except (TypeError, ValueError):
                    delay = min(20.0, 2.0 ** attempt)
                time.sleep(max(1.0, min(delay, 20.0)))
            except Exception as exc:
                last_error = exc
                if attempt == 4:
                    break
                time.sleep(min(10.0, 2.0 ** attempt))
        if payload is None:
            raise RuntimeError(f"Could not download rows {offset}-{offset + length} from {dataset}.") from last_error
        rows = payload.get("rows", [])
        if not rows:
            return
        for entry in rows:
            row = entry.get("row")
            if isinstance(row, dict):
                yield row
        offset += len(rows)
        if offset >= int(payload.get("num_rows_total", max_rows)):
            return
        time.sleep(0.15)



def rows_oasst(limit: int) -> Iterable[str]:
    """Build user/assistant pairs from OASST parent links."""
    dataset = "OpenAssistant/oasst1"
    config, split = dataset_metadata(dataset)
    messages: dict[str, dict[str, Any]] = {}
    max_rows = max(limit * 8, 2000)
    try:
        for item in dataset_rows(dataset, config, split, max_rows=max_rows):
            if str(item.get("lang", "en")).lower() not in {"en", "eng", "english"}:
                continue
            message_id = item.get("message_id")
            if message_id is not None:
                messages[str(message_id)] = item
    except Exception as exc:
        raise RuntimeError("Could not download OpenAssistant/OASST1 rows from the Hugging Face Dataset Viewer API.") from exc

    emitted = 0
    for item in messages.values():
        if str(item.get("role", "")).lower() != "assistant":
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
        raise RuntimeError("OASST1 returned no usable English parent-linked user/assistant pairs.")


def rows_tinystories(limit: int) -> Iterable[str]:
    dataset = "roneneldan/TinyStories"
    config, split = dataset_metadata(dataset)
    emitted = 0
    try:
        for item in dataset_rows(dataset, config, split, max_rows=limit):
            text = clean_text(item.get("text"))
            if len(text) < 40:
                continue
            yield text
            emitted += 1
            if emitted >= limit:
                return
    except Exception as exc:
        raise RuntimeError("Could not download TinyStories rows from the Hugging Face Dataset Viewer API.") from exc
    if emitted == 0:
        raise RuntimeError("TinyStories returned no usable stories.")


def rows_wikipedia(limit: int) -> Iterable[str]:
    """Fetch a bounded sample of English Wikipedia articles without HF streaming threads."""
    dataset = "wikimedia/wikipedia"
    config, split = dataset_metadata(dataset, config_hint="20231101.en")
    emitted = 0
    try:
        for item in dataset_rows(dataset, config, split, max_rows=limit):
            title = clean_text(item.get("title"), 300)
            article = clean_text(item.get("text"))
            if not title or len(article) < 100:
                continue
            yield f"Article: {title}\n{article}"
            emitted += 1
            if emitted >= limit:
                return
    except Exception as exc:
        raise RuntimeError("Could not download Wikipedia rows from the Hugging Face Dataset Viewer API.") from exc
    if emitted == 0:
        raise RuntimeError("Wikipedia returned no usable articles.")


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
