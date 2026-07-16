"""Bridge the translator's synchronous callbacks to an SSE stream.

The library invokes ``on_event`` and ``on_conversation`` synchronously, on the
same event-loop task that runs ``translate()`` (see
``sql2graph/src/sql2graph/engine/async_translator.py``). So the bridge is simple:

* milestone events go onto an ``asyncio.Queue`` via ``put_nowait`` (never await,
  never a threading queue) and are forwarded immediately;
* conversation snapshots fire *per token* and resend the **entire** transcript,
  so we coalesce them: the callback just stores the latest snapshot and a timer
  flushes at most one ``conversation`` event per tick.

We rely on ``on_conversation`` alone for the live transcript: it already carries
the growing assistant text token-by-token, so ``stream_to`` is unnecessary.

Lifecycle: the translator runs inside ``async with`` so its LLM client, DB
connections, and any throwaway managed container are torn down on completion and
on client disconnect (the generator's ``finally`` cancels the task, which raises
``CancelledError`` inside ``translate()`` and triggers ``__aexit__``).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from sql2graph import (
    AsyncSQLTranslator,
    CompletedEvent,
    FixGeneratedEvent,
    GeneratedEvent,
    MaxIterationsReachedEvent,
    ParseFailedEvent,
    StalledEvent,
    TranslationEvent,
    UnmappedColumnsEvent,
    UnmappedTablesEvent,
    ValidatedEvent,
)

from . import library
from .models import LlmSettings

logger = logging.getLogger(__name__)

# Max one coalesced conversation snapshot per this interval (~12 fps, matching
# the CLI's Live refresh_per_second).
_COALESCE_SECONDS = 0.08


def _sse(event: str, data: Any) -> dict[str, str]:
    """Shape a dict the way sse-starlette expects (data must be a string)."""
    return {"event": event, "data": json.dumps(data)}


def _event_to_sse(event: TranslationEvent) -> dict[str, str]:
    match event:
        case ParseFailedEvent(message=m):
            return _sse("parse_warning", {"message": m})
        case UnmappedTablesEvent(tables=tables, message=m):
            return _sse("unmapped_tables", {"tables": list(tables), "message": m})
        case UnmappedColumnsEvent(columns=cols, message=m):
            return _sse("unmapped_columns", {"columns": list(cols), "message": m})
        case GeneratedEvent(iteration=i, query=q):
            return _sse("generated", {"iteration": i, "query": q})
        case ValidatedEvent(iteration=i, query=q, errors=errs, passed=passed):
            return _sse("validated", {"iteration": i, "query": q, "errors": list(errs), "passed": passed})
        case FixGeneratedEvent(iteration=i, query=q):
            return _sse("fix", {"iteration": i, "query": q})
        case StalledEvent(iteration=i, query=q, errors=errs):
            return _sse("stalled", {"iteration": i, "query": q, "errors": list(errs)})
        case MaxIterationsReachedEvent(iteration=i, errors=errs):
            return _sse("max_iterations", {"iteration": i, "errors": list(errs)})
        case CompletedEvent(result=result):
            return _sse("completed", {"result": result.model_dump()})
        case _:  # pragma: no cover - exhaustive above
            return _sse("unknown", {})


async def stream(translator: AsyncSQLTranslator, sql: str, effective_mode: str) -> AsyncIterator[dict[str, str]]:
    """Yield SSE events for one translation."""
    queue: asyncio.Queue[dict[str, str] | None] = asyncio.Queue()
    latest_conversation: list[dict[str, str]] | None = None
    dirty = False

    def on_conversation(snapshot: list[dict[str, str]]) -> None:
        nonlocal latest_conversation, dirty
        latest_conversation = snapshot
        dirty = True

    def on_event(event: TranslationEvent) -> None:
        queue.put_nowait(_event_to_sse(event))

    async def runner() -> None:
        try:
            async with translator:
                await translator.translate(sql, on_event=on_event, on_conversation=on_conversation)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any failure to the client
            logger.exception("translation failed")
            queue.put_nowait(_sse("error", {"message": f"{type(exc).__name__}: {exc}"}))
        finally:
            queue.put_nowait(None)  # sentinel

    # Managed mode boots a throwaway DB before any event fires (validator.warmup);
    # let the client show a "provisioning" state during that wait.
    if effective_mode == "managed":
        yield _sse("status", {"phase": "provisioning"})

    task = asyncio.create_task(runner())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=_COALESCE_SECONDS)
            except TimeoutError:
                if dirty and latest_conversation is not None:
                    dirty = False
                    yield _sse("conversation", latest_conversation)
                continue

            # Flush a pending snapshot before the next milestone so ordering reads naturally.
            if dirty and latest_conversation is not None:
                dirty = False
                yield _sse("conversation", latest_conversation)

            if item is None:  # sentinel: translation finished or errored
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def stream_build_mapping(
    ddl: str,
    dialect: str | None,
    llm_settings: LlmSettings,
    refine: bool = True,
) -> AsyncIterator[dict[str, str]]:
    """Yield SSE events for one mapping build with live refinement streaming.

    Same coalescing pattern as :func:`stream`: when *refine* is true the refinement's
    per-token ``on_conversation`` snapshots are flushed at most once per tick as
    ``conversation`` events; a final ``done`` event carries the full result dict (or an
    ``error`` event on failure). When *refine* is false no conversation is emitted (the
    build is deterministic) and only the ``done`` event fires.
    """
    queue: asyncio.Queue[dict[str, str] | None] = asyncio.Queue()
    latest_conversation: list[dict[str, str]] | None = None
    dirty = False

    def on_conversation(snapshot: list[dict[str, str]]) -> None:
        nonlocal latest_conversation, dirty
        latest_conversation = snapshot
        dirty = True

    async def runner() -> None:
        try:
            result = await library.build_mapping_from_ddl_async(
                ddl, dialect=dialect, llm=llm_settings, refine=refine, on_conversation=on_conversation
            )
            queue.put_nowait(_sse("done", result))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any failure to the client
            logger.exception("mapping build failed")
            queue.put_nowait(_sse("error", {"message": f"{type(exc).__name__}: {exc}"}))
        finally:
            queue.put_nowait(None)  # sentinel

    task = asyncio.create_task(runner())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=_COALESCE_SECONDS)
            except TimeoutError:
                if dirty and latest_conversation is not None:
                    dirty = False
                    yield _sse("conversation", latest_conversation)
                continue

            if dirty and latest_conversation is not None:
                dirty = False
                yield _sse("conversation", latest_conversation)

            if item is None:  # sentinel: build finished or errored
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
