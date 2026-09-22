#!/usr/bin/env python3
"""
ARKHER AGENT — o "Termux com visual".
Roda no Windows do runner (GitHub Actions), num PC seu, no Kaggle ou no Termux.
Expoe uma API HTTP que a web UI consome via Tailscale.

  python agent.py

Rotas:
  GET  /health            estado da maquina (cpu, ram, disco, uptime)
  POST /exec              executa e devolve tudo de uma vez
  POST /spawn             executa em BACKGROUND -> job_id
  GET  /job?id=&from=     saida incremental do job (streaming por polling)
  POST /kill              mata um job
  GET  /jobs              lista jobs
  GET  /ls?path=          lista arquivos
  GET  /cat?path=         le arquivo (texto)
  POST /write             escreve arquivo
  GET  /history           historico de comandos (persistido)
  POST /snapshot          salva o estado agora
  GET  /screen?scale=&q=  PRINT da tela (base64 jpeg)  <- os OLHOS
  POST /input             mouse/teclado na VM          <- as MAOS
  POST /app               abre programa (roblox/blender/...)
  GET  /guiready          existe sessao grafica ativa?
  GET  /gerar3d           motores 3D instalados neste no (--lista)
  POST /gerar3d           gera 3D a partir de texto/imagem -> job
  POST /gerar3d/instalar  instala um motor 3D (pip/git) -> job
  GET  /infer             modelos de ponta do HF que este no pode rodar
  POST /infer             roda chat/imagem/embed/asr/depth/fundo/upscale -> job
  POST /treinar           treina LoRA (ou DPO, por preferencia) no dataset do site -> job
  GET  /memoria           memoria compartilhada do no (o que IAs/chats/VMs descobriram)
  POST /memoria           recebe itens de memoria (site/IA/outro no) — sobrevive a sessao
  GET  /dataset           o que o no ja acumulou de aprendizado (licoes + preferencias)
  POST /dataset           recebe licoes/preferencias do site (o cerebro vira dataset)
  POST /dataset/auto      liga o treino automatico: quando junta N amostras novas, treina
  GET  /node              quem eu sou: IP do Tailscale, porta, RDP
  GET  /file?path=&dl=    entrega arquivo (glb/png) pra o navegador
  GET  /ws?canal=...      WebSocket: frames ao vivo, job ao vivo, cmd direto
So usa a stdlib. Nada de torch aqui: quem faz o trabalho pesado e o
gerar3d.py, chamado como job (assim o agente continua leve e sempre de pe).
"""
import base64, hashlib, json, os, platform, select, shutil, signal, socket, struct, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('ARKHER_PORT', '8765'))
STATE = os.environ.get('ARKHER_STATE') or os.path.join(os.path.expanduser('~'), 'arkher_state')
WORK = os.path.join(STATE, 'work')
os.makedirs(WORK, exist_ok=True)
HIST = os.path.join(STATE, 'history.jsonl')
IS_WIN = platform.system() == 'Windows'
IS_TERMUX = bool(os.environ.get('TERMUX_VERSION')) or os.path.isdir('/data/data/com.termux')
BOOT = time.time()
JOBS = {}
LOCK = threading.Lock()

# no Termux nao existe /bin/bash; no Linux comum existe. Descobre na hora.
BASH = shutil.which('bash') or shutil.which('sh') or '/bin/sh'
BASE = os.path.dirname(os.path.abspath(__file__))
GERAR3D = os.path.join(BASE, 'gerar3d.py')
# nao usa BASH pra chamar python: o caminho do interpretador certo e este
PY = sys.executable or shutil.which('python3') or shutil.which('python') or 'python'
OUT3D = os.path.join(WORK, '3d')
JOBS3D = os.path.join(OUT3D, '_jobs')
# modelos de ponta do HF (hf_hub.py) — mesma ideia do gerar3d: roda como job
HFHUB = os.path.join(BASE, 'hf_hub.py')
OUTHF = os.path.join(STATE, 'hf', '_jobs')
os.makedirs(OUTHF, exist_ok=True)
# o cerebro do no: tudo que o site aprendeu chega aqui e vira dataset de treino
MEMORIA = os.path.join(STATE, 'memoria.jsonl')
DATASET = os.path.join(STATE, 'hf', 'dataset.jsonl')
AUTOCFG = os.path.join(STATE, 'hf', 'auto.json')
os.makedirs(os.path.dirname(DATASET), exist_ok=True)
PWSH = shutil.which('powershell') or shutil.which('pwsh') or 'powershell'


def shell(cmd):
    if IS_WIN:
        return [PWSH, '-NoProfile', '-NonInteractive', '-Command', cmd]
    return [BASH, '-lc', cmd]


def log_hist(entry):
    try:
        with open(HIST, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception:
        pass


def run_sync(cmd, timeout=600, cwd=None):
    t0 = time.time()
    try:
        p = subprocess.run(shell(cmd), capture_output=True, text=True, errors='replace',
                           timeout=timeout, cwd=cwd or WORK)
        out, err, code = p.stdout, p.stderr, p.returncode
    except subprocess.TimeoutExpired:
        out, err, code = '', f'tempo esgotado ({timeout}s) — use /spawn pra tarefas longas', 124
    except Exception as e:
        out, err, code = '', f'{type(e).__name__}: {e}', 1
    ms = int((time.time() - t0) * 1000)
    log_hist({'t': time.time(), 'cmd': cmd, 'code': code, 'ms': ms})
    return {'out': out[-60000:], 'err': err[-20000:], 'code': code, 'ms': ms}


def spawn_list(argv, cwd=None, env=None, jid=None):
    """igual ao spawn, mas com lista de argumentos: sem shell, sem escaping.
    E o jeito certo de chamar o gerar3d.py (o prompt do usuario entra como
    argumento literal, nao como texto de shell)."""
    jid = jid or uuid.uuid4().hex[:8]
    cmd = ' '.join(argv)
    job = {'id': jid, 'cmd': cmd, 'buf': [], 'done': False, 'code': None,
           'start': time.time(), 'proc': None}
    with LOCK:
        JOBS[jid] = job

    def worker():
        e = dict(os.environ)
        if env:
            e.update({k: str(v) for k, v in env.items()})
        try:
            p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, errors='replace', bufsize=1,
                                 cwd=cwd or WORK, env=e)
            job['proc'] = p
            for line in p.stdout:
                with LOCK:
                    job['buf'].append(line.rstrip('\n'))
                    if len(job['buf']) > 5000:
                        del job['buf'][:2000]
            p.wait()
            job['code'] = p.returncode
        except Exception as ex:
            with LOCK:
                job['buf'].append(f'{type(ex).__name__}: {ex}')
            job['code'] = 1
        job['done'] = True
        log_hist({'t': time.time(), 'cmd': cmd, 'code': job['code'],
                  'ms': int((time.time() - job['start']) * 1000), 'bg': True})

    threading.Thread(target=worker, daemon=True).start()
    return jid


