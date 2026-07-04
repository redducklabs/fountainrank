"""Task B12a — size-capped streaming multipart file reader.

``read_capped_multipart_file`` must stream the request body chunk-by-chunk
(via ``request.stream()``) and extract the first file part's bytes without
ever buffering more than ``max_bytes`` worth of file data. These tests build
a Starlette ``Request`` directly from an ASGI scope + a custom ``receive``
callable so we can (a) prove a valid small upload round-trips exactly, (b)
prove an oversized upload aborts EARLY -- by counting how many times
``receive`` was actually invoked before ``TooLarge`` fires, well short of
the number of chunks a full body would require -- and (c) prove a
non-multipart content type fails fast with a clear error before any body
read happens at all.
"""

from __future__ import annotations

import pytest
from starlette.requests import Request

from app.multipart_read import TooLarge, read_capped_multipart_file

BOUNDARY = b"----FountainRankTestBoundary123"


def _build_scope(content_type: bytes) -> dict:
    return {
        "type": "http",
        "method": "POST",
        "path": "/upload",
        "headers": [(b"content-type", content_type)],
    }


def _multipart_body(filename: bytes, field_name: bytes, file_bytes: bytes) -> bytes:
    disposition = b'Content-Disposition: form-data; name="' + field_name
    disposition += b'"; filename="' + filename + b'"\r\n'
    return (
        b"--"
        + BOUNDARY
        + b"\r\n"
        + disposition
        + b"Content-Type: application/octet-stream\r\n\r\n"
        + file_bytes
        + b"\r\n--"
        + BOUNDARY
        + b"--\r\n"
    )


def _chunked_receive(body: bytes, chunk_size: int):
    """A receive callable that yields ``body`` in fixed-size chunks, counting calls."""
    state = {"offset": 0, "calls": 0}

    async def receive() -> dict:
        state["calls"] += 1
        offset = state["offset"]
        chunk = body[offset : offset + chunk_size]
        state["offset"] += chunk_size
        more_body = state["offset"] < len(body)
        return {"type": "http.request", "body": chunk, "more_body": more_body}

    return receive, state


def _lazy_large_receive(chunk: bytes, total_chunks: int):
    """A receive callable that lazily manufactures an arbitrarily large body.

    Never materializes the full body in memory -- each call just returns the
    same pre-built chunk again, up to ``total_chunks`` times -- so a test can
    assert the reader stops calling ``receive`` long before ``total_chunks``
    is reached.
    """
    state = {"calls": 0}

    async def receive() -> dict:
        state["calls"] += 1
        more_body = state["calls"] < total_chunks
        return {"type": "http.request", "body": chunk, "more_body": more_body}

    return receive, state


@pytest.mark.asyncio
async def test_valid_small_file_returns_exact_bytes():
    file_bytes = b"hello fountain photo bytes" * 10
    body = _multipart_body(b"photo.jpg", b"file", file_bytes)
    receive, _ = _chunked_receive(body, chunk_size=32)
    request = Request(_build_scope(b"multipart/form-data; boundary=" + BOUNDARY), receive)

    result = await read_capped_multipart_file(request, max_bytes=1_000_000)

    assert result == file_bytes


@pytest.mark.asyncio
async def test_oversized_file_raises_too_large_and_aborts_early():
    max_bytes = 5_000
    chunk = b"x" * 1_000
    # Enough chunks to build a body far larger than max_bytes if fully consumed.
    total_chunks_if_unbounded = 5_000
    # Prepend real multipart headers so the parser gets past headers before
    # the oversized part_data starts arriving.
    header = (
        b"--" + BOUNDARY + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="big.bin"\r\n'
        b"Content-Type: application/octet-stream\r\n\r\n"
    )

    header_sent = {"done": False}
    state = {"calls": 0}

    async def receive() -> dict:
        state["calls"] += 1
        if not header_sent["done"]:
            header_sent["done"] = True
            return {"type": "http.request", "body": header, "more_body": True}
        more_body = state["calls"] < total_chunks_if_unbounded
        return {"type": "http.request", "body": chunk, "more_body": more_body}

    request = Request(_build_scope(b"multipart/form-data; boundary=" + BOUNDARY), receive)

    with pytest.raises(TooLarge):
        await read_capped_multipart_file(request, max_bytes=max_bytes)

    # Should have aborted well before consuming anywhere near the full,
    # (deliberately oversized) body.
    assert state["calls"] < total_chunks_if_unbounded // 10


@pytest.mark.asyncio
async def test_non_multipart_content_type_raises_clear_error():
    state = {"calls": 0}

    async def receive() -> dict:
        state["calls"] += 1
        return {"type": "http.request", "body": b"{}", "more_body": False}

    request = Request(_build_scope(b"application/json"), receive)

    with pytest.raises(ValueError, match="multipart"):
        await read_capped_multipart_file(request, max_bytes=1_000)

    # The content-type check must fail fast, before ever touching the body.
    assert state["calls"] == 0
