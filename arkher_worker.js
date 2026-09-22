/* ============================================================
   WORKER — busca PASSIVA: CPU e RAM, zero cota, zero GPU

   Você descreveu duas coisas. Uma não existe, a outra é exatamente
   isto aqui:

   ❌ "o modelo fica treinando de graça enquanto ninguém usa"
      Modelo de API não roda na sua máquina: ele não tem "modo ocioso".
      Ou você chama (e consome cota), ou não acontece nada. Não existe
      trabalho gratuito escondido ali. E "treinar sem GPU" continua não
      existindo — treino de peso é gradiente, e gradiente pede GPU.

   ✅ "quando não estiver buscando de forma ativa, elas buscam de forma
      passiva com CPU e RAM"  ← ISTO É REAL, E FUNCIONA ASSIM:

      Baixar página, tirar HTML, cortar em blocos, deduplicar, indexar,
      vetorizar e guardar: NADA disso precisa de GPU, e nada disso gasta
      cota de IA — porque não chama modelo nenhum. É só CPU, RAM e rede.

      E "dar tudo pra todas as outras": o cofre é UM só. O que este
      worker traz do Kaggle, do Codespace ou do seu PC entra no mesmo
      motor neural que alimenta o prompt de todos os modelos.

   COMO O TRABALHO SE DIVIDE (é esta a arquitetura certa):

     CPU + RAM  (grátis, ilimitado, roda no Kaggle/Codespace/PC)
        └─ baixar, limpar, deduplicar, indexar, vetorizar, guardar   ← ESTE ARQUIVO

     COTA GRÁTIS DE IA  (perecível: zera todo dia)
        └─ destilar bloco em regra, responder pergunta              ← arkher_operarios.js

     GPU  (só o seu nó)
        └─ treinar LoRA de um modelo SEU                            ← neural.js › enviarParaNo

   O script gerado aqui roda em qualquer máquina com Python 3 e curl:
   sem instalar nada, sem chave, sem cota. Ele varre uma lista de
   sementes, respeita limites (profundidade, páginas, pausa) e devolve
   um PACK no formato do Mega Pack — que você importa e pronto: as
   outras máquinas acabaram de trabalhar para todos os modelos.
   ============================================================ */
'use strict';