def spawn(cmd, cwd=None):
    """roda em background e vai acumulando a saida — pra Blender, build, etc."""
    jid = uuid.uuid4().hex[:8]
    job = {'id': jid, 'cmd': cmd, 'buf': [], 'done': False, 'code': None,
           'start': time.time(), 'proc': None}
    with LOCK:
        JOBS[jid] = job

    def worker():
        try:
            p = subprocess.Popen(shell(cmd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, errors='replace', bufsize=1,
                                 cwd=cwd or WORK)
            job['proc'] = p
            for line in p.stdout:
                with LOCK:
                    job['buf'].append(line.rstrip('\n'))
                    if len(job['buf']) > 5000:
                        del job['buf'][:2000]
            p.wait()
            job['code'] = p.returncode
        except Exception as e:
            with LOCK:
                job['buf'].append(f'{type(e).__name__}: {e}')
            job['code'] = 1
        job['done'] = True
        log_hist({'t': time.time(), 'cmd': cmd, 'code': job['code'],
                  'ms': int((time.time() - job['start']) * 1000), 'bg': True})

    threading.Thread(target=worker, daemon=True).start()
    return jid


_MACHINE_CACHE = {'t': 0, 'v': None}


def machine():
    # cacheia 20s: o /health e chamado a cada poucos segundos e o CIM do Windows e lento
    if _MACHINE_CACHE['v'] and time.time() - _MACHINE_CACHE['t'] < 20:
        info = dict(_MACHINE_CACHE['v'])
        info['up'] = int(time.time() - BOOT)
        with LOCK:
            info['jobs'] = len([j for j in JOBS.values() if not j['done']])
        return info
    so = 'windows' if IS_WIN else ('android' if IS_TERMUX else platform.system().lower())
    info = {'host': socket.gethostname(), 'os': so, 'os_detalhe': platform.platform()[:70],
            'termux': IS_TERMUX, 'up': int(time.time() - BOOT), 'state': STATE, 'work': WORK,
            'port': PORT}
    try:
        info['cpu_count'] = os.cpu_count()
    except Exception:
        pass
    try:
        if IS_WIN:
            r = subprocess.run(shell(
                "(Get-CimInstance Win32_Processor).Name; "
                "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1); "
                "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"),
                capture_output=True, text=True, timeout=25)
            ls = [x.strip() for x in r.stdout.strip().split('\n') if x.strip()]
            if len(ls) >= 1: info['cpu'] = ls[0]
            if len(ls) >= 2: info['ram_gb'] = float(ls[1])
            if len(ls) >= 3: info['ram_free_gb'] = float(ls[2])
        else:
            cpu = ''
            try:
                for ln in open('/proc/cpuinfo', encoding='utf-8', errors='replace'):
                    if ln.lower().startswith(('model name', 'hardware', 'processor')) and ':' in ln:
                        v = ln.split(':', 1)[1].strip()
                        if v and not v.isdigit(): cpu = v; break
            except Exception:
                pass
            info['cpu'] = cpu or platform.processor() or platform.machine() or 'cpu'
            try:
                mt = ma = 0
                for ln in open('/proc/meminfo'):
                    if ln.startswith('MemTotal'): mt = int(ln.split()[1])
                    if ln.startswith('MemAvailable'): ma = int(ln.split()[1])
                if mt: info['ram_gb'] = round(mt / 1048576, 1)
                if ma: info['ram_free_gb'] = round(ma / 1048576, 1)
            except Exception:
                pass
            if shutil.which('nvidia-smi'):
                try:
                    g = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
                                       capture_output=True, text=True, timeout=10).stdout.strip()
                    if g: info['gpu'] = g.split('\n')[0]
                except Exception:
                    pass
        du = shutil.disk_usage(STATE)
        info['disk_free_gb'] = round(du.free / 1e9, 1)
        info['disk_total_gb'] = round(du.total / 1e9, 1)
    except Exception:
        pass
    _MACHINE_CACHE['v'] = dict(info); _MACHINE_CACHE['t'] = time.time()
    with LOCK:
        info['jobs'] = len([j for j in JOBS.values() if not j['done']])
    return info


def snapshot():
    """salva tudo que importa antes do runner morrer"""
    try:
        meta = {'saved': time.time(), 'when': time.ctime(), 'machine': machine()}
        with open(os.path.join(STATE, 'SNAPSHOT.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        return meta
    except Exception as e:
        return {'err': str(e)}


# ================= OLHOS E MAOS (controle da tela) =================
# Windows: usa .NET via PowerShell. Sem pip, so stdlib.
PS_GUI = r"""
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);
  public static string Title(){ IntPtr h=GetForegroundWindow(); int n=GetWindowTextLength(h);
    var sb=new System.Text.StringBuilder(n+1); GetWindowText(h,sb,sb.Capacity); return sb.ToString(); }
}
'@
"""


def ps(script, timeout=60):
    """roda powershell e devolve stdout cru"""
    p = subprocess.run([PWSH, '-NoProfile', '-NonInteractive', '-STA', '-Command', script],
                       capture_output=True, timeout=timeout)
    return p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')


def grab_screen(scale=1.0, quality=55):
    """JPEG da tela inteira -> base64. Devolve dict {b64, w, h, real_w, real_h, titulo} ou {err}"""
    scale = max(0.1, min(1.0, float(scale)))
    quality = max(10, min(95, int(quality)))
    if not IS_WIN:
        # Linux com X (Xvfb do DsOS, por exemplo)
        disp = os.environ.get('DISPLAY') or os.environ.get('DSOS_DISPLAY') or ':77'
        out = os.path.join(STATE, 'shot.jpg')
        try:
            if shutil.which('import'):
                subprocess.run(['import', '-display', disp, '-window', 'root', '-quality', str(quality), out], timeout=30)
            elif shutil.which('ffmpeg'):
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'quiet', '-f', 'x11grab', '-i', disp,
                                '-frames:v', '1', '-q:v', '6', out], timeout=30)
            else:
                return {'err': 'sem ferramenta de captura (imagemagick/ffmpeg) neste sistema'}
            if not os.path.exists(out):
                return {'err': 'captura falhou (sem sessao grafica em ' + disp + '?)'}
            raw = open(out, 'rb').read()
            return {'b64': base64.b64encode(raw).decode(), 'w': 0, 'h': 0, 'real_w': 0, 'real_h': 0, 'titulo': ''}
        except Exception as e:
            return {'err': str(e)}
    f = os.path.join(STATE, 'shot.jpg').replace("'", "''")
    sc = PS_GUI + f"""
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)
$w=[int]($b.Width*{scale}); $h=[int]($b.Height*{scale})
if({scale} -ne 1.0){{ $r=New-Object System.Drawing.Bitmap $bmp,$w,$h; $bmp.Dispose(); $bmp=$r }}
$cod=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{{$_.MimeType -eq 'image/jpeg'}}
$pr=New-Object System.Drawing.Imaging.EncoderParameters 1
$pr.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),{quality}
$bmp.Save('{f}',$cod,$pr); $bmp.Dispose()
Write-Output "$w|$h|$($b.Width)|$($b.Height)|$([M]::Title())"
"""
    err = ''
    try:
        out, err = ps(sc, 90)
        parts = (out.strip().splitlines() or [''])[-1].split('|')
        raw = open(os.path.join(STATE, 'shot.jpg'), 'rb').read()
        return {'b64': base64.b64encode(raw).decode(),
                'w': int(parts[0]) if len(parts) > 1 else 0,
                'h': int(parts[1]) if len(parts) > 1 else 0,
                'real_w': int(parts[2]) if len(parts) > 3 else 0,
                'real_h': int(parts[3]) if len(parts) > 3 else 0,
                'titulo': parts[4] if len(parts) > 4 else ''}
    except Exception as e:
        return {'err': f'{e} :: {err[:300]}'}


def sendkeys_escape(txt):
    """texto literal -> sintaxe do SendKeys. Os especiais + ^ % ~ ( ) { } [ ] viram {x}."""
    out = []
    for ch in str(txt):
        if ch in '+^%~(){}[]':
            out.append('{' + ch + '}')
        elif ch == '\n':
            out.append('{ENTER}')
        elif ch == '\t':
            out.append('{TAB}')
        else:
            out.append(ch)
    return ''.join(out)


def ps_str(s):
    """string literal do PowerShell entre aspas simples (unico escape: ' -> '')"""
    return "'" + str(s).replace("'", "''") + "'"


