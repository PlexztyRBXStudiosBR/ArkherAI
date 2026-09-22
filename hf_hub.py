#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================
 ARKHER HF-HUB — roda os modelos DE PONTA do Hugging Face no no
 que tem GPU (Kaggle T4/P100, o PC do GitHub Actions ou a sua maquina).
================================================================

Por que este arquivo existe
---------------------------
O HF acabou com o serverless gratis (api-inference.huggingface.co nao
resolve mais; o que sobrou e o router router.huggingface.co/v1, que e
so texto e cobra por token). Ou seja: "pegar os 2,5 milhoes de modelos
do Hub" de graca NAO da pra fazer pela API deles.

O que da: baixar o modelo e rodar na GPU que a gente JA tem de graca.
E exatamente o que este modulo faz. Ele roda no no (Kaggle/PC), o
agent.py chama como JOB (assim o agente continua leve e sempre de pe)
e o site conversa com o agente normalmente.

Regra de ouro deste arquivo: NADA de import pesado no topo. Se a lib
nao estiver instalada, a tarefa devolve um erro CLARO dizendo o comando
pra instalar — nunca um stack trace nem um "ok" mentiroso.

Tarefas (e pra que servem no game dev)
--------------------------------------
  chat      texto/codigo com modelo grande (roteiro, GDD, Luau, C#, C++, GDScript)
  imagem    conceito, textura, sprite, ceu, tileset (SDXL-Turbo/SD-Turbo/FLUX)
  embed     vetores pro armazenamento neural (memoria do site)
  asr       audio -> texto (reuniao de design, narracao)
  depth     mapa de profundidade (displacement, parallax, refinamento de malha)
  fundo     remove fundo (sprite limpo a partir de concept)
  upscale   aumenta resolucao de textura/print
  treinar   LoRA no SEU dataset (o "treina a IA" de verdade, com pesos)
            tipo "dpo" = treino por PREFERENCIA: aproxima do que o enxame
            aprovou e afasta do que o critico reprovou (mais forte que SFT)
  lista     o que este no tem e o que pode rodar

Uso direto (o agent.py usa assim, com --meta-out):
  python3 hf_hub.py --lista
  python3 hf_hub.py --args /tmp/pedido.json --meta-out /tmp/resposta.json
  python3 hf_hub.py --selftest          # so stdlib, roda em qualquer lugar
"""
import argparse, base64, json, os, platform, shutil, sys, time, traceback

STATE = os.environ.get('ARKHER_STATE') or os.path.join(os.path.expanduser('~'), 'arkher_state')
SAIDA = os.path.join(STATE, 'hf')                      # arquivos gerados
TREINO = os.path.join(SAIDA, 'treino')                 # adapters LoRA salvos
INDICE = os.path.join(TREINO, 'index.json')
os.makedirs(SAIDA, exist_ok=True)
os.makedirs(TREINO, exist_ok=True)

TOKEN = (os.environ.get('HF_TOKEN') or os.environ.get('HUGGING_FACE_HUB_TOKEN') or '').strip()


# ------------------------------------------------------------------
# CATALOGO — so modelos de ponta, um por faixa de VRAM, com o aviso
# honesto do que precisa (gated = aceitar licenca no site do HF).
# ------------------------------------------------------------------
CATALOGO = [
    # ---- chat / codigo ----
    {'tarefa': 'chat', 'id': 'Qwen/Qwen2.5-Coder-7B-Instruct', 'nome': 'Qwen2.5 Coder 7B',
     'vram_gb': 6, 'papel': 'codigo + Luau/C#/GDScript', 'nota': 'melhor custo/beneficio pra script de jogo'},
    {'tarefa': 'chat', 'id': 'Qwen/Qwen2.5-7B-Instruct', 'nome': 'Qwen2.5 7B',
     'vram_gb': 6, 'papel': 'conversa geral + design', 'nota': 'bom em portugues'},
    {'tarefa': 'chat', 'id': 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', 'nome': 'DeepSeek R1 7B',
     'vram_gb': 6, 'papel': 'raciocinio passo a passo', 'nota': 'pensa antes de responder (mais lento)'},
    {'tarefa': 'chat', 'id': 'meta-llama/Llama-3.1-8B-Instruct', 'nome': 'Llama 3.1 8B',
     'vram_gb': 7, 'papel': 'geral', 'nota': 'GATED: aceite a licenca no HF antes'},
    {'tarefa': 'chat', 'id': 'openai/gpt-oss-20b', 'nome': 'gpt-oss 20B (MoE)',
     'vram_gb': 13, 'papel': 'geral forte', 'nota': 'MoE: ativa 3.6B, roda em 16GB quantizado'},
    {'tarefa': 'visao', 'id': 'Qwen/Qwen2.5-VL-7B-Instruct', 'nome': 'Qwen2.5-VL 7B',
     'vram_gb': 8, 'papel': 've imagem: UI, level design, bug de shader', 'nota': 'o "olho" do agente com GPU'},
    # ---- imagem (conceito/textura/sprite) ----
    {'tarefa': 'imagem', 'id': 'stabilityai/sd-turbo', 'nome': 'SD Turbo',
     'vram_gb': 4, 'papel': 'imagem rapida 512px', 'nota': '1 a 4 passos, o mais leve'},
    {'tarefa': 'imagem', 'id': 'stabilityai/sdxl-turbo', 'nome': 'SDXL Turbo',
     'vram_gb': 7, 'papel': 'conceito 1024px', 'nota': '1 a 4 passos: ideal pra iterar rapido'},
    {'tarefa': 'imagem', 'id': 'stabilityai/stable-diffusion-xl-base-1.0', 'nome': 'SDXL base',
     'vram_gb': 10, 'papel': 'conceito/textura com mais qualidade', 'nota': '20 a 30 passos'},
    {'tarefa': 'imagem', 'id': 'black-forest-labs/FLUX.1-schnell', 'nome': 'FLUX.1 schnell',
     'vram_gb': 16, 'papel': 'qualidade topo, 4 passos', 'nota': 'aperta em T4 16GB; use passos=4'},
    # ---- 3D: quem faz e o gerar3d.py (aqui vai so a imagem de entrada) ----
    {'tarefa': '3d', 'id': 'stabilityai/TripoSR', 'nome': 'TripoSR',
     'vram_gb': 6, 'papel': 'imagem -> malha .glb', 'nota': 'instale pelo /gerar3d/instalar (motor triposr)'},
    {'tarefa': '3d', 'id': 'openai/shap-e', 'nome': 'Shap-E',
     'vram_gb': 3, 'papel': 'texto -> malha .glb', 'nota': 'roda ate na CPU; instale pelo /gerar3d/instalar (motor shape)'},
    # ---- audio ----
    {'tarefa': 'asr', 'id': 'openai/whisper-large-v3-turbo', 'nome': 'Whisper large-v3 turbo',
     'vram_gb': 4, 'papel': 'audio -> texto', 'nota': 'legenda, ata de reuniao, comando por voz'},
    # ---- utilidades de producao ----
    {'tarefa': 'depth', 'id': 'depth-anything/Depth-Anything-V2-Small-hf', 'nome': 'Depth Anything V2',
     'vram_gb': 2, 'papel': 'profundidade a partir de 1 imagem', 'nota': 'displacement/parallax/pseudo-3D'},
    {'tarefa': 'fundo', 'id': 'briaai/RMBG-1.4', 'nome': 'RMBG 1.4',
     'vram_gb': 2, 'papel': 'tira o fundo', 'nota': 'sprite limpo a partir de concept'},
    {'tarefa': 'upscale', 'id': 'caidas/swin2SR-classical-sr-x4-64', 'nome': 'Swin2SR x4',
     'vram_gb': 3, 'papel': 'aumenta textura/print x4', 'nota': 'pra textura final, nao pra prototipo'},
    # ---- embeddings (memoria neural) ----
    {'tarefa': 'embed', 'id': 'sentence-transformers/all-MiniLM-L6-v2', 'nome': 'MiniLM L6',
     'vram_gb': 1, 'papel': 'vetor de texto 384d', 'nota': 'leve: da conta do armazenamento neural'},
    {'tarefa': 'embed', 'id': 'Qwen/Qwen3-Embedding-0.6B', 'nome': 'Qwen3 Embedding 0.6B',
     'vram_gb': 2, 'papel': 'vetor 1024d, melhor recall', 'nota': 'use se o MiniLM confundir assuntos parecidos'},
]
BASES_TREINO = [
    {'id': 'Qwen/Qwen2.5-Coder-7B-Instruct', 'nome': 'Qwen2.5 Coder 7B', 'vram_gb': 12,
     'nota': 'padrao pra game dev em 4-bit (T4 16GB aguenta)'},
    {'id': 'Qwen/Qwen2.5-3B-Instruct', 'nome': 'Qwen2.5 3B', 'vram_gb': 8,
     'nota': 'treina em 20 min, bom pra testar o pipeline'},
    {'id': 'meta-llama/Llama-3.2-1B-Instruct', 'nome': 'Llama 3.2 1B', 'vram_gb': 5,
     'nota': 'super rapido: ideal pra validar o dataset antes do modelo grande'},
]
LIB_PIP = {
    'torch': 'pip install torch --index-url https://download.pytorch.org/whl/cu121',
    'transformers': 'pip install transformers',
    'diffusers': 'pip install diffusers',
    'accelerate': 'pip install accelerate',
    'bitsandbytes': 'pip install bitsandbytes',
    'safetensors': 'pip install safetensors',
    'peft': 'pip install peft',
    'trl': 'pip install trl',
    'datasets': 'pip install datasets',
    'PIL': 'pip install pillow',
    'numpy': 'pip install numpy',
    'unsloth': 'pip install unsloth  # opcional: treina ~2x mais rapido em T4',
}


# ------------------------------------------------------------------
# ambiente: o que tem aqui de verdade
# ------------------------------------------------------------------
def _libs():
    import importlib
    out = {}
    for nome in LIB_PIP:
        try:
            m = importlib.import_module(nome)
            out[nome] = getattr(m, '__version__', 'ok')
        except Exception:
            out[nome] = None
    return out


def _gpu():
    """le a GPU sem importar torch: nvidia-smi e mais barato e sempre existe no Kaggle."""
    info = {'cuda': False, 'gpu': '', 'vram_gb': 0.0, 'quantos': 0}
    exe = shutil.which('nvidia-smi')
    if not exe:
        return info
    try:
        r = shutil.which('nvidia-smi')
        import subprocess
        p = subprocess.run([r, '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=20)
        nomes, vram = [], []
        for linha in (p.stdout or '').strip().splitlines():
            if ',' not in linha:
                continue
            n, mb = linha.rsplit(',', 1)
            nomes.append(n.strip())
            vram.append(int(float(mb)))
        if nomes:
            info.update(cuda=True, gpu=nomes[0], vram_gb=round(max(vram) / 1024.0, 1),
                        quantos=len(nomes), todas=nomes)
    except Exception as e:
        info['erro'] = '%s: %s' % (type(e).__name__, e)
    return info


def _ram_gb():
    try:
        import re
        with open('/proc/meminfo') as f:
            m = re.search(r'MemTotal:\s+(\d+) kB', f.read())
        return round(int(m.group(1)) / 1048576.0, 1) if m else 0
    except Exception:
        return 0


def _disco_gb(p=None):
    try:
        t, u, l = shutil.disk_usage(p or STATE)
        return {'livre_gb': round(l / 1e9, 1), 'total_gb': round(t / 1e9, 1)}
    except Exception:
        return {}


def ambiente():
    libs = _libs()
    g = _gpu()
    motores = {}
    for t in ('chat', 'imagem', 'asr', 'embed', 'depth', 'fundo', 'upscale', 'treinar'):
        motores[t] = _pode(t, libs)
    return {'ok': True, 'python': platform.python_version(), 'os': platform.system().lower(),
            'gpu': g, 'ram_gb': _ram_gb(), 'disco': _disco_gb(), 'libs': libs,
            'motores': motores, 'hf_token': bool(TOKEN),
            'treinados': _treinados(), 'estado': STATE}


def _pode(tarefa, libs=None):
    """o que esta tarefa precisa e o que falta. Nao chuta: le a lib de verdade."""
    libs = libs or _libs()
    falta = []
    precisa = {'chat': ['torch', 'transformers'], 'visao': ['torch', 'transformers'],
               'imagem': ['torch', 'diffusers', 'PIL'], 'asr': ['torch', 'transformers'],
               'embed': ['torch', 'transformers'], 'depth': ['torch', 'transformers'],
               '3d': ['torch'], 'fundo': ['torch', 'transformers'],
               'upscale': ['torch', 'transformers'], 'treinar': ['torch', 'transformers', 'peft']}[tarefa]
    for l in precisa:
        if not libs.get(l):
            falta.append(l)
    g = _gpu()
    dica = ''
    if falta:
        dica = ' ; '.join(LIB_PIP.get(l, 'pip install ' + l) for l in falta)
    elif not g['cuda'] and tarefa in ('chat', 'visao', 'imagem', 'treinar'):
        dica = 'sem CUDA: funciona, mas MUITO devagar (rode no Kaggle com Accelerator GPU)'
    return {'pronto': not falta, 'falta': falta, 'dica': dica}


def _treinados():
    try:
        with open(INDICE, encoding='utf-8') as f:
            return json.load(f).get('adapters', [])
    except Exception:
        return []


def _salvar_treinado(item):
    d = {'adapters': _treinados()}
    d['adapters'] = [a for a in d['adapters'] if a.get('nome') != item.get('nome')] + [item]
    with open(INDICE, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    return d['adapters']


def catalogo():
    a = ambiente()
    return {'ok': True, 'ambiente': {k: a[k] for k in ('python', 'os', 'gpu', 'ram_gb', 'disco',
                                                      'hf_token', 'treinados')},
            'tarefas': a['motores'], 'modelos': CATALOGO, 'bases_treino': BASES_TREINO,
            'rotas': {'chat': 'POST /infer {tarefa:"chat", modelo, messages}',
                      'imagem': 'POST /infer {tarefa:"imagem", prompt, w, h, passos}',
                      'embed': 'POST /infer {tarefa:"embed", textos:[...]}',
                      'asr': 'POST /infer {tarefa:"asr", audio:"/caminho.wav"}',
                      'treinar': 'POST /treinar {amostras:[...], base, nome, passos}' ,
                      'treinar_dpo': 'POST /treinar {tipo:"dpo", amostras:[{messages,chosen,rejected}], base, nome}'}}


# ------------------------------------------------------------------
# tarefa: CHAT (e o que faz o site usar a GPU como provedor)
# ------------------------------------------------------------------
def _msgs_para_texto(tok, messages, sistema=None):
    """usa o chat template do proprio modelo; se nao tiver, monta na mao."""
    ms = []
    if sistema:
        ms.append({'role': 'system', 'content': sistema})
    for m in messages:
        r = m.get('role') or 'user'
        c = m.get('content')
        if isinstance(c, list):   # formato multimodal: pega so o texto
            c = ' '.join(x.get('text', '') for x in c if isinstance(x, dict))
        ms.append({'role': 'user' if r == 'narrator' else r, 'content': c or ''})
    try:
        return tok.apply_chat_template(ms, tokenize=False, add_generation_prompt=True)
    except Exception:
        partes = []
        for m in ms:
            partes.append({'system': '### Instrucao:\n', 'user': '### Pedido:\n',
                           'assistant': '### Resposta:\n'}.get(m['role'], '') + m['content'])
        return '\n\n'.join(partes) + '\n\n### Resposta:\n'


def t_chat(a, dirsaida):
    from transformers import AutoTokenizer, AutoModelForCausalLM
    import torch
    base = a.get('base') or a.get('modelo') or 'Qwen/Qwen2.5-Coder-7B-Instruct'
    adapter = a.get('adapter')
    if isinstance(base, str) and base.startswith('local:'):
        nome = base.split(':', 1)[1]
        for it in _treinados():
            if it.get('nome') == nome:
                base, adapter = it['base'], it['caminho']
                break
        else:
            raise RuntimeError('nao existe LoRA treinado com o nome "%s"' % nome)
    tok = AutoTokenizer.from_pretrained(base, token=TOKEN or None)
    kw = {'device_map': 'auto'}
    if torch.cuda.is_available():
        kw['torch_dtype'] = torch.float16
        if a.get('quantizar', True) and _libs().get('bitsandbytes'):
            try:
                from transformers import BitsAndBytesConfig
                kw['quantization_config'] = BitsAndBytesConfig(
                    load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True)
            except Exception:
                pass
    else:
        kw['torch_dtype'] = torch.float32
    modelo = AutoModelForCausalLM.from_pretrained(base, token=TOKEN or None, **kw)
    if adapter:
        from peft import PeftModel
        modelo = PeftModel.from_pretrained(modelo, adapter)
    modelo.eval()
    texto = _msgs_para_texto(tok, a.get('messages') or [], a.get('sistema'))
    ids = tok(texto, return_tensors='pt').to(modelo.device)
    max_new = int(a.get('max_tokens') or 1024)
    temp = float(a.get('temperatura', 0.7))
    t0 = time.time()
    with torch.no_grad():
        saida = modelo.generate(**ids, max_new_tokens=max_new, do_sample=temp > 0.01,
                                temperature=max(temp, 0.01), top_p=float(a.get('top_p', 0.95)),
                                repetition_penalty=float(a.get('repeticao', 1.05)),
                                pad_token_id=tok.eos_token_id)
    novo = saida[0][ids['input_ids'].shape[1]:]
    txt = tok.decode(novo, skip_special_tokens=True).strip()
    return {'ok': True, 'tarefa': 'chat', 'modelo': base, 'adapter': adapter, 'texto': txt,
            'tokens': int(novo.shape[0]), 'sec': round(time.time() - t0, 1)}


# ------------------------------------------------------------------
# tarefa: IMAGEM (conceito, textura, sprite, ceu, tileset)
# ------------------------------------------------------------------
def t_imagem(a, dirsaida):
    import torch
    from diffusers import AutoPipelineForText2Image
    mid = a.get('modelo') or 'stabilityai/sd-turbo'
    turbo = 'turbo' in mid or 'schnell' in mid
    passos = int(a.get('passos') or (2 if turbo else 25))
    guia = float(a.get('guia') if a.get('guia') is not None else (0.0 if turbo else 7.0))
    w = int(a.get('w') or (1024 if 'xl' in mid or 'flux' in mid.lower() else 512))
    h = int(a.get('h') or w)
    w, h = (w // 8) * 8, (h // 8) * 8
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    pipe = AutoPipelineForText2Image.from_pretrained(mid, torch_dtype=dtype, token=TOKEN or None)
    pipe = pipe.to('cuda' if torch.cuda.is_available() else 'cpu')
    if not turbo:
        pipe.set_progress_bar_config(disable=True)
    gen = None
    if a.get('seed') not in (None, ''):
        gen = torch.Generator('cuda' if torch.cuda.is_available() else 'cpu').manual_seed(int(a['seed']))
    t0 = time.time()
    img = pipe(prompt=a.get('prompt') or 'concept art', num_inference_steps=passos,
               guidance_scale=guia, width=w, height=h, generator=gen).images[0]
    caminho = os.path.join(dirsaida, 'imagem_%d.png' % int(time.time()))
    img.save(caminho)
    return {'ok': True, 'tarefa': 'imagem', 'modelo': mid, 'arquivo': caminho,
            'w': w, 'h': h, 'passos': passos, 'sec': round(time.time() - t0, 1)}


# ------------------------------------------------------------------
# tarefa: EMBED (alimenta o armazenamento neural)
# ------------------------------------------------------------------
def t_embed(a, dirsaida):
    """vetores por mean-pooling. Sem sentence-transformers: menos dependencia."""
    import torch
    from transformers import AutoTokenizer, AutoModel
    mid = a.get('modelo') or 'sentence-transformers/all-MiniLM-L6-v2'
    textos = a.get('textos') or ([a['texto']] if a.get('texto') else [])
    if not textos:
        raise RuntimeError('manda "textos": ["...", "..."]')
    tok = AutoTokenizer.from_pretrained(mid, token=TOKEN or None)
    mod = AutoModel.from_pretrained(mid, token=TOKEN or None)
    mod.eval()
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    mod = mod.to(dev)
    vetores = []
    lote = int(a.get('lote') or 16)
    with torch.no_grad():
        for i in range(0, len(textos), lote):
            b = tok(textos[i:i + lote], padding=True, truncation=True, max_length=512,
                    return_tensors='pt').to(dev)
            r = mod(**b).last_hidden_state
            m = b['attention_mask'].unsqueeze(-1).float()
            v = (r * m).sum(1) / m.sum(1).clamp(min=1e-6)
            v = torch.nn.functional.normalize(v, p=2, dim=1)
            vetores += v.cpu().tolist()
    return {'ok': True, 'tarefa': 'embed', 'modelo': mid, 'dim': len(vetores[0]),
            'vetores': vetores, 'quantos': len(vetores)}


# ------------------------------------------------------------------
# tarefas: audio, profundidade, fundo, upscale
# ------------------------------------------------------------------
def _pipeline(tarefa, mid, **kw):
    from transformers import pipeline
    return pipeline(tarefa, model=mid, token=TOKEN or None, **kw)


def t_asr(a, dirsaida):
    mid = a.get('modelo') or 'openai/whisper-large-v3-turbo'
    audio = a.get('audio')
    if not audio:
        raise RuntimeError('manda "audio": "/caminho/arquivo.wav" (ou audio_b64)')
    if a.get('audio_b64'):
        audio = os.path.join(dirsaida, 'entrada.wav')
        with open(audio, 'wb') as f:
            f.write(base64.b64decode(a['audio_b64'].split(',')[-1]))
    p = _pipeline('automatic-speech-recognition', mid,
                  chunk_length_s=30, generate_kwargs={'language': a.get('idioma') or 'portuguese'})
    t0 = time.time()
    r = p(audio)
    return {'ok': True, 'tarefa': 'asr', 'modelo': mid, 'texto': (r or {}).get('text', ''),
            'sec': round(time.time() - t0, 1)}


def _imagem_entrada(a, dirsaida):
    p = a.get('imagem')
    if not p and a.get('imagem_b64'):
        p = os.path.join(dirsaida, 'entrada.png')
        with open(p, 'wb') as f:
            f.write(base64.b64decode(a['imagem_b64'].split(',')[-1]))
    if not p:
        raise RuntimeError('manda "imagem": "/caminho.png" (ou imagem_b64)')
    return p


def t_depth(a, dirsaida):
    from PIL import Image
    p = _imagem_entrada(a, dirsaida)
    mid = a.get('modelo') or 'depth-anything/Depth-Anything-V2-Small-hf'
    r = _pipeline('depth-estimation', mid)(Image.open(p).convert('RGB'))
    saida = os.path.join(dirsaida, 'profundidade.png')
    r['depth'].save(saida)
    return {'ok': True, 'tarefa': 'depth', 'modelo': mid, 'arquivo': saida}


def t_fundo(a, dirsaida):
    from PIL import Image
    p = _imagem_entrada(a, dirsaida)
    mid = a.get('modelo') or 'briaai/RMBG-1.4'
    r = _pipeline('image-segmentation', mid, trust_remote_code=True)(Image.open(p).convert('RGB'))
    saida = os.path.join(dirsaida, 'sem_fundo.png')
    if isinstance(r, list) and r and r[0].get('mask'):
        img = Image.open(p).convert('RGBA')
        img.putalpha(r[0]['mask'].convert('L').resize(img.size))
        img.save(saida)
    else:
        raise RuntimeError('o modelo nao devolveu mascara: %r' % (r,))
    return {'ok': True, 'tarefa': 'fundo', 'modelo': mid, 'arquivo': saida}


def t_upscale(a, dirsaida):
    from PIL import Image
    p = _imagem_entrada(a, dirsaida)
    mid = a.get('modelo') or 'caidas/swin2SR-classical-sr-x4-64'
    r = _pipeline('image-to-image', mid)(Image.open(p).convert('RGB'))
    saida = os.path.join(dirsaida, 'upscale.png')
    (r[0] if isinstance(r, list) else r).save(saida)
    return {'ok': True, 'tarefa': 'upscale', 'modelo': mid, 'arquivo': saida}


# ------------------------------------------------------------------
# TAREFA: TREINAR (LoRA) — o "treina a IA" de verdade, com pesos
# Tres caminhos, do melhor pro mais a prova de bala:
#   1) unsloth   (2x mais rapido em T4, ja cuida do chat template)
#   2) trl.SFTTrainer (padrao, quantiza 4-bit com bitsandbytes)
#   3) transformers.Trainer na mao (funciona em qualquer versao)
# ------------------------------------------------------------------
def _amostras_para_texto(amostras, tok=None):
    """aceita {"messages":[...]}, {"prompt","completion"} ou {"text"}."""
    textos = []
    for x in amostras:
        if isinstance(x, str):
            textos.append(x); continue
        if x.get('text'):
            textos.append(x['text']); continue
        if x.get('messages'):
            ms = x['messages']
            if tok is not None:
                try:
                    textos.append(tok.apply_chat_template(ms, tokenize=False))
                    continue
                except Exception:
                    pass
            t = ''
            for m in ms:
                c = m.get('content')
                if isinstance(c, list):
                    c = ' '.join(y.get('text', '') for y in c if isinstance(y, dict))
                t += {'system': '### Instrucao:\n', 'user': '### Pedido:\n',
                      'assistant': '### Resposta:\n'}.get(m.get('role'), '') + (c or '') + '\n'
            textos.append(t)
            continue
        if x.get('prompt'):
            textos.append('### Pedido:\n%s\n### Resposta:\n%s' % (x['prompt'], x.get('completion', '')))
            continue
        raise RuntimeError('amostra sem formato conhecido: %s' % json.dumps(x, ensure_ascii=False)[:200])
    return [t for t in textos if t.strip()]


def _conversa_para_texto(ms):
    """chosen/rejected vem como lista de mensagens (formato do site).
    Vira texto simples: e o formato que QUALQUER versao do trl aceita."""
    if isinstance(ms, str):
        return ms
    out = []
    for m in (ms or []):
        c = m.get('content')
        if isinstance(c, list):
            c = ' '.join(x.get('text', '') for x in c if isinstance(x, dict))
        out.append({'system': '### Instrucao:\n', 'user': '### Pedido:\n',
                    'assistant': '### Resposta:\n'}.get(m.get('role'), '') + (c or ''))
    return '\n'.join(out).strip()


def _treinar_dpo(amostras, base, destino, passos, r, lr, log):
    """Treino por PREFERENCIA: aproxima do que o conselho aprovou e afasta do
    que o critico reprovou. E mais forte que SFT porque ensina o que NAO fazer.
    `amostras` = [{messages|prompt, chosen, rejected}, ...] (o site exporta assim)."""
    import torch
    from datasets import Dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import LoraConfig, get_peft_model
    try:
        from trl import DPOTrainer, DPOConfig
    except Exception as e:
        raise RuntimeError('o treino DPO precisa do trl novo: pip install -U trl (erro: %s)' % e)

    pares = []
    for x in amostras:
        if not (x.get('chosen') and x.get('rejected')):
            continue
        p = x.get('prompt')
        if not p and x.get('messages'):
            p = next((m.get('content') for m in x['messages'] if m.get('role') == 'user'), '')
        pares.append({'prompt': str(p or ''),
                      'chosen': _conversa_para_texto(x['chosen']),
                      'rejected': _conversa_para_texto(x['rejected'])})
    if len(pares) < 2:
        raise RuntimeError('DPO precisa de pelo menos 2 pares valido (chosen/rejected); vieram %d' % len(pares))
    log('DPO: %d pares de preferencia' % len(pares))

    tok = AutoTokenizer.from_pretrained(base, token=TOKEN or None)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    kw = {'device_map': 'auto', 'torch_dtype': torch.float16 if torch.cuda.is_available() else torch.float32}
    if _libs().get('bitsandbytes') and torch.cuda.is_available():
        from transformers import BitsAndBytesConfig
        kw['quantization_config'] = BitsAndBytesConfig(load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type='nf4')
    modelo = AutoModelForCausalLM.from_pretrained(base, token=TOKEN or None, **kw)
    try:
        from peft import prepare_model_for_kbit_training
        modelo = prepare_model_for_kbit_training(modelo)
    except Exception:
        pass
    modelo = get_peft_model(modelo, LoraConfig(r=r, lora_alpha=r * 2, lora_dropout=0.05,
                                              bias='none', task_type='CAUSAL_LM',
                                              target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj']))
    ds = Dataset.from_list(pares)
    cfg = _kw_suportados(DPOConfig.__init__, {
        'output_dir': destino, 'per_device_train_batch_size': 1, 'gradient_accumulation_steps': 8,
        'max_steps': passos, 'learning_rate': lr if lr else 5e-5, 'warmup_steps': 5,
        'logging_steps': 5, 'save_steps': max(passos, 1), 'max_length': 1024, 'max_prompt_length': 512,
        'beta': 0.1, 'fp16': torch.cuda.is_available(), 'report_to': [],
    })
    treinador = DPOTrainer(model=modelo, args=DPOConfig(**cfg), train_dataset=ds, processing_class=tok)
    treinador.train()
    modelo.save_pretrained(destino); tok.save_pretrained(destino)
    log('DPO salvo em %s' % destino)


def _kw_suportados(fn, kw):
    """nem toda versao de trl/transformers aceita os mesmos nomes — so passa o que existe."""
    try:
        import inspect
        p = inspect.signature(fn).parameters
        aceita = set(p) | {k for k, v in p.items() if v.kind == v.VAR_KEYWORD}
        return {k: v for k, v in kw.items() if k in aceita}
    except Exception:
        return kw


def t_treinar(a, dirsaida):
    import torch
    base = a.get('base') or 'Qwen/Qwen2.5-Coder-7B-Instruct'
    nome = (a.get('nome') or ('lora-%d' % int(time.time()))).strip().replace(' ', '-')
    amostras = a.get('amostras') or []
    if not amostras:
        raise RuntimeError('manda "amostras": [...] (o site exporta isso no botao "Exportar dataset")')
    destino = os.path.join(TREINO, nome)
    os.makedirs(destino, exist_ok=True)
    passos = int(a.get('passos') or 60)
    r = 16 if a.get('r') is None else int(a['r'])
    lr = float(a.get('lr') or 2e-4)
    maxlen = int(a.get('maxlen') or 1024)
    log = []

    def diz(s):
        log.append(str(s))
        print(s, flush=True)

    tipo = (a.get('tipo') or '').lower()
    if not tipo:
        tipo = 'dpo' if (amostras and amostras[0].get('chosen') and amostras[0].get('rejected')) else 'sft'
    diz('treino %s | base=%s | amostras=%d | passos=%d | saida=%s'
        % (tipo.upper(), base, len(amostras), passos, destino))
    modo = ''

    # ---- 0) preferencia (DPO): o enxame gera esses pares sozinho ----
    if tipo == 'dpo':
        _treinar_dpo(amostras, base, destino, passos, r, lr, diz)
        item = {'nome': nome, 'base': base, 'caminho': destino, 'amostras': len(amostras),
                'passos': passos, 'modo': 'dpo', 'criado': time.time(),
                'usar': 'no site: escolha o modelo "local:%s"' % nome}
        _salvar_treinado(item)
        return {'ok': True, 'tarefa': 'treinar', **item, 'log': log[-40:]}

    # ---- 1) unsloth ----
    if a.get('usar_unsloth', True) and _libs().get('unsloth') and torch.cuda.is_available():
        try:
            from unsloth import FastLanguageModel
            modelo, tok = FastLanguageModel.from_pretrained(model_name=base, max_seq_length=maxlen,
                                                            dtype=None, load_in_4bit=True)
            modelo = FastLanguageModel.get_peft_model(modelo, r=r, lora_alpha=r * 2,
                target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
                lora_dropout=0.0, bias='none', use_gradient_checkpointing='unsloth')
            textos = _amostras_para_texto(amostras, tok)
            from datasets import Dataset
            ds = Dataset.from_dict({'text': textos})
            from trl import SFTTrainer
            cfg = _kw_suportados(__import__('trl').SFTConfig,
                                 {'output_dir': destino, 'per_device_train_batch_size': 2,
                                  'gradient_accumulation_steps': 4, 'max_steps': passos,
                                  'learning_rate': lr, 'warmup_steps': 5, 'logging_steps': 5,
                                  'save_steps': max(passos, 1), 'max_seq_length': maxlen,
                                  'max_length': maxlen, 'fp16': not torch.cuda.is_bf16_supported(),
                                  'bf16': torch.cuda.is_bf16_supported(), 'report_to': 'none',
                                  'dataset_text_field': 'text'})
            t = SFTTrainer(model=modelo, tokenizer=tok, train_dataset=ds,
                           args=__import__('trl').SFTConfig(**cfg))
            t.train()
            modelo.save_pretrained(destino); tok.save_pretrained(destino)
            modo = 'unsloth'
        except Exception as e:
            diz('unsloth falhou (%s: %s) — caindo pro trl padrao' % (type(e).__name__, e))

    # ---- 2) trl puro ----
    if not modo:
        try:
            from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
            from peft import LoraConfig, get_peft_model
            from datasets import Dataset
            tok = AutoTokenizer.from_pretrained(base, token=TOKEN or None)
            if tok.pad_token is None:
                tok.pad_token = tok.eos_token
            kw = {'device_map': 'auto', 'torch_dtype': torch.float16 if torch.cuda.is_available() else torch.float32}
            if _libs().get('bitsandbytes') and torch.cuda.is_available():
                from transformers import BitsAndBytesConfig
                kw['quantization_config'] = BitsAndBytesConfig(load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type='nf4')
            modelo = AutoModelForCausalLM.from_pretrained(base, token=TOKEN or None, **kw)
            try:
                from peft import prepare_model_for_kbit_training
                modelo = prepare_model_for_kbit_training(modelo)
            except Exception:
                pass
            cfg_peft = LoraConfig(r=r, lora_alpha=r * 2, lora_dropout=0.05, bias='none',
                                  task_type='CAUSAL_LM',
                                  target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj'])
            modelo = get_peft_model(modelo, cfg_peft)
            textos = _amostras_para_texto(amostras, tok)
            ds = Dataset.from_dict({'text': textos})

            def tokeniza(x):
                r_ = tok(x['text'], truncation=True, max_length=maxlen, padding='max_length')
                r_['labels'] = r_['input_ids'].copy()
                return r_

            ds = ds.map(tokeniza, batched=True, remove_columns=['text'])
            args = TrainingArguments(**_kw_suportados(TrainingArguments.__init__, {
                'output_dir': destino, 'per_device_train_batch_size': 1,
                'gradient_accumulation_steps': 8, 'max_steps': passos, 'learning_rate': lr,
                'warmup_steps': 5, 'logging_steps': 5, 'save_steps': max(passos, 1),
                'fp16': torch.cuda.is_available(), 'report_to': [], 'save_total_limit': 2}))
            from transformers import Trainer
            Trainer(model=modelo, args=args, train_dataset=ds).train()
            modelo.save_pretrained(destino); tok.save_pretrained(destino)
            modo = 'peft+trainer'
        except Exception as e:
            diz('caminho 2 falhou: %s: %s' % (type(e).__name__, e))
            diz(traceback.format_exc()[-1500:])
            raise RuntimeError('nao consegui treinar: %s. Veja o log acima; o caminho que mais '
                               'funciona no Kaggle e: pip install trl peft bitsandbytes datasets '
                               'accelerate' % e)

    item = {'nome': nome, 'base': base, 'caminho': destino, 'amostras': len(amostras),
            'passos': passos, 'modo': modo, 'criado': time.time(),
            'usar': 'no site: escolha o modelo "local:%s" (ou POST /infer com modelo=local:%s)' % (nome, nome)}
    _salvar_treinado(item)
    return {'ok': True, 'tarefa': 'treinar', **item, 'log': log[-40:]}


TAREFAS = {'chat': t_chat, 'imagem': t_imagem, 'embed': t_embed, 'asr': t_asr,
           'depth': t_depth, 'fundo': t_fundo, 'upscale': t_upscale, 'treinar': t_treinar}


# ------------------------------------------------------------------
def rodar(pedido, meta_out=None):
    tarefa = (pedido.get('tarefa') or '').strip().lower()
    t0 = time.time()
    dirsaida = os.path.join(SAIDA, tarefa or 'x', '%d_%s' % (int(t0), tarefa or 'x'))
    os.makedirs(dirsaida, exist_ok=True)
    try:
        if tarefa in ('lista', 'catalogo', ''):
            r = catalogo()
        elif tarefa not in TAREFAS:
            raise RuntimeError('tarefa desconhecida: %r (tenho: %s)' % (tarefa, ', '.join(sorted(TAREFAS))))
        else:
            preciso = _pode(tarefa)
            if not preciso['pronto']:
                raise RuntimeError('falta %s neste no. Rode: %s' % (', '.join(preciso['falta']), preciso['dica']))
            r = TAREFAS[tarefa](pedido, dirsaida)
        r.setdefault('sec', round(time.time() - t0, 1))
    except Exception as e:
        r = {'ok': False, 'tarefa': tarefa, 'erro': '%s: %s' % (type(e).__name__, e),
             'como_resolver': _pode(tarefa)['dica'] if tarefa in TAREFAS else
             'tarefas: ' + ', '.join(sorted(TAREFAS)),
             'trace': traceback.format_exc()[-1200:], 'sec': round(time.time() - t0, 1)}
    if meta_out:
        try:
            os.makedirs(os.path.dirname(meta_out) or '.', exist_ok=True)
            with open(meta_out, 'w', encoding='utf-8') as f:
                json.dump(r, f, ensure_ascii=False)
        except Exception as e:
            print('nao consegui escrever %s: %s' % (meta_out, e), file=sys.stderr)
    return r


def selftest():
    """sem torch, sem GPU: prova que o catalogo, os formatos e os erros estao certos."""
    falhas = []
    c = catalogo()
    if not c['ok']:
        falhas.append('catalogo nao abriu')
    for m in CATALOGO:
        for k in ('tarefa', 'id', 'nome', 'vram_gb', 'papel'):
            if k not in m:
                falhas.append('modelo %s sem %s' % (m.get('id'), k))
        if m['tarefa'] != '3d' and m['tarefa'] not in TAREFAS and m['tarefa'] not in ('visao',):
            falhas.append('tarefa estranha no catalogo: %s' % m['tarefa'])
    if not _amostras_para_texto([{'messages': [{'role': 'user', 'content': 'oi'},
                                               {'role': 'assistant', 'content': 'ola'}]}]):
        falhas.append('formato messages nao virou texto')
    if not _amostras_para_texto([{'prompt': 'p', 'completion': 'c'}]):
        falhas.append('formato prompt/completion nao virou texto')
    if len(_amostras_para_texto(['texto solto'])) != 1:
        falhas.append('texto solto nao passou')
    r = rodar({'tarefa': 'nao_existe'})
    if r.get('ok') or 'desconhecida' not in (r.get('erro') or ''):
        falhas.append('tarefa invalida nao deu erro claro')
    r2 = rodar({'tarefa': 'chat', 'messages': [{'role': 'user', 'content': 'oi'}]})
    if r2.get('ok') and not _libs().get('transformers'):
        falhas.append('disse ok sem transformers instalado (mentira)')
    if not r2.get('ok') and not r2.get('como_resolver'):
        falhas.append('erro sem "como_resolver"')
    print(json.dumps({'ok': not falhas, 'falhas': falhas, 'gpu': _gpu(),
                      'libs_ok': [k for k, v in _libs().items() if v]}, ensure_ascii=False, indent=1))
    return 0 if not falhas else 1


def main():
    ap = argparse.ArgumentParser(description='ARKHER HF-HUB — modelos de ponta no no com GPU')
    ap.add_argument('--lista', action='store_true', help='catalogo + o que este no tem')
    ap.add_argument('--args', help='arquivo JSON com o pedido')
    ap.add_argument('--meta-out', help='onde escrever a resposta em JSON')
    ap.add_argument('--selftest', action='store_true', help='checagens sem GPU/torch')
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if a.lista:
        print(json.dumps(catalogo(), ensure_ascii=False, indent=1)); return
    pedido = {}
    if a.args:
        with open(a.args, encoding='utf-8') as f:
            pedido = json.load(f)
    r = rodar(pedido, a.meta_out)
    if not a.meta_out:
        print(json.dumps(r, ensure_ascii=False))
    else:
        print(json.dumps({k: v for k, v in r.items() if k != 'vetores'}, ensure_ascii=False))
    sys.exit(0 if r.get('ok') else 1)


if __name__ == '__main__':
    main()
