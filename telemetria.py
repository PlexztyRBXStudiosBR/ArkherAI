#!/usr/bin/env python3
"""TELEMETRIA — o jogo conta o que aconteceu, e o no devolve o que consertar.

Roda em qualquer lugar com Python 3 (so stdlib): no no do Kaggle, no PC, no
Termux, na VPS. Nao precisa de banco, nao precisa de chave.

    python3 telemetria.py                     # porta 8777
    TELEMETRIA_PORT=9000 python3 telemetria.py
    python3 telemetria.py --resumo meu-jogo   # so imprime o resumo do arquivo

ROTAS
    GET  /health                 esta vivo + quantos jogos/eventos
    POST /evento                 {jogo, versao, lote:[{t,evento,quem,dados}]}
    GET  /resumo?jogo=           numeros medidos (mortes por fase, onde trava,
                                 quanto tempo jogam, quantos voltam)
    GET  /sugestoes?jogo=        o que mudar na proxima versao, COM o numero
                                 que sustenta cada sugestao

O QUE ELE NUNCA FAZ
    - Nao guarda identidade: nome, e-mail, conversa e afins sao descartados
      antes de gravar (e o jogo tambem nao manda — duas camadas).
    - Nao cresce sem teto: corpo ate 64 KB, 200 eventos por envio, e limite
      de envios por minuto por origem. Passou disso, recusa com motivo.
    - Nao inventa conclusao: com pouco dado, a resposta diz que e pouco dado.

O ARQUIVO E A VERDADE
    Cada evento aceito vira uma linha em telemetria/<jogo>.jsonl. O resumo em
    memoria e so cache: ao subir, ele reconstroi tudo lendo o arquivo. Se o
    processo cair, nada se perde.
"""

import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