# apps conhecidos: lista de candidatos; o primeiro que existir e usado
APPS_WIN = {
    'roblox':   [r'$env:LOCALAPPDATA\Roblox\Versions\*\RobloxStudioBeta.exe',
                 r'$env:LOCALAPPDATA\Roblox\Versions\*\RobloxStudioLauncherBeta.exe',
                 r'C:\Program Files (x86)\Roblox\Versions\*\RobloxStudioBeta.exe',
                 r'C:\Program Files (x86)\Roblox\Versions\*\RobloxStudioLauncherBeta.exe'],
    'blender':  [r'C:\Program Files\Blender Foundation\*\blender.exe', 'blender'],
    'explorer': ['explorer.exe'],
    'notepad':  ['notepad.exe'],
    'cmd':      ['cmd.exe'],
    'powershell': ['powershell.exe'],
    'edge':     [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'msedge.exe'],
    'chrome':   [r'C:\Program Files\Google\Chrome\Application\chrome.exe', 'chrome.exe'],
    'calc':     ['calc.exe'],
}
APPS_LINUX = {'blender': ['blender'], 'terminal': ['xterm', 'xfce4-terminal'], 'files': ['pcmanfm', 'thunar'],
              'editor': ['mousepad', 'gedit']}


def abrir_app(nome, caminho=None):
    nome = (nome or '').lower().strip()
    if IS_WIN:
        cands = [caminho] if caminho else APPS_WIN.get(nome)
        if not cands:
            return {'ok': False, 'err': f'nao sei abrir "{nome}". Conhecidos: ' + ', '.join(APPS_WIN)}
        # resolve curingas/variaveis no PowerShell e abre o primeiro que existir
        lista = ','.join(ps_str(c) for c in cands)
        script = f"""
$ok=$false
foreach($c in @({lista})){{
  $c2=$ExecutionContext.InvokeCommand.ExpandString($c)
  $p=$null
  if($c2 -match '[\\\\/]'){{ $p=Get-Item -Path $c2 -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }}
  else {{ $p=(Get-Command $c2 -ErrorAction SilentlyContinue | Select-Object -First 1).Source; if(-not $p){{ $p=$c2 }} }}
  if($p){{ try {{ Start-Process $p; Write-Output "OK|$p"; $ok=$true; break }} catch {{ }} }}
}}
if(-not $ok){{ Write-Output "NAO|nenhum candidato existe" }}
"""
        try:
            out, err = ps(script, 40)
            ln = (out.strip().splitlines() or ['NAO|sem saida'])[-1]
            if ln.startswith('OK|'):
                return {'ok': True, 'exe': ln[3:]}
            return {'ok': False, 'err': f'{nome}: {ln[4:] if "|" in ln else ln} {err[:200]}'.strip()}
        except Exception as e:
            return {'ok': False, 'err': str(e)}
    cands = [caminho] if caminho else APPS_LINUX.get(nome, [nome])
    for c in cands:
        if shutil.which(c):
            env = dict(os.environ)
            env.setdefault('DISPLAY', os.environ.get('DSOS_DISPLAY', ':77'))
            subprocess.Popen([c], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=WORK)
            return {'ok': True, 'exe': c}
    return {'ok': False, 'err': f'{nome}: nao instalado'}


def do_input(act):
    """act = {do:'move|click|dblclick|right|drag|scroll|type|key|hotkey|wait|app', ...}"""
    d = act.get('do')
    try:
        x, y = int(float(act.get('x', 0) or 0)), int(float(act.get('y', 0) or 0))
    except Exception:
        x, y = 0, 0
    if d == 'wait':
        time.sleep(max(0.0, min(float(act.get('sec', 1) or 1), 30))); return {'ok': True}
    if d == 'app':
        r = abrir_app(act.get('nome') or act.get('app') or '', act.get('caminho'))
        if r.get('ok'): time.sleep(min(float(act.get('esperar', 5) or 5), 30))
        return r
    if not IS_WIN:
        # Linux: xdotool se existir (DsOS/Xvfb)
        if not shutil.which('xdotool'):
            return {'ok': False, 'err': 'controle de tela: sem xdotool neste sistema'}
        env = dict(os.environ); env.setdefault('DISPLAY', os.environ.get('DSOS_DISPLAY', ':77'))
        def xd(*a):
            p = subprocess.run(['xdotool', *a], env=env, capture_output=True, text=True, timeout=20)
            return {'ok': p.returncode == 0, 'err': p.stderr.strip()[:200] or None}
        if d == 'move': return xd('mousemove', str(x), str(y))
        if d == 'click': return xd('mousemove', str(x), str(y), 'click', '1')
        if d == 'dblclick': return xd('mousemove', str(x), str(y), 'click', '--repeat', '2', '1')
        if d == 'right': return xd('mousemove', str(x), str(y), 'click', '3')
        if d == 'drag': return xd('mousemove', str(x), str(y), 'mousedown', '1', 'mousemove', str(int(act.get('x2', x))), str(int(act.get('y2', y))), 'mouseup', '1')
        if d == 'scroll': return xd('mousemove', str(x), str(y), 'click', '--repeat', '3', '5' if int(act.get('amount', -400)) < 0 else '4')
        if d == 'type': return xd('type', '--delay', '12', '--', str(act.get('text') or ''))
        if d in ('key', 'hotkey'):
            k = str(act.get('key') or act.get('combo') or '').strip('{}').lower()
            mapa = {'enter': 'Return', 'esc': 'Escape', 'tab': 'Tab', 'del': 'Delete', 'backspace': 'BackSpace'}
            k = mapa.get(k, k).replace('^', 'ctrl+').replace('%', 'alt+').replace('+', 'shift+') if d == 'hotkey' else mapa.get(k, k)
            return xd('key', k)
        return {'ok': False, 'err': f'acao desconhecida: {d}'}
    S = PS_GUI
    if d == 'move':
        S += f"[M]::SetCursorPos({x},{y})"
    elif d in ('click', 'dblclick', 'right', 'middle'):
        down, up = (2, 4) if d in ('click', 'dblclick') else ((8, 16) if d == 'right' else (32, 64))
        S += f"[M]::SetCursorPos({x},{y});Start-Sleep -m 60;"
        S += f"[M]::mouse_event({down},0,0,0,0);[M]::mouse_event({up},0,0,0,0);"
        if d == 'dblclick':
            S += f"Start-Sleep -m 90;[M]::mouse_event({down},0,0,0,0);[M]::mouse_event({up},0,0,0,0);"
    elif d == 'drag':
        x2, y2 = int(float(act.get('x2', 0) or 0)), int(float(act.get('y2', 0) or 0))
        S += (f"[M]::SetCursorPos({x},{y});Start-Sleep -m 80;[M]::mouse_event(2,0,0,0,0);"
              f"Start-Sleep -m 120;")
        for i in range(1, 11):
            S += f"[M]::SetCursorPos({x + (x2 - x) * i // 10},{y + (y2 - y) * i // 10});Start-Sleep -m 25;"
        S += "[M]::mouse_event(4,0,0,0,0);"
    elif d == 'scroll':
        amt = int(float(act.get('amount', -400) or -400))
        S += f"[M]::SetCursorPos({x},{y});[M]::mouse_event(2048,0,0,{amt & 0xFFFFFFFF},0);"
    elif d == 'type':
        S += f'[System.Windows.Forms.SendKeys]::SendWait({ps_str(sendkeys_escape(act.get("text") or ""))})'
    elif d == 'key':
        S += f'[System.Windows.Forms.SendKeys]::SendWait({ps_str(act.get("key", ""))})'
    elif d == 'hotkey':
        S += f'[System.Windows.Forms.SendKeys]::SendWait({ps_str(act.get("combo", ""))})'
    else:
        return {'ok': False, 'err': f'acao desconhecida: {d}'}
    try:
        out, err = ps(S, 60)
        return {'ok': not err.strip(), 'out': out.strip()[:400], 'err': err.strip()[:400] or None}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def gui_ready():
    """checa se existe sessao grafica de verdade (senao a tela sai preta)"""
    if not IS_WIN:
        disp = os.environ.get('DISPLAY') or os.environ.get('DSOS_DISPLAY') or ':77'
        tem_x = os.path.exists('/tmp/.X11-unix/X' + disp.lstrip(':'))
        return {'ok': tem_x, 'display': disp,
                'nota': None if tem_x else 'sem servidor X em ' + disp + ' (suba o DsOS/Xvfb)'}
    try:
        out, _ = ps("(quser) 2>&1 | Out-String", 30)
        ativo = 'Active' in out or 'Ativo' in out
        if not ativo:
            # o runner do Actions roda dentro de uma sessao interativa (o proprio runner). Testa
            # o que importa: dar pra capturar a tela com tamanho > 0.
            g = grab_screen(0.1, 30)
            ativo = bool(g.get('b64')) and (g.get('real_w') or 0) > 0
        return {'ok': ativo, 'sessoes': out.strip()[:500],
                'nota': None if ativo else
                'SEM SESSAO GRAFICA ATIVA — conecte por RDP uma vez (usuario nexus) e rode: tscon 1 /dest:console'}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def _py3d_disponivel():
    return os.path.isfile(GERAR3D)


