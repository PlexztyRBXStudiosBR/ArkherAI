#!/usr/bin/env python3
"""
ARKHER 3D — texto ou imagem -> modelo 3D (.glb).

Roda no no que tiver GPU (Kaggle P100/T4, PC com CUDA). Tambem roda em CPU,
so que devagar. Nao depende do agente: e um programa de linha de comando, e o
agente so chama ele.

  python gerar3d.py --lista
  python gerar3d.py --prompt "uma espada medieval de gelo"
  python gerar3d.py --imagem foto.png --engine triposr
  python gerar3d.py --instalar shape
  python gerar3d.py --selftest          (nao precisa de GPU nem internet)

Saidas em <ARKHER_STATE>/work/3d/:
  <nome>.glb            a malha
  <nome>_preview.png    render proprio (numpy+PIL, sem OpenGL)
  <nome>.json           metadados (motor, tempo, triangulos, avisos)

Na ultima linha imprime  ARKHER3D_OK {json}  ou  ARKHER3D_ERRO {json},
que e o que o agente le. Todo o resto e log pra tela.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import time

STATE = os.environ.get('ARKHER_STATE') or os.path.join(os.path.expanduser('~'), 'arkher_state')
SAIDA = os.path.join(STATE, 'work', '3d')
MOTORES_DIR = os.path.join(STATE, '3d', 'engines')


# --------------------------------------------------------------------------
# catalogo dos motores
# --------------------------------------------------------------------------
# 'deps'   = nomes de import (o que precisa existir pra rodar)
# 'pip'    = pacotes pra instalar
# 'vram'   = VRAM aproximada em GB
# 'gpu'    = ganha muito com GPU?
# 'verificado' = eu rodei isso aqui no sandbox? (honestidade acima de tudo)
MOTORES = {
    'shape': {
        'nome': 'Shap-E (texto -> 3D)',
        'tipo': 'texto',
        'deps': ['torch', 'diffusers', 'transformers', 'trimesh', 'numpy', 'PIL'],
        'pip': ['torch', 'diffusers', 'transformers', 'accelerate', 'trimesh',
                'numpy', 'pillow', 'safetensors', 'huggingface_hub', 'fast_simplification'],
        'modelo': 'openai/shap-e',
        'peso_gb': 2.0, 'vram': 6, 'gpu': True,
        'qualidade': 'media',
        'nota': 'formas bolhudas — serve de rascunho/bloqueio, nao de modelo final',
        'verificado': False,
    },
    'shape-img': {
        'nome': 'Shap-E (imagem -> 3D)',
        'tipo': 'imagem',
        'deps': ['torch', 'diffusers', 'transformers', 'trimesh', 'numpy', 'PIL'],
        'pip': ['torch', 'diffusers', 'transformers', 'accelerate', 'trimesh',
                'numpy', 'pillow', 'safetensors', 'huggingface_hub', 'fast_simplification'],
        'modelo': 'openai/shap-e-img2img',
        'peso_gb': 2.0, 'vram': 6, 'gpu': True,
        'qualidade': 'media',
        'nota': 'usa a cor/forma da imagem; fundo limpo ajuda muito',
        'verificado': False,
    },
    'triposr': {
        'nome': 'TripoSR (imagem -> 3D)',
        'tipo': 'imagem',
        'deps': ['torch', 'trimesh', 'numpy', 'PIL', 'omegaconf', 'einops', 'jaxtyping',
                 'rembg', 'torchmcubes'],
        'pip': ['torch', 'trimesh', 'numpy', 'pillow', 'omegaconf', 'einops', 'jaxtyping',
                'huggingface_hub', 'safetensors', 'setuptools', 'rembg', 'onnxruntime',
                'fast_simplification'],
        'modelo': 'stabilityai/TripoSR',
        'extra': 'precisa do repo VAST-AI-Research/TripoSR (clonado pelo --instalar) e do '
                 'torchmcubes compilado (2-5 min de compilacao; sem ele o TripoSR nem importa)',
        'peso_gb': 1.7, 'vram': 8, 'gpu': True,
        'qualidade': 'alta',
        'nota': 'malha bem mais limpa que o Shap-E; 0,5s no A100, ~1 min no T4',
        'verificado': False,
    },
    'sd-turbo': {
        'nome': 'SD-Turbo (texto -> imagem, so pro TripoSR)',
        'tipo': 'auxiliar',
        'deps': ['torch', 'diffusers'],
        'pip': ['torch', 'diffusers', 'transformers', 'accelerate'],
        'modelo': 'stabilityai/sd-turbo',
        'peso_gb': 2.5, 'vram': 4, 'gpu': True,
        'qualidade': 'media',
        'nota': 'gera a imagem de 1 a 4 passos pra alimentar o TripoSR',
        'verificado': False,
    },
    'procedural': {
        'nome': 'Procedural (sem IA)',
        'tipo': 'texto',
        'deps': ['trimesh', 'numpy', 'PIL'],
        'pip': ['trimesh', 'numpy', 'pillow'],
        'modelo': '',
        'peso_gb': 0.05, 'vram': 0, 'gpu': False,
        'qualidade': 'baixa',
        'nota': 'NAO e IA: monta primitivas a partir do texto/hash. So pra testar '
                'o encanamento (job, preview, download) sem depender de GPU.',
        'verificado': True,
    },
}

# ordem de preferencia quando engine=auto.
# triposr so atende texto se o sd-turbo (texto->imagem) tambem estiver instalado;
# shape e pip puro, sem compilar nada — e o caminho que menos quebra.
PREFERENCIA = {
    'imagem': ['triposr', 'shape-img'],
    'texto': ['shape', 'triposr'],
}


def _faltando(deps):
    out = []
    for d in deps:
        try:
            if importlib.util.find_spec(d) is None:
                out.append(d)
        except Exception:
            out.append(d)
    return out


def _gpu():
    """(nome, vram_gb, cuda) sem depender de torch instalado."""
    try:
        import torch  # noqa
        if torch.cuda.is_available():
            nome = torch.cuda.get_device_name(0)
            try:
                vram = torch.cuda.get_device_properties(0).total_memory / 1e9
            except Exception:
                vram = 0
            return nome, round(vram, 1), True
    except Exception:
        pass
    try:
        r = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total',
                            '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=15)
        if r.returncode == 0 and r.stdout.strip():
            linha = r.stdout.strip().split('\n')[0]
            nome, _, mb = linha.rpartition(',')
            return nome.strip(), round(float(mb) / 1024, 1), False
    except Exception:
        pass
    return '', 0.0, False


def _ram_gb():
    try:
        with open('/proc/meminfo') as f:
            for l in f:
                if l.startswith('MemTotal'):
                    return round(int(l.split()[1]) / 1048576, 1)
    except Exception:
        pass
    try:
        import ctypes

        class _MS(ctypes.Structure):
            _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong),
                        ('ullTotalPhys', ctypes.c_ulonglong),
                        ('ullAvailPhys', ctypes.c_ulonglong),
                        ('ullTotalPageFile', ctypes.c_ulonglong),
                        ('ullAvailPageFile', ctypes.c_ulonglong),
                        ('ullTotalVirtual', ctypes.c_ulonglong),
                        ('ullAvailVirtual', ctypes.c_ulonglong),
                        ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
        m = _MS()
        m.dwLength = ctypes.sizeof(_MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return round(m.ullTotalPhys / 1e9, 1)
    except Exception:
        return 0.0


def lista():
    gpu, vram, cuda = _gpu()
    motores = {}
    for k, m in MOTORES.items():
        falta = _faltando(m['deps'])
        pronto = not falta
        if k == 'triposr':
            pronto = pronto and os.path.isfile(os.path.join(MOTORES_DIR, 'TripoSR', 'run.py'))
            if not os.path.isfile(os.path.join(MOTORES_DIR, 'TripoSR', 'run.py')):
                falta = falta + ['repo VAST-AI-Research/TripoSR']
        motores[k] = {
            'id': k, 'nome': m['nome'], 'tipo': m['tipo'], 'qualidade': m['qualidade'],
            'pronto': bool(pronto), 'faltando': falta, 'nota': m['nota'],
            'modelo': m['modelo'], 'vram_gb': m['vram'], 'peso_gb': m['peso_gb'],
            'usa_gpu': m['gpu'], 'verificado': m['verificado'],
            'instalar': 'python gerar3d.py --instalar ' + k if not pronto else '',
            'cabe_aqui': (not m['gpu']) or cuda or (vram == 0),
        }
    return {'ok': True, 'gpu': gpu, 'vram_gb': vram, 'cuda': cuda, 'ram_gb': _ram_gb(),
            'os': platform.system(), 'py': platform.python_version(),
            'saida': SAIDA, 'motores': motores}


# --------------------------------------------------------------------------
# malha: normalizar, salvar, preview
# --------------------------------------------------------------------------
def _cores(mesh):
    """cores dos vertices (uint8 Nx4) ou None.
    O trimesh devolve BRANCO por padrao quando nao existe cor no arquivo — isso
    nao conta como 'tem cor' (era o que deixava o preview cinza-chumbo)."""
    import numpy as np
    try:
        vc = np.asarray(mesh.visual.vertex_colors)
    except Exception:
        return None
    if vc.ndim != 2 or vc.shape[1] < 3 or vc.shape[0] != len(mesh.vertices):
        return None
    vc = vc.astype(np.float64)
    if vc.max() <= 1.01 and vc.max() > 0:
        vc = vc * 255.0
    vc = np.clip(vc, 0, 255)
    if vc.shape[1] == 3:
        vc = np.concatenate([vc, np.full((len(vc), 1), 255.0)], axis=1)
    return vc.astype(np.uint8)


def _expandir(lo, hi):
    """(i, j) de todos os pares com lo[i] <= j < hi[i], em arrays paralelos."""
    import numpy as np
    cont = (hi - lo).astype(np.int64)
    tot = int(cont.sum())
    if tot == 0:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    i = np.repeat(np.arange(len(lo), dtype=np.int64), cont)
    base = np.cumsum(cont) - cont
    j = np.arange(tot, dtype=np.int64) - np.repeat(base, cont) + np.repeat(lo, cont)
    return i, j


def _cor_mais_proxima(orig, cores, novos):
    """cor do vertice original mais proximo de cada vertice novo.
    Grade hash em numpy puro (sem scipy): Nao cai pra forca bruta em malha grande."""
    import numpy as np
    o = np.asarray(orig, dtype=np.float64)
    n = np.asarray(novos, dtype=np.float64)
    if len(o) == 0 or len(n) == 0:
        return None
    mn, mx = o.min(axis=0), o.max(axis=0)
    lado = np.maximum(mx - mn, 1e-9)
    cel = max(4, min(96, int(round(len(o) ** (1.0 / 3.0)))))
    gi = np.minimum(((o - mn) / lado * cel).astype(np.int64), cel - 1)
    chave = (gi[:, 0] * cel + gi[:, 1]) * cel + gi[:, 2]
    ordem = np.argsort(chave, kind='stable')
    chave_s = chave[ordem]
    BIG = np.int64(len(o) + 1)
    saida = np.zeros((len(n), cores.shape[1]), dtype=np.uint8)
    passo = 200000
    for ini in range(0, len(n), passo):
        pedaco = n[ini:ini + passo]
        gn0 = np.minimum(((pedaco - mn) / lado * cel).astype(np.int64), cel - 1)
        melhor = np.full(len(pedaco), np.iinfo(np.int64).max, dtype=np.int64)
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                for c in (-1, 0, 1):
                    gn = np.clip(gn0 + [a, b, c], 0, cel - 1)
                    kk = (gn[:, 0] * cel + gn[:, 1]) * cel + gn[:, 2]
                    lo = np.searchsorted(chave_s, kk, 'left')
                    hi = np.searchsorted(chave_s, kk, 'right')
                    ii, jj = _expandir(lo, hi)
                    if len(ii) == 0:
                        continue
                    d2 = ((o[ordem[jj]] - pedaco[ii]) ** 2).sum(1)
                    chv = np.rint(d2 * 1e6).astype(np.int64) * BIG + ordem[jj]
                    np.minimum.at(melhor, ii, chv)
        ok = melhor != np.iinfo(np.int64).max
        if ok.any():
            saida[ini:ini + passo][ok] = cores[(melhor[ok] % BIG)]
    return saida


def normalizar(mesh, alvo=1.0):
    """centro na origem e maior lado = alvo. GLB solto em qualquer escala e um lixo
    pra quem vai importar no Blender/Roblox."""
    import numpy as np
    v = np.asarray(mesh.vertices, dtype=np.float64)
    if len(v) == 0:
        raise ValueError('malha vazia')
    c = (v.max(axis=0) + v.min(axis=0)) / 2.0
    v = v - c
    ext = float(np.max(v.max(axis=0) - v.min(axis=0))) or 1.0
    v *= (alvo / ext)
    mesh.vertices = v.astype(np.float32)
    return mesh


def limpar(mesh, max_faces=0):
    """tira faces degeneradas, junta vertices e (se der) decima."""
    import numpy as np
    avisos = []
    try:
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.update_faces(mesh.unique_faces())
        mesh.remove_unreferenced_vertices()
    except Exception as e:
        avisos.append('limpeza parcial: %s' % e)
    if max_faces and len(mesh.faces) > max_faces:
        # a decimacao joga fora as cores dos vertices: guarda antes e devolve depois
        v_antes = np.asarray(mesh.vertices, dtype=np.float64).copy()
        c_antes = _cores(mesh)
        try:
            novo = mesh.simplify_quadric_decimation(face_count=max_faces)
            avisos.append('decimado de %d pra %d faces' % (len(mesh.faces), len(novo.faces)))
            if c_antes is not None and len(novo.vertices):
                try:
                    cores = _cor_mais_proxima(v_antes, c_antes, np.asarray(novo.vertices))
                    if cores is not None:
                        novo.visual.vertex_colors = cores
                except Exception as e:
                    avisos.append('cores nao foram pra malha decimada: %s' % e)
            mesh = novo
        except Exception:
            avisos.append('malha densa (%d faces) e sem fast_simplification pra decimar'
                          % len(mesh.faces))
    return mesh, avisos


def _cam(v, yaw=35.0, pitch=22.0):
    """roda os vertices pra uma vista 3/4 (ortho)."""
    import numpy as np
    a, b = np.radians(yaw), np.radians(pitch)
    ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    return v @ ry.T @ rx.T


def _tam_render(n, alvo, cap=1600):
    """Super-amostragem: malha densa tem triangulo do tamanho de 1-2 pixels e o
    PIL deixa buraco entre eles. Renderiza maior e reduz com LANCZOS -> liso."""
    import math
    return int(max(alvo, min(cap, 5.0 * math.sqrt(max(int(n), 1)))))


def _malha_do_render(mesh, limite=40000):
    """devolve (V, F, cores) pra pintar. Malha densa e decimada numa COPIA
    (com as cores levadas junto) — o .glb salvo continua com a malha cheia."""
    import numpy as np
    V = np.asarray(mesh.vertices, dtype=np.float64)
    F = np.asarray(mesh.faces, dtype=np.int64)
    cc = _cores(mesh)
    if len(F) > limite:
        try:
            copia = mesh.copy()
            copia, _ = limpar(copia, limite)
            V = np.asarray(copia.vertices, dtype=np.float64)
            F = np.asarray(copia.faces, dtype=np.int64)
            cc = _cores(copia)
        except Exception:
            return V, F, cc, False        # nao deu: cai na nuvem de pontos
    return V, F, cc, True


def preview(mesh, destino, tam=640):
    """Render proprio em numpy+PIL: z-buffer por pintor, sem OpenGL e sem pyrender.
    Malha densa e decimada so pra este print (com as cores) e pintada normal."""
    import numpy as np
    from PIL import Image, ImageDraw

    V, F, cc, deu = _malha_do_render(mesh)
    faces_ok = deu and F.ndim == 2 and len(F) > 0 and int(F.max()) < len(V)
    S = _tam_render(len(F) if faces_ok else len(V), tam)
    img = Image.new('RGB', (S, S), (13, 16, 23))
    if len(V) == 0:
        img.save(destino)
        return destino

    Vc = _cam(V)
    xy, z = Vc[:, :2], Vc[:, 2]
    span = max(float(np.ptp(xy[:, 0])), float(np.ptp(xy[:, 1]))) or 1.0
    esc = (S * 0.82) / span
    have_cores = cc is not None and (int(cc[:, :3].max()) - int(cc[:, :3].min())) >= 3
    base = cc[:, :3].astype(np.float64) if have_cores else \
        np.tile(np.array([190, 196, 210], dtype=np.float64), (len(V), 1))
    luz = np.array([-0.4, 0.65, 0.65])
    luz = luz / np.linalg.norm(luz)
    px = (xy[:, 0] * esc + S / 2).astype(np.int32)
    py = (-xy[:, 1] * esc + S / 2).astype(np.int32)

    if faces_ok:
        # pintor: longe -> perto. Sem culling: em malha decimada a normal por face
        # sai barulhenta e o culling abriria buracos.
        dr = ImageDraw.Draw(img)
        a_, b_, c_ = Vc[F[:, 0]], Vc[F[:, 1]], Vc[F[:, 2]]
        nrm = np.cross(b_ - a_, c_ - a_)
        nl = np.linalg.norm(nrm, axis=1)
        nl[nl == 0] = 1
        lum = np.clip((nrm / nl[:, None]) @ luz, 0.12, 1.0)
        cor = base[F].mean(axis=1) if have_cores else base[F[:, 0]]
        for i in np.argsort(z[F].mean(axis=1)):
            r, g, b = np.clip(cor[i] * (0.35 + 0.65 * lum[i]), 0, 255).astype(int)
            dr.polygon([(px[F[i, 0]], py[F[i, 0]]), (px[F[i, 1]], py[F[i, 1]]),
                        (px[F[i, 2]], py[F[i, 2]])], fill=(int(r), int(g), int(b)))
    else:
        # ultimo recurso: nuvem de pontos com z-buffer vetorizado
        n_pts = min(220000, max(80000, len(F) * 2)) if len(F) else len(V)
        try:
            pts, fid = mesh.sample(n_pts, return_index=True)
        except Exception:
            pts, fid = mesh.vertices, None
        pts = np.asarray(pts, dtype=np.float64)
        cor = base[:len(pts)]
        if have_cores and fid is not None and len(F):
            try:
                cor = base[F[np.asarray(fid, dtype=np.int64)][:, 0]]   # fid = FACE
            except Exception:
                pass
        cor = np.resize(cor, (len(pts), 3))
        Pc = _cam(pts)
        qx = (Pc[:, 0] * esc + S / 2).astype(np.int64)
        qy = (-Pc[:, 1] * esc + S / 2).astype(np.int64)
        qz = Pc[:, 2]
        ok = (qx >= 0) & (qx < S) & (qy >= 0) & (qy < S)
        qx, qy, qz, cor = qx[ok], qy[ok], qz[ok], cor[ok]
        if len(qx):
            prof = np.clip((qz - qz.min()) / ((qz.max() - qz.min()) or 1), 0, 1)
            cores = np.clip(cor * (0.45 + 0.75 * prof)[:, None], 0, 255).astype(np.uint8)
            flat = qy * S + qx
            zbuf = np.full(S * S, -np.inf)
            np.maximum.at(zbuf, flat, qz)
            sel = np.flatnonzero(zbuf[flat] == qz)
            buf = np.zeros((S * S, 3), dtype=np.uint8)
            buf[flat[sel]] = cores[sel]
            m3 = buf.reshape(S, S, 3)
            dens = len(qx) / float(S * S)
            for _ in range(1 if dens >= 1.3 else (2 if dens >= 0.42 else 3)):
                m3[1:, :] = np.maximum(m3[1:, :], m3[:-1, :])
                m3[:, 1:] = np.maximum(m3[:, 1:], m3[:, :-1])
            mask = m3.max(2) > 30
            viz = np.zeros(mask.shape, np.int16)
            soma = np.zeros(m3.shape, np.int32)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy == 0 and dx == 0:
                        continue
                    n = np.roll(np.roll(mask.astype(np.int16), dy, 0), dx, 1)
                    viz += n
                    soma += np.roll(np.roll(m3, dy, 0), dx, 1).astype(np.int32) * n[:, :, None]
            buraco = (~mask) & (viz >= 5)
            if buraco.any():
                m3[buraco] = (soma / np.maximum(viz, 1)[:, :, None]).astype(np.uint8)[buraco]
            img = Image.fromarray(m3, 'RGB')

    if S != tam:
        img = img.resize((tam, tam), Image.LANCZOS)
    ImageDraw.Draw(img).rectangle([0, 0, tam - 1, tam - 1], outline=(36, 44, 62))
    img.save(destino)
    return destino


def salvar_glb(mesh, destino):
    mesh.export(destino, file_type='glb')
    return destino


# --------------------------------------------------------------------------
# motores de verdade
# --------------------------------------------------------------------------
def _torch_device():
    import torch
    if torch.cuda.is_available():
        return 'cuda', torch.float16
    return 'cpu', torch.float32


def _shape(prompt=None, imagem=None, passos=64, guia=15.0, frame=256, grade=96, seed=None):
    """Shap-E via diffusers (pip puro, sem compilar nada)."""
    import torch
    import numpy as np
    import trimesh
    from diffusers import ShapEPipeline, ShapEImg2ImgPipeline

    dev, dtype = _torch_device()
    gerador = torch.Generator(device=dev).manual_seed(int(seed)) if seed is not None else None

    def carregar(classe, repo):
        # algumas versoes publicam o peso em fp16 (variant); se nao tiver, segue fp32
        try:
            p = classe.from_pretrained(repo, torch_dtype=dtype, variant='fp16' if dev == 'cuda' else None)
        except Exception:
            p = classe.from_pretrained(repo, torch_dtype=dtype)
        return p.to(dev)

    if imagem:
        pipe = carregar(ShapEImg2ImgPipeline, MOTORES['shape-img']['modelo'])
        img = imagem
        if hasattr(img, 'convert'):
            img = img.convert('RGB')
        saida = pipe(img, num_inference_steps=passos, guidance_scale=min(guia, 4.0),
                     frame_size=frame, generator=gerador, output_type='mesh')
    else:
        pipe = carregar(ShapEPipeline, MOTORES['shape']['modelo'])
        saida = pipe(prompt, num_inference_steps=passos, guidance_scale=guia,
                     frame_size=frame, generator=gerador, output_type='mesh')

    lat = saida.images if hasattr(saida, 'images') else saida[0]
    # 'mesh' ainda vem como latente: decodifica na grade pedida (VRAM ~ grade^3)
    try:
        from diffusers.pipelines.shap_e.renderer import MeshDecoderOutput  # noqa
        e_mesh = lat and isinstance(lat[0], MeshDecoderOutput)
    except Exception:
        e_mesh = False
    if not e_mesh:
        decod = []
        for l in lat:
            decod.append(pipe.shap_e_renderer.decode_to_mesh(l[None, :], dev, grid_size=int(grade)))
        lat = decod

    m = lat[0]
    verts = np.asarray(m.verts.detach().float().cpu().numpy() if hasattr(m.verts, 'detach') else m.verts)
    faces = np.asarray(m.faces.detach().cpu().numpy() if hasattr(m.faces, 'detach') else m.faces)
    malha = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    try:
        ch = getattr(m, 'vertex_channels', None)
        if isinstance(ch, dict) and all(k in ch for k in ('R', 'G', 'B')):
            cores = np.stack([np.asarray(ch[k].detach().cpu().numpy() if hasattr(ch[k], 'detach') else ch[k])
                              for k in ('R', 'G', 'B')], axis=1)
            if cores.shape[0] == len(verts):
                if cores.max() <= 1.01:
                    cores = cores * 255.0
                rgba = np.concatenate([np.clip(cores, 0, 255),
                                       np.full((len(cores), 1), 255.0)], axis=1).astype(np.uint8)
                malha.visual.vertex_colors = rgba
    except Exception:
        pass
    del pipe
    return malha, {'device': dev, 'grade': grade, 'repo': MOTORES['shape' if not imagem else 'shape-img']['modelo']}


def _texto_para_imagem(prompt, destino, seed=None, passos=2):
    import torch
    from diffusers import AutoPipelineForText2Image
    dev, dtype = _torch_device()
    pipe = AutoPipelineForText2Image.from_pretrained('stabilityai/sd-turbo', torch_dtype=dtype)
    pipe = pipe.to(dev)
    g = torch.Generator(device=dev).manual_seed(int(seed)) if seed is not None else None
    img = pipe(prompt=prompt + ', objeto unico no centro, fundo branco liso, produto',
               num_inference_steps=max(1, min(int(passos), 4)), guidance_scale=0.0,
               generator=g).images[0]
    os.makedirs(os.path.dirname(destino) or '.', exist_ok=True)
    img.save(destino)
    del pipe
    return destino


def _triposr(imagem, pasta_saida, repo_dir, max_faces=0, mc_res=256, sem_rembg=False):
    """Delega pro run.py oficial do TripoSR (nao reimplementei a API deles).
    So passa as flags que o run.py clonado realmente tem."""
    run_py = os.path.join(repo_dir, 'run.py')
    if not os.path.isfile(run_py):
        raise RuntimeError('TripoSR nao esta instalado aqui — rode: python gerar3d.py --instalar triposr')
    if _faltando(['torchmcubes']):
        raise RuntimeError('falta o torchmcubes (obrigatorio: o TripoSR importa ele no topo).\n'
                           'rode: python gerar3d.py --instalar triposr')
    help_txt = ''
    try:
        h = subprocess.run([sys.executable, run_py, '--help'], capture_output=True,
                           text=True, timeout=180, cwd=repo_dir)
        help_txt = (h.stdout or '') + (h.stderr or '')
    except Exception:
        pass
    argv = [sys.executable, run_py, os.path.abspath(imagem), '--output-dir', os.path.abspath(pasta_saida)]
    if '--model-save-format' in help_txt:
        argv += ['--model-save-format', 'glb']
    if '--mc-resolution' in help_txt:
        argv += ['--mc-resolution', str(int(mc_res))]
    if '--no-remove-bg' in help_txt and sem_rembg:
        argv += ['--no-remove-bg']
    if '--device' in help_txt:
        try:
            import torch
            if torch.cuda.is_available():
                argv += ['--device', 'cuda']
        except Exception:
            pass
    print('$ ' + ' '.join(argv), flush=True)
    r = subprocess.run(argv, capture_output=True, text=True, timeout=3600, cwd=repo_dir)
    if r.stdout:
        print(r.stdout[-4000:], flush=True)
    if r.returncode != 0:
        erro = ((r.stderr or '') + (r.stdout or ''))[-1200:]
        # o rembg baixa um modelo proprio; se estiver sem rede ele derruba tudo.
        # Sem rembg funciona (so exige fundo liso) — entao tenta de novo assim.
        if not sem_rembg and ('rembg' in erro.lower() or 'onnxruntime' in erro.lower()
                              or 'download' in erro.lower()):
            print('[3d] rembg falhou — tentando de novo com --no-remove-bg '
                  '(o fundo da imagem precisa ser liso)', flush=True)
            return _triposr(imagem, pasta_saida, repo_dir, max_faces, mc_res, sem_rembg=True)
        raise RuntimeError('TripoSR falhou (code %s): %s' % (r.returncode, erro))
    cands = []
    for raiz, _, arqs in os.walk(pasta_saida):
        for a in arqs:
            if a.lower().endswith(('.glb', '.obj', '.ply', '.stl')):
                cands.append(os.path.join(raiz, a))
    if not cands:
        raise RuntimeError('TripoSR rodou mas nao achei malha em %s' % pasta_saida)
    cands.sort(key=lambda p: (not p.lower().endswith('.glb'), -os.path.getsize(p)))
    return cands[0]


def _procedural(prompt, seed=None):
    """Sem IA. Monta uma coisa qualquer, deterministica, so pra testar o encanamento."""
    import numpy as np
    import trimesh
    s = int(seed) if seed is not None else int(hashlib.sha256((prompt or 'x').encode()).hexdigest()[:8], 16)
    rnd = np.random.RandomState(s)
    partes = []
    n = rnd.randint(4, 9)
    for i in range(n):
        t = rnd.choice(['box', 'cyl', 'sphere'])
        esc = rnd.uniform(0.35, 0.9, 3)
        if t == 'box':
            p = trimesh.creation.box(extents=esc)
        elif t == 'cyl':
            p = trimesh.creation.cylinder(radius=esc[0] / 2, height=esc[1] * 1.6,
                                          sections=int(rnd.randint(8, 20)))
        else:
            p = trimesh.creation.icosphere(subdivisions=int(rnd.randint(1, 3)), radius=esc[0] / 2)
        p.apply_translation(rnd.uniform(-0.5, 0.5, 3))
        p.apply_transform(trimesh.transformations.random_rotation_matrix(rnd.rand(3)))
        partes.append(p)
    malha = trimesh.util.concatenate(partes)
    cor = np.array([[[90, 130, 200, 255]]], dtype=np.uint8)
    malha.visual.vertex_colors = np.tile(cor.reshape(1, 4), (len(malha.vertices), 1))
    return malha, {'seed': s, 'primitivas': int(n),
                   'aviso': 'procedural NAO e IA — so pra testar o encanamento'}


def _install_argv(motor):
    m = MOTORES[motor]
    pip = [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '-q']
    cmds = []
    # O torch merece comando separado: numa maquina sem GPU o wheel CUDA tem ~2,5 GB
    # e o de CPU ~200 MB. Com GPU, o padrao (PyPI) ja traz CUDA.
    if 'torch' in m['pip']:
        resto = [x for x in m['pip'] if x != 'torch']
        cuda = _gpu()[2] or bool(os.environ.get('ARKHER_TORCH') == 'cuda')
        if cuda and os.environ.get('ARKHER_TORCH') != 'cpu':
            cmds.append(pip + ['torch'])
        else:
            print('[3d] sem GPU aqui: instalando o torch de CPU (~200 MB em vez de ~2,5 GB)', flush=True)
            cmds.append(pip + ['torch', '--index-url', 'https://download.pytorch.org/whl/cpu'])
        if resto:
            cmds.append(pip + resto)
    else:
        cmds.append(pip + m['pip'])
    if os.environ.get('HF_HOME'):
        print('[3d] modelos vao pra HF_HOME=%s (persiste entre sessoes se estiver no estado)' % os.environ['HF_HOME'],
              flush=True)
    if motor == 'triposr':
        repo = os.path.join(MOTORES_DIR, 'TripoSR')
        if not os.path.isfile(os.path.join(repo, 'run.py')):
            os.makedirs(MOTORES_DIR, exist_ok=True)
            cmds.append(['git', 'clone', '--depth', '1',
                         'https://github.com/VAST-AI-Research/TripoSR.git', repo])
        # o isosurface.py faz "from torchmcubes import marching_cubes" no topo,
        # sem try/except: sem isso o TripoSR nao importa, ponto.
        cmds.append(pip + ['git+https://github.com/tatsy/torchmcubes.git'])
    return cmds


def instalar(motor):
    if motor not in MOTORES:
        raise SystemExit('motor desconhecido: %s' % motor)
    print('== instalando %s ==' % MOTORES[motor]['nome'], flush=True)
    ok = True
    for c in _install_argv(motor):
        print('$ ' + ' '.join(c), flush=True)
        r = subprocess.run(c, text=True, errors='replace')
        if r.returncode != 0:
            ok = False
            print('!!! falhou (code %s). Continuando pro proximo passo.' % r.returncode, flush=True)
    st = lista()['motores'][motor]
    print('== resultado: %s | faltando: %s' %
          ('PRONTO' if st['pronto'] else 'INCOMPLETO', ', '.join(st['faltando']) or 'nada'), flush=True)
    return 0 if (ok and st['pronto']) else 1


# --------------------------------------------------------------------------
# fluxo principal
# --------------------------------------------------------------------------
def _escolher(engine, tipo):
    st = lista()['motores']
    cand = [k for k in PREFERENCIA[tipo] if st.get(k, {}).get('pronto')]
    if tipo == 'texto' and 'triposr' in cand and not st['sd-turbo']['pronto']:
        cand.remove('triposr')      # sem sd-turbo nao ha como dar texto pro TripoSR
    if cand:
        return cand[0]
    raise SystemExit(
        'nenhum motor de %s pronto neste no. Instale um:\n' % tipo +
        '\n'.join('  python gerar3d.py --instalar %s' % k
                   for k in (('triposr', 'sd-turbo') if tipo == 'texto' else PREFERENCIA[tipo])) +
        '\n(cada um tem tamanho, tempo de download e risco diferentes — veja --lista)')


def gerar(prompt=None, imagem=None, engine='auto', seed=None, passos=64, guia=15.0,
          frame=256, grade=96, max_faces=150000, quieto=False):
    t0 = time.time()
    os.makedirs(SAIDA, exist_ok=True)
    tipo = 'imagem' if imagem else 'texto'
    escolhido = engine if engine and engine != 'auto' else 'auto'
    if escolhido != 'auto' and escolhido not in MOTORES:
        raise SystemExit('motor desconhecido: %s\nveja os disponiveis: python gerar3d.py --lista' % escolhido)
    if escolhido == 'auto':
        escolhido = _escolher('auto', tipo)
    print('[3d] motor: %s' % MOTORES[escolhido]['nome'], flush=True)
    if not quieto:
        f = _faltando(MOTORES[escolhido]['deps'])
        if f:
            raise SystemExit('faltam dependencias do motor %s: %s\nrode: python gerar3d.py --instalar %s'
                             % (escolhido, ', '.join(f), escolhido))

    meta_extra = {}
    nome = 'gerado_' + time.strftime('%Y%m%d_%H%M%S')
    if escolhido == 'procedural':
        malha, meta_extra = _procedural(prompt, seed)
    elif escolhido in ('shape', 'shape-img'):
        img = None
        if imagem:
            from PIL import Image
            img = Image.open(imagem)
        malha, meta_extra = _shape(prompt=prompt, imagem=img, passos=passos, guia=guia,
                                   frame=frame, grade=grade, seed=seed)
    elif escolhido == 'triposr':
        repo = os.path.join(MOTORES_DIR, 'TripoSR')
        # sem GPU o TripoSR nao roda; e texto precisa virar imagem antes
        if imagem:
            caminho_img = imagem
        else:
            alvo = os.path.join(SAIDA, nome + '_entrada.png')
            print('[3d] texto -> imagem com SD-Turbo…', flush=True)
            caminho_img = _texto_para_imagem(prompt, alvo, seed=seed)
            meta_extra['imagem_entrada'] = os.path.basename(caminho_img)
        tmp = os.path.join(SAIDA, nome + '_triposr')
        os.makedirs(tmp, exist_ok=True)
        print('[3d] TripoSR reconstruindo…', flush=True)
        bruto = _triposr(caminho_img, tmp, repo, max_faces, mc_res=grade * 4 if grade < 64 else 256)
        print('[3d] malha bruta: %s' % bruto, flush=True)
        import trimesh
        malha = trimesh.load(bruto, force='mesh', process=True)
        meta_extra['bruto'] = os.path.relpath(bruto, SAIDA)
    else:
        raise SystemExit('motor %s ainda nao implementado' % escolhido)

    malha, avisos = limpar(malha, max_faces)
    malha = normalizar(malha, 1.0)
    meta_extra['avisos'] = avisos

    glb = os.path.join(SAIDA, nome + '.glb')
    salvar_glb(malha, glb)
    print('[3d] glb: %s (%.2f MB)' % (glb, os.path.getsize(glb) / 1e6), flush=True)

    png = os.path.join(SAIDA, nome + '_preview.png')
    try:
        preview(malha, png)
        print('[3d] preview: %s' % png, flush=True)
    except Exception as e:
        png = None
        meta_extra['avisos'] = meta_extra.get('avisos', []) + ['preview falhou: %s' % e]

    seg = round(time.time() - t0, 1)
    meta = {
        'ok': True, 'motor': escolhido, 'motor_nome': MOTORES[escolhido]['nome'],
        'qualidade': MOTORES[escolhido]['qualidade'], 'verificado': MOTORES[escolhido]['verificado'],
        'prompt': prompt or '', 'imagem': os.path.basename(imagem) if imagem else '',
        'glb': os.path.relpath(glb, os.path.dirname(SAIDA)),
        'glb_abs': glb,
        'preview': os.path.relpath(png, os.path.dirname(SAIDA)) if png else '',
        'preview_abs': png or '',
        'faces': int(len(malha.faces)), 'vertices': int(len(malha.vertices)),
        'segundos': seg, 'nota': MOTORES[escolhido]['nota'],
        'aviso': meta_extra.get('aviso', ''), 'avisos': meta_extra.get('avisos', []),
    }
    for k in ('device', 'grade', 'repo', 'seed', 'primitivas', 'imagem_entrada', 'bruto'):
        if k in meta_extra:
            meta[k] = meta_extra[k]
    with open(os.path.join(SAIDA, nome + '.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print('ARKHER3D_OK ' + json.dumps(meta, ensure_ascii=False), flush=True)
    return meta


def selftest():
    """Sem GPU, sem internet, sem GPU-driver: prova que o encanamento funciona."""
    print('== ARKHER3D selftest ==', flush=True)
    st = lista()
    print('gpu: %s | vram: %s GB | ram: %s GB | cuda: %s' %
          (st['gpu'] or 'nenhuma', st['vram_gb'], st['ram_gb'], st['cuda']), flush=True)
    for k, m in st['motores'].items():
        print('   %-11s %-9s %s%s' % (k, m['qualidade'], 'PRONTO' if m['pronto'] else 'falta: ',
                                      '' if m['pronto'] else ', '.join(m['faltando'])), flush=True)
    r = gerar(prompt='selftest bloco', engine='procedural')
    import trimesh
    back = trimesh.load(r['glb_abs'], force='mesh')
    prev = r.get('preview_abs') or ''
    tam_prev = os.path.getsize(prev) if prev and os.path.isfile(prev) else 0
    ok = (len(back.faces) == r['faces']) and tam_prev > 2000
    print('== relido: %d faces, preview %d bytes -> %s =='
          % (len(back.faces), tam_prev, 'OK' if ok else 'FALHOU'), flush=True)
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description='ARKHER 3D — texto/imagem -> .glb')
    ap.add_argument('--prompt', '-p')
    ap.add_argument('--imagem', '-i')
    ap.add_argument('--engine', '-e', default='auto')
    ap.add_argument('--seed', type=int)
    ap.add_argument('--passos', type=int, default=64)
    ap.add_argument('--guia', type=float, default=15.0)
    ap.add_argument('--frame', type=int, default=256)
    ap.add_argument('--grade', type=int, default=96, help='resolucao da decodificacao (VRAM ~ grade^3)')
    ap.add_argument('--max-faces', type=int, default=150000)
    ap.add_argument('--saida', help='caminho do .glb (padrao: pasta work/3d)')
    ap.add_argument('--lista', action='store_true')
    ap.add_argument('--instalar', metavar='MOTOR')
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--meta-out', dest='meta_out',
                    help='grava o resultado (ou o erro) nesse arquivo — o agente le daqui')
    a = ap.parse_args()

    def _grava_meta(obj):
        if not a.meta_out:
            return
        try:
            os.makedirs(os.path.dirname(a.meta_out) or '.', exist_ok=True)
            with open(a.meta_out, 'w', encoding='utf-8') as f:
                json.dump(obj, f, ensure_ascii=False)
        except Exception as e:
            print('aviso: nao consegui gravar %s: %s' % (a.meta_out, e), flush=True)

    if a.lista:
        print(json.dumps(lista(), ensure_ascii=False, indent=1))
        return 0
    if a.instalar:
        return instalar(a.instalar)
    if a.selftest:
        return selftest()
    if not a.prompt and not a.imagem:
        ap.error('precisa de --prompt ou --imagem (ou --lista / --instalar / --selftest)')
    try:
        meta = gerar(prompt=a.prompt, imagem=a.imagem, engine=a.engine, seed=a.seed,
                     passos=a.passos, guia=a.guia, frame=a.frame, grade=a.grade,
                     max_faces=a.max_faces)
        _grava_meta(meta)
        return 0 if meta.get('ok') else 1
    except SystemExit as e:
        msg = str(e) or 'falhou'
        erro = {'ok': False, 'erro': msg}
        _grava_meta(erro)
        print('ARKHER3D_ERRO ' + json.dumps(erro, ensure_ascii=False), flush=True)
        return 2
    except Exception as e:
        import traceback
        traceback.print_exc()
        erro = {'ok': False, 'erro': '%s: %s' % (type(e).__name__, e)}
        _grava_meta(erro)
        print('ARKHER3D_ERRO ' + json.dumps(erro, ensure_ascii=False), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
