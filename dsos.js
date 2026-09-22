/* ============================================================
   DsOS — Hybrid Compute Operating Environment
   Nucleo: Backends, Capability Detector, Compute Router, Projects.
   NAO e uma VM. E a camada que escolhe ONDE cada tarefa roda.
   Regra de ouro: nunca inventar hardware. Sempre detectar.
   ============================================================ */
(function () {
  const D = {};
  D.versao = '1.0';

  /* ---------- BACKENDS (providers) ----------
     Cada provider implementa a mesma interface:
     id, nome, os, detect() -> caps, exec(cmd), disponivel  */

  const Providers = {};

  /* ---- 1. LOCAL (o navegador do usuario) ---- */
  Providers.local = {
    id: 'local', nome: 'Este dispositivo', os: navegadorOS(),
    remoto: false,
    async detect() {
      const c = {
        os: navegadorOS(), gui: true, remote: false,
        cpu_count: (navigator.hardwareConcurrency || 0),
        ram_gb: (navigator.deviceMemory || 0),
        gpu: gpuDoNavegador(), cuda: false,
        // o navegador NAO executa binarios nativos
        nativo: false, disco_gb: 0, sessao_min: Infinity,
      };
      c.ok = true;
      return c;
    },
    async exec() { throw new Error('o navegador nao executa binarios nativos'); },
  };

  function navegadorOS() {
    const u = (navigator.userAgent || '').toLowerCase();
    if (/android/.test(u)) return 'android';
    if (/iphone|ipad/.test(u)) return 'ios';
    if (/windows/.test(u)) return 'windows';
    if (/mac os/.test(u)) return 'macos';
    if (/linux/.test(u)) return 'linux';
    return 'desconhecido';
  }
  function gpuDoNavegador() {
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
      if (!gl) return null;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL';
    } catch (e) { return null; }
  }

  /* ---- fabrica de providers HTTP (agent.py em qualquer maquina) ---- */
  function agentProvider(id, nome, chaveLS, osEsperado) {
    return {
      id: id, nome: nome, os: osEsperado, remoto: true,
      url() { return LS.get(chaveLS, ''); },
      async detect() {
        const u = this.url();
        if (!u) return { ok: false, motivo: 'nao configurado' };
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        try {
          const r = await fetch(u.replace(/\/$/, '') + '/health', { signal: ctl.signal });
          const j = await r.json();
          // SO REAL reportado pela maquina, nao o que eu esperava
          const osTxt = String(j.os || '').toLowerCase();
          const so = (j.host === 'kaggle') ? 'linux'
                   : /windows/.test(osTxt) ? 'windows'
                   : /android/.test(osTxt) || j.termux ? 'android'
                   : /linux/.test(osTxt) ? 'linux'
                   : (osTxt || osEsperado);
          const gpuTxt = j.gpu && !/sem gpu/i.test(j.gpu) ? j.gpu : null;
          return {
            ok: true, os: so, gui: so === 'windows' || !!j.display,
            remote: true, nativo: true,
            cpu: j.cpu || '', cpu_count: j.cpu_count || 0,
            ram_gb: parseFloat(j.ram_gb) || 0, disco_gb: j.disk_free_gb || j.disk_gb || 0,
            gpu: gpuTxt, vram_gb: j.vram_gb || null,
            cuda: !!gpuTxt && /nvidia|tesla|t4|p100|a100|rtx|gtx/i.test(gpuTxt),
            host: j.host || '', bruto: j,
          };
        } catch (e) {
          const https = location.protocol === 'https:' && /^http:\/\//i.test(u);
          return { ok: false, motivo: e.name === 'AbortError'
            ? (https ? 'bloqueado (HTTP x HTTPS)' : 'sem resposta') : (e.message || 'offline') };
        } finally { clearTimeout(t); }
      },
      async exec(cmd, timeout) {
        const u = this.url();
        if (!u) throw new Error(nome + ': nao configurado');
        const r = await fetch(u.replace(/\/$/, '') + '/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: cmd, timeout: timeout || 600 }),
        });
        const j = await r.json();
        return (j.out || '') + (j.err ? '\n' + j.err : '');
      },
      async spawn(cmd) {
        const u = this.url();
        const r = await fetch(u.replace(/\/$/, '') + '/spawn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: cmd }),
        });
        return (await r.json()).id;
      },
    };
  }

  Providers.windows = agentProvider('windows', 'Windows Cloud (GitHub)', 'arkher_agent', 'windows');
  Providers.kaggle  = agentProvider('kaggle',  'Linux GPU (Kaggle)',     'arkher_kaggle', 'linux');
  Providers.android = agentProvider('android', 'Android (Termux)',       'arkher_droid',  'android');

  D.providers = Providers;
  D.lista = function () { return Object.keys(Providers).map(k => Providers[k]); };

  /* ---------- CACHE DE CAPACIDADES ---------- */
  const caps = {}; let quando = 0;

  D.detectarTudo = async function (forcar) {
    if (!forcar && Date.now() - quando < 30000 && Object.keys(caps).length) return caps;
    const ids = Object.keys(Providers);
    const res = await Promise.all(ids.map(i => Providers[i].detect().catch(e => ({ ok: false, motivo: e.message }))));
    ids.forEach((i, n) => { caps[i] = res[n]; caps[i].id = i; caps[i].nome = Providers[i].nome; });
    quando = Date.now();
    return caps;
  };
  D.caps = function () { return caps; };

  /* ---------- REGISTRY DE APLICATIVOS ----------
     Cada app DECLARA o que precisa. O router usa isso. */
  D.apps = {
    'roblox-studio': {
      nome: 'Roblox Studio', icone: 'i-cube',
      req: { os: ['windows'], gui: true, nativo: true, ram_gb: 4 },
      abrir: { tipo: 'pilot', alvo: 'roblox' },
      nota: 'Aplicacao Windows. Exige sessao grafica e login manual na conta Roblox.',
    },
    'blender-gui': {
      nome: 'Blender (interativo)', icone: 'i-cube',
      req: { os: ['windows', 'linux'], gui: true, nativo: true, ram_gb: 8 },
      abrir: { tipo: 'pilot', alvo: 'blender' },
      nota: 'Modo A: janela remota. Precisa de sessao grafica no backend.',
    },
    'blender-render': {
      nome: 'Blender (render em lote)', icone: 'i-spark',
      req: { os: ['windows', 'linux'], gui: false, nativo: true, gpu: false, ram_gb: 4 },
      abrir: { tipo: 'cmd', alvo: 'blender -b "{arquivo}" -o "{saida}" -a' },
      nota: 'Modo B: headless. Nao precisa de tela — roda em qualquer backend nativo.',
    },
    'unreal': {
      nome: 'Unreal Engine', icone: 'i-cube',
      req: { os: ['windows'], gui: true, nativo: true, gpu: true, ram_gb: 16, disco_gb: 100 },
      abrir: { tipo: 'pilot', alvo: 'unreal' },
      nota: 'Requisito pesado. Se nenhum backend atender, o DsOS avisa em vez de fingir.',
    },
    'ia-3d': {
      nome: 'Gerar 3D (IA)', icone: 'i-cube',
      req: { os: ['linux', 'windows'], gui: false, nativo: true, gpu: true, cuda: true },
      abrir: { tipo: 'tool', alvo: 'gerar_3d' },
      nota: 'TripoSR (imagem->3D) com GPU ou Shap-E (texto->3D) na CPU. Sem GPU e lento.',
    },
    'ia-imagem': {
      nome: 'Gerar imagem (IA)', icone: 'i-spark',
      req: { os: [], gui: false, nativo: false },
      abrir: { tipo: 'tool', alvo: 'gerar_imagem' },
      nota: 'Vai por API — nao precisa de backend nativo.',
    },
    'terminal': {
      nome: 'Terminal', icone: 'i-term',
      req: { os: [], gui: false, nativo: true },
      abrir: { tipo: 'term' },
      nota: 'Shell do backend escolhido: PowerShell no Windows, bash no Linux.',
    },
    'arquivos': {
      nome: 'Arquivos', icone: 'i-folder',
      req: { os: [], gui: false, nativo: true },
      abrir: { tipo: 'files' },
      nota: 'Navega no disco do backend ativo.',
    },
    'chat-ia': {
      nome: 'Chat IA', icone: 'i-chat',
      req: { os: [], gui: false, nativo: false },
      abrir: { tipo: 'aba', alvo: 'chat' },
      nota: 'Nao precisa de backend: roda pela cascata de modelos.',
    },
    'navegador': {
      nome: 'Pesquisa web', icone: 'i-cloud',
      req: { os: [], gui: false, nativo: false },
      abrir: { tipo: 'tool', alvo: 'buscar_web' },
      nota: 'Busca e leitura de paginas.',
    },
  };

  /* ---------- CAPABILITY DETECTOR ----------
     backend atende o app? devolve {ok, faltou:[...]} */
  D.compativel = function (app, cap) {
    const r = app.req || {}, faltou = [];
    if (!cap || !cap.ok) return { ok: false, faltou: ['backend offline'] };
    if (r.os && r.os.length && r.os.indexOf(cap.os) < 0) faltou.push('SO ' + r.os.join('/'));
    if (r.nativo && !cap.nativo) faltou.push('execucao nativa');
    if (r.gui && !cap.gui) faltou.push('sessao grafica');
    if (r.gpu && !cap.gpu) faltou.push('GPU');
    if (r.cuda && !cap.cuda) faltou.push('CUDA');
    if (r.ram_gb && cap.ram_gb && cap.ram_gb < r.ram_gb) faltou.push(r.ram_gb + 'GB RAM');
    if (r.disco_gb && cap.disco_gb && cap.disco_gb < r.disco_gb) faltou.push(r.disco_gb + 'GB disco');
    return { ok: !faltou.length, faltou: faltou };
  };

  /* ---------- COMPUTE ROUTER ----------
     decide ONDE rodar. Explica o porque (sem caixa-preta). */
  D.rotear = async function (appId, prefer) {
    const app = typeof appId === 'string' ? D.apps[appId] : appId;
    if (!app) return { ok: false, err: 'app desconhecido: ' + appId };
    const c = await D.detectarTudo();

    // pontuacao: GPU/CUDA quando pedido, RAM, e preferencia por local (menos latencia)
    const nota = (id, cap) => {
      let s = 100;
      if (app.req.gpu && cap.cuda) s += 60;
      if (app.req.gpu && cap.gpu) s += 20;
      s += Math.min(cap.ram_gb || 0, 64);
      s += Math.min((cap.cpu_count || 0) * 2, 32);
      if (!cap.remote) s += 25;               // local e mais rapido de responder
      if (id === prefer) s += 1000;           // escolha manual manda
      return s;
    };

    const analise = [];
    let melhor = null;
    // escolha manual: respeita, mas avisa se o backend nao atende
    if (prefer && c[prefer]) {
      const comp = D.compativel(app, c[prefer]);
      if (!comp.ok) {
        return { ok: false, app: app, forcado: prefer,
          err: (c[prefer].nome || prefer) + ' nao atende "' + app.nome + '": falta ' +
               comp.faltou.join(', ') + '. Use o modo automatico ou outro backend.' };
      }
    }
    for (const id of Object.keys(c)) {
      const cap = c[id];
      const comp = D.compativel(app, cap);
      const item = { id: id, nome: cap.nome || id, ok: comp.ok,
                     faltou: comp.faltou, nota: comp.ok ? nota(id, cap) : -1, cap: cap };
      analise.push(item);
      if (comp.ok && (!melhor || item.nota > melhor.nota)) melhor = item;
    }
    analise.sort((a, b) => b.nota - a.nota);

    if (!melhor) {
      return { ok: false, app: app, analise: analise,
        err: 'Nenhum backend atende "' + app.nome + '". Faltou: ' +
             analise.map(a => a.nome + ' (' + a.faltou.join(', ') + ')').join(' · ') };
    }
    return { ok: true, app: app, backend: melhor.id, cap: melhor.cap,
             provider: Providers[melhor.id], analise: analise };
  };

  /* roda um comando no backend escolhido pelo router */
  D.executar = async function (appId, cmd, prefer) {
    const r = await D.rotear(appId, prefer);
    if (!r.ok) throw new Error(r.err);
    const out = await r.provider.exec(cmd);
    return { backend: r.backend, out: out };
  };

  /* ---------- PROJETOS ---------- */
  D.projetos = {
    todos() { return LS.get('dsos_projetos', []); },
    criar(nome, tipo) {
      const l = this.todos();
      if (l.some(p => p.nome === nome)) return { ok: false, err: 'ja existe' };
      const p = { id: 'p' + Date.now().toString(36), nome: nome, tipo: tipo || 'custom',
                  criado: Date.now(), backend: null, arquivos: [], logs: [] };
      l.push(p); LS.set('dsos_projetos', l);
      try { if (window.Sync && Sync.set) Sync.set('dsos_projetos', l); } catch (e) {}
      return { ok: true, projeto: p };
    },
    remover(id) {
      const l = this.todos().filter(p => p.id !== id);
      LS.set('dsos_projetos', l);
      try { if (window.Sync && Sync.set) Sync.set('dsos_projetos', l); } catch (e) {}
    },
    caminho(p, backend) {
      const base = backend === 'windows' ? 'C:\\arkher_state\\work\\' : '/kaggle/working/';
      return base + 'Projects/' + (p.tipo || 'Custom') + '/' + p.nome;
    },
    /* migra um projeto de um backend pro outro via tar + base64 */
    async migrar(p, de, para, onLog) {
      const log = onLog || function () {};
      const A = Providers[de], B = Providers[para];
      if (!A || !B) throw new Error('backend invalido');
      const cA = D.caps()[de], cB = D.caps()[para];
      if (!cA || !cA.ok) throw new Error(de + ' offline');
      if (!cB || !cB.ok) throw new Error(para + ' offline');
      const src = this.caminho(p, de), dst = this.caminho(p, para);
      log('empacotando em ' + de + '…');
      const cmdTar = cA.os === 'windows'
        ? `powershell -c "Compress-Archive -Path '${src}\\*' -DestinationPath '$env:TEMP\\mig.zip' -Force; [Convert]::ToBase64String([IO.File]::ReadAllBytes(\\"$env:TEMP\\mig.zip\\"))"`
        : `cd "${src}" && tar czf /tmp/mig.tgz . && base64 -w0 /tmp/mig.tgz`;
      const b64 = (await A.exec(cmdTar, 300)).trim().split('\n').pop();
      if (!b64 || b64.length < 16) throw new Error('nada pra migrar em ' + src);
      log('enviando ' + Math.round(b64.length / 1365) + ' KB para ' + para + '…');
      const cmdPut = cB.os === 'windows'
        ? `powershell -c "New-Item -ItemType Directory -Force -Path '${dst}'|Out-Null; [IO.File]::WriteAllBytes(\\"$env:TEMP\\mig.zip\\",[Convert]::FromBase64String('${b64}')); Expand-Archive -Path \\"$env:TEMP\\mig.zip\\" -DestinationPath '${dst}' -Force"`
        : `mkdir -p "${dst}" && echo '${b64}' | base64 -d > /tmp/mig.tgz && tar xzf /tmp/mig.tgz -C "${dst}"`;
      await B.exec(cmdPut, 300);
      log('pronto em ' + dst);
      return { ok: true, destino: dst };
    },
  };

  /* ---------- texto de status honesto ---------- */
  D.resumo = function (cap) {
    if (!cap || !cap.ok) return cap && cap.motivo ? cap.motivo : 'offline';
    const p = [];
    if (cap.cpu_count) p.push(cap.cpu_count + ' nucleos');
    if (cap.ram_gb) p.push(cap.ram_gb + ' GB');
    p.push(cap.gpu ? cap.gpu.slice(0, 28) + (cap.cuda ? ' (CUDA)' : '') : 'sem GPU');
    if (cap.gui) p.push('com tela');
    return p.join(' · ');
  };

  if (typeof window !== 'undefined') window.DsOS = D;
  if (typeof module !== 'undefined') module.exports = D;
})();
