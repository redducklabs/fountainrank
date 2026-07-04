"""Size-capped streaming multipart file reader.

Reads a ``multipart/form-data`` request body incrementally from
``request.stream()`` and extracts the first file part's bytes, aborting the
instant the accumulated size would exceed ``max_bytes`` -- it never buffers
the whole body, so a large-but-under-the-content-length-limit upload can't
exhaust memory before a size check runs.

This exists so the upload endpoint can perform a reservation/quota check
*before* reading the body: taking ``UploadFile`` as an endpoint parameter
forces FastAPI/Starlette to fully parse the multipart body before the
endpoint function even runs, which is too late to reject an oversized
upload cheaply. Calling ``read_capped_multipart_file(request, max_bytes)``
from inside the endpoint, after the reservation check has already passed,
keeps the size cap authoritative.

Built on ``python-multipart``'s low-level streaming ``MultipartParser``
(callback API), fed chunk-by-chunk -- never handed the whole body at once.
"""

from __future__ import annotations

import logging

from fastapi import Request
from python_multipart.multipart import MultipartParser, parse_options_header

logger = logging.getLogger(__name__)


class TooLarge(Exception):
    """Raised when the first file part exceeds the caller's ``max_bytes`` cap.

    Callers should map this to an HTTP 413 response.
    """


async def read_capped_multipart_file(request: Request, max_bytes: int) -> bytes:
    """Stream ``request``'s multipart body and return the first file part's bytes.

    Raises:
        ValueError: the ``Content-Type`` header is missing, not
            ``multipart/form-data``, or has no ``boundary`` parameter.
        TooLarge: the first file part's accumulated bytes exceed ``max_bytes``.
    """
    content_type = request.headers.get("content-type")
    if not content_type:
        raise ValueError("Missing Content-Type header; expected multipart/form-data")

    main_type, options = parse_options_header(content_type.encode("latin-1"))
    if main_type != b"multipart/form-data":
        raise ValueError(f"Expected multipart/form-data content type, got: {content_type!r}")

    boundary = options.get(b"boundary")
    if not boundary:
        raise ValueError("multipart/form-data Content-Type is missing a boundary parameter")

    buffer = bytearray()
    total = 0
    state = {"is_file": False, "got_file": False}
    headers: dict[bytes, bytes] = {}
    header_name: list[bytes] = []
    header_value: list[bytes] = []

    def on_part_begin() -> None:
        headers.clear()
        state["is_file"] = False

    def on_header_field(data: bytes, start: int, end: int) -> None:
        header_name.append(data[start:end])

    def on_header_value(data: bytes, start: int, end: int) -> None:
        header_value.append(data[start:end])

    def on_header_end() -> None:
        headers[b"".join(header_name).lower()] = b"".join(header_value)
        header_name.clear()
        header_value.clear()

    def on_headers_finished() -> None:
        content_disp = headers.get(b"content-disposition")
        if content_disp is None:
            state["is_file"] = False
            return
        _disp, disp_options = parse_options_header(content_disp)
        state["is_file"] = disp_options.get(b"filename") is not None

    def on_part_data(data: bytes, start: int, end: int) -> None:
        nonlocal total
        if not state["is_file"] or state["got_file"]:
            return
        total += end - start
        if total > max_bytes:
            logger.warning(
                "multipart file part exceeded size cap",
                extra={"max_bytes": max_bytes, "accumulated_bytes": total},
            )
            raise TooLarge(f"Uploaded file exceeds maximum size of {max_bytes} bytes")
        buffer.extend(data[start:end])

    def on_part_end() -> None:
        if state["is_file"]:
            state["got_file"] = True

    parser = MultipartParser(
        boundary,
        callbacks={
            "on_part_begin": on_part_begin,
            "on_header_field": on_header_field,
            "on_header_value": on_header_value,
            "on_header_end": on_header_end,
            "on_headers_finished": on_headers_finished,
            "on_part_data": on_part_data,
            "on_part_end": on_part_end,
        },
    )

    async for chunk in request.stream():
        if not chunk:
            continue
        parser.write(chunk)
        if state["got_file"]:
            break

    return bytes(buffer)
