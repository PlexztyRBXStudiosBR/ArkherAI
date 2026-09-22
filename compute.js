/* DsOS Compute Manager — item 17 da spec.
   Conhece todos os backends, mede o que cada um REALMENTE tem, e decide
   onde cada tarefa roda. Nenhum valor fixo: tudo vem de /capacidades. */
(function () {
  const CM = {};
  const _ls = () => (typeof LS !== 'undefined' ? LS : (window.LS || null));
  const LSg = (k, d) => { const s = _ls(); return s ? s.get(k, d) : d; };
  const LSs = (k, v) => { const s = _ls(); if (s) s.set(k, v); };

  /* backends sao dados, nao codigo: somar um novo = uma linha aqui ou pela UI */
  const PADRAO = [
    { id: 'local',   nome: 'Este dispositivo', tipo: 'browser', url: '' },
    { id: 'kaggle',  nome: 'Kaggle',           tipo: 'dsos',    url: '' },
    { id: 'windows', nome: 'PC Windows (GitHub)', tipo: 'dsos', url: '' }
  ];

  CM.lista = () => {
    const salvo = LSg('dsos_backends', null);
    if (salvo && salvo.length) return salvo;
    return PADRAO.slice();
  };
  CM.salvar = l => LSs('dsos_backends', l);
  CM.add = (nome, url, tipo) => {
    const l = CM.lista();
    l.push({ id: 'b' + Date.now().toString(36), nome, url: (url || '').replace(/\/+$/, ''), tipo: tipo || 'dsos' });
    CM.salvar(l); return l;
  };
  CM.remover = id => { const l = CM.lista().filter(b => b.id !== id); CM.salvar(l); return l; };
  CM.setUrl = (id, url) => {
    const l = CM.lista(); const b = l.find(x => x.id === id);
    if (b) { b.url = (url || '').replace(/\/+$/, ''); CM.salvar(l); } return l;
  };

  CM.estado = {};   // id -> {online, cap, erro, quando}

  async function sondar(b) {
    if (b.tipo === 'browser') {
      const n = navigator;
      return {
        online: true,
        cap: {
          hw: { cpu: 'navegador', cpu_cores: n.hardwareConcurrency || null,
                ram_gb: n.deviceMemory || null, gpu: null, vram_mb: null,
                cuda: false, os: n.platform || '?', backend: 'local' },
          compat: { linux: { ok: false }, windows: { ok: false }, android: { ok: false } },
          tela: false, captura: false, entrada: false, gpu_compute: false
        }
      };
    }
    if (!b.url) return { online: false, erro: 'sem endereco' };
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(b.url + '/capacidades', { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { online: true, cap: await r.json() };
    } catch (e) {
      return { online: false, erro: e.name === 'AbortError' ? 'sem resposta' : e.message };
    } finally { clearTimeout(t); }
  }

  CM.sondarTodos = async function () {
    const l = CM.lista();
    const res = await Promise.all(l.map(async b => {
      const s = await sondar(b);
      s.quando = Date.now();
      CM.estado[b.id] = s;
      return Object.assign({}, b, s);
    }));
    return res;
  };

  /* ---- catalogo de tarefas: o que cada uma EXIGE ---- */
  CM.tarefas = {
    'roblox-studio': { nome: 'Roblox Studio', os: 'windows', gui: true, wine: false,
      nota: 'aplicativo Windows; nao roda em Linux nem sob Wine (anticheat)' },
    'blender-gui':   { nome: 'Blender (interativo)', gui: true },
    'blender-render':{ nome: 'Blender (render)', gui: false, prefereGpu: true },
    'ia-3d':         { nome: 'Gerar 3D com IA', gui: false, gpu: false, prefereGpu: true,
      nota: 'com GPU (TripoSR) fica rapido; sem GPU o Shap-E roda na CPU — devagar' },
    'treino-ia':     { nome: 'Treinar modelo', gui: false, gpu: true },
    'terminal':      { nome: 'Terminal', gui: false },
    'build':         { nome: 'Compilar projeto', gui: false },
    'chat':          { nome: 'Chat com IA', gui: false, local: true },
    'android-app':   { nome: 'App Android', android: true,
      nota: 'exige runtime Android (Waydroid/Anbox) no backend' }
  };

  /* ---- decisao: pontua cada backend para a tarefa ---- */
  CM.rotear = function (tarefaId, preferido) {
    const t = CM.tarefas[tarefaId];
    if (!t) return { ok: false, motivo: 'tarefa desconhecida: ' + tarefaId };
    const cands = [];
    for (const b of CM.lista()) {
      const st = CM.estado[b.id];
      if (!st || !st.online) { cands.push({ b, pontos: -1, por: 'offline' }); continue; }
      const c = st.cap || {}; const h = c.hw || {}; const cp = c.compat || {};
      const falhas = [];
      if (t.local && b.tipo !== 'browser') falhas.push('roda no proprio navegador');
      if (!t.local && b.tipo === 'browser') falhas.push('navegador nao executa isso');
      if (t.os === 'windows') {
        const w = cp.windows || {};
        if (!w.ok) falhas.push('sem compatibilidade Windows');
        else if (w.via === 'wine' && t.wine === false)
          falhas.push('Wine nao serve para este app');
      }
      if (t.gui && !c.tela) falhas.push('sem sessao grafica');
      if (t.gui && !c.captura) falhas.push('sem captura de tela');
      if (t.gpu && !c.gpu_compute) falhas.push('sem GPU CUDA');
      if (t.android && !(cp.android || {}).ok) falhas.push('sem runtime Android');
      if (falhas.length) { cands.push({ b, pontos: -1, por: falhas.join(' · ') }); continue; }

      let p = 10;
      if (h.cuda) p += 60;
      if (h.gpu) p += 20;
      if (t.prefereGpu && h.cuda) p += 40;
      p += Math.min(64, h.ram_gb || 0);
      p += Math.min(32, (h.cpu_cores || 0) * 2);
      if (b.tipo === 'browser') p += 25;
      if (preferido && b.id === preferido) p += 1000;
      cands.push({ b, pontos: p, por: 'compativel' });
    }
    const bons = cands.filter(c => c.pontos >= 0).sort((a, z) => z.pontos - a.pontos);
    if (!bons.length) {
      return { ok: false, tarefa: t.nome, motivo: 'nenhum backend compativel',
               nota: t.nota || null, detalhe: cands.map(c => c.b.nome + ': ' + c.por) };
    }
    if (preferido) {
      const pf = cands.find(c => c.b.id === preferido);
      if (pf && pf.pontos < 0) {
        return { ok: false, tarefa: t.nome,
                 motivo: 'o backend escolhido nao serve: ' + pf.por,
                 alternativa: bons[0].b.nome, nota: t.nota || null };
      }
    }
    return { ok: true, tarefa: t.nome, backend: bons[0].b, pontos: bons[0].pontos,
             outros: bons.slice(1).map(c => c.b.nome) };
  };

  /* ---- execucao distribuida (item 16): partes diferentes em backends diferentes ---- */
  CM.distribuir = function (partes) {
    return partes.map(p => {
      const r = CM.rotear(p.tarefa, p.backend);
      return { parte: p.nome || p.tarefa, tarefa: p.tarefa,
               destino: r.ok ? r.backend.nome : null,
               id: r.ok ? r.backend.id : null,
               ok: r.ok, motivo: r.ok ? null : r.motivo };
    });
  };

  /* resumo honesto pra UI */
  CM.resumo = function (id) {
    const st = CM.estado[id];
    if (!st) return 'nao sondado';
    if (!st.online) return 'offline — ' + (st.erro || '?');
    const h = (st.cap || {}).hw || {};
    const p = [];
    if (h.cpu) p.push(String(h.cpu).replace(/\(R\)|\(TM\)|CPU|Processor/g, '').trim() +
                      (h.cpu_cores ? ' x' + h.cpu_cores : ''));
    if (h.ram_gb) p.push(h.ram_gb + ' GB');
    p.push(h.gpu ? h.gpu + (h.vram_mb ? ' (' + (h.vram_mb / 1024).toFixed(0) + ' GB)' : '') : 'sem GPU');
    if (h.disco_livre_gb) p.push(h.disco_livre_gb + ' GB livres');
    return p.join(' · ');
  };

  window.CM = CM;
  if (typeof module !== 'undefined' && module.exports) module.exports = CM;
})();
