/* ============================================================
   ARKHER — MEMORIA COMPARTILHADA
   ============================================================

   Um quadro so pra todo mundo: as IAs do enxame, os chats, as abas
   (3D, terminal, piloto) e as sessoes de VM/no.

   Por que existe: sem isso cada conversa comeca do zero e cada IA do
   conselho so sabe o que esta no prompt dela. Com isso:
     - o que a IA descobre numa ferramenta (comando que funcionou,
       caminho de arquivo, API correta) fica no quadro e as OUTRAS IAs
       leem antes de responder;
     - o que aconteceu no chat 1 o chat 2 ja sabe;
     - o que a sessao de VM fez (instalou, criou, quebrou) fica gravado
       no propio no e volta pra qualquer navegador que falar com ele;
     - e sincroniza entre seus aparelhos (Supabase), se voce usar login.

   Regra de ouro: item com sigilo:true NUNCA sai daqui (nao vai pro no
   nem pro Supabase). Senha, token e chave ficam assim.

   Tipos: achado | acao | erro | decisao | arquivo | nota
   Escopos: global | chat:<id> | sessao:<id> | conselho:<id> | vm:<url> | tarefa:<slug>
   ============================================================ */
'use strict';
(function () {
  const M = {};
  const KEY = 'arkher_mem';
  const CFO = 'arkher_mem_cfg';
  const SES = 'arkher_mem_sessao';
  const SYN = 'arkher_mem_sync';      // quando foi a ultima sincronizacao

  M.cfg = Object.assign({
    ligado: true,      // gravar e usar a memoria
    auto: true,        // gravar sozinho o que as ferramentas fazem
    teto: 1500,        // itens guardados (os mais antigos sem valor saem)
    sync: true,        // compartilhar entre aparelhos (Supabase)
    no: true,          // espelhar no no/VM (agent.py /memoria)
    dias: 60,          // idade maxima de item comum
    vetor: true,       // busca por significado (vetor local + HF/no quando tiver)
    destilar: false,   // virar o quadro em regras sozinho (sem GPU)
    destilarMin: 25,   // quantos itens novos antes de destilar
  }, (typeof LS !== 'undefined' ? LS.get(CFO, {}) : {}) || {});

  M.itens = (typeof LS !== 'undefined' && Array.isArray(LS.get(KEY, null))) ? LS.get(KEY, []) : [];
  const VKEY = 'arkher_mem_vec';
  // {id: {v:[...], via:'local'|'hf'|'gpu'}} — o mesmo motor do neural.js
  M.vecs = (typeof LS !== 'undefined' && LS.get(VKEY, null)) ? LS.get(VKEY, {}) : {};

  function limite() { return Math.max(20, M.cfg.teto | 0); }   // piso de seguranca
  function salva() {
    try {
      M.itens = M.itens.slice(-limite());
      const ids = new Set(M.itens.map(x => x.id));
      for (const k in M.vecs) if (!ids.has(k)) delete M.vecs[k];   // vetor de item que saiu
      LS.set(KEY, M.itens);
      LS.set(VKEY, M.vecs);
    } catch (e) {}
  }
  function agora() { return Date.now(); }
  function id(t) {
    // djb2 + tamanho: id estavel (o mesmo texto no mesmo escopo = mesmo id, sempre)
    const s = String(t);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'm' + h.toString(36) + '-' + s.length.toString(36);
  }
  M.hash = id;

  M.sessao = function (nova) {
    let s = LS.get(SES, '');
    if (!s || nova) { s = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); LS.set(SES, s); }
    return s;
  };

  /* ---------------- escrever ---------------- */
  M.add = function (item) {
    if (!M.cfg.ligado) return { ok: false, err: 'memoria desligada' };
    item = item || {};
    const texto = String(item.texto || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (texto.length < 3) return { ok: false, err: 'texto vazio' };
    const escopo = item.escopo || 'global';
    const it = {
      id: id(escopo + '|' + texto),
      t: item.t || agora(),
      tipo: item.tipo || 'nota',
      texto, escopo,
      tags: (item.tags || []).map(x => String(x).slice(0, 40)).slice(0, 8),
      de: String(item.de || 'site').slice(0, 60),
      sigilo: !!item.sigilo,
    };
    const ja = M.itens.find(x => x.id === it.id);
    if (ja) { ja.t = it.t; ja.vezes = (ja.vezes || 1) + 1; salva(); return { ok: true, id: it.id, novo: false }; }
    M.itens.push(it);
    if (M.itens.length > limite()) M.podar();
    salva();
    return { ok: true, id: it.id, novo: true };
  };

  M.addMuitos = function (lista) {
    let novos = 0;
    for (const x of (lista || [])) { const r = M.add(x); if (r && r.novo) novos++; }
    return { ok: true, novos, total: M.itens.length };
  };

  /* achado: o que a IA descobriu de util (vai pro quadro do conselho) */
  M.achado = function (texto, o) {
    o = o || {};
    return M.add({ tipo: o.tipo || 'achado', texto, escopo: o.escopo || 'global',
                   de: o.de || 'ia', tags: o.tags, sigilo: o.sigilo });
  };

  /* ---------------- ler ---------------- */
  M.listar = function (f) {
    f = f || {};
    let a = M.itens;
    if (f.escopo) a = a.filter(x => x.escopo === f.escopo || (f.familia && x.escopo.split(':')[0] === f.familia));
    if (f.familia && !f.escopo) a = a.filter(x => x.escopo.split(':')[0] === f.familia);
    if (f.tipo) a = a.filter(x => x.tipo === f.tipo);
    if (f.desde) a = a.filter(x => x.t >= f.desde);
    if (!f.sigilo) a = a.filter(x => !x.sigilo);
    if (f.q) {
      const q = String(f.q).toLowerCase().split(/\s+/).filter(x => x.length > 2);
      a = a.filter(x => q.every(p => (x.texto + ' ' + (x.tags || []).join(' ')).toLowerCase().includes(p)));
    }
    a = a.slice().sort((x, y) => (y.t - x.t) || ((y.vezes || 1) - (x.vezes || 1)));
    return f.k ? a.slice(0, f.k) : a;
  };

  /* texto curto pro prompt: o que todo mundo ja sabe */
  M.contexto = function (escopo, k, pergunta) {
    if (!M.cfg.ligado) return '';
    let a = M.itens.filter(x => !x.sigilo);
    if (escopo) a = a.filter(x => x.escopo === escopo || x.escopo === 'global' || x.escopo === 'chat:' + escopo || x.escopo === 'sessao:' + escopo);
    if (pergunta) {
      // o que for relevante pra ESTA pergunta entra na frente (palavra-chave aqui;
      // quem tem vetor usa M.relevantes(), que e assincrono)
      const q = tokens(pergunta);
      const rel = x => q.filter(t => tokens(x.texto + ' ' + (x.tags || []).join(' ')).includes(t)).length;
      a = a.slice().sort((x, y) => (rel(y) - rel(x)) || (y.t - x.t));
    } else {
      a = a.slice().sort((x, y) => y.t - x.t);
    }
    // prioriza decisao/achado/erro (o que muda a resposta) em cima do resto
    const peso = t => ({ decisao: 3, achado: 2, erro: 2, arquivo: 1, acao: 0, nota: 0 }[t] || 0);
    a = a.sort((x, y) => (peso(y.tipo) - peso(x.tipo)) || (y.t - x.t)).slice(0, k || 8);
    if (!a.length) return '';
    return a.map(x => '- [' + x.tipo + ' · ' + x.escopo + '] ' + x.texto).join('\n');
  };

  /* junta o quadro numa lista de mensagens (nao mexe no que voce escreveu) */
  M.injetar = function (msgs, escopo, k, pergunta) {
    if (!M.cfg.ligado) return msgs;
    const quadro = M.contexto(escopo, k, pergunta);
    const neural = (typeof Neural !== 'undefined' && Neural.regrasTexto) ? Neural.regrasTexto(6) : '';
    if (!quadro && !neural) return msgs;
    const bloco = 'MEMORIA COMPARTILHADA (o que ja foi descoberto aqui — use se for util, ignore se nao tiver a ver):\n'
      + (quadro || '') + (neural ? '\nRegras aprendidas:\n' + neural : '');
    const i = msgs.findIndex(m => m.role === 'system');
    if (i >= 0) msgs[i] = { role: 'system', content: msgs[i].content + '\n\n' + bloco };
    else msgs = [{ role: 'system', content: bloco }].concat(msgs);
    return msgs;
  };

  /* versao com busca por significado (usada pelo chat e pelo enxame) */
  M.injetarAssinc = async function (msgs, escopo, k, pergunta) {
    if (!M.cfg.ligado) return msgs;
    let itens = [];
    try { itens = await M.relevantes(pergunta, k || 8, escopo); } catch (e) { itens = M.listar({ k: k || 8 }); }
    const quadro = itens.map(x => '- [' + x.tipo + ' · ' + x.escopo + '] ' + x.texto).join('\n');
    const neural = (typeof Neural !== 'undefined' && Neural.regrasTexto) ? Neural.regrasTexto(6) : '';
    if (!quadro && !neural) return msgs;
    const bloco = 'MEMORIA COMPARTILHADA (o que ja foi descoberto — priorizei o que tem a ver com a pergunta):\n'
      + (quadro || '') + (neural ? '\nRegras aprendidas:\n' + neural : '');
    const i = msgs.findIndex(m => m.role === 'system');
    if (i >= 0) msgs[i] = { role: 'system', content: msgs[i].content + '\n\n' + bloco };
    else msgs = [{ role: 'system', content: bloco }].concat(msgs);
    return msgs;
  };

  /* ---------------- auto-captura: o que as ferramentas fizeram ----------------
     Uma linha por ferramenta, sem despejar saida crua (isso ja esta no log).
     O que interessa pro futuro: o que rodou, onde deu certo e o que quebrou. */
  const SIGILO = /senha|password|token|secret|apikey|api_key|authorization|bearer/i;
  M.captura = function (call, res) {
    try {
      if (!M.cfg.ligado || !M.cfg.auto || !call || !call.tool) return;
      const a = call.args || {};
      const r = res || {};
      let alvo = a.caminho || a.path || a.url || a.q || a.query || a.prompt || a.cmd || a.comando || '';
      if (!alvo && a.nome) alvo = a.nome;
      alvo = String(alvo).replace(/\s+/g, ' ').slice(0, 160);
      const saida = String(r.out || r.err || '').replace(/\s+/g, ' ').trim();
      const resumo = r.ok === false
        ? ('falhou: ' + String(r.err || 'erro').slice(0, 160))
        : ('ok: ' + saida.slice(0, 150));
      const deVM = /^(rodar_vm|bash|write|escrever_arquivo|ler_arquivo|abrir_app|piloto|gerar_3d|treinar|info_no)$/.test(call.tool);
      const escopo = deVM ? ('vm:' + (M.baseAtual() || 'no')) : ('sessao:' + M.sessao());
      const texto = call.tool + '(' + alvo + ') ' + resumo;
      if (SIGILO.test(texto)) return;                      // segredo nunca entra
      M.add({ tipo: r.ok === false ? 'erro' : 'acao', texto, escopo, de: 'ferramenta',
              tags: [call.tool] });
      if (r.ok === false) M.add({ tipo: 'erro', texto: call.tool + ' falhou com ' + alvo + ' — ' + String(r.err || '').slice(0, 160),
                                  escopo: 'global', tags: [call.tool], de: 'ferramenta' });
    } catch (e) { /* memoria nunca derruba ferramenta */ }
  };

  M.baseAtual = function () {
    try { return (LS.get('arkher_kaggle', '') || LS.get('arkher_agent', '') || LS.get('arkher_droid', '') || '').replace(/\/+$/, ''); }
    catch (e) { return ''; }
  };

  /* ---------------- no/VM: a memoria sobrevive a sessao ----------------
     POST /memoria no agent.py grava em $STATE/memoria.jsonl. Assim a sessao
     de VM de hoje e lida pela de amanha (e por qualquer aparelho seu). */
  M.noEnviar = async function (base, itens) {
    if (!M.cfg.no) return { ok: false, err: 'espelho no no desligado' };
    base = (base || M.baseAtual()).replace(/\/+$/, '');
    if (!base) return { ok: false, err: 'nenhum no configurado' };
    const lista = (itens || M.itens.filter(x => !x.sigilo)).slice(-400);
    const r = await fetch(base + '/memoria', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens: lista }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.err || 'o no recusou a memoria');
    return j;
  };

  M.noPuxar = async function (base, desde) {
    base = (base || M.baseAtual()).replace(/\/+$/, '');
    if (!base) return { ok: false, err: 'nenhum no configurado' };
    const r = await fetch(base + '/memoria?k=600' + (desde ? '&desde=' + desde : ''));
    const j = await r.json();
    if (!j.ok) throw new Error(j.err || 'o no nao respondeu a memoria');
    const r2 = M.addMuitos((j.itens || []).map(x => Object.assign({}, x, { escopo: x.escopo && x.escopo.indexOf('vm:') === 0 ? x.escopo : ('vm:' + base) })));
    return { ok: true, ...r2, totalNo: j.total };
  };

  /* ---------------- sync entre aparelhos (Supabase) ---------------- */
  M.sincronizar = async function (forcar) {
    if (!M.cfg.sync) return { ok: false, err: 'sync desligado' };
    if (typeof Sync === 'undefined' || !Sync.ligado || !Sync.ligado()) return { ok: false, err: 'sem login/Supabase (modo local)' };
    const ultimo = LS.get(SYN, 0);
    if (!forcar && Date.now() - ultimo < 20000) return { ok: true, pulado: true };
    const remoto = await Sync.get('memoria', null);
    let novos = 0;
    if (remoto && Array.isArray(remoto.itens)) {
      const meus = new Set(M.itens.map(x => x.id));
      for (const x of remoto.itens) {
        if (x.sigilo || meus.has(x.id)) continue;
        M.itens.push(x); novos++;
      }
    }
    M.podar();
    await Sync.set('memoria', { itens: M.itens.filter(x => !x.sigilo).slice(-1200), t: Date.now() });
    LS.set(SYN, Date.now());
    salva();
    return { ok: true, novos, total: M.itens.length };
  };

  /* ---------------- limpeza ---------------- */
  M.podar = function () {
    const velho = agora() - (M.cfg.dias | 0) * 86400e3;
    const antes = M.itens.length;
    // 'nota' e 'acao' velhas saem; decisao/erro/aprendizado ficam (sao o valor)
    M.itens = M.itens.filter(x => x.tipo === 'decisao' || x.tipo === 'aprendizado' || x.t > velho);
    const teto = limite();
    if (M.itens.length > teto) {
      const uteis = M.itens.filter(x => x.tipo === 'decisao' || x.tipo === 'erro');
      const resto = M.itens.filter(x => x.tipo !== 'decisao' && x.tipo !== 'erro')
        .slice(-Math.max(1, teto - uteis.length));
      M.itens = uteis.concat(resto).sort((a, b) => a.t - b.t);
    }
    salva();
    return { ok: true, antes, depois: M.itens.length };
  };

  M.limpar = function (familia) {
    if (!familia) M.itens = [];
    else M.itens = M.itens.filter(x => x.escopo.split(':')[0] !== familia);
    salva();
    return { ok: true, total: M.itens.length };
  };

  M.stats = function () {
    const porTipo = {}, porEscopo = {};
    for (const x of M.itens) {
      porTipo[x.tipo] = (porTipo[x.tipo] || 0) + 1;
      const f = x.escopo.split(':')[0];
      porEscopo[f] = (porEscopo[f] || 0) + 1;
    }
    return { total: M.itens.length, porTipo, porEscopo, sigilo: M.itens.filter(x => x.sigilo).length,
             cfg: Object.assign({}, M.cfg) };
  };

  M.config = function (o) {
    M.cfg = Object.assign(M.cfg, o || {});
    LS.set(CFO, M.cfg);
    return M.cfg;
  };

  /* ---------------- busca por significado ----------------
     Mesmo motor do neural.js (vetor), mas em cima do QUADRO. Sem token e sem
     no, o vetor local (hash de palavras + 4-gramas) ja resolve: pega erro de
     digitacao e palavra parecida, que a busca por palavra-chave nao pega. */
  function tokens(t) {
    if (typeof Neural !== 'undefined' && Neural.tokens) return Neural.tokens(t);
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_$#./-]+/g, ' ').split(/\s+/).filter(x => x.length > 2);
  }
  function vetorLocal(t) {
    if (typeof Neural !== 'undefined' && Neural.vetorLocal) return Neural.vetorLocal(t);
    // plano B: bolsa de palavras com hash (se o neural.js nao estiver carregado)
    const DIM = 256, v = new Float64Array(DIM);
    for (const tk of tokens(t)) {
      let h = 5381; for (let i = 0; i < tk.length; i++) h = ((h << 5) + h + tk.charCodeAt(i)) >>> 0;
      v[h % DIM] += (h % 2 ? 1 : -1);
    }
    let n = 0; for (let i = 0; i < DIM; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    return Array.from(v, x => x / n);
  }
  const cos = (a, b) => { if (!a || !b || a.length !== b.length) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  function kw(consulta, item) {
    const q = new Set(tokens(consulta)), alvo = new Set(tokens((item.tags || []).join(' ') + ' ' + item.texto));
    if (!q.size) return 0;
    let hit = 0;
    for (const t of q) if (alvo.has(t)) hit++;
    return hit / q.size;
  }
  const PESO_TIPO = { decisao: 0.10, erro: 0.07, achado: 0.05, arquivo: 0.03 };

  /* vetoriza em lote o que ainda nao tem vetor (barato: local; melhor: HF/no) */
  M.indexar = async function (max, onLog) {
    if (!M.cfg.vetor) return { ok: false, err: 'busca por vetor desligada' };
    const log = onLog || (() => {});
    const faltam = M.itens.filter(x => !M.vecs[x.id]);
    if (!faltam.length) return { ok: true, novos: 0, total: Object.keys(M.vecs).length, via: '-' };
    const lote = faltam.slice(-(max || 48));
    let v, via = 'local';
    try {
      if (typeof Neural !== 'undefined' && Neural.vetorizar) {
        const r = await Neural.vetorizar(lote.map(x => x.tipo + ': ' + x.texto), log);
        v = r.v; via = r.via;
      } else throw new Error('sem neural.js');
    } catch (e) {
      log('vetor: ' + e.message + ' — usando o local');
      v = lote.map(x => vetorLocal(x.tipo + ': ' + x.texto)); via = 'local';
    }
    let n = 0;
    lote.forEach((it, i) => { if (v[i]) { M.vecs[it.id] = { v: v[i], via }; n++; } });
    salva();
    log('indexou ' + n + ' item(ns) do quadro (via ' + via + ')');
    return { ok: true, novos: n, total: Object.keys(M.vecs).length, via };
  };

  /* busca hibrida: significado + palavra + tipo + idade. Sem vetor, so palavra. */
  M.buscar = async function (q, k, o) {
    o = o || {};
    q = String(q || '').trim();
    k = k || 10;
    let itens = M.listar({ familia: o.familia, k: 999999 });
    if (o.permitir) itens = itens.filter(o.permitir);
    if (!itens.length) return [];
    let qv = null;
    if (M.cfg.vetor && q) {
      try { await M.indexar(24); } catch (e) { /* segue sem vetor */ }
      qv = {};
      try {
        if (typeof Neural !== 'undefined' && Neural.vetorizar) {
          const r = await Neural.vetorizar([q]);
          if (r.v && r.v[0]) qv[r.via] = r.v[0];
        }
      } catch (e) { /* palavra ainda ordena */ }
      qv.local = vetorLocal(q);
    }
    const agora2 = Date.now();
    const res = [];
    for (const it of itens) {
      const vec = M.vecs[it.id];
      let c = 0;
      if (qv && vec && qv[vec.via]) c = cos(qv[vec.via], vec.v);
      else if (qv && !vec) c = 0;
      const w = q ? kw(q, it) : 0;
      const idade = Math.max(0, 1 - (agora2 - it.t) / (1000 * 60 * 60 * 24 * 365));
      const sc = 0.52 * c + 0.34 * w + (PESO_TIPO[it.tipo] || 0) + 0.05 * Math.min(3, it.vezes || 1) / 3 + 0.09 * idade;
      if (!q || sc > 0.06) res.push({ item: it, sc, cos: c, kw: w });
    }
    res.sort((a, b) => b.sc - a.sc);
    return res.slice(0, k);
  };

  /* o que entra no prompt: relevante pra pergunta + o que e recente/importante */
  /* o que serve pro prompt: global, VM, o conselho atual e a MINHA sessao.
     Conversa solta de outro chat nao entra (senao o prompt vira despejo). */
  function serveNoPrompt(x, escopo) {
    const f = x.escopo.split(':')[0];
    if (f === 'global' || f === 'vm' || f === 'conselho' || f === 'tarefa') return true;
    if (f === 'sessao' || f === 'chat') return !!escopo && x.escopo.endsWith(':' + escopo);
    return true;
  }

  M.relevantes = async function (pergunta, k, escopo) {
    k = k || 6;
    const perto = x => serveNoPrompt(x, escopo);
    let sem = [];
    try { sem = pergunta ? await M.buscar(pergunta, k, { permitir: perto }) : []; } catch (e) {}
    const vistos = new Set(), out = [];
    for (const x of sem) { if (!vistos.has(x.item.id)) { vistos.add(x.item.id); out.push(x.item); } }
    // completa com o que IMPORTA e e recente (decisao/erro/achado) — nunca 'nota' solta
    if (out.length < k) {
      const bons = M.listar({ k: 60 }).filter(perto).filter(x => x.tipo === 'decisao' || x.tipo === 'erro' || x.tipo === 'achado')
        .sort((a, b) => b.t - a.t);
      for (const x of bons) { if (out.length >= k + 2) break; if (!vistos.has(x.id)) { vistos.add(x.id); out.push(x); } }
    }
    return out.slice(0, k + 2);
  };

  /* ---------------- destilar: o quadro vira REGRAS (sem GPU) ----------------
     Regra e o que sobrevive: entra SEMPRE no prompt, custa 1 linha e nao
     depende de buscar nada. O modelo so faz o resumo; quem guarda somos nos. */
  M.destilar = async function (onLog) {
    const log = onLog || (() => {});
    const desde = M.cfg.ultimaDestilacao || 0;
    const novos = M.itens.filter(x => !x.sigilo && x.t > desde && (x.tipo === 'achado' || x.tipo === 'decisao' || x.tipo === 'erro' || x.tipo === 'acao'));
    const min = M.cfg.destilarMin | 0 || 25;
    if (novos.length < Math.min(3, min)) {
      throw new Error('poucos itens novos (' + novos.length + '): converse/rode o conselho mais um pouco antes de destilar');
    }
    if (typeof Arkher === 'undefined' || !Arkher.ask) throw new Error('a cascata (Arkher) nao esta carregada');
    if (typeof Neural === 'undefined' || !Neural.regras) throw new Error('o neural.js (onde as regras moram) nao esta carregado');
    const lote = novos.slice(-60);
    log('destilando ' + lote.length + ' itens do quadro em regras...');
    const amostra = lote.map((x, i) => i + ') [' + x.tipo + '] ' + x.texto).join('\n').slice(0, 14000);
    const ja = Neural.regrasTexto(20);
    const r = await Arkher.ask([
      { role: 'system', content: 'Voce transforma anotacoes tecnicas em REGRAS OPERACIONAIS curtas. '
          + 'Devolva so linhas comecando com "- ", no maximo 10, em portugues, especificas (comando, caminho, '
          + 'nome de API, decisao tomada). Nada de generalidade tipo "seja claro". Se algo so vale para esta maquina, '
          + 'diga a maquina na regra.' },
      { role: 'user', content: (ja ? 'Regras que ja existem (nao repita):\n' + ja + '\n\n' : '') + 'Anotacoes:\n' + amostra },
    ], { stage: 'code', maxTries: 3 });
    const generica = (typeof Neural !== 'undefined' && Neural.eGenerica) ? Neural.eGenerica : (t) => t.length < 45;
    const linhas = String(r.text || '').split('\n').map(x => x.replace(/^[-*•]\s*/, '').trim())
      .filter(x => x.length > 12 && x.length < 300 && !generica(x));
    let add = 0;
    for (const txt of linhas) {
      let h = 5381; const base = tokens(txt).slice(0, 6).join(' ');
      for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
      const chave = 'mem' + h.toString(36);
      const g = Neural.regras.find(x => x.chave === chave);
      if (g) { g.peso = (g.peso || 1) + 1; g.t = Date.now(); continue; }
      if (tokens(txt).length < 3) continue;
      Neural.regras.push({ chave, txt, peso: 1, t: Date.now(), src: 'memoria' });
      add++;
    }
    Neural.regras.sort((a, b) => (b.peso || 1) - (a.peso || 1));
    if (Neural.regras.length > 60) Neural.regras.splice(60);
    M.cfg.ultimaDestilacao = Date.now();
    M.config(M.cfg);
    if (Neural.salvar) { try { Neural.salvar(); } catch (e) {} }
    M.add({ tipo: 'aprendizado', texto: 'destilei ' + lote.length + ' itens do quadro em ' + add + ' regra(s) novas',
            escopo: 'global', de: 'memoria' });
    log('destilou ' + add + ' regras novas (total ' + Neural.regras.length + ')');
    return { itens: lote.length, novas: add, total: Neural.regras.length, modelo: r.model || '' };
  };

  /* destila sozinho quando junta item novo suficiente */
  M.autoDestilar = async function (onLog) {
    const log = onLog || (() => {});
    if (!M.cfg.destilar) return { ok: false, motivo: 'desligado' };
    const desde = M.cfg.ultimaDestilacao || 0;
    const novos = M.itens.filter(x => !x.sigilo && x.t > desde && (x.tipo === 'achado' || x.tipo === 'decisao' || x.tipo === 'erro')).length;
    if (novos < (M.cfg.destilarMin | 0 || 25)) return { ok: false, motivo: 'poucos novos (' + novos + ')' };
    try { const r = await M.destilar(log); return { ok: true, ...r }; }
    catch (e) { return { ok: false, erro: e.message }; }
  };

  /* ---------------- ciclo de vida ---------------- */
  M.init = async function (log) {
    log = log || function () {};
    try {
      M.podar();
      const base = M.baseAtual();
      if (base && M.cfg.no) {
        const ultimo = LS.get('arkher_mem_no_' + base, 0);
        if (Date.now() - ultimo > 300000) {          // 5 min de cache por no
          try {
            const r = await M.noPuxar(base);
            LS.set('arkher_mem_no_' + base, Date.now());
            if (r.novos) log('memoria: ' + r.novos + ' item(ns) vieram do no');
          } catch (e) { /* no fora do ar nao impede nada */ }
        }
      }
      if (M.cfg.sync) { try { await M.sincronizar(); } catch (e) {} }
      M.pronto = true;
    } catch (e) { M.pronto = true; }
    return M.stats();
  };

  if (typeof window !== 'undefined') window.Memoria = M;
  if (typeof module !== 'undefined') module.exports = { Memoria: M };
})();