def motores3d(ttl=60):
    """--lista do gerar3d.py, com cache curta (abre imports, nao e instantaneo)."""
    global _M3D
    agora = time.time()
    if _M3D['v'] and agora - _M3D['t'] < ttl:
        return _M3D['v']
    if not _py3d_disponivel():
        v = {'ok': False, 'err': 'gerar3d.py nao esta na pasta do agente (%s)' % BASE,
             'motores': {}}
    else:
        try:
            r = subprocess.run([PY, GERAR3D, '--lista'], capture_output=True, text=True,
                               errors='replace', timeout=60, cwd=BASE)
            v = json.loads(r.stdout or '{}')
            if not v.get('ok'):
                v = {'ok': False, 'err': (r.stderr or 'falhou')[-500:], 'motores': {}}
        except Exception as e:
            v = {'ok': False, 'err': '%s: %s' % (type(e).__name__, e), 'motores': {}}
    _M3D = {'t': agora, 'v': v}
    return v


def meta3d(jid):
    """le o JSON que o gerar3d.py escreveu (sucesso ou erro)."""
    caminho = os.path.join(JOBS3D, '%s.json' % jid)
    try:
        with open(caminho, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


# ---------------- modelos de ponta do HF (hf_hub.py) ----------------
def _py_hf_disponivel():
    return os.path.isfile(HFHUB)


def meta_hf(jid):
    try:
        with open(os.path.join(OUTHF, '%s.json' % jid), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def adapters_hf():
    """LoRAs ja treinados neste no (o site usa pra escolher 'local:<nome>')."""
    try:
        with open(os.path.join(SAIDA, 'treino', 'index.json'), encoding='utf-8') as f:
            return json.load(f).get('adapters', [])
    except Exception:
        return []


def memoria_add(itens, fonte=''):
    """memoria compartilhada do no: append com dedupe por hash, teto de 8000 linhas."""
    os.makedirs(os.path.dirname(MEMORIA), exist_ok=True)
    vistos = set()
    total = 0
    try:
        with open(MEMORIA, encoding='utf-8') as f:
            for linha in f:
                linha = linha.strip()
                if linha:
                    total += 1
                    try:
                        it0 = json.loads(linha)
                        # a identidade do item e (tipo, texto, escopo): a mesma
                        # descoberta nao entra duas vezes nem com metadados diferentes
                        vistos.add(hashlib.sha1(('%s|%s|%s' % (it0.get('tipo'), it0.get('texto'), it0.get('escopo'))).encode('utf-8')).hexdigest())
                    except Exception:
                        vistos.add(hashlib.sha1(linha.encode('utf-8')).hexdigest())
    except Exception:
        pass
    novos = 0
    with open(MEMORIA, 'a', encoding='utf-8') as f:
        for it in (itens or []):
            if not isinstance(it, dict):
                continue
            if it.get('sigilo'):
                continue                      # sigilo nunca entra no no
            it = dict(it)
            it.setdefault('t', int(time.time() * 1000))
            if fonte and not it.get('de'):
                it['de'] = fonte
            linha = json.dumps(it, ensure_ascii=False)
            h = hashlib.sha1(('%s|%s|%s' % (it.get('tipo'), it.get('texto'), it.get('escopo'))).encode('utf-8')).hexdigest()
            if h in vistos:
                continue
            vistos.add(h)
            f.write(linha + '\n')
            novos += 1
    if novos:
        total += novos
        _memoria_podar()
    return {'novos': novos, 'total': total, 'arquivo': MEMORIA}


def _memoria_podar(maximo=8000):
    """corta o arquivo pela metade quando passa do teto (mantem o mais novo)."""
    try:
        with open(MEMORIA, encoding='utf-8') as f:
            linhas = [l for l in f if l.strip()]
        if len(linhas) <= maximo:
            return 0
        with open(MEMORIA, 'w', encoding='utf-8') as f:
            f.writelines(linhas[-maximo // 2:])
        return len(linhas) - maximo // 2
    except Exception:
        return 0


def memoria_ler(k=400, desde=0, q='', escopo=''):
    itens = []
    try:
        with open(MEMORIA, encoding='utf-8') as f:
            for linha in f:
                linha = linha.strip()
                if not linha:
                    continue
                try:
                    it = json.loads(linha)
                except Exception:
                    continue
                if desde and int(it.get('t') or 0) < int(desde):
                    continue
                if escopo and not str(it.get('escopo') or '').startswith(escopo):
                    continue
                if q and q.lower() not in json.dumps(it, ensure_ascii=False).lower():
                    continue
                itens.append(it)
    except Exception:
        pass
    itens.sort(key=lambda x: int(x.get('t') or 0))
    return itens[-int(k):]


def dataset_add(itens):
    """guarda amostras no dataset do no, sem repetir (hash do conteudo)."""
    os.makedirs(os.path.dirname(DATASET), exist_ok=True)
    vistos = set()
    total = 0
    try:
        with open(DATASET, encoding='utf-8') as f:
            for linha in f:
                linha = linha.strip()
                if linha:
                    total += 1
                    vistos.add(hashlib.sha1(linha.encode('utf-8')).hexdigest())
    except Exception:
        pass
    novos = 0
    with open(DATASET, 'a', encoding='utf-8') as f:
        for it in itens:
            if not isinstance(it, dict):
                continue
            linha = json.dumps(it, ensure_ascii=False)
            h = hashlib.sha1(linha.encode('utf-8')).hexdigest()
            if h in vistos:
                continue
            vistos.add(h)
            f.write(linha + '\n')
            novos += 1
    if novos:
        total += novos
    return {'novos': novos, 'total': total, 'arquivo': DATASET}


def dataset_ler(maximo=20000):
    itens = []
    try:
        with open(DATASET, encoding='utf-8') as f:
            for linha in f:
                linha = linha.strip()
                if not linha:
                    continue
                try:
                    itens.append(json.loads(linha))
                except Exception:
                    pass
    except Exception:
        return []
    return itens[-maximo:]


def dataset_info():
    itens = dataset_ler()
    dpo = sum(1 for x in itens if x.get('chosen') and x.get('rejected'))
    try:
        tam = os.path.getsize(DATASET)
        quando = os.path.getmtime(DATASET)
    except Exception:
        tam, quando = 0, 0
    return {'total': len(itens), 'sft': len(itens) - dpo, 'dpo': dpo, 'bytes': tam,
            'atualizado': int(quando), 'adapters': [a.get('nome') for a in adapters_hf()]}


def auto_cfg(**novo):
    c = {'ligado': False, 'min_novos': 40, 'min_total': 40, 'base': '', 'passos': 60,
         'ultimo': 0, 'jobs': 0, 'quando': 0, 'erro': ''}
    try:
        with open(AUTOCFG, encoding='utf-8') as f:
            c.update(json.load(f) or {})
    except Exception:
        pass
    if novo:
        c.update({k: v for k, v in novo.items() if v is not None})
        try:
            with open(AUTOCFG, 'w', encoding='utf-8') as f:
                json.dump(c, f, ensure_ascii=False)
        except Exception:
            pass
    return c


def auto_decisao(c=None):
    """decide se ja da pra treinar sozinho. Separado do loop pra ser testavel."""
    c = c or auto_cfg()
    if not c.get('ligado'):
        return {'treinar': False, 'motivo': 'treino automatico desligado'}
    with LOCK:
        ocupado = any(j.get('tarefa') == 'treinar' and not j.get('done') for j in JOBS.values())
    if ocupado:
        return {'treinar': False, 'motivo': 'ja tem treino rodando'}
    d = dataset_info()
    if d['total'] < int(c.get('min_total') or 40):
        return {'treinar': False, 'motivo': 'poucas amostras (%d de %s)' % (d['total'], c.get('min_total')),
                'total': d['total']}
    novos = d['total'] - int(c.get('ultimo') or 0)
    if novos < int(c.get('min_novos') or 40):
        return {'treinar': False, 'motivo': 'so %d amostras novas (min %s)' % (novos, c.get('min_novos')),
                'total': d['total'], 'novos': novos}
    tipo = 'dpo' if d['dpo'] * 3 >= d['total'] else 'lora'
    pedido = {'tarefa': 'treinar', 'amostras': dataset_ler(), 'tipo': tipo,
              'nome': 'auto-%s' % time.strftime('%m%d-%H%M'), 'passos': int(c.get('passos') or 60)}
    if c.get('base'):
        pedido['base'] = c['base']
    return {'treinar': True, 'motivo': '%d amostras novas, tipo %s' % (novos, tipo), 'pedido': pedido,
            'total': d['total'], 'novos': novos, 'tipo': tipo}


def _auto_treino_loop():
    """se juntou amostra nova suficiente, treina sozinho e deixa o adapter pronto.
    E assim que o no (Kaggle) fica mais forte sem voce apertar nada."""
    while True:
        time.sleep(120)
        try:
            c = auto_cfg()
            d = auto_decisao(c)
            if not d['treinar']:
                continue
            jid = _job_infer('treinar', d['pedido'])
            auto_cfg(ultimo=d['total'], jobs=int(c.get('jobs') or 0) + 1, quando=int(time.time()), erro='')
            print('[auto-treino] %s com %d amostras (job %s)' % (d['tipo'], d['total'], jid), flush=True)
        except Exception as e:
            try:
                auto_cfg(erro='%s: %s' % (type(e).__name__, e))
            except Exception:
                pass


_CAT_HF = {'t': 0.0, 'v': None}


def catalogo_hf(recarregar=False):
    """roda hf_hub.py --lista e guarda 60s (e caro: importa libs)."""
    if not _py_hf_disponivel():
        return {'ok': False, 'err': 'hf_hub.py nao esta na pasta do agente (%s)' % BASE}
    if not recarregar and _CAT_HF['v'] and time.time() - _CAT_HF['t'] < 60:
        return _CAT_HF['v']
    try:
        r = subprocess.run([PY, HFHUB, '--lista'], capture_output=True, text=True,
                           timeout=180, cwd=BASE, env=dict(os.environ, ARKHER_STATE=STATE))
        v = json.loads(r.stdout or '{}')
        if not v.get('ok'):
            v = {'ok': False, 'err': (r.stderr or 'nao deu pra ler o catalogo')[-400:], 'modelos': []}
    except Exception as e:
        v = {'ok': False, 'err': '%s: %s' % (type(e).__name__, e), 'modelos': []}
    v['treinados'] = adapters_hf()
    _CAT_HF.update(t=time.time(), v=v)
    return v


def _job_infer(tarefa, pedido):
    """escreve o pedido em arquivo (sem shell: o texto do usuario nao passa por bash)
    e sobe o hf_hub.py como job, igual ao gerar3d."""
    os.makedirs(OUTHF, exist_ok=True)
    jid = uuid.uuid4().hex[:8]
    args = os.path.join(OUTHF, jid + '.args.json')
    meta = os.path.join(OUTHF, jid + '.json')
    with open(args, 'w', encoding='utf-8') as f:
        json.dump(pedido, f, ensure_ascii=False)
    spawn_list([PY, HFHUB, '--args', args, '--meta-out', meta], cwd=BASE,
               env={'ARKHER_STATE': STATE}, jid=jid)
    return jid


def _estado_infer(self_, jid):
    with LOCK:
        j = JOBS.get(jid)
    m = meta_hf(jid)
    linhas = (j['buf'][-14:] if j else [])
    if m and m.get('ok'):
        self_._s({'ok': True, 'estado': 'pronto', 'meta': m, 'linhas': linhas,
                  'sec': int(time.time() - j['start']) if j else 0})
    elif j and not j['done']:
        self_._s({'ok': True, 'estado': 'rodando', 'linhas': linhas,
                  'sec': int(time.time() - j['start'])})
    elif not j and not m:
        self_._s({'ok': False, 'err': 'job nao existe'}, 404)
    else:
        erro = (m or {}).get('erro') or ('terminou com codigo %s' % (j['code'] if j else '?'))
        self_._s({'ok': False, 'estado': 'falhou', 'erro': erro,
                  'como_resolver': (m or {}).get('como_resolver', ''), 'linhas': linhas})


def node_info():
    """quem eu sou na rede: o site usa isso pra preencher URL/RDP sozinho."""
    ip, nome, ts_ip = '', socket.gethostname(), ''
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80)); ip = s.getsockname()[0]; s.close()
    except Exception:
        pass
    exe = shutil.which('tailscale') or ('C:\\Program Files\\Tailscale\\tailscale.exe' if IS_WIN else '')
    if exe and os.path.exists(exe):
        try:
            r = subprocess.run([exe, 'ip', '-4'], capture_output=True, text=True, timeout=15)
            ts_ip = (r.stdout or '').strip().splitlines()[0] if r.stdout.strip() else ''
        except Exception:
            pass
    usuario = os.environ.get('ARKHER_RDP_USER') or (os.environ.get('USERNAME') if IS_WIN else os.environ.get('USER', ''))
    rdp = {'porta': 3389, 'usuario': usuario or 'nexus', 'ligado': False,
           'senha': os.environ.get('ARKHER_RDP_PW', '')}
    if IS_WIN:
        try:
            r = subprocess.run([PWSH, '-NoProfile', '-Command',
                                "(Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server')"
                                ".fDenyTSConnections"],
                               capture_output=True, text=True, timeout=25)
            rdp['ligado'] = (r.stdout or '').strip() == '0'
        except Exception:
            pass
    return {'ok': True, 'os': 'windows' if IS_WIN else ('android' if IS_TERMUX else 'linux'),
            'host': nome, 'porta': PORT, 'ip': ip, 'tailscale_ip': ts_ip,
            'url': ('http://%s:%d' % (ts_ip or ip or nome, PORT)), 'rdp': rdp,
            'hf': {'catalogo': _py_hf_disponivel(), 'treinados': len(adapters_hf())},
            'memoria': len(memoria_ler(k=100000)),
            'hora': time.time(), 'uptime_s': int(time.time() - BOOT)}


def _dentro_de_state(caminho):
    """nada de entregar /etc/passwd pro navegador."""
    try:
        real = os.path.realpath(caminho)
        raiz = os.path.realpath(STATE)
        return os.path.commonpath([real, raiz]) == raiz
    except Exception:
        return False


_TIPO = {'.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
         '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
         '.obj': 'text/plain; charset=utf-8', '.stl': 'model/stl', '.ply': 'application/octet-stream'}
_M3D = {'t': 0, 'v': None}

# ==========================================================================
# WebSocket (ws_min.py) — ver o porque no proprio modulo. Sem ele, o site cai
# sozinho pro modo antigo (polling); com ele, tela e saida de job vem ao vivo.
# ==========================================================================
try:
    import ws_min
    TEM_WS = True
except Exception:
    ws_min = None
    TEM_WS = False

_MOTORES_3D_TEXTO = ('shape', 'procedural')


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _s(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    # ---------------- WebSocket ----------------
    def _para_ws(self, q):
        if not TEM_WS:
            self._s({'ok': False, 'err': 'ws_min.py nao esta na pasta do agente — '
                                          'o site usa o modo antigo (polling)'}, 501)
            return
        if not ws_min.aceitar(self):
            self._s({'ok': False, 'err': 'nao e um pedido websocket'}, 400); return
        canal = (q.get('canal') or ['frames'])[0]
        try:
            if canal == 'frames':
                self._ws_frames(q)
            elif canal == 'job':
                self._ws_job(q)
            elif canal == 'cmd':
                self._ws_cmd()
            else:
                ws_min.manda_json(self.connection, {'t': 'erro', 'v': 'canal desconhecido: ' + canal})
        except Exception as e:
            try:
                ws_min.manda_json(self.connection, {'t': 'erro', 'v': '%s: %s' % (type(e).__name__, e)})
            except Exception:
                pass
        try:
            ws_min.fechar(self.connection)
            self.close_connection = True
        except Exception:
            pass

    def _ws_frames(self, q):
        """Empurra print da tela continuamente. O cliente pode ajustar
        {scale,q,fps} a qualquer momento. Frame que demora mais que o intervalo
        simplesmente atrasa o proximo — nao acumula fila (latencia sempre baixa)."""
        sock = self.connection
        def num(chave, padrao, lo, hi):
            try:
                return max(lo, min(hi, float((q.get(chave) or [padrao])[0])))
            except Exception:
                return padrao
        opts = {'scale': num('scale', 0.5, 0.1, 1.0), 'q': int(num('q', 55, 20, 95)),
                'fps': num('fps', 8, 1, 30)}
        buf = b''
        prox = 0.0
        while True:
            # 1) recados do cliente (ajuste ou fechar)
            op, d, buf = ws_min.ler_controle(sock, buf)
            if op is None or op == ws_min.OP_CLOSE:
                return
            if op == ws_min.OP_TXT and isinstance(d, dict):
                if 'scale' in d: opts['scale'] = max(0.1, min(1.0, float(d['scale'])))
                if 'q' in d: opts['q'] = int(max(20, min(95, float(d['q']))))
                if 'fps' in d: opts['fps'] = max(1.0, min(30.0, float(d['fps'])))
            agora = time.time()
            if agora < prox:
                time.sleep(min(0.02, prox - agora))
                continue
            g = grab_screen(opts['scale'], opts['q'])
            if g.get('b64'):
                if not ws_min.manda(sock, base64.b64decode(g['b64']), ws_min.OP_BIN):
                    return
            else:
                if not ws_min.manda_json(sock, {'t': 'erro', 'v': g.get('err') or 'sem captura'}):
                    return
                time.sleep(1.0)
            prox = time.time() + 1.0 / max(1.0, opts['fps'])

    def _ws_job(self, q):
        """Manda a saida do job conforme ela sai, linha por linha."""
        sock = self.connection
        jid = (q.get('id') or [''])[0]
        frm = 0
        try:
            frm = int((q.get('from') or ['0'])[0])
        except Exception:
            frm = 0
        buf = b''
        while True:
            j = JOBS.get(jid)
            if not j:
                # pode ser um job 3D (que vive na pasta 3d/_jobs)
                m = meta3d(jid)
                if m:
                    ws_min.manda_json(sock, {'t': 'fim', 'v': {'code': 0 if m.get('ok') else 1, 'meta': m}})
                else:
                    ws_min.manda_json(sock, {'t': 'erro', 'v': 'job nao existe'})
                return
            with LOCK:
                linhas = j['buf'][frm:]
                frm += len(linhas)
                done, code = j['done'], j['code']
            for l in linhas:
                if not ws_min.manda_json(sock, {'t': 'linha', 'v': l}):
                    return
            if done:
                ws_min.manda_json(sock, {'t': 'fim', 'v': {'code': code,
                                                           'sec': int(time.time() - j['start'])}})
                return
            op, _d, buf = ws_min.ler_controle(sock, buf)   # cliente fechou?
            if op is None or op == ws_min.OP_CLOSE:
                return
            time.sleep(0.12)

    def _ws_cmd(self):
        """Um canal so pra comandos: mandou {cmd}, recebe {out,err,code}. Sem
        reabrir conexao a cada comando (era o custo escondido do /exec)."""
        sock = self.connection
        buf = b''
        while True:
            op, d, buf = ws_min.ler_controle(sock, buf)
            if op is None or op == ws_min.OP_CLOSE:
                return
            if op != ws_min.OP_TXT or not isinstance(d, dict):
                time.sleep(0.03)
                continue
            cmd = (d.get('cmd') or '').strip()
            if not cmd:
                ws_min.manda_json(sock, {'ok': False, 'err': 'cmd vazio'})
                continue
            try:
                r = run_sync(cmd, int(d.get('timeout') or 600), d.get('cwd'))
                ws_min.manda_json(sock, {'ok': r['code'] == 0, **r})
            except Exception as e:
                ws_min.manda_json(sock, {'ok': False, 'err': '%s: %s' % (type(e).__name__, e)})

    def _arquivo(self, q):
        """entrega glb/png pro navegador (o site precisa poder baixar o modelo)."""
        caminho = (q.get('path') or [''])[0]
        if not caminho:
            self._s({'ok': False, 'err': 'path vazio'}, 400); return
        if not os.path.isabs(caminho):
            caminho = os.path.join(WORK, caminho)
        if not _dentro_de_state(caminho):
            self._s({'ok': False, 'err': 'caminho fora da pasta de estado'}, 403); return
        if not os.path.isfile(caminho):
            self._s({'ok': False, 'err': 'arquivo nao existe: %s' % caminho}, 404); return
        ext = os.path.splitext(caminho)[1].lower()
        try:
            with open(caminho, 'rb') as f:
                corpo = f.read()
        except Exception as e:
            self._s({'ok': False, 'err': str(e)}, 500); return
        self.send_response(200)
        self.send_header('Content-Type', _TIPO.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Disposition',
                         '%s; filename="%s"' % ('attachment' if q.get('dl') else 'inline',
                                                os.path.basename(caminho)))
        self.end_headers()
        try:
            self.wfile.write(corpo)
        except Exception:
            pass

    # ---------------- cerebro do no: dataset + treino automatico ----------------
    def _post_dataset(self, b):
        """o site manda o que aprendeu (lisoes e pares de preferencia) e isso
        vira dataset de treino aqui no no — e o que faz a IA melhorar sozinha."""
        itens = b.get('amostras') or []
        if not itens and b.get('jsonl'):
            for linha in str(b['jsonl']).splitlines():
                linha = linha.strip()
                if not linha:
                    continue
                try:
                    itens.append(json.loads(linha))
                except Exception:
                    pass
        if not itens:
            self._s({'ok': False, 'err': 'manda "jsonl" (uma amostra por linha) ou "amostras":[...] '
                                         '— o site tem o botao "Enviar cerebro pro no" na aba Cerebro'}, 400); return
        r = dataset_add(itens)
        self._s({'ok': True, **r})

    def _post_treinar(self, b):
        """treina um LoRA no dataset que o site exportou (JSONL ou lista de amostras)."""
        if not _py_hf_disponivel():
            self._s({'ok': False, 'err': 'hf_hub.py nao esta na pasta do agente (%s)' % BASE}, 400); return
        amostras = b.get('amostras') or []
        if not amostras and b.get('jsonl'):
            for linha in str(b['jsonl']).splitlines():
                linha = linha.strip()
                if not linha:
                    continue
                try:
                    amostras.append(json.loads(linha))
                except Exception:
                    pass
        if not amostras:
            # sem amostras no pedido: treina com o que o no ja acumulou
            amostras = dataset_ler()
            if not amostras:
                self._s({'ok': False, 'err': 'sem amostras: manda "amostras":[...] ou "jsonl":"{"messages":[...]}\n...", '
                                             'ou use POST /dataset antes — o site tem os botoes na aba Cerebro'}, 400); return
        if len(amostras) > 20000:
            self._s({'ok': False, 'err': 'dataset grande demais (%d amostras, max 20000)' % len(amostras)}, 400); return
        pedido = {'tarefa': 'treinar', 'amostras': amostras}
        if not b.get('tipo'):
            # mistura com preferencia? entao DPO (ensina o que NAO fazer)
            pares = sum(1 for x in amostras if x.get('chosen') and x.get('rejected'))
            if pares * 3 >= len(amostras):
                pedido['tipo'] = 'dpo'
        # amostras no formato de PREFERENCIA (chosen/rejected) => o hf_hub usa DPO sozinho
        for k in ('base', 'nome', 'passos', 'r', 'lr', 'maxlen', 'usar_unsloth', 'tipo'):
            if b.get(k) not in (None, ''):
                pedido[k] = b[k]
        jid = _job_infer('treinar', pedido)
        env = catalogo_hf().get('ambiente', {})
        self._s({'ok': True, 'id': jid, 'estado': 'rodando', 'amostras': len(amostras),
                 'base': pedido.get('base') or 'Qwen/Qwen2.5-Coder-7B-Instruct',
                 'gpu': (env.get('gpu') or {}).get('gpu', ''),
                 'poll': '/infer?job=' + jid,
                 'aviso': 'treino demora (minutos): acompanhe com GET /infer?job=' + jid})

    def _post_gerar3d(self, b):
        if not _py3d_disponivel():
            self._s({'ok': False, 'err': 'gerar3d.py nao esta na pasta do agente (%s)\n'
                                         'suba o arquivo junto com o agent.py' % BASE}, 400); return
        prompt = (b.get('prompt') or '').strip()
        imagem = (b.get('imagem') or '').strip()
        b64 = b.get('imagem_b64') or ''
        os.makedirs(JOBS3D, exist_ok=True)
        if b64:
            try:
                bruto = base64.b64decode(b64.split(',')[-1])
                if len(bruto) > 25_000_000:
                    self._s({'ok': False, 'err': 'imagem grande demais (25 MB max)'}, 400); return
                imagem = os.path.join(OUT3D, 'entrada_%d.png' % int(time.time()))
                os.makedirs(OUT3D, exist_ok=True)
                with open(imagem, 'wb') as f:
                    f.write(bruto)
            except Exception as e:
                self._s({'ok': False, 'err': 'imagem invalida: %s' % e}, 400); return
        if not prompt and not imagem:
            self._s({'ok': False, 'err': 'manda prompt ou imagem'}, 400); return
        argv = [PY, GERAR3D]
        if prompt:
            argv += ['--prompt', prompt]
        if imagem:
            argv += ['--imagem', imagem]
        argv += ['--engine', (b.get('engine') or b.get('motor') or 'auto').strip()]
        if b.get('seed') not in (None, ''):
            argv += ['--seed', str(int(b['seed']))]
        for chave, flag in (('passos', '--passos'), ('grade', '--grade'),
                            ('frame', '--frame'), ('max_faces', '--max-faces')):
            if b.get(chave) not in (None, ''):
                argv += [flag, str(int(b[chave]))]
        jid = uuid.uuid4().hex[:8]
        meta_out = os.path.join(JOBS3D, jid + '.json')
        argv = argv[:2] + ['--meta-out', meta_out] + argv[2:]
        spawn_list(argv, cwd=BASE, env={'ARKHER_STATE': STATE}, jid=jid)
        motores = motores3d().get('motores') or {}
        if argv[argv.index('--engine') + 1] != 'auto' and argv[argv.index('--engine') + 1] in motores \
                and not motores[argv[argv.index('--engine') + 1]]['pronto']:
            self._s({'ok': True, 'id': jid, 'estado': 'rodando', 'engine': argv[argv.index('--engine') + 1],
                     'aviso': 'esse motor ainda nao esta instalado neste no — o job vai explicar o que falta'})
            return
        self._s({'ok': True, 'id': jid, 'estado': 'rodando',
                 'engine': argv[argv.index('--engine') + 1],
                 'poll': '/gerar3d?job=' + jid})

    def do_OPTIONS(self):
        self._s({'ok': True})

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path.rstrip('/') or '/'
        if p == '/ws':
            try:
                self._para_ws(q)
            except Exception:
                pass
            return
        try:
            self._get(p, q)
        except Exception as e:
            self._s({'ok': False, 'err': f'{type(e).__name__}: {e}'}, 500)

    def _get(self, p, q):
        if p in ('/', '/health'):
            self._s({'ok': True, **machine()})
        elif p == '/job':
            jid = (q.get('id') or [''])[0]
            frm = int((q.get('from') or ['0'])[0])
            with LOCK:
                j = JOBS.get(jid)
                if not j:
                    self._s({'ok': False, 'err': 'job nao existe'}, 404); return
                lines = j['buf'][frm:]
                self._s({'ok': True, 'id': jid, 'lines': lines,
                         'next': frm + len(lines), 'done': j['done'], 'code': j['code'],
                         'sec': int(time.time() - j['start'])})
        elif p == '/jobs':
            with LOCK:
                self._s({'ok': True, 'items': [
                    {'id': j['id'], 'cmd': j['cmd'][:90], 'done': j['done'],
                     'code': j['code'], 'sec': int(time.time() - j['start'])}
                    for j in JOBS.values()]})
        elif p == '/ls':
            path = (q.get('path') or [WORK])[0]
            if not os.path.isabs(path):
                path = os.path.join(WORK, path)
            try:
                items = []
                for n in sorted(os.listdir(path))[:500]:
                    fp = os.path.join(path, n)
                    try:
                        items.append({'name': n, 'dir': os.path.isdir(fp),
                                      'size': os.path.getsize(fp) if os.path.isfile(fp) else 0})
                    except Exception:
                        pass
                self._s({'ok': True, 'path': os.path.abspath(path), 'items': items})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/cat':
            path = (q.get('path') or [''])[0]
            if not path:
                self._s({'ok': False, 'err': 'path vazio'}, 400); return
            if not os.path.isabs(path):
                path = os.path.join(WORK, path)
            try:
                with open(path, encoding='utf-8', errors='replace') as f:
                    self._s({'ok': True, 'path': path, 'text': f.read(200000)})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/screen':
            sc = float((q.get('scale') or ['0.5'])[0])
            qa = int((q.get('q') or ['55'])[0])
            g = grab_screen(sc, qa)
            if g.get('err'):
                self._s({'ok': False, 'err': g['err']}, 500)
            else:
                self._s({'ok': True, 'img': 'data:image/jpeg;base64,' + g['b64'],
                         'w': g['w'], 'h': g['h'], 'real_w': g['real_w'], 'real_h': g['real_h'],
                         'titulo': g.get('titulo', '')})
        elif p == '/guiready':
            self._s(gui_ready())
        elif p == '/file':
            self._arquivo(q)
        elif p == '/memoria':
            k = int((q.get('k') or ['400'])[0] or 400)
            desde = int((q.get('desde') or ['0'])[0] or 0)
            itens = memoria_ler(k=k, desde=desde, q=(q.get('q') or [''])[0], escopo=(q.get('escopo') or [''])[0])
            self._s({'ok': True, 'total': len(itens), 'itens': itens, 'arquivo': MEMORIA})
        elif p == '/dataset':
            self._s({'ok': True, **dataset_info(), 'auto': auto_cfg()})
        elif p == '/gerar3d':
            jid = (q.get('job') or [''])[0]
            if not jid:
                v = motores3d()
                self._s({'ok': bool(v.get('ok')), **v}); return
            with LOCK:
                j = JOBS.get(jid)
            m = meta3d(jid)
            linhas = (j['buf'][-14:] if j else [])
            if m and m.get('ok'):
                self._s({'ok': True, 'estado': 'pronto', 'meta': m, 'linhas': linhas,
                         'sec': int(time.time() - j['start']) if j else 0})
            elif j and not j['done']:
                self._s({'ok': True, 'estado': 'rodando', 'linhas': linhas,
                         'sec': int(time.time() - j['start'])})
            elif not j and not m:
                self._s({'ok': False, 'err': 'job 3D nao existe'}, 404)
            else:
                erro = (m or {}).get('erro') or ('terminou com codigo %s' % (j['code'] if j else '?'))
                self._s({'ok': False, 'estado': 'falhou', 'erro': erro, 'linhas': linhas})
        elif p == '/node':
            self._s(node_info())
        elif p == '/infer':
            jid = (q.get('job') or [''])[0]
            if jid:
                _estado_infer(self, jid); return
            self._s(catalogo_hf(recarregar=bool(q.get('refresh'))))
        elif p == '/treinar':
            jid = (q.get('job') or [''])[0]
            if jid:
                _estado_infer(self, jid); return
            self._s({'ok': True, 'treinados': adapters_hf(),
                     'bases': (catalogo_hf().get('bases_treino') or [])})
        elif p == '/history':
            items = []
            try:
                with open(HIST, encoding='utf-8') as f:
                    items = [json.loads(x) for x in f.read().strip().split('\n') if x][-200:]
            except Exception:
                pass
            self._s({'ok': True, 'items': items})
        else:
            self._s({'ok': False, 'err': 'rota desconhecida'}, 404)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0) or 0)
        try:
            b = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            self._s({'ok': False, 'err': 'json invalido'}, 400); return
        p = urlparse(self.path).path.rstrip('/') or '/'
        try:
            self._post(p, b)
        except Exception as e:
            self._s({'ok': False, 'err': f'{type(e).__name__}: {e}'}, 500)

    def _post(self, p, b):
        if p == '/exec':
            cmd = (b.get('cmd') or '').strip()
            if not cmd:
                self._s({'ok': False, 'err': 'cmd vazio'}, 400); return
            r = run_sync(cmd, int(b.get('timeout') or 600), b.get('cwd'))
            self._s({'ok': r['code'] == 0, **r})
        elif p == '/spawn':
            cmd = (b.get('cmd') or '').strip()
            if not cmd:
                self._s({'ok': False, 'err': 'cmd vazio'}, 400); return
            self._s({'ok': True, 'id': spawn(cmd, b.get('cwd'))})
        elif p == '/kill':
            with LOCK:
                j = JOBS.get(b.get('id'))
            if j and j.get('proc'):
                try:
                    j['proc'].kill()
                except Exception:
                    pass
            self._s({'ok': True})
        elif p == '/write':
            try:
                path = b.get('path') or 'arquivo.txt'
                if not os.path.isabs(path):
                    path = os.path.join(WORK, path)
                os.makedirs(os.path.dirname(path) or WORK, exist_ok=True)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(b.get('content') or '')
                self._s({'ok': True, 'path': path})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/input':
            acts = b.get('acts') or ([b] if b.get('do') else [])
            res = []
            for a in acts[:60]:
                res.append(do_input(a))
                try:
                    time.sleep(max(0.0, min(float(a.get('after', 0.25)), 10)))
                except Exception:
                    pass
            shot = None
            if b.get('shot'):
                g = grab_screen(float(b.get('scale') or 0.5))
                if g.get('b64'): shot = 'data:image/jpeg;base64,' + g['b64']
            self._s({'ok': all(r.get('ok') for r in res), 'res': res, 'img': shot})
        elif p == '/app':
            r = abrir_app(b.get('nome') or '', b.get('caminho'))
            if not r.get('ok'):
                self._s(r, 400); return
            time.sleep(max(0.0, min(float(b.get('esperar') or 6), 30)))
            g = grab_screen(0.5)
            self._s({'ok': True, 'exe': r.get('exe'),
                     'img': ('data:image/jpeg;base64,' + g['b64']) if g.get('b64') else None})
        elif p == '/gerar3d':
            self._post_gerar3d(b)
        elif p == '/gerar3d/instalar':
            if not _py3d_disponivel():
                self._s({'ok': False, 'err': 'gerar3d.py nao esta na pasta do agente'}, 400); return
            motor = (b.get('engine') or b.get('motor') or 'shape').strip()
            if motor not in ('shape', 'shape-img', 'triposr', 'sd-turbo', 'procedural'):
                self._s({'ok': False, 'err': 'motor invalido: %s' % motor}, 400); return
            os.makedirs(JOBS3D, exist_ok=True)
            meses = {'ARKHER_STATE': STATE}
            jid = spawn_list([PY, GERAR3D, '--instalar', motor], cwd=BASE, env=meses)
            self._s({'ok': True, 'id': jid, 'engine': motor,
                     'aviso': 'pip baixando gigabytes — acompanhe em /job?id=' + jid})
        elif p == '/infer':
            if not _py_hf_disponivel():
                self._s({'ok': False, 'err': 'hf_hub.py nao esta na pasta do agente (%s)\n'
                                             'suba o arquivo junto com o agent.py' % BASE}, 400); return
            tarefa = (b.get('tarefa') or '').strip().lower()
            if not tarefa:
                self._s({'ok': False, 'err': 'manda "tarefa": chat|imagem|embed|asr|depth|fundo|upscale'},
                        400); return
            if tarefa == 'treinar':
                self._post_treinar(b); return
            pedido = dict(b); pedido['tarefa'] = tarefa
            jid = _job_infer(tarefa, pedido)
            self._s({'ok': True, 'id': jid, 'estado': 'rodando', 'tarefa': tarefa,
                     'poll': '/infer?job=' + jid})
        elif p == '/treinar':
            self._post_treinar(b)
        elif p == '/memoria':
            itens = b.get('itens') or ([b] if b.get('texto') else [])
            if not itens:
                self._s({'ok': False, 'err': 'manda "itens":[...] ou {texto, tipo, escopo}'}, 400); return
            r = memoria_add(itens, fonte=b.get('de') or 'no')
            self._s({'ok': True, **r})
        elif p == '/memoria/podar':
            self._s({'ok': True, 'cortados': _memoria_podar(int(b.get('max') or 8000))})
        elif p == '/dataset':
            self._post_dataset(b)
        elif p == '/dataset/auto':
            c = auto_cfg(**{k: b.get(k) for k in ('ligado', 'min_novos', 'min_total', 'base', 'passos') if k in b})
            self._s({'ok': True, **c, 'dataset': dataset_info()})
        elif p == '/snapshot':
            self._s({'ok': True, 'meta': snapshot()})
        else:
            self._s({'ok': False, 'err': 'rota desconhecida'}, 404)

    def log_message(self, *a):
        pass


def on_die(*_):
    snapshot()
    sys.exit(0)


if __name__ == '__main__':
    for s in ('SIGTERM', 'SIGINT', 'SIGBREAK'):
        if hasattr(signal, s):
            try:
                signal.signal(getattr(signal, s), on_die)
            except Exception:
                pass
    # salva sozinho a cada 2 min (se o runner cair de repente, nao perde tudo)
    def autosave():
        while True:
            time.sleep(120)
            snapshot()
    threading.Thread(target=autosave, daemon=True).start()
    # treino automatico: quando o site manda amostra nova suficiente, treina sozinho
    threading.Thread(target=_auto_treino_loop, daemon=True).start()

    srv = ThreadingHTTPServer(('0.0.0.0', PORT), H)
    srv.daemon_threads = True
    m = machine()
    print(f"ARKHER AGENT :{PORT}  {m.get('os')}  {m.get('cpu', '?')}  {m.get('ram_gb', '?')}GB  work={WORK}", flush=True)
    srv.serve_forever()
