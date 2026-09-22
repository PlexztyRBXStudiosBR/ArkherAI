#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DsOS Core - roda DENTRO do backend (Kaggle Linux, runner Windows, VPS, PC).
Nao e uma pagina web: e a sessao real do sistema.

Mesmo contrato do agent.py (Tailscale + HTTP), mas transporta:
  - tela real  (GET  /frame)
  - entrada    (POST /input)
  - sistema    (/sys /procs /fs /exec /apps)

Linux: Xvfb + gerenciador de janelas real + xdotool.
Windows: sessao grafica nativa + PowerShell.
So stdlib.
"""
import base64, json, os, platform, shutil, subprocess, sys, threading, time
try:
    import ws_min
    TEM_WS = True
except Exception:            # ws_min.py nao esta na pasta -> site usa polling
    ws_min = None
    TEM_WS = False
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("DSOS_PORT", "8766"))
WIN  = platform.system() == "Windows"
DISP = os.environ.get("DSOS_DISPLAY", ":77")
W, H = int(os.environ.get("DSOS_W", "1280")), int(os.environ.get("DSOS_H", "720"))
ROOT = os.environ.get("DSOS_ROOT") or (os.path.join(os.path.expanduser("~"), "dsos") if WIN or not os.path.isdir("/kaggle") else "/kaggle/working/dsos")
BASH = shutil.which("bash") or shutil.which("sh") or "/bin/sh"
PWSH = shutil.which("powershell") or shutil.which("pwsh") or "powershell"
JOBS, LOCK = {}, threading.Lock()
BOOT = time.time()

def sh(cmd, t=120, env=None):
    e = dict(os.environ); e.update(env or {})
    try:
        if WIN:
            p = subprocess.run([PWSH,"-NoProfile","-NonInteractive","-Command",cmd],
                               capture_output=True, text=True, errors="replace", timeout=t, env=e, cwd=ROOT)
        else:
            p = subprocess.run([BASH,"-lc",cmd], capture_output=True, text=True, errors="replace",
                               timeout=t, env=e, cwd=ROOT)
        return {"ok": p.returncode == 0, "code": p.returncode,
                "out": p.stdout[-60000:], "err": p.stderr[-8000:]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": -1, "out": "", "err": "timeout %ss" % t}
    except Exception as ex:
        return {"ok": False, "code": -1, "out": "", "err": str(ex)}

def tem(b):
    return shutil.which(b) is not None

# ---------------------------------------------------------------- HARDWARE
# regra do usuario: detectar de verdade, nunca inventar.
def hw():
    d = {"os": platform.system(), "release": platform.release(),
         "arch": platform.machine(), "host": platform.node(),
         "uptime": int(time.time() - BOOT)}
    # CPU
    try:
        d["cpu_cores"] = os.cpu_count()
        if WIN:
            r = sh("(Get-CimInstance Win32_Processor).Name", 20)
            d["cpu"] = r["out"].strip().split("\n")[0] if r["ok"] else "?"
        else:
            n = "?"
            for ln in open("/proc/cpuinfo"):
                if ln.startswith("model name"):
                    n = ln.split(":",1)[1].strip(); break
            d["cpu"] = n
    except Exception: d["cpu"] = "?"
    # RAM
    try:
        if WIN:
            r = sh("[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)", 20)
            d["ram_gb"] = float(r["out"].strip()) if r["ok"] and r["out"].strip() else None
            r2 = sh("[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)", 20)
            d["ram_livre_gb"] = float(r2["out"].strip()) if r2["ok"] and r2["out"].strip() else None
        else:
            mt = ma = 0
            for ln in open("/proc/meminfo"):
                if ln.startswith("MemTotal"):     mt = int(ln.split()[1])
                if ln.startswith("MemAvailable"): ma = int(ln.split()[1])
            d["ram_gb"] = round(mt/1048576, 1); d["ram_livre_gb"] = round(ma/1048576, 1)
    except Exception: d["ram_gb"] = None
    # GPU - so o que o nvidia-smi devolver
    d["gpu"] = None; d["vram_mb"] = None; d["cuda"] = False
    if tem("nvidia-smi"):
        r = sh("nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits", 25)
        if r["ok"] and r["out"].strip():
            p = [x.strip() for x in r["out"].strip().split("\n")[0].split(",")]
            d["gpu"] = p[0]
            if len(p) > 1 and p[1].isdigit(): d["vram_mb"] = int(p[1])
            if len(p) > 2 and p[2].isdigit(): d["vram_uso_mb"] = int(p[2])
            d["cuda"] = True
    # disco
    try:
        t, u, f = shutil.disk_usage(ROOT if os.path.isdir(ROOT) else ".")
        d["disco_gb"] = round(t/2**30,1); d["disco_livre_gb"] = round(f/2**30,1)
    except Exception: pass
    # o que a sessao grafica suporta
    d["gui"] = bool(os.environ.get("DSOS_GUI")) or WIN or os.path.exists("/tmp/.X11-unix/X" + DISP.lstrip(":"))
    d["wine"] = tem("wine")
    d["backend"] = os.environ.get("DSOS_BACKEND", "kaggle" if os.path.isdir("/kaggle") else ("windows" if WIN else "linux"))
    return d


# --------------------------------------------------------- COMPATIBILIDADE
def compat():
    """Item 12 da spec: as tres familias. So reporta o que REALMENTE existe."""
    c = {}
    # Linux nativo
    c["linux"] = {"ok": not WIN, "via": "nativo" if not WIN else None,
                  "nota": None if not WIN else "backend e Windows"}
    # Windows
    if WIN:
        c["windows"] = {"ok": True, "via": "nativo", "nota": None}
    elif tem("wine"):
        v = sh("wine --version", 20)
        c["windows"] = {"ok": True, "via": "wine",
                        "versao": (v["out"] or "").strip(),
                        "nota": "Wine roda MUITO app Windows, mas nao todos. "
                                "Roblox Studio nao funciona sob Wine (anticheat)."}
    else:
        c["windows"] = {"ok": False, "via": None,
                        "nota": "sem Wine neste backend; use o backend Windows"}
    # Android - so se houver runtime de verdade
    a_via = None
    for b, nome in (("waydroid","waydroid"), ("anbox","anbox")):
        if tem(b): a_via = nome; break
    if a_via:
        st = sh("%s status 2>&1 | head -3" % a_via, 25)
        c["android"] = {"ok": True, "via": a_via, "estado": (st["out"] or "").strip()}
    elif tem("adb"):
        c["android"] = {"ok": False, "via": "adb",
                        "nota": "adb existe mas nao ha runtime Android; da pra controlar "
                                "um aparelho conectado, nao rodar apps aqui"}
    else:
        c["android"] = {"ok": False, "via": None,
                        "nota": "sem runtime Android neste backend. Waydroid/Anbox exigem "
                                "kernel binder + privilegio, que Kaggle e Actions nao dao."}
    return c

def audio():
    """Item 2: audio. Diz a verdade sobre um backend headless."""
    if WIN:
        return {"ok": True, "via": "wasapi", "nota": "audio local do runner; nao ha canal de retorno ainda"}
    for b in ("pulseaudio","pipewire"):
        if tem(b): return {"ok": True, "via": b, "nota": "sem transporte de audio pro navegador ainda"}
    return {"ok": False, "via": None, "nota": "sem servidor de audio neste backend"}

def servicos():
    """Item 2: servicos do sistema. Estado real, sem falso positivo."""
    if WIN:
        r = sh("Get-Service|?{$_.Status -eq 'Running'}|Select-Object -First 20 Name,DisplayName|ConvertTo-Json -Compress", 25)
        try:
            j = json.loads(r["out"] or "[]")
            if isinstance(j, dict): j = [j]
            return [{"nome": x.get("Name"), "desc": x.get("DisplayName")} for x in j]
        except Exception: return []
    out = []
    # Xvfb: o teste honesto e perguntar ao proprio X, nao procurar string em processo
    xok = False
    if tem("xdpyinfo"):
        xok = sh("DISPLAY=%s xdpyinfo >/dev/null 2>&1 && echo on" % DISP, 12)["out"].strip() == "on"
    elif tem("xset"):
        xok = sh("DISPLAY=%s xset q >/dev/null 2>&1 && echo on" % DISP, 12)["out"].strip() == "on"
    else:
        xok = os.path.exists("/tmp/.X11-unix/X" + DISP.lstrip(":"))
    out.append({"nome": "Xvfb (servidor X)", "ativo": xok})
    wm = getattr(TELA, "wm", None)
    out.append({"nome": "gerenciador de janelas" + (" (%s)" % wm if wm else ""),
                "ativo": bool(wm) and xok})
    out.append({"nome": "DsOS Core", "ativo": True})   # se responde, esta no ar
    for nome, b in (("audio", "pulseaudio"), ("tailscale", "tailscaled")):
        out.append({"nome": nome, "ativo": bool(sh("pidof %s 2>/dev/null" % b, 8)["out"].strip())})
    return out

def rede():
    """Item 2: rede."""
    d = {}
    try:
        if WIN:
            r = sh("(Get-NetIPAddress -AddressFamily IPv4|?{$_.IPAddress -ne '127.0.0.1'}|Select -First 3 -Expand IPAddress) -join ','", 20)
        else:
            r = sh("hostname -I 2>/dev/null || ip -4 -o addr show | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' '", 15)
        d["ips"] = [x for x in (r["out"] or "").replace(","," ").split() if x][:4]
    except Exception: d["ips"] = []
    ts = sh("tailscale ip -4 2>/dev/null | head -1", 15)
    d["tailscale"] = (ts["out"] or "").strip() or None
    return d

# ---------------------------------------------------------- SESSAO GRAFICA
class Tela:
    """Desktop real. No Linux sobe Xvfb + WM; no Windows usa a sessao existente."""
    escala = 100     # ultima escala usada em /frame (o /input converte por ela)

    def __init__(self):
        self.ok = False; self.erro = None; self.procs = []; self.wm = None

    def subir(self):
        if WIN:
            self.ok = True; return {"ok": True, "modo": "windows-nativo"}
        faltando = [b for b in ("Xvfb","xdotool","x11vnc") if not tem(b)]
        if not tem("Xvfb"):
            self.erro = "Xvfb nao instalado"
            return {"ok": False, "erro": self.erro, "faltando": faltando}
        os.environ["DISPLAY"] = DISP
        if self.ok:
            return {"ok": True, "modo": "xvfb", "wm": self.wm, "display": DISP, "res": "%dx%d" % (W,H), "faltando": faltando, "nota": "ja estava no ar"}
        # servidor X virtual (se ja houver um neste display, reaproveita)
        if not os.path.exists("/tmp/.X11-unix/X" + DISP.lstrip(":")):
            self.procs.append(subprocess.Popen(
                ["Xvfb", DISP, "-screen","0","%dx%dx24"%(W,H), "-ac","+extension","GLX","+render","-noreset"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            time.sleep(2.5)
            if not os.path.exists("/tmp/.X11-unix/X" + DISP.lstrip(":")):
                self.erro = "Xvfb nao subiu no display " + DISP
                return {"ok": False, "erro": self.erro, "faltando": faltando}
        # gerenciador de janelas de verdade (o que existir)
        for wm in ("openbox","fluxbox","icewm","xfwm4","jwm","mutter","marco"):
            if tem(wm):
                self.procs.append(subprocess.Popen([wm], env=dict(os.environ, DISPLAY=DISP),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                self.wm = wm; break
        else:
            self.wm = None
        # painel/barra se houver
        for pn in ("tint2","xfce4-panel","lxpanel"):
            if tem(pn):
                self.procs.append(subprocess.Popen([pn], env=dict(os.environ, DISPLAY=DISP),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                break
        # fundo
        if tem("xsetroot"):
            sh("DISPLAY=%s xsetroot -solid '#0e1420'" % DISP, 10)
        time.sleep(1)
        self.ok = True
        return {"ok": True, "modo": "xvfb", "wm": self.wm, "display": DISP,
                "res": "%dx%d" % (W,H), "faltando": faltando}

    def frame(self, q=55, escala=100):
        """JPEG da tela real."""
        q = max(10, min(95, int(q))); escala = max(10, min(100, int(escala)))
        # o /input precisa saber: o cliente calcula o clique em pixels DA IMAGEM
        # que recebeu. Sem isso, clique com s<100 errava o alvo.
        self.escala = escala
        if WIN:
            ps = ("Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
                  "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;"
                  "$bm=New-Object Drawing.Bitmap $b.Width,$b.Height;"
                  "$g=[Drawing.Graphics]::FromImage($bm);"
                  "$g.CopyFromScreen($b.X,$b.Y,0,0,$bm.Size);"
                  "if(%d -lt 100){$w=[int]($b.Width*%d/100);$h=[int]($b.Height*%d/100);$r=New-Object Drawing.Bitmap $bm,$w,$h;$bm.Dispose();$bm=$r};"
                  "$ms=New-Object IO.MemoryStream;"
                  "$en=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{$_.MimeType -eq 'image/jpeg'};"
                  "$p=New-Object Drawing.Imaging.EncoderParameters 1;"
                  "$p.Param[0]=New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality),%d;"
                  "$bm.Save($ms,$en,$p);$bm.Dispose();[Convert]::ToBase64String($ms.ToArray())") % (escala, escala, escala, q)
            r = sh(ps, 40)
            if r["ok"] and r["out"].strip():
                return base64.b64decode(r["out"].strip().splitlines()[-1]), "image/jpeg"
            raise RuntimeError((r["err"] or "falha ao capturar").strip()[:300])
        # Linux
        out = "/tmp/dsos_f.jpg"
        if tem("ffmpeg"):
            r = sh("ffmpeg -y -loglevel quiet -f x11grab -draw_mouse 1 -video_size %dx%d -i %s "
                   "-frames:v 1 -q:v %d %s" % (W,H,DISP, max(2,int(31-q*0.29)), out), 30)
            if os.path.exists(out) and os.path.getsize(out) > 0:
                return open(out,"rb").read(), "image/jpeg"
        if tem("import"):   # imagemagick
            r = sh("DISPLAY=%s import -window root -quality %d %s" % (DISP,q,out), 30)
            if os.path.exists(out): return open(out,"rb").read(), "image/jpeg"
        if tem("scrot"):
            r = sh("DISPLAY=%s scrot -o -q %d %s" % (DISP,q,out), 30)
            if os.path.exists(out): return open(out,"rb").read(), "image/jpeg"
        raise RuntimeError("sem ferramenta de captura (ffmpeg/imagemagick/scrot)")

    def ponteiro(self):
        """Posicao REAL do ponteiro. Devolve (x, y) ou None. Nao estima."""
        if WIN:
            ps = ("Add-Type -AssemblyName System.Windows.Forms;"
                  "$p=[System.Windows.Forms.Cursor]::Position;"
                  "Write-Output (\"$($p.X) $($p.Y)\")")
            r = sh(ps, 15)
            if r["ok"] and r["out"].strip():
                try:
                    a, b = r["out"].strip().split()[:2]
                    return int(a), int(b)
                except Exception:
                    return None
            return None
        if not tem("xdotool"):
            return None
        r = sh("DISPLAY=%s xdotool getmouselocation --shell" % DISP, 10)
        if not (r["ok"] and r["out"]):
            return None
        d = {}
        for ln in r["out"].splitlines():
            if "=" in ln:
                k, v = ln.split("=", 1); d[k.strip()] = v.strip()
        try: return int(d.get("X")), int(d.get("Y"))
        except Exception: return None

    # --------- entrada: touch, mouse, teclado, gamepad
    def entrada(self, ev):
        t = ev.get("t")
        # volta da escala da imagem para a escala real da tela
        f = 100.0 / (getattr(self, "escala", 100) or 100)
        if f != 1.0:
            for k in ("x", "y", "x2", "y2", "dx", "dy"):
                if k in ev:
                    try: ev[k] = int(round(float(ev[k]) * f))
                    except Exception: pass
            for p in (ev.get("pontos") or []):
                for k in ("x", "y"):
                    if k in p:
                        try: p[k] = int(round(float(p[k]) * f))
                        except Exception: pass
        if WIN:
            return self._win_input(ev)
        if not tem("xdotool"):
            return {"ok": False, "erro": "xdotool ausente"}
        D = "DISPLAY=%s " % DISP
        x, y = int(ev.get("x",0)), int(ev.get("y",0))
        if t in ("tap","click","down","up","move","dbl"):
            b = {"left":1,"middle":2,"right":3}.get(ev.get("btn","left"),1)
            if t == "move":  return sh(D+"xdotool mousemove %d %d"%(x,y), 10)
            if t == "down":  return sh(D+"xdotool mousemove %d %d mousedown %d"%(x,y,b), 10)
            if t == "up":    return sh(D+"xdotool mousemove %d %d mouseup %d"%(x,y,b), 10)
            if t == "dbl":   return sh(D+"xdotool mousemove %d %d click --repeat 2 %d"%(x,y,b), 10)
            return sh(D+"xdotool mousemove %d %d click %d"%(x,y,b), 10)
        if t == "drag":
            return sh(D+"xdotool mousemove %d %d mousedown 1 mousemove %d %d mouseup 1"
                      % (x,y,int(ev.get("x2",x)),int(ev.get("y2",y))), 15)
        if t == "scroll":
            b = 4 if ev.get("dy",0) < 0 else 5
            n = max(1, min(10, abs(int(ev.get("n",3)))))
            return sh(D+"xdotool mousemove %d %d click --repeat %d %d"%(x,y,n,b), 10)

        if t == "pinch":
            # zoom: ctrl+scroll e o gesto universal em app de desktop
            n = max(1, min(8, abs(int(ev.get("n", 3)))))
            b = 4 if ev.get("escala", 1) > 1 else 5
            return sh(D + "xdotool mousemove %d %d keydown ctrl click --repeat %d %d keyup ctrl"
                      % (x, y, n, b), 15)
        if t == "multi":
            # sequencia de pontos; X11 nao tem multitouch real, entao viram cliques encadeados
            ps = ev.get("pontos") or []
            for p in ps[:5]:
                sh(D + "xdotool mousemove %d %d click 1" % (int(p.get("x",0)), int(p.get("y",0))), 10)
            return {"ok": True, "pontos": len(ps[:5]),
                    "nota": "X11 nao expoe multitouch real; enviados como cliques em sequencia"}
        if t == "combo":
            # teclas modificadoras: ctrl+alt+t, super, etc
            k = str(ev.get("v", ""))[:60]
            if not all(c.isalnum() or c in "+_-" for c in k):
                return {"ok": False, "erro": "combo invalido"}
            return sh(D + "xdotool key %s" % k, 10)
        if t == "gamepad":
            # mapeia botao do gamepad para tecla configurada pelo usuario
            k = str(ev.get("tecla", ""))[:40]
            if not k or not all(c.isalnum() or c in "+_-" for c in k):
                return {"ok": False, "erro": "sem tecla mapeada"}
            return sh(D + "xdotool key %s" % k, 10)
        if t == "trackpad":
            return sh(D + "xdotool mousemove_relative -- %d %d"
                      % (int(ev.get("dx",0)), int(ev.get("dy",0))), 10)
        if t == "texto":
            s = str(ev.get("v",""))[:2000].replace("'", "'\\''")
            return sh(D+"xdotool type --delay 12 -- '%s'" % s, 30)
        if t == "tecla":
            k = str(ev.get("v","Return"))[:60]
            if not all(c.isalnum() or c in "+_-" for c in k):
                return {"ok": False, "erro": "tecla invalida"}
            return sh(D+"xdotool key %s" % k, 10)
        return {"ok": False, "erro": "evento %r desconhecido" % t}

    def _win_input(self, ev):
        t = ev.get("t"); x,y = int(ev.get("x",0)), int(ev.get("y",0))
        base = ("Add-Type -AssemblyName System.Windows.Forms;"
                "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")]public static extern void "
                "mouse_event(int f,int dx,int dy,int d,int e);' -Name U -Namespace W;")
        if t in ("tap","click","down","up","move","dbl","drag"):
            cmd = base + "[Windows.Forms.Cursor]::Position=New-Object Drawing.Point(%d,%d);" % (x,y)
            if t in ("tap","click"): cmd += "[W.U]::mouse_event(2,0,0,0,0);[W.U]::mouse_event(4,0,0,0,0);"
            elif t == "dbl": cmd += "[W.U]::mouse_event(2,0,0,0,0);[W.U]::mouse_event(4,0,0,0,0);Start-Sleep -m 80;[W.U]::mouse_event(2,0,0,0,0);[W.U]::mouse_event(4,0,0,0,0);"
            elif t == "down": cmd += "[W.U]::mouse_event(2,0,0,0,0);"
            elif t == "up":   cmd += "[W.U]::mouse_event(4,0,0,0,0);"
            elif t == "drag":
                cmd += ("[W.U]::mouse_event(2,0,0,0,0);Start-Sleep -m 60;"
                        "[Windows.Forms.Cursor]::Position=New-Object Drawing.Point(%d,%d);"
                        "Start-Sleep -m 60;[W.U]::mouse_event(4,0,0,0,0);"
                        % (int(ev.get("x2",x)), int(ev.get("y2",y))))
            return sh(cmd, 20)
        if t == "scroll":
            return sh(base + "[W.U]::mouse_event(2048,0,0,%d,0);" % (-120 if ev.get("dy",0)>0 else 120), 15)
        if t == "pinch":
            n = max(1, min(8, abs(int(ev.get("n",3)))))
            return sh(base + ("$w=%d;1..%d|%%{[W.U]::mouse_event(2048,0,0,$w,0)}" %
                      (120 if ev.get("escala",1) > 1 else -120, n)), 20)
        if t == "trackpad":
            return sh(base + "$p=[Windows.Forms.Cursor]::Position;"
                      "[Windows.Forms.Cursor]::Position=New-Object Drawing.Point(($p.X+%d),($p.Y+%d));"
                      % (int(ev.get("dx",0)), int(ev.get("dy",0))), 15)
        if t in ("gamepad","combo"):
            m2 = {"Return":"{ENTER}","Escape":"{ESC}","Tab":"{TAB}","Up":"{UP}","Down":"{DOWN}",
                  "Left":"{LEFT}","Right":"{RIGHT}","space":" ","BackSpace":"{BACKSPACE}"}
            k = m2.get(str(ev.get("tecla") or ev.get("v","")), None)
            if k is None: return {"ok": False, "erro": "tecla nao mapeada"}
            return sh("Add-Type -AssemblyName System.Windows.Forms;"
                      "[Windows.Forms.SendKeys]::SendWait('%s')" % k, 15)
        if t == "texto":
            s = "".join(("{" + c + "}") if c in "+^%~(){}[]" else ("{ENTER}" if c == "\n" else c)
                        for c in str(ev.get("v",""))[:2000]).replace("'","''")
            return sh("Add-Type -AssemblyName System.Windows.Forms;"
                      "[Windows.Forms.SendKeys]::SendWait('%s')" % s, 25)
        if t == "tecla":
            k = _win_key(str(ev.get("v","")))
            if k is None: return {"ok": False, "erro": "tecla nao mapeada: %s" % ev.get("v")}
            return sh("Add-Type -AssemblyName System.Windows.Forms;"
                      "[Windows.Forms.SendKeys]::SendWait('%s')" % k.replace("'","''"), 15)
        return {"ok": False, "erro": "evento desconhecido"}

_WK = {"return":"{ENTER}","enter":"{ENTER}","escape":"{ESC}","esc":"{ESC}","backspace":"{BACKSPACE}",
       "tab":"{TAB}","up":"{UP}","down":"{DOWN}","left":"{LEFT}","right":"{RIGHT}","delete":"{DEL}",
       "home":"{HOME}","end":"{END}","page_up":"{PGUP}","page_down":"{PGDN}","space":" ",
       "super":"^{ESC}","insert":"{INS}","print":"{PRTSC}"}
def _win_key(k):
    """nome de tecla estilo xdotool (ctrl+shift+s, F5, Return) -> SendKeys."""
    k = k.strip()
    if not k: return None
    partes = k.split("+") if "+" in k and k != "+" else [k]
    mods = ""; base = partes[-1]
    for m in partes[:-1]:
        m = m.lower()
        if m in ("ctrl","control"): mods += "^"
        elif m == "alt": mods += "%"
        elif m == "shift": mods += "+"
        elif m in ("super","win"): return None
    b = base.lower()
    if b in _WK: tk = _WK[b]
    elif len(b) == 1: tk = ("{" + b + "}") if b in "+^%~(){}[]" else b
    elif b.startswith("f") and b[1:].isdigit() and 1 <= int(b[1:]) <= 16: tk = "{F%d}" % int(b[1:])
    else: return None
    return mods + tk

TELA = Tela()

# ------------------------------------------------------------- JANELAS/PROC
def janelas():
    if WIN:
        r = sh("Get-Process|?{$_.MainWindowTitle}|Select-Object Id,ProcessName,MainWindowTitle|ConvertTo-Json -Compress", 25)
        try:
            j = json.loads(r["out"] or "[]")
            if isinstance(j, dict): j = [j]
            return [{"id":x.get("Id"),"nome":x.get("ProcessName"),"titulo":x.get("MainWindowTitle")} for x in j]
        except Exception: return []
    if not tem("xdotool"): return []
    r = sh("DISPLAY=%s xdotool search --onlyvisible --name '.*' 2>/dev/null" % DISP, 15)
    out = []
    for wid in (r["out"] or "").split():
        n = sh("DISPLAY=%s xdotool getwindowname %s" % (DISP, wid), 8)
        if n["ok"] and n["out"].strip():
            out.append({"id": wid, "titulo": n["out"].strip()})
    return out[:40]

def processos():
    if WIN:
        r = sh("Get-Process|Sort-Object -Descending WS|Select-Object -First 25 Id,ProcessName,"
               "@{n='MB';e={[math]::Round($_.WS/1MB,1)}}|ConvertTo-Json -Compress", 25)
        try:
            j = json.loads(r["out"] or "[]")
            if isinstance(j, dict): j = [j]
            return [{"pid":x.get("Id"),"nome":x.get("ProcessName"),"mb":x.get("MB")} for x in j]
        except Exception: return []
    r = sh("ps -eo pid,comm,rss --sort=-rss|head -26|tail -25", 15)
    out = []
    for ln in (r["out"] or "").strip().split("\n"):
        p = ln.split(None, 2)
        if len(p) == 3 and p[0].isdigit():
            out.append({"pid": int(p[0]), "nome": p[1], "mb": round(int(p[2])/1024, 1)})
    return out

# ---------------------------------------------------------------- APPS
def apps_instalados():
    """So lista o que existe de verdade nesta maquina."""
    cands = ([("Roblox Studio", r"$env:LOCALAPPDATA\Roblox\Versions\*\RobloxStudioBeta.exe"),
              ("Blender", r"C:\Program Files\Blender Foundation\*\blender.exe"),
              ("Explorador", "explorer.exe"), ("Terminal", "powershell.exe"),
              ("Bloco de notas", "notepad.exe"), ("Navegador", "msedge.exe")]
             if WIN else
             [("Blender","blender"), ("Terminal","xterm"), ("Terminal","xfce4-terminal"),
              ("GIMP","gimp"), ("Inkscape","inkscape"), ("Arquivos","pcmanfm"),
              ("Arquivos","thunar"), ("Navegador","firefox"), ("Navegador","chromium"),
              ("Editor","mousepad"), ("Editor","geany"), ("Calculadora","galculator"),
              ("Wine","wine")])
    out = []
    vistos = set()
    for nome, b in cands:
        if nome in vistos: continue
        if WIN:
            if "*" in b or "\\" in b:
                r = sh("Test-Path (Resolve-Path '%s' -EA SilentlyContinue|Select -First 1)" % b, 15)
                if "True" not in (r["out"] or ""): continue
            elif not shutil.which(b): continue
        else:
            if not tem(b): continue
        out.append({"nome": nome, "bin": b}); vistos.add(nome)
    return out

def abrir_app(b):
    if WIN:
        return sh("Start-Process '%s'" % b.replace("'","''"), 30)
    if not TELA.ok: return {"ok": False, "erro": "sessao grafica nao esta no ar"}
    subprocess.Popen(["bash","-lc", b], env=dict(os.environ, DISPLAY=DISP),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT)
    return {"ok": True, "aberto": b}

# ---------------------------------------------------------------- ARQUIVOS
def listar(p):
    p = os.path.abspath(p or ROOT)
    if not os.path.isdir(p): return {"ok": False, "erro": "nao e pasta"}
    it = []
    try:
        for n in sorted(os.listdir(p))[:400]:
            f = os.path.join(p, n)
            try: it.append({"nome": n, "dir": os.path.isdir(f), "b": os.path.getsize(f) if os.path.isfile(f) else 0})
            except Exception: pass
    except PermissionError: return {"ok": False, "erro": "sem permissao"}
    return {"ok": True, "path": p, "itens": it, "pai": os.path.dirname(p)}

# ---------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _j(self, o, code=200):
        b = json.dumps(o).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def _bin(self, b, mime):
        self.send_response(200); self._cors()
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    # ---------------- WebSocket ----------------
    def _para_ws(self, q):
        """canal=frames: empurra JPEG da tela (sem uma requisicao por foto).
        canal=input: recebe os eventos de mouse/teclado pelo mesmo socket —
        toque na tela deixa de custar um POST por evento."""
        if not TEM_WS:
            return self._j({"ok": False, "erro": "ws_min.py nao esta na pasta do DsOS — "
                                                "o site usa o modo antigo (polling)"}, 501)
        if not ws_min.aceitar(self):
            return self._j({"ok": False, "erro": "nao e um pedido websocket"}, 400)
        canal = (q.get("canal") or ["frames"])[0]
        sock = self.connection
        try:
            if canal == "frames":
                self._ws_frames(sock, q)
            elif canal == "input":
                self._ws_input(sock)
            else:
                ws_min.manda_json(sock, {"t": "erro", "v": "canal desconhecido: " + canal})
        except Exception as ex:
            try:
                ws_min.manda_json(sock, {"t": "erro", "v": "%s: %s" % (type(ex).__name__, ex)})
            except Exception:
                pass
        try:
            ws_min.fechar(sock)
            self.close_connection = True
        except Exception:
            pass

    def _ws_frames(self, sock, q):
        def num(chave, padrao, lo, hi):
            try:
                return max(lo, min(hi, float((q.get(chave) or [padrao])[0])))
            except Exception:
                return padrao
        opts = {"q": int(num("q", 55, 10, 95)), "s": int(num("s", 100, 10, 100)),
                "fps": num("fps", 10, 1, 30)}
        buf = b""
        prox = 0.0
        while True:
            op, d, buf = ws_min.ler_controle(sock, buf)
            if op is None or op == ws_min.OP_CLOSE:
                return
            if op == ws_min.OP_TXT and isinstance(d, dict):
                if "q" in d: opts["q"] = int(max(10, min(95, float(d["q"]))))
                if "s" in d: opts["s"] = int(max(10, min(100, float(d["s"]))))
                if "fps" in d: opts["fps"] = max(1.0, min(30.0, float(d["fps"])))
            agora = time.time()
            if agora < prox:
                time.sleep(min(0.02, prox - agora))
                continue
            if not WIN and not TELA.ok:
                if not ws_min.manda_json(sock, {"t": "erro",
                                                "v": "sessao grafica desligada — clique em Ligar DsOS"}):
                    return
                time.sleep(1.5)
                prox = time.time() + 1.5
                continue
            try:
                b, mime = TELA.frame(opts["q"], opts["s"])
                if len(b) < 100:
                    raise RuntimeError("captura vazia")
                if not ws_min.manda(sock, b, ws_min.OP_BIN):
                    return
            except Exception as ex:
                if not ws_min.manda_json(sock, {"t": "erro", "v": str(ex)[:300]}):
                    return
                time.sleep(1.0)
            prox = time.time() + 1.0 / max(1.0, opts["fps"])

    def _ws_input(self, sock):
        """Eventos chegam como {"eventos":[{t:tap,...}]} ou {"t":...} solto."""
        buf = b""
        while True:
            op, d, buf = ws_min.ler_controle(sock, buf)
            if op is None or op == ws_min.OP_CLOSE:
                return
            if op != ws_min.OP_TXT or d is None:
                time.sleep(0.02)
                continue
            evs = d.get("eventos") if isinstance(d, dict) else None
            if evs is None:
                evs = [d] if isinstance(d, dict) else []
            res = []
            for e in evs[:20]:
                try:
                    res.append(TELA.entrada(e))
                except Exception as ex:
                    res.append({"ok": False, "erro": str(ex)[:200]})
            ws_min.manda_json(sock, {"ok": all(r.get("ok") for r in res) if res else False, "res": res})

    def do_OPTIONS(self):
        self.send_response(204); self._cors()
        self.send_header("Content-Length","0"); self.end_headers()

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query); r = u.path.rstrip("/") or "/"
        if r == "/ws":
            try:
                self._para_ws(q)
            except Exception:
                pass
            return
        try:
            if r in ("/", "/health"):
                return self._j({"ok": True, "dsos": True, "versao": "1.0",
                                "tela": TELA.ok, "hw": hw()})
            if r == "/sys":     return self._j({"ok": True, "hw": hw()})
            if r == "/cursor":
                pos = TELA.ponteiro()
                return self._j({"ok": bool(pos), "escala": getattr(TELA, "escala", 100),
                                "x": (pos or (None, None))[0], "y": (pos or (None, None))[1]})
            if r == "/frame":
                if not WIN and not TELA.ok:
                    return self._j({"ok": False, "erro": "sessao grafica desligada — clique em Ligar DsOS"}, 503)
                try:
                    b, m = TELA.frame(int(q.get("q",["55"])[0]), int(q.get("s",["100"])[0]))
                    return self._bin(b, m)
                except Exception as ex:
                    return self._j({"ok": False, "erro": str(ex)}, 503)
            if r == "/compat":  return self._j({"ok": True, "compat": compat()})
            if r == "/servicos": return self._j({"ok": True, "servicos": servicos(),
                                                 "audio": audio(), "rede": rede()})
            if r == "/capacidades":
                h = hw(); c = compat()
                return self._j({"ok": True, "hw": h, "compat": c, "audio": audio(),
                                "tela": TELA.ok,
                                "captura": bool(WIN or (TELA.ok and (tem("ffmpeg") or tem("import") or tem("scrot")))),
                                "entrada": bool(WIN or (TELA.ok and tem("xdotool"))),
                                "gpu_compute": bool(h.get("cuda"))})
            if r == "/janelas":  return self._j({"ok": True, "janelas": janelas()})
            if r == "/procs":    return self._j({"ok": True, "procs": processos()})
            if r == "/apps":     return self._j({"ok": True, "apps": apps_instalados()})
            if r == "/fs":       return self._j(listar(q.get("p",[ROOT])[0]))
            if r == "/job":
                with LOCK: return self._j(JOBS.get(q.get("id",[""])[0], {"erro":"nao existe"}))
            return self._j({"erro":"rota desconhecida"}, 404)
        except Exception as ex:
            return self._j({"ok": False, "erro": str(ex)}, 500)

    def do_POST(self):
        u = urlparse(self.path); r = u.path.rstrip("/") or "/"
        n = int(self.headers.get("Content-Length") or 0)
        try: body = json.loads(self.rfile.read(n) or b"{}")
        except Exception: body = {}
        try:
            if r == "/boot":   return self._j(TELA.subir())
            if r == "/input":
                evs = body.get("eventos") or [body]
                return self._j({"ok": True, "res": [TELA.entrada(e) for e in evs[:20]]})
            if r == "/exec":
                return self._j(sh(body.get("cmd",""), int(body.get("timeout",120))))
            if r == "/abrir":  return self._j(abrir_app(body.get("bin","")))
            if r == "/matar":
                p = int(body.get("pid",0))
                return self._j(sh(("Stop-Process -Id %d -Force" % p) if WIN else ("kill -9 %d" % p), 15))
            if r == "/res":
                global W,H
                W,H = int(body.get("w",W)), int(body.get("h",H))
                if not WIN and tem("xrandr"):
                    sh("DISPLAY=%s xrandr --fb %dx%d" % (DISP,W,H), 15)
                return self._j({"ok": True, "res": "%dx%d" % (W,H)})
            return self._j({"erro":"rota desconhecida"}, 404)
        except Exception as ex:
            return self._j({"ok": False, "erro": str(ex)}, 500)

if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    print("[DsOS] backend:", hw().get("backend"), "| root:", ROOT, flush=True)
    if os.environ.get("DSOS_AUTOBOOT","1") == "1":
        print("[DsOS] sessao grafica:", TELA.subir(), flush=True)
    print("[DsOS] ouvindo na porta", PORT, flush=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    srv.daemon_threads = True
    srv.serve_forever()