VERSAO = "1.0"
PORT = int(os.environ.get("TELEMETRIA_PORT", "8777"))
RAIZ = os.environ.get("TELEMETRIA_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "telemetria"))

MAX_CORPO = 64 * 1024          # 64 KB por envio
MAX_EVENTOS = 200              # por envio
MAX_ENVIOS_MIN = 120           # por origem, por minuto
MAX_TEXTO = 80
MAX_CHAVES = 12
MIN_AMOSTRA = 8                # abaixo disso, nao se conclui nada

PROIBIDAS = {
    "nome", "name", "username", "user", "usuario", "email", "mail", "telefone",
    "phone", "ip", "senha", "password", "token", "chat", "mensagem", "userid",
    "displayname", "conta", "documento", "cookie", "discord",
}

_RE_SLUG = re.compile(r"[^a-z0-9_-]+")


def slug(nome):
    n = _RE_SLUG.sub("-", str(nome or "jogo").strip().lower())[:40].strip("-")
    return n or "jogo"


def _finito(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def limpar_dados(dados, nivel=1):
    """Mesma regra do lado do jogo: chave proibida sai, texto longo corta,
    tabela funda demais nao entra, numero estranho (nan/inf) nao entra."""
    if not isinstance(dados, dict) or nivel > 2:
        return None
    saida, n = {}, 0
    for k, v in dados.items():
        ks = str(k)
        if ks.lower() in PROIBIDAS or len(ks) > 32:
            continue
        n += 1
        if n > MAX_CHAVES:
            break
        if isinstance(v, bool):
            saida[ks] = v
        elif _finito(v):
            saida[ks] = v
        elif isinstance(v, str):
            saida[ks] = v[:MAX_TEXTO]
        elif isinstance(v, dict):
            sub = limpar_dados(v, nivel + 1)
            if sub:
                saida[ks] = sub
    return saida


class Jogo:
    """Agregado de um jogo. Tudo aqui e numero medido — nada estimado."""

    def __init__(self, nome):
        self.nome = nome
        self.eventos = 0
        self.sessoes = set()
        self.por_evento = Counter()
        self.mortes_fase = Counter()
        self.chegadas_fase = Counter()
        self.saidas_fase = Counter()
        self.onde_trava = Counter()
        self.onde_morre = Counter()
        self.por_versao = Counter()
        self.sessao_t = {}          # sessao -> [primeiro, ultimo] (ms)
        self.primeiro = None
        self.ultimo = None

    def aceitar(self, ev, versao=None):
        if not isinstance(ev, dict):
            return False
        nome = ev.get("evento")
        if not isinstance(nome, str) or not nome or len(nome) > 40:
            return False
        t = ev.get("t")
        t = float(t) if _finito(t) else time.time()
        dados = ev.get("dados") if isinstance(ev.get("dados"), dict) else {}
        quem = ev.get("quem") if isinstance(ev.get("quem"), str) else None

        self.eventos += 1
        self.por_evento[nome] += 1
        if quem:
            self.sessoes.add(quem)
            a = self.sessao_t.get(quem)
            if a is None:
                self.sessao_t[quem] = [t, t]
            else:
                if t < a[0]:
                    a[0] = t
                if t > a[1]:
                    a[1] = t
        if self.primeiro is None or t < self.primeiro:
            self.primeiro = t
        if self.ultimo is None or t > self.ultimo:
            self.ultimo = t
        if versao:
            self.por_versao[str(versao)[:16]] += 1

        fase = dados.get("fase")
        if isinstance(fase, (int, float)) and _finito(fase):
            fase = int(fase)
            if nome in ("morte", "morreu"):
                self.mortes_fase[fase] += 1
            elif nome in ("chegou", "entrou_fase", "fase"):
                self.chegadas_fase[fase] += 1
            elif nome in ("saiu", "desistiu", "quit"):
                self.saidas_fase[fase] += 1

        pos = None
        x, z = dados.get("x"), dados.get("z")
        if _finito(x) and _finito(z):
            pos = (int(x // 10) * 10, int(z // 10) * 10)
        if pos:
            if nome in ("travou", "preso", "stuck"):
                self.onde_trava[pos] += 1
            elif nome in ("morte", "morreu"):
                self.onde_morre[pos] += 1
        return True

    def para_json(self):
        comuns = self.por_evento.most_common(12)
        durs = [round((b[1] - b[0]) / 60.0, 1) for b in self.sessao_t.values() if b[1] >= b[0]]
        dur_media = round(sum(durs) / len(durs), 1) if durs else None
        mortes = self.mortes_fase.most_common(20)
        return {
            "jogo": self.nome,
            "eventos": self.eventos,
            "sessoes": len(self.sessoes),
            "minutos_por_sessao": dur_media,
            "por_evento": dict(comuns),
            "mortes_por_fase": {str(k): v for k, v in mortes},
            "chegadas_por_fase": {str(k): v for k, v in self.chegadas_fase.most_common(20)},
            "saidas_por_fase": {str(k): v for k, v in self.saidas_fase.most_common(20)},
            "onde_trava": [{"x": k[0], "z": k[1], "n": v} for k, v in self.onde_trava.most_common(10)],
            "onde_morre": [{"x": k[0], "z": k[1], "n": v} for k, v in self.onde_morre.most_common(10)],
            "por_versao": dict(self.por_versao),
            "arquivo": self.nome + ".jsonl",
        }

    def sugestoes(self):
        """O que mudar — e o numero que sustenta cada sugestao.
        Com pouco dado, a resposta e 'pouco dado'. Nada de chute."""
        s = []
        total_mortes = sum(self.mortes_fase.values())
        if self.eventos < MIN_AMOSTRA:
            return [{"nivel": "sem-dado", "texto":
                     "ainda e pouco dado (%d eventos): jogue mais um pouco antes de mudar algo"
                     % self.eventos}], total_mortes
        if total_mortes >= MIN_AMOSTRA and self.mortes_fase:
            fase, n = self.mortes_fase.most_common(1)[0]
            pct = round(100.0 * n / total_mortes)
            if pct >= 45:
                s.append({"nivel": "dificuldade",
                          "texto": "a fase %s concentra %d%% das mortes (%d de %d): e o lugar de afrouxar primeiro"
                                   % (fase, pct, n, total_mortes),
                          "numeros": {"fase": fase, "mortes": n, "total": total_mortes, "porcento": pct}})
            else:
                s.append({"nivel": "dificuldade",
                          "texto": "as mortes estao espalhadas (%d em %d fases): o problema nao e uma fase so"
                                   % (total_mortes, len(self.mortes_fase))})
        if self.onde_trava:
            (x, z), n = self.onde_trava.most_common(1)[0]
            if n >= 3:
                s.append({"nivel": "bug-provavel",
                          "texto": "%d jogadores travaram perto de (%d, %d): olhe esse ponto do mapa"
                                   % (n, x, z),
                          "numeros": {"x": x, "z": z, "n": n}})
        if self.saidas_fase:
            fase, n = self.saidas_fase.most_common(1)[0]
            chegou = self.chegadas_fase.get(fase) or 0
            if chegou >= MIN_AMOSTRA and n >= 3:
                pct = round(100.0 * n / chegou)
                if pct >= 30:
                    s.append({"nivel": "retencao",
                              "texto": "%d%% dos que chegam na fase %s saem ali (%d de %d): o jogo perde o jogador nesse ponto"
                                       % (pct, fase, n, chegou),
                              "numeros": {"fase": fase, "saidas": n, "chegaram": chegou, "porcento": pct}})
        durs = [b[1] - b[0] for b in self.sessao_t.values() if b[1] >= b[0]]
        if len(durs) >= MIN_AMOSTRA:
            media = sum(durs) / len(durs) / 60.0
            longas = len([d for d in durs if d >= 5 * 60 * 1000])
            if media < 2:
                s.append({"nivel": "primeira-impressao",
                          "texto": "sessao media de %.1f min (%d de %d jogam menos de 5 min): o comeco nao esta segurando"
                                   % (media, len(durs) - longas, len(durs)),
                          "numeros": {"minutos_medio": round(media, 1)}})
            else:
                s.append({"nivel": "tempo",
                          "texto": "sessao media de %.1f min — o jogo esta segurando" % media})
        if not s:
            s.append({"nivel": "sem-dado", "texto": "sem sugestao com os dados de agora"})
        return s, total_mortes


class Acervo:
    def __init__(self, raiz):
        self.raiz = raiz
        self.jogos = {}
        os.makedirs(raiz, exist_ok=True)

    def caminho(self, nome):
        return os.path.join(self.raiz, slug(nome) + ".jsonl")

    def carregar(self, nome):
        s = slug(nome)
        if s in self.jogos:
            return self.jogos[s]
        j = Jogo(s)
        p = self.caminho(s)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for linha in f:
                    linha = linha.strip()
                    if not linha:
                        continue
                    try:
                        ev = json.loads(linha)
                    except Exception:
                        continue
                    j.aceitar(ev.get("e") or {}, ev.get("v"))
        self.jogos[s] = j
        return j

    def aceitar(self, corpo, agora=None):
        nome = slug(corpo.get("jogo"))
        versao = corpo.get("versao")
        if isinstance(versao, str):
            versao = versao[:16]
        else:
            versao = None
        j = self.carregar(nome)
        lote = corpo.get("lote")
        if not isinstance(lote, list):
            return {"ok": False, "motivo": "sem lote"}
        if len(lote) > MAX_EVENTOS:
            return {"ok": False, "motivo": "lote grande demais (max %d)" % MAX_EVENTOS, "aceitos": 0}
        aceitos = 0
        with open(self.caminho(nome), "a", encoding="utf-8") as f:
            for ev in lote:
                if not isinstance(ev, dict):
                    continue
                ev = dict(ev)
                ev["dados"] = limpar_dados(ev.get("dados"))
                if not isinstance(ev.get("quem"), str):
                    ev.pop("quem", None)
                if j.aceitar(ev, versao):
                    aceitos += 1
                    f.write(json.dumps({"e": ev, "v": versao}, ensure_ascii=False) + "\n")
        return {"ok": True, "aceitos": aceitos, "recusados": len(lote) - aceitos,
                "eventos_no_jogo": j.eventos, "sessoes": len(j.sessoes)}

    def lista(self):
        return sorted(self.jogos.keys())

    def no_disco(self):
        """jogos que existem no ARQUIVO (mesmo que ainda ninguem tenha pedido)"""
        try:
            return sorted(f[:-6] for f in os.listdir(self.raiz) if f.endswith(".jsonl"))
        except Exception:
            return []


# --------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    acervo = None
    _envios = defaultdict(list)
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _j(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        try:
            self.wfile.write(b)
        except Exception:
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _limite(self):
        ip = self.client_address[0]
        agora = time.time()
        v = [t for t in H._envios[ip] if agora - t < 60]
        v.append(agora)
        H._envios[ip] = v
        return len(v) <= MAX_ENVIOS_MIN

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/health", "/"):
            todos = H.acervo.lista()
            ev = sum(H.acervo.carregar(n).eventos for n in todos)
            return self._j({"ok": True, "servico": "telemetria", "versao": VERSAO,
                            "jogos": todos, "eventos": ev})
        if u.path == "/resumo":
            nome = (q.get("jogo") or ["jogo"])[0]
            j = H.acervo.carregar(nome)
            return self._j(j.para_json())
        if u.path == "/sugestoes":
            nome = (q.get("jogo") or ["jogo"])[0]
            j = H.acervo.carregar(nome)
            s, _ = j.sugestoes()
            return self._j({"jogo": j.nome, "sugestoes": s, "eventos": j.eventos, "sessoes": len(j.sessoes)})
        return self._j({"erro": "rota desconhecida"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/evento":
            return self._j({"erro": "rota desconhecida"}, 404)
        if not self._limite():
            return self._j({"ok": False, "motivo": "envios demais por minuto"}, 429)
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except Exception:
            n = 0
        if n <= 0:
            return self._j({"ok": False, "motivo": "corpo vazio"}, 400)
        if n > MAX_CORPO:
            return self._j({"ok": False, "motivo": "corpo grande demais (max %d KB)" % (MAX_CORPO // 1024)}, 413)
        bruto = self.rfile.read(n)
        try:
            corpo = json.loads(bruto.decode("utf-8", "replace"))
        except Exception:
            return self._j({"ok": False, "motivo": "json invalido"}, 400)
        if not isinstance(corpo, dict):
            return self._j({"ok": False, "motivo": "corpo invalido"}, 400)
        r = H.acervo.aceitar(corpo)
        return self._j(r, 200 if r.get("ok") else 400)


def resumo_no_terminal(nome):
    a = Acervo(RAIZ)
    j = a.carregar(nome)
    d = j.para_json()
    print("jogo: %s · eventos: %d · sessoes: %d · minutos/sessao: %s" %
          (d["jogo"], d["eventos"], d["sessoes"], d["minutos_por_sessao"]))
    print("eventos:", json.dumps(d["por_evento"], ensure_ascii=False))
    print("mortes por fase:", json.dumps(d["mortes_por_fase"], ensure_ascii=False))
    print("onde trava:", json.dumps(d["onde_trava"], ensure_ascii=False))
    s, _ = j.sugestoes()
    for x in s:
        print(" -", x["texto"])
    print("arquivo:", os.path.join(RAIZ, d["arquivo"]))


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--resumo":
        return resumo_no_terminal(sys.argv[2])
    os.makedirs(RAIZ, exist_ok=True)
    H.acervo = Acervo(RAIZ)
    for n in H.acervo.no_disco():          # o arquivo e a verdade: le tudo que existe
        H.acervo.carregar(n)
    print("[telemetria] ouvindo em 0.0.0.0:%d" % PORT, flush=True)
    print("[telemetria] arquivos em %s" % RAIZ, flush=True)
    if H.acervo.lista():
        print("[telemetria] jogos ja no arquivo: %s" % ", ".join(H.acervo.lista()), flush=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
