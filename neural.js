/* ============================================================
   ARKHER — NEURAL (armazenamento neural + treino)
   ============================================================

   O que este arquivo e, sem enrolacao:

   1) MEMORIA VETORIAL (RAG de verdade)
      Tudo que entra (o pacote de conhecimento, o que voce colar, o
      que a IA aprendeu na conversa) e cortado em pedacos, virou vetor
      e fica pesquisavel por SIGNIFICADO, nao por palavra exata.
      Três caminhos de vetorizacao, na ordem:
        a) no com GPU   -> /infer tarefa=embed (de graca, dim grande)
        b) HF router    -> feature-extraction do MiniLM (rapido, gratis)
        c) local        -> hashing de palavras+bigramas (SEMPRE funciona,
                           inclusive offline; e o piso que nunca falha)
      Se (a) e (b) cairem, a busca continua funcionando em (c) + palavra.

   2) APRENDIZADO AUTOMATICO
      Toda resposta boa vira uma licao (o par pergunta/resposta fica
      guardado como dado de treino) e, quando juntam licoes suficientes,
      o "Destilar" comprime tudo em REGRAS que entram fixas no prompt
      de sistema. Isso e aprendizado continuo sem precisar de GPU.

   3) TREINO COM PESOS (o de verdade)
      "Exportar dataset" gera JSONL no formato que o trl/unsloth comem.
      Manda pro no com GPU (POST /treinar) e ele treina um LoRA. Depois
      o proprio no passa a responder com esse modelo (modelo: "local:<nome>").

   O que este arquivo NAO e: nao e "modelo treinando sozinho no seu
   navegador". O navegador nao treina peso — ele guarda, busca e manda
   o dataset pra quem tem GPU. Quem diz o contrario esta mentindo.
   ============================================================ */
