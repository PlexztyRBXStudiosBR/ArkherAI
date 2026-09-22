#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================
 ARKHER — RELIGADOR DO KAGGLE
================================================================

O problema: a sessao do Kaggle morre sozinha (12 h de limite, 20 min
parado sem interacao) e o kernel NAO religa. O do GitHub Actions religa
porque um workflow pode disparar outro; o Kaggle nao tem esse botao...
mas tem API.

A solucao: este script. Ele pega o notebook do repo, empurra pro Kaggle
(kaggle kernels push = inicia a execucao) e, se voce pedir --vigiar,
fica olhando: morreu? empurra de novo. Roda de qualquer lugar que
tenha internet e o token: na VM do Actions, no Termux, no seu PC.

  python3 religa_kaggle.py --usuario WhiteXz7 --uma-vez
  python3 religa_kaggle.py --usuario WhiteXz7 --vigiar --intervalo 300

Token (uma das duas formas):
  1) variaveis de ambiente:  KAGGLE_USERNAME  e  KAGGLE_KEY
  2) arquivo ~/.kaggle/kaggle.json  {"username":"...","key":"..."}

Cota: sao ~30 h de GPU por semana no Kaggle. Se religar sem parar, a
cota acaba e o Kaggle comeca a recusar — por isso o padrao aqui e
maximo de 6 religadas por hora e o script PARA quando aparece erro de
cota (e diz na cara que parou).
"""
import argparse, json, os, re, shutil, subprocess, sys, time

TOKEN_URL = 'https://www.kaggle.com/settings/account'
REPO_RAW = 'https://raw.githubusercontent.com/WhiteXz7/ARKHER-AI/main'


def _kaggle_cmd():
    """acha o CLI do kaggle: comando direto, python -m, ou nenhum."""
    if shutil.which('kaggle'):
        return ['kaggle']
    try:
        r = subprocess.run([sys.executable, '-m', 'kaggle', '--version'],
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            return [sys.executable, '-m', 'kaggle']
    except Exception:
        pass
    return None


def _tem_token():
    if os.environ.get('KAGGLE_USERNAME') and os.environ.get('KAGGLE_KEY'):
        return True
    p = os.path.join(os.path.expanduser('~'), '.kaggle', 'kaggle.json')
    return os.path.isfile(p)


def montar_kernel(dir_destino, usuario, notebook='arkher_kaggle.ipynb', titulo='ARKHER Kaggle node',
                  repo_local=None, slug='arkher-kaggle-node'):
    """monta a pasta que o kaggle kernels push espera (notebook + metadata)."""
    os.makedirs(dir_destino, exist_ok=True)
    slug = re.sub(r'[^a-z0-9-]+', '-', slug.lower()).strip('-') or 'arkher-kaggle-node'
    # notebook: do repo local se existir, senao baixa do GitHub
    origem = os.path.join(repo_local, notebook) if repo_local else None
    destino = os.path.join(dir_destino, notebook)
    if origem and os.path.isfile(origem):
        shutil.copy(origem, destino)
        via = origem
    else:
        import urllib.request
        url = REPO_RAW + '/' + notebook
        urllib.request.urlretrieve(url, destino)
        via = url
    meta = {
        'id': '%s/%s' % (usuario, slug),
        'title': titulo,
        'code_file': notebook,
        'language': 'python',
        'kernel_type': 'notebook',
        'is_private': True,
        'enable_gpu': True,           # <- o motivo de existir
        'enable_internet': True,      # <- Tailscale e pip precisam disto
        'dataset_sources': [], 'competition_sources': [], 'kernel_sources': [], 'model_sources': [],
    }
    with open(os.path.join(dir_destino, 'kernel-metadata.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    return {'dir': dir_destino, 'id': meta['id'], 'notebook_via': via}


def empurrar(cmd, pasta):
    r = subprocess.run(cmd + ['kernels', 'push', '-p', pasta], capture_output=True, text=True, timeout=600)
    saida = (r.stdout or '') + (r.stderr or '')
    return {'ok': r.returncode == 0, 'saida': saida.strip()[-1200:], 'code': r.returncode}


def estado(cmd, kid):
    try:
        r = subprocess.run(cmd + ['kernels', 'status', kid], capture_output=True, text=True, timeout=180)
        txt = ((r.stdout or '') + (r.stderr or '')).strip()
    except Exception as e:
        return {'erro': '%s: %s' % (type(e).__name__, e)}
    m = re.search(r'status\s+"?([a-zA-Z0-9_]+)"?', txt)
    return {'bruto': txt[-300:], 'estado': (m.group(1).lower() if m else '?')}


def main():
    ap = argparse.ArgumentParser(description='Religa (ou vigia) o no ARKHER no Kaggle')
    ap.add_argument('--usuario', default=os.environ.get('KAGGLE_USERNAME', ''), help='seu usuario do Kaggle')
    ap.add_argument('--slug', default='arkher-kaggle-node')
    ap.add_argument('--notebook', default='arkher_kaggle.ipynb')
    ap.add_argument('--repo', default=None, help='pasta do repo (pra usar o notebook local em vez do GitHub)')
    ap.add_argument('--dir', default='/tmp/arkher_kernel')
    ap.add_argument('--uma-vez', action='store_true', help='so empurra agora e sai')
    ap.add_argument('--vigiar', action='store_true', help='fica religando quando a sessao morrer')
    ap.add_argument('--intervalo', type=int, default=300, help='segundos entre as checagens (padrao 300)')
    ap.add_argument('--max-hora', type=int, default=6, help='limite de religadas por hora (protege a cota)')
    a = ap.parse_args()

    cmd = _kaggle_cmd()
    if not cmd:
        print(json.dumps({'ok': False, 'erro': 'o CLI do kaggle nao esta instalado',
                          'como_resolver': 'pip install kaggle  (e coloque KAGGLE_USERNAME/KAGGLE_KEY, '
                                           'ou salve ~/.kaggle/kaggle.json — pegue em %s)' % TOKEN_URL},
                         ensure_ascii=False, indent=1))
        return 2
    if not _tem_token():
        print(json.dumps({'ok': False, 'erro': 'sem credencial do Kaggle',
                          'como_resolver': 'KAGGLE_USERNAME e KAGGLE_KEY (ou ~/.kaggle/kaggle.json). '
                                           'Gere o token em %s' % TOKEN_URL}, ensure_ascii=False, indent=1))
        return 2
    if not a.usuario:
        print(json.dumps({'ok': False, 'erro': 'faltou --usuario (ou KAGGLE_USERNAME)'}, ensure_ascii=False))
        return 2

    info = montar_kernel(a.dir, a.usuario, a.notebook, repo_local=a.repo, slug=a.slug)
    print('kernel: %s   (notebook de %s)' % (info['id'], info['notebook_via']))

    if a.uma_vez or not a.vigiar:
        r = empurrar(cmd, info['dir'])
        print(json.dumps({'ok': r['ok'], 'acao': 'push', 'kernel': info['id'], 'saida': r['saida']},
                         ensure_ascii=False, indent=1))
        if not r['ok'] and re.search(r'quota|exceed|limit', r['saida'], re.I):
            print('>> a cota de GPU do Kaggle acabou (30 h/semana). Espere o reset no domingo.')
        return 0 if r['ok'] else 1

    # ---- modo vigia ----
    print('vigia ligado: checando a cada %ds (max %d religadas/hora). Ctrl+C pra sair.' % (a.intervalo, a.max_hora))
    religadas = []
    empurrou_agora = False
    while True:
        agora = time.time()
        religadas = [t for t in religadas if agora - t < 3600]
        st = estado(cmd, info['id'])
        e = st.get('estado', '?')
        vivo = e in ('running', 'queued', 'starting', 'queued_running')
        print('[%s] estado=%s' % (time.strftime('%H:%M:%S'), e or st.get('bruto', '?')))
        if not vivo and not empurrou_agora:
            if len(religadas) >= a.max_hora:
                print('>> ja religuei %d vezes nesta hora — segurando pra nao queimar a cota' % a.max_hora)
            else:
                r = empurrar(cmd, info['dir'])
                religadas.append(time.time())
                print('>> religuei: %s' % ('ok' if r['ok'] else 'falhou'))
                if r['saida']:
                    print('   %s' % r['saida'].replace('\n', '\n   ')[-500:])
                if not r['ok'] and re.search(r'quota|exceed|limit', r['saida'], re.I):
                    print('>> PARANDO: a cota de GPU acabou (30 h/semana). Volte depois do reset.')
                    return 3
                empurrou_agora = True
        if vivo and empurrou_agora:
            empurrou_agora = False
        time.sleep(max(60, a.intervalo))


if __name__ == '__main__':
    sys.exit(main())