const Worker = {
  PADRAO: {
    paginas: 60,        // quantas páginas baixar nesta rodada
    depth: 1,           // 0 = só as sementes · 1 = sementes + links
    links: 20,          // links por página
    pausa: 1.0,         // segundos entre páginas (respeito ao servidor)
    chars: 40000,       // corte do texto por página
  },

  /* ---------- o script que roda nas outras máquinas ---------- */
  gerar(opts) {
    opts = Object.assign({}, this.PADRAO, opts || {});
    const seeds = (opts.seeds || []).map(s => String(s).trim()).filter(s => /^https?:\/\//i.test(s));
    if (!seeds.length) return { ok: false, err: 'informe pelo menos uma semente http(s)' };

    const py = `#!/usr/bin/env python3
# ============================================================
# ARKHER WORKER — busca passiva (CPU + RAM, sem GPU, sem cota)
#
# Roda em qualquer maquina com Python 3. Nao instala nada, nao usa
# chave, nao chama modelo de IA. So baixa, limpa, deduplica e escreve
# um PACK no formato do Mega Pack, que voce importa no ARKHER.
#
#   python3 arkher_worker.py
#
# Sementes: ${seeds.length} · paginas: ${opts.paginas} · profundidade: ${opts.depth}
# ============================================================
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

SEMENTES = ${JSON.stringify(seeds, null, 4)}
PAGINAS = ${opts.paginas}
PROFUNDIDADE = ${opts.depth}
LINKS_POR_PAGINA = ${opts.links}
PAUSA = ${opts.pausa}
CHARS = ${opts.chars}
SAIDA = ${JSON.stringify(opts.saida || 'pack-worker.md')}
UA = 'Mozilla/5.0 (compatible; ArkherWorker/1.0)'

fila = [(u, 0) for u in SEMENTES]
vistos = set()


def limpar(bruto):
    t = re.sub(r'(?is)<(script|style|nav|footer|header)[^>]*>.*?</\\1>', ' ', bruto)
    t = re.sub(r'(?s)<!--.*?-->', ' ', t)
    t = re.sub(r'(?s)<[^>]+>', ' ', t)
    t = html.unescape(t)
    return re.sub(r'\\s+', ' ', t).strip()


def links_de(bruto, base):
    achados = []
    for m in re.finditer(r'(?is)<a\\s[^>]*href\\s*=\\s*["\\']([^"\\'#]+)["\\']', bruto):
        try:
            u = urllib.parse.urljoin(base, m.group(1).strip()).split('#')[0]
        except Exception:
            continue
        if not u.startswith('http'):
            continue
        if re.search(r'\\.(png|jpe?g|gif|svg|css|js|pdf|zip|mp4|mp3|webp|ico|woff2?)$', u, re.I):
            continue
        if u not in achados:
            achados.append(u)
        if len(achados) >= LINKS_POR_PAGINA:
            break
    return achados


def baixar(url):
    ped = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(ped, timeout=25) as r:
        dados = r.read(2_000_000)
        enc = r.headers.get_content_charset() or 'utf-8'
    return dados.decode(enc, 'replace')


linhas = ['# PACK: worker (busca passiva)', '@fonte: arkher_worker.py em ' + time.strftime('%Y-%m-%d %H:%M'), '']
baixadas = 0
falhas = 0
blocos = 0

while fila and baixadas < PAGINAS:
    url, prof = fila.pop(0)
    if url in vistos:
        continue
    vistos.add(url)
    try:
        bruto = baixar(url)
        texto = limpar(bruto)[:CHARS]
        baixadas += 1
        if len(texto) > 400:
            linhas.append('## ' + url)
            linhas.append('@fonte: ' + url)
            for i in range(0, len(texto), 1800):
                pedaco = texto[i:i + 1800].strip()
                if len(pedaco) > 200:
                    linhas.append('- ' + pedaco)
                    blocos += 1
            linhas.append('')
        if prof < PROFUNDIDADE:
            for u in links_de(bruto, url):
                if u not in vistos:
                    fila.append((u, prof + 1))
        print('[%d] ok  %s (%d chars)' % (baixadas, url, len(texto)))
    except Exception as e:
        falhas += 1
        print('[--] erro %s (%s)' % (url, e))
    time.sleep(PAUSA)

with open(SAIDA, 'w', encoding='utf-8') as f:
    f.write('\\n'.join(linhas))

print('')
print('pronto: %d pagina(s), %d bloco(s), %d erro(s)' % (baixadas, blocos, falhas))
print('arquivo: %s  (%.1f KB)' % (SAIDA, os.path.getsize(SAIDA) / 1024.0))
print('agora importe esse arquivo no ARKHER: Config > Mega Pack > arquivo .md')
`;
    return { ok: true, script: py, paginas: opts.paginas, sementes: seeds.length };
  },

  /* ---------- baixar o script no navegador ---------- */
  baixarScript(opts) {
    const r = this.gerar(opts);
    if (!r.ok) return r;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.script], { type: 'text/x-python' }));
    a.download = 'arkher_worker.py';
    a.click();
    return r;
  },

  /* ---------- busca PASSIVA aqui mesmo, agora ----------
     CPU + RAM puros: baixa, limpa e indexa. Nenhum modelo é chamado,
     nenhuma cota é tocada. É o mesmo trabalho que o script faz, só que
     rodando neste navegador/site.                                     */
  async passivo(quantas, onLog) {
    const log = onLog || (() => {});
    if (typeof Dinamico === 'undefined') return { ok: false, err: 'módulo de ingestão não carregado' };
    if (typeof Neural !== 'undefined' && !Neural.pronto) { try { await Neural.init(log); } catch (e) {} }

    const antes = (typeof Neural !== 'undefined') ? Neural.stats_().itens : 0;
    log('busca passiva: baixando e indexando (sem chamar modelo nenhum)…');
    const r = await Dinamico.rodar(quantas || 4, log);
    const depois = (typeof Neural !== 'undefined') ? Neural.stats_().itens : 0;
    return {
      ok: r.ok, baixadas: r.baixadas, blocos: depois - antes, links: r.links,
      fila: r.fila, erros: r.erros, cotaDeIA: 0, gpu: 0,
    };
  },
};

if (typeof window !== 'undefined') window.Worker = Worker;
if (typeof module !== 'undefined' && module.exports) module.exports = { Worker };