'use strict';
(function () {
  if (typeof LS === 'undefined' && typeof require !== 'undefined') {
    globalThis.LS = require('./core.js').LS;
  }

  const KEY = 'arkher_cerebro_v1';      // texto (sincronizavel, sem vetor)
  const VKEY = 'arkher_cerebro_vec_v1'; // vetores (local: pesado, nao sincroniza)
  const EMB_HF = 'sentence-transformers/all-MiniLM-L6-v2';
  const DIM_LOCAL = 384;

  const N = {
    pronto: false,
    cfg: { auto: true, usarHF: true, usarGPU: true, preferencias: true, k: 6, max: 1500, tetoTreino: 4000 },
    itens: [], regras: [], treino: [], prefs: [], vistos: {},
    vecs: {},      // id -> {v:[], dim, via}
    stats: { add: 0, busca: 0, acerto: 0, licoes: 0, vetoresHF: 0, vetoresGPU: 0, vetoresLocal: 0 },
  };

  /* ---------------- base ---------------- */
  const agora = () => Date.now();
  const carrega = () => {
    try {
      const d = LS.get(KEY, null);
      if (d) {
        N.itens = d.itens || []; N.regras = d.regras || []; N.treino = d.treino || []; N.prefs = d.prefs || [];
        N.vistos = d.vistos || {}; N.stats = Object.assign(N.stats, d.stats || {});
        if (d.cfg) N.cfg = Object.assign(N.cfg, d.cfg);
      }
      N.vecs = LS.get(VKEY, {}) || {};
    } catch (e) { /* storage corrompido: comeca limpo */ }
  };
  let _timer = null;
  const salva = (ja) => {
    try { LS.set(KEY, { itens: N.itens, regras: N.regras, treino: N.treino, prefs: N.prefs, vistos: N.vistos, stats: N.stats, cfg: N.cfg, t: agora() }); } catch (e) {}
    if (ja) { try { LS.set(VKEY, N.vecs); } catch (e) {} return; }
    if (_timer) return;
    _timer = setTimeout(() => { _timer = null; try { LS.set(VKEY, N.vecs); } catch (e) {} }, 1500);
  };

  /* ---------------- texto -> pedacos ---------------- */
  N.chunk = function (txt, max, sobre) {
    max = max || 900; sobre = sobre || 120;
    const limpo = String(txt || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
    if (limpo.length <= max) return limpo ? [limpo] : [];
    const partes = [];
    // corta em paragrafo, depois em frase, so quebra no meio se nao houver escolha
    const paras = limpo.split(/\n{2,}|(?<=\.)\s+(?=[A-ZÀ-Ú])/);
    let atual = '';
    for (const p of paras) {
      if ((atual + ' ' + p).length <= max) { atual = (atual ? atual + ' ' : '') + p; continue; }
      if (atual) partes.push(atual);
      if (p.length <= max) { atual = p; continue; }
      for (let i = 0; i < p.length; i += max - sobre) partes.push(p.slice(i, i + max));
      atual = '';
    }
    if (atual) partes.push(atual);
    return partes.filter(x => x.trim().length > 20);
  };

  /* ---------------- vetor local (nunca falha) ----------------
     hashing de palavras + bigramas + trigramas de caractere, com
     "idf" simples por frequencia. Nao e o MiniLM, mas funciona
     offline e ordena por assunto igual.                              */
  const STOP = new Set(('a o e de da do das dos em no na nos nas um uma para por com sem que q ' +
    'se ao aos as os eh é sao são ser esta está estao estão foi era como mais menos muito pouco ' +
    'the of and to in is are for on with that this it be as at or by an').split(/\s+/));
  function fnv(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }
  N.tokens = function (t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_$#./-]+/g, ' ').split(/\s+/).filter(x => x.length > 2 && !STOP.has(x));
  };
  N.vetorLocal = function (txt) {
    const v = new Float64Array(DIM_LOCAL);
    const tk = N.tokens(txt);
    const pesa = (chave, w) => { const i = fnv(chave) % DIM_LOCAL; v[i] += w * (fnv(chave + '#s') % 2 ? 1 : -1); };
    for (const t of tk) {
      pesa(t, 1);
      for (let i = 0; i < t.length - 3; i++) pesa(t.slice(i, i + 4), 0.35);   // erro de digitacao
    }
    for (let i = 0; i < tk.length - 1; i++) pesa(tk[i] + '_' + tk[i + 1], 0.6);
    let n = 0; for (let i = 0; i < DIM_LOCAL; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    return Array.from(v, x => x / n);
  };
  const cos = (a, b) => {
    if (!a || !b || a.length !== b.length) return 0;
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  };

  /* ---------------- vetor externo: no GPU e HF ---------------- */
  function tokenHF() {
    if (typeof LS === 'undefined') return '';
    return LS.get('arkher_hf_token', '') || (typeof Vault !== 'undefined' && Vault.pick && (Vault.pick('hf') || {}).token) || '';
  }
  function noGPU() {
    if (typeof LS === 'undefined') return '';
    return LS.get('arkher_kaggle', '') || LS.get('arkher_agent', '') || '';
  }
  async function vetoresHF(textos) {
    const tk = tokenHF();
    if (!tk) throw new Error('sem token HF');
    const r = await fetch('https://router.huggingface.co/hf-inference/models/' + EMB_HF + '/pipeline/feature-extraction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
      body: JSON.stringify({ inputs: textos }),
    });
    if (!r.ok) throw new Error('HF HTTP ' + r.status);
    let v = await r.json();
    if (v && v[0] && !Array.isArray(v[0])) v = [v];         // veio um texto só
    if (!Array.isArray(v) || !Array.isArray(v[0])) throw new Error('formato inesperado do HF');
    return v;
  }
  async function vetoresGPU(textos, onLog) {
    const base = noGPU().replace(/\/+$/, '');
    if (!base) throw new Error('sem no configurado');
    const log = onLog || (() => {});
    const r = await fetch(base + '/infer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarefa: 'embed', textos, modelo: EMB_HF }),
    });
    const j = await r.json();
    if (!j.id) throw new Error(j.err || 'o no nao aceitou o job');
    for (let i = 0; i < 120; i++) {                          // ate 4 min
      await new Promise(s => setTimeout(s, 2000));
      const st = await (await fetch(base + '/infer?job=' + j.id)).json();
      if (st.estado === 'rodando') { log('vetorizando no no... ' + (st.sec || 0) + 's'); continue; }
      if (st.estado === 'pronto' && st.meta && st.meta.vetores) {
        N.stats.vetoresGPU += st.meta.vetores.length;
        return st.meta.vetores;
      }
      throw new Error((st.erro || 'falhou') + (st.como_resolver ? ' — ' + st.como_resolver : ''));
    }
    throw new Error('o no demorou demais pra vetorizar');
  }
  /**
   * vetoriza uma lista. Devolve {v:[[...]], via:'gpu'|'hf'|'local'}.
   * Nunca lanca: se tudo falhar, cai no local (offline, sempre funciona).
   */
  N.vetorizar = async function (textos, onLog) {
    if (!textos || !textos.length) return { v: [], via: 'vazio' };
    if (N.cfg.usarGPU && textos.length >= 8) {
      try {
        const v = await vetoresGPU(textos, onLog);
        if (v && v.length === textos.length) return { v, via: 'gpu' };
      } catch (e) { if (onLog) onLog('no GPU nao vetorizou (' + e.message + ') — tentando o HF'); }
    }
    if (N.cfg.usarHF && tokenHF()) {
      try {
        const v = await vetoresHF(textos);
        if (v && v.length === textos.length) { N.stats.vetoresHF += v.length; return { v, via: 'hf' }; }
      } catch (e) { if (onLog) onLog('HF nao vetorizou (' + e.message + ') — usando o local'); }
    }
    N.stats.vetoresLocal += textos.length;
    return { v: textos.map(N.vetorLocal), via: 'local' };
  };

  /* ---------------- guardar ---------------- */
  /* id ESTAVEL: o mesmo texto tem sempre o mesmo id — é isso que faz
     ingerir o mesmo pack duas vezes não duplicar nada.
     (Antes o id levava um pedaço do relógio, e por isso o mesmo bloco
     entrava de novo a cada ingestão.) */
  const idDe = (t) => 'i' + fnv(String(t).slice(0, 400)).toString(36);

  N.add = async function (txt, meta, onLog) {
    meta = meta || {};
    const partes = meta.semCortar ? [String(txt)] : N.chunk(txt, meta.max || 900);
    if (!partes.length) return 0;
    const { v, via } = await N.vetorizar(partes, onLog);
    let n = 0;
    partes.forEach((p, i) => {
      const id = idDe(p);
      if (N.itens.some(x => x.id === id)) return;
      N.itens.push({
        id, txt: p, tags: meta.tags || '', t: meta.t || agora(),
        src: meta.src || 'manual', fonte: meta.fonte || '', peso: meta.peso == null ? 1 : meta.peso,
        via,
      });
      if (v[i]) N.vecs[id] = { v: (via === 'local') ? v[i] : v[i], dim: v[i].length, via };
      n++;
    });
    N.stats.add += n;
    N.poda();
    salva(meta.sincrono);
    return n;
  };
  N.addMuitos = async function (lista, meta, onLog) {
    let n = 0;
    for (const x of lista) n += await N.add(typeof x === 'string' ? x : x.txt, Object.assign({}, meta, x.meta || {}, typeof x === 'string' ? {} : { tags: x.tags, fonte: x.fonte, t: x.t }), onLog);
    return n;
  };
  N.poda = function () {
    if (N.itens.length <= N.cfg.max) return 0;
    const peso = x => (x.peso || 1) * (x.src === 'seed' || x.src === 'regra' ? 3 : 1) + Math.max(0, 1 - (agora() - x.t) / (1000 * 60 * 60 * 24 * 120));
    N.itens.sort((a, b) => peso(b) - peso(a));
    const fora = N.itens.splice(N.cfg.max);
    fora.forEach(x => { delete N.vecs[x.id]; });
    return fora.length;
  };

  /* ---------------- buscar ---------------- */
  function kw(consulta, item) {
    const q = new Set(N.tokens(consulta)), alvo = new Set(N.tokens((item.tags || '') + ' ' + item.txt));
    if (!q.size) return 0;
    let hit = 0;
    for (const t of q) if (alvo.has(t)) hit++;
    return hit / q.size;
  }
  N.buscar = async function (consulta, k, opts) {
    opts = opts || {};
    k = k || N.cfg.k;
    N.stats.busca++;
    // vetor da consulta: tenta o mesmo caminho dos itens guardados
    const caminhos = [...new Set(N.itens.slice(0, 400).map(x => x.via))].filter(x => x && x !== 'local');
    let qv = {};
    for (const c of caminhos) {
      try {
        const { v, via } = c === 'hf' ? { v: await vetoresHF([consulta]), via: 'hf' }
          : c === 'gpu' ? { v: await vetoresGPU([consulta]), via: 'gpu' } : { v: [N.vetorLocal(consulta)], via: 'local' };
        if (v && v[0]) qv[via] = v[0];
      } catch (e) { /* segue: palavra ainda ordena */ }
    }
    qv.local = N.vetorLocal(consulta);
    const res = [];
    for (const it of N.itens) {
      const vec = N.vecs[it.id];
      let c = 0;
      if (vec && qv[vec.via]) c = cos(qv[vec.via], vec.v);
      const w = kw(consulta, it);
      const idade = Math.max(0, 1 - (agora() - it.t) / (1000 * 60 * 60 * 24 * 365));
      const sc = 0.55 * c + 0.36 * w + 0.05 * (it.peso || 1) / 3 + 0.04 * idade + (it.src === 'regra' ? 0.05 : 0);
      if (sc > 0.06) res.push({ item: it, sc, cos: c, kw: w });
    }
    res.sort((a, b) => b.sc - a.sc);
    if (res.length) N.stats.acerto++;
    return res.slice(0, k);
  };

  /** texto pronto pra colar no prompt de sistema */
  N.contexto = async function (consulta, k) {
    const achados = await N.buscar(consulta, k || N.cfg.k);
    if (!achados.length) return '';
    const linhas = achados.map(r =>
      '[memoria] ' + (r.item.t || r.item.fonte || 'nota') + ':\n' + r.item.txt.slice(0, 1100));
    return linhas.join('\n\n');
  };
  /** regras destiladas: entram SEMPRE no prompt (curtas e densas) */
  N.regrasTexto = function (max) {
    if (!N.regras.length) return '';
    return N.regras.slice(0, max || 18).map(r => '- ' + (r.txt || r)).join('\n');
  };

  /* ---------------- aprendizado automatico ---------------- */
  /** guarda o par pergunta/resposta como dado de treino + licao curta */
  N.licao = function (pergunta, resposta, meta) {
    meta = meta || {};
    pergunta = String(pergunta || '').slice(0, 2000);
    resposta = String(resposta || '').slice(0, 6000);
    if (pergunta.length < 8 || resposta.length < 40) return false;
    if (/^erro|^falhou|nao consegui/i.test(resposta.slice(0, 40))) return false;
    N.treino.push({ messages: [{ role: 'user', content: pergunta },
                               { role: 'assistant', content: resposta }],
                    t: agora(), tags: meta.tags || '', modelo: meta.modelo || '' });
    if (N.treino.length > N.cfg.tetoTreino) N.treino.splice(0, N.treino.length - N.cfg.tetoTreino);
    N.stats.licoes++;
    salva();
    return true;
  };
  /** importar/exportar dataset pro treino com pesos (LoRA no no GPU) */
  N.exportar = function (max) {
    const l = N.treino.slice(-(max || 4000));
    return l.map(x => JSON.stringify(x)).join('\n');
  };

  /* ---------------- treino por preferencia (DPO) ----------------
     O enxame produz isso sozinho: a resposta agregada e a "escolhida",
     a pior proposta e a "rejeitada". Treinar assim aproxima o modelo do
     conselho e afasta do erro. E o formato que o hf_hub.py aceita com
     tipo "dpo".                                                     */
  N.preferencia = function (pergunta, escolhida, rejeitada, meta) {
    meta = meta || {};
    if (!pergunta || !escolhida || !rejeitada) return false;
    if (String(escolhida).trim() === String(rejeitada).trim()) return false;
    if (String(escolhida).length < 60 || String(rejeitada).length < 60) return false;
    N.prefs.push({ messages: [{ role: 'user', content: String(pergunta).slice(0, 3000) }],
                   chosen: [{ role: 'assistant', content: String(escolhida).slice(0, 8000) }],
                   rejected: [{ role: 'assistant', content: String(rejeitada).slice(0, 8000) }],
                   t: agora(), tags: meta.tags || '', de: meta.de || '', para: meta.para || '' });
    if (N.prefs.length > 2000) N.prefs.splice(0, N.prefs.length - 2000);
    salva();
    return true;
  };
  N.exportarPrefs = function (max) {
    return N.prefs.slice(-(max || 2000)).map(x => JSON.stringify(x)).join('\n');
  };
  N.importarPrefs = function (jsonl) {
    let n = 0;
    for (const linha of String(jsonl || '').split('\n')) {
      const t = linha.trim(); if (!t) continue;
      try { const o = JSON.parse(t); if (o.chosen && o.rejected) { N.prefs.push(o); n++; } } catch (e) {}
    }
    salva(); return n;
  };
  N.importar = function (jsonl) {
    let n = 0;
    for (const linha of String(jsonl || '').split('\n')) {
      const t = linha.trim(); if (!t) continue;
      try {
        const o = JSON.parse(t);
        if (o.messages || o.prompt) {
          N.treino.push(o.messages ? o : { messages: [{ role: 'user', content: o.prompt },
                                                      { role: 'assistant', content: o.completion || '' }] });
          n++;
        }
      } catch (e) {}
    }
    if (N.treino.length > N.cfg.tetoTreino) N.treino.splice(0, N.treino.length - N.cfg.tetoTreino);
    salva(); return n;
  };
  /**
   * DESTILAR (treino sem GPU): o modelo le as licoes novas e devolve
   * regras curtas. Regra nao se acumula pra sempre: reforco soma peso,
   * regra fraca e podada. E assim que ele "fica mais esperto" sem
   * precisar de placa de video.
   */
  N.destilar = async function (onLog) {
    const log = onLog || (() => {});
    const lote = N.treino.slice(-40);
    // checa o que da pra checar sem rede primeiro: o aviso util e "faltam licoes"
    if (lote.length < 3) throw new Error('poucas licoes (' + lote.length + '): use o chat mais um pouco antes de destilar');
    if (typeof Arkher === 'undefined' || !Arkher.ask) throw new Error('a cascata (Arkher) nao esta carregada');
    log('destilando ' + lote.length + ' licoes em regras...');
    const amostra = lote.map((x, i) => {
      const u = (x.messages.find(m => m.role === 'user') || {}).content || '';
      const a = (x.messages.find(m => m.role === 'assistant') || {}).content || '';
      return i + ') P: ' + u.slice(0, 300) + '\n   R: ' + a.slice(0, 500);
    }).join('\n').slice(0, 12000);
    const ja = N.regrasTexto(20);
    const r = await Arkher.ask([
      { role: 'system', content: 'Voce extrai REGRAS OPERACIONAIS curtas de conversas tecnicas. ' +
        'Devolva so linhas comecando com "- ", uma regra por linha, no maximo 12, em portugues, ' +
        'especificas (comando, caminho, nome de API). Nada de generalidade tipo "seja claro".' },
      { role: 'user', content: (ja ? 'Regras que ja existem:\n' + ja + '\n\n' : '') + 'Conversas:\n' + amostra },
    ], { stage: 'code', maxTries: 3 });
    const novas = String(r.text || '').split('\n').map(x => x.replace(/^[-*•]\s*/, '').trim())
      .filter(x => x.length > 12 && x.length < 300 && !N.eGenerica(x));
    let add = 0;
    for (const txt of novas) {
      const g = N.regras.find(x => x.chave === fnv(N.tokens(txt).slice(0, 6).join(' ')));
      if (g) { g.peso = (g.peso || 1) + 1; g.t = agora(); continue; }
      N.regras.push({ chave: fnv(N.tokens(txt).slice(0, 6).join(' ')), txt, peso: 1, t: agora() });
      add++;
    }
    N.regras.sort((a, b) => (b.peso || 1) - (a.peso || 1));
    if (N.regras.length > 60) N.regras.splice(60);
    salva(); log('destilou ' + add + ' regras novas (total ' + N.regras.length + ')');
    return { novas: add, total: N.regras.length, modelo: r.model };
  };

  /* ---------------- estudar: baixar e guardar documentacao ---------------- */
  N.estudar = async function (url, onLog) {
    const log = onLog || (() => {});
    if (typeof Web === 'undefined' || !Web.abrir) throw new Error('o modulo Web (websearch.js) nao esta carregado');
    log('baixando ' + url);
    const txt = await Web.abrir(url, 60000);
    if (!txt || txt.length < 200) throw new Error('a pagina veio vazia ou curta demais (' + (txt || '').length + ' chars)');
    const titulo = (txt.match(/^(.{0,120})/) || [])[1] || url;
    log('guardando ' + txt.length + ' chars de ' + url);
    const n = await N.add(txt, { src: 'doc', fonte: url, tags: titulo, peso: 2, max: 1100 }, log);
    return { url, chars: txt.length, pedacos: n };
  };

  /* ---------------- sync com o time (Supabase) ---------------- */
  N.sincronizar = async function (direcao) {
    if (typeof Sync === 'undefined' || !Sync.ligado || !Sync.ligado()) throw new Error('sem Supabase ligado (modo local)');
    const remoto = await Sync.get('cerebro', null);
    let mudou = 0;
    if (remoto && remoto.itens) {
      const ids = new Set(N.itens.map(x => x.id));
      for (const it of remoto.itens) if (!ids.has(it.id)) { N.itens.push(it); mudou++; }
      for (const r of (remoto.regras || [])) if (!N.regras.some(x => x.chave === r.chave)) { N.regras.push(r); mudou++; }
    }
    if (!direcao || direcao === 'subir') {
      await Sync.set('cerebro', { itens: N.itens.slice(-800), regras: N.regras, t: agora() });
    }
    salva(); N.poda();
    return { mudou, itens: N.itens.length, regras: N.regras.length };
  };

  /* ---------------- o nó com GPU: cérebro -> dataset -> treino ----------------
     Aqui a IA aprende de verdade: o que ela viveu (lições) e o que o conselho
     aprovou/reprovou (pares de preferência) vai pro nó, vira dataset e treina
     o modelo. No nó com GPU isso é o hf_hub.py (LoRA/DPO); sem GPU ele responde
     honestamente que falta torch — e a gente só guarda.                       */
  N.noBase = function () {
    if (typeof LS === 'undefined') return '';
    return ((LS.get('arkher_kaggle', '') || LS.get('arkher_agent', '') || '') + '').replace(/\/+$/, '');
  };

  N.enviarParaNo = async function (base, log) {
    base = (base || N.noBase()).replace(/\/+$/, '');
    if (!base) throw new Error('configure o nó com GPU primeiro (aba VM → URL do nó)');
    const licoes = N.exportar(2000);
    const prefs = N.exportarPrefs(2000);
    const manda = async (jsonl) => {
      if (!jsonl) return { ok: true, novos: 0, total: 0 };
      const r = await fetch(base + '/dataset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonl }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.err || 'o nó recusou o dataset');
      return j;
    };
    if (log) log('mandando pro nó: ' + (licoes ? licoes.split('\n').length : 0) + ' lições + '
      + (prefs ? prefs.split('\n').length : 0) + ' preferências');
    const a = await manda(licoes);
    const b = await manda(prefs);
    const r = { licoes: a.novos || 0, prefs: b.novos || 0, total: (b.total || a.total || 0) };
    if (log) log('o nó agora tem ' + r.total + ' amostras (' + r.licoes + ' lições novas, ' + r.prefs + ' preferências novas)');
    return r;
  };

  N.treinoAuto = async function (base, cfg) {
    base = (base || N.noBase()).replace(/\/+$/, '');
    if (!base) throw new Error('sem nó com GPU configurado');
    const r = await fetch(base + '/dataset/auto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.err || 'o nó recusou');
    return j;
  };

  N.estadoNo = async function (base) {
    base = (base || N.noBase()).replace(/\/+$/, '');
    if (!base) throw new Error('sem nó com GPU configurado');
    const r = await fetch(base + '/dataset');
    const j = await r.json();
    if (!j.ok) throw new Error(j.err || 'o nó não respondeu');
    return j;
  };

  /** regra generica demais nao serve: 'seja claro', 'evite X' — ocupa prompt e nao ensina nada */
  N.eGenerica = function (txt) {
    const t = String(txt || '').trim();
    if (/^(seja|sê|evite|mantenha|prefira|responda|escreva|use sempre|sempre use|tente|busque|garanta)\b/i.test(t)) return true;
    if (/^(a |o )?(boa |melhor )?(pratica|ideia) (e|é)\b/i.test(t)) return true;
    if (t.length < 45 && !/[0-9_\/.:#$-]/.test(t)) return true;   // sem nada concreto (comando, caminho, numero)
    return false;
  };

  /* salvar agora (o memoria.js joga regras destiladas aqui e chama isto) */
  N.salvar = function () { try { salva(); return true; } catch (e) { return false; } };

  /* ---------------- ciclo de vida ---------------- */
  N.init = async function (onLog) {
    if (N.pronto) return N;
    carrega();
    // primeira vez: carrega o pacote de conhecimento do repo (conhecimento.js)
    if (!N.itens.length && typeof Conhecimento !== 'undefined' && Conhecimento.itens) {
      const log = onLog || (() => {});
      log('carregando ' + Conhecimento.itens.length + ' blocos de conhecimento...');
      await N.addMuitos(Conhecimento.itens.map(x => ({ txt: x.txt, tags: x.t + ' ' + (x.tags || ''), fonte: x.fonte || '' })),
        { src: 'seed', peso: 2, max: 1400 }, log);
    }
    N.pronto = true;
    salva(true);
    return N;
  };
  N.stats_ = function () {
    const comVetor = Object.keys(N.vecs).length;
    return {
      itens: N.itens.length, vetores: comVetor, regras: N.regras.length,
      licoes: N.treino.length, preferencias: (N.prefs || []).length, porFonte: N.itens.reduce((a, x) => (a[x.src] = (a[x.src] || 0) + 1, a), {}),
      vetoresHF: N.stats.vetoresHF, vetoresGPU: N.stats.vetoresGPU, vetoresLocal: N.stats.vetoresLocal,
      busca: N.stats.busca, auto: N.cfg.auto,
    };
  };
  N.limpar = function (oque) {
    if (oque === 'treino') { N.treino = []; N.prefs = []; }
    else if (oque === 'regras') N.regras = [];
    else if (oque === 'docs') {
      N.itens = N.itens.filter(x => x.src !== 'doc' && x.src !== 'manual');
      N.vecs = {}; N.itens.forEach(() => {});
    } else { N.itens = []; N.vecs = {}; N.treino = []; N.prefs = []; N.regras = []; }
    salva(true);
    return N.stats_();
  };

  if (typeof window !== 'undefined') window.Neural = N;
  if (typeof module !== 'undefined') module.exports = { Neural: N };
})();
