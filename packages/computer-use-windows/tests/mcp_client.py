"""In-memory MCP client for the tests, the same on mcp 1.x and 2.x.

Replies come back in wire form, the JSON a real client receives (camelCase keys such as
``isError``, ``inputSchema``, ``mimeType``, ``serverInfo``). The tests check that contract, not
one SDK's Python models: mcp 2.x renamed their attributes to snake_case.

Both paths run the full initialize handshake and JSON-RPC over in-memory streams, as stdio does.
"""

from __future__ import annotations

import functools
import importlib.metadata
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import anyio

MCP_MAJOR = int(importlib.metadata.version("mcp").split(".")[0])


def wire(model: Any) -> dict[str, Any]:
    """An SDK model as it came over the wire: only the fields the server sent.

    exclude_unset drops what the client model fills in by itself (mcp 2.x adds e.g.
    ``resultType: "complete"`` to every CallToolResult it parses).
    """
    return model.model_dump(mode="json", by_alias=True, exclude_none=True, exclude_unset=True)


@dataclass
class Session:
    init: dict[str, Any]  # the InitializeResult's "instructions" and "serverInfo"
    _call: Callable[[str, dict[str, Any]], Awaitable[Any]]
    _list: Callable[[], Awaitable[Any]]

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return wire(await self._call(name, arguments))

    async def list_tools(self) -> list[dict[str, Any]]:
        return [wire(tool) for tool in (await self._list()).tools]


@asynccontextmanager
async def open_session(mcp_server: Any, timeout: float) -> AsyncIterator[Session]:
    """Connect a client to ``mcp_server`` (``server.build_server``) and initialize."""
    if MCP_MAJOR >= 2:
        from mcp.client import Client

        # "legacy": the initialize handshake over streams, which is what a stdio client does.
        async with Client(mcp_server, mode="legacy", read_timeout_seconds=timeout) as client:
            info = client.server_info
            init = {
                "instructions": client.instructions,
                "serverInfo": wire(info) if info is not None else None,
            }
            yield Session(init, client.call_tool, client.list_tools)
        return

    from mcp.client.session import ClientSession
    from mcp.shared.memory import create_client_server_memory_streams

    # mcp 1.x has no public in-memory client that keeps the InitializeResult; this is the wiring
    # of its mcp.shared.memory.create_connected_server_and_client_session, which also reaches
    # FastMCP's lowlevel server through this private attribute (1.x only gets fixes now).
    low = mcp_server._mcp_server
    async with create_client_server_memory_streams() as (client_streams, server_streams):
        async with anyio.create_task_group() as tg:
            tg.start_soon(
                functools.partial(
                    low.run,
                    server_streams[0],
                    server_streams[1],
                    low.create_initialization_options(),
                    raise_exceptions=False,
                )
            )
            try:
                async with ClientSession(
                    client_streams[0],
                    client_streams[1],
                    read_timeout_seconds=timedelta(seconds=timeout),
                ) as session:
                    result = wire(await session.initialize())
                    init = {key: result.get(key) for key in ("instructions", "serverInfo")}
                    yield Session(init, session.call_tool, session.list_tools)
            finally:
                tg.cancel_scope.cancel()
