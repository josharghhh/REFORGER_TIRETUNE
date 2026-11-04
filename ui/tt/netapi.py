"""Minimal Workbench Net API client (the wire protocol Enfusion Blender Tools uses).

protocol int (1) | client id | content type 'JsonRPC' | json request  ->  error code | json response
Strings are uint32-LE length-prefixed UTF-8. Enable the Net API in Workbench (Options > Net API) first.
"""
from __future__ import annotations

import json
import socket

HOST, CLIENT = '127.0.0.1', 'TireTune'


def _send_int(s, v):
    s.sendall(int(v).to_bytes(4, 'little'))


def _send_str(s, text):
    b = text.encode('utf-8')
    _send_int(s, len(b))
    s.sendall(b)


def _recv_exact(s, n):
    buf = b''
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('Workbench closed the connection')
        buf += chunk
    return buf


def _recv_str(s):
    n = int.from_bytes(_recv_exact(s, 4), 'little')
    return _recv_exact(s, n).decode('utf-8')


def call(func: str, params: dict | None = None, port: int = 5775, timeout: float = 20) -> dict:
    req = dict(params or {})
    req['APIFunc'] = func
    with socket.create_connection((HOST, port), timeout=timeout) as s:
        _send_int(s, 1)
        _send_str(s, CLIENT)
        _send_str(s, 'JsonRPC')
        _send_str(s, json.dumps(req))
        code = _recv_str(s)
        body = _recv_str(s)
    out = json.loads(body) if body else {}
    out.setdefault('ErrorCode', code)
    return out
