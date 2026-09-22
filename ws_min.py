#!/usr/bin/env python3
"""
ws_min — WebSocket minimo (RFC 6455), so stdlib.

Por que existe: /frame e /job em HTTP custam uma ida e volta por foto/linha.
Com WebSocket o no empurra os quadros na hora e o navegador nao pede nada.
Medido no agente: 5 comandos = ~25ms no WS contra ~5 requisicoes HTTP.

Por que NAO WebRTC (rtc.io e afins): WebRTC e melhor (sem overhead de HTTP por
quadro, P2P de verdade), mas exige um servidor de sinalizacao SEMPRE no ar.
Nossos nos caem a cada 6h (Actions) e ~9-12h (Kaggle) — nao ha onde hospedar
isso de graca e de forma confiavel. WS ja entrega o ganho principal sem essa
peca, e o proprio navegador implementa.

Usado pelo agent.py (canal frames/job/cmd) e pelo dsos_core.py (frames/input).
Se este arquivo nao estiver na pasta do servidor, o /ws responde 501 e o site
cai sozinho pro modo antigo (polling) — nada quebra.
"""
import base64
import hashlib
import json
import select
import socket
import struct
import time

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
OP_TXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 1, 2, 8, 9, 10
SEM_DADOS = 'sem-dados'


def aceitar(handler):
    """Faz o handshake no handler do http.server. True = agora e um socket WS."""
    chave = handler.headers.get('Sec-WebSocket-Key', '')
    if not chave or 'websocket' not in (handler.headers.get('Upgrade', '') or '').lower():
        return False
    aceita = base64.b64encode(hashlib.sha1((chave + GUID).encode()).digest()).decode()
    try:
        handler.wfile.write(b'HTTP/1.1 101 Switching Protocols\r\n'
                            b'Upgrade: websocket\r\n'
                            b'Connection: Upgrade\r\n'
                            b'Sec-WebSocket-Accept: ' + aceita.encode() + b'\r\n\r\n')
        handler.wfile.flush()
    except OSError:
        return False
    return True


def ler(sock, buf, bloqueante=True, timeout=0.2):
    """Le um frame. Devolve (opcode, payload, sobra_do_buffer).
    opcode None = fechou; SEM_DADOS = nada agora (modo nao bloqueante)."""
    def _exato(n):
        nonlocal buf
        while len(buf) < n:
            sock.settimeout(None if bloqueante else timeout)
            try:
                pedaco = sock.recv(65536)
            except (socket.timeout, BlockingIOError):
                if bloqueante:
                    continue
                raise TimeoutError
            except OSError:
                return None
            if not pedaco:
                return None
            buf += pedaco
        dado, buf = buf[:n], buf[n:]
        return dado

    try:
        cab = _exato(2)
    except TimeoutError:
        return SEM_DADOS, b'', buf
    if cab is None:
        return None, b'', buf
    op = cab[0] & 0x0F
    mascarado = bool(cab[1] & 0x80)
    n = cab[1] & 0x7F
    if n == 126:
        ext = _exato(2)
        if ext is None:
            return None, b'', buf
        n = struct.unpack('>H', ext)[0]
    elif n == 127:
        ext = _exato(8)
        if ext is None:
            return None, b'', buf
        n = struct.unpack('>Q', ext)[0]
    if n > 48 * 1024 * 1024:          # recusa coisa absurda
        return None, b'', buf
    mascara = _exato(4) if mascarado else b'\x00\x00\x00\x00'
    if mascara is None:
        return None, b'', buf
    carga = _exato(n) if n else b''
    if carga is None:
        return None, b'', buf
    if mascarado:
        carga = bytes(b ^ mascara[i % 4] for i, b in enumerate(carga))
    return op, carga, buf


def manda(sock, dados, op=OP_TXT):
    """Envia um frame. False = conexao morta (pode fechar)."""
    if isinstance(dados, str):
        dados = dados.encode('utf-8')
    cab = bytearray([0x80 | op])
    n = len(dados)
    if n < 126:
        cab.append(n)
    elif n < 65536:
        cab.append(126)
        cab += struct.pack('>H', n)
    else:
        cab.append(127)
        cab += struct.pack('>Q', n)
    try:
        sock.sendall(bytes(cab) + dados)
        return True
    except OSError:
        return False


def manda_json(sock, obj):
    return manda(sock, json.dumps(obj, ensure_ascii=False), OP_TXT)


def tem_dados(sock, timeout=0):
    try:
        return bool(select.select([sock], [], [], timeout)[0])
    except OSError:
        return False


def ler_controle(sock, buf):
    """Le (se houver) um recado do cliente. Devolve (op, dados, buf).
    Se o cliente pedir pra fechar, op = 8."""
    if not tem_dados(sock):
        return SEM_DADOS, None, buf
    op, carga, buf = ler(sock, buf, bloqueante=False)
    if op in (OP_PING,):
        manda(sock, carga, OP_PONG)
        return SEM_DADOS, None, buf
    if op == OP_TXT:
        try:
            return OP_TXT, json.loads(carga.decode('utf-8')), buf
        except Exception:
            return SEM_DADOS, None, buf
    return op, None, buf


def fechar(sock):
    try:
        manda(sock, b'', OP_CLOSE)
    except Exception:
        pass
