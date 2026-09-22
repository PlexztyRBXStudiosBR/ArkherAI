/* ============================================================
   ARKHER — nucleo de IA
   Lista 1: Puter (catalogo vivo)  ->  Lista 2: HF Hub (live)
   Fallback + quarentena (circuit breaker). Sem servidor.
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') {
  const c = require('./core.js'); globalThis.LS = c.LS; globalThis.errText = c.errText; globalThis._err = c._err;
}
/* _err vem do core.js. NAO redeclare aqui: um segundo `const _err` no escopo
   global derruba ESTE arquivo inteiro com SyntaxError (e sem app.js nao existe
   Puter, Arkher, HF, GPU nem Breaker). */

/* ---------- ranqueador: sem lista fixa, le o catalogo vivo ---------- */
const TIER = [
  [/fable/i, 100], [/opus/i, 95], [/ultra/i, 88], [/sonnet/i, 80], [/gpt-?5/i, 78],
  [/max/i, 72], [/\bpro\b/i, 66], [/405b/i, 62], [/70b/i, 55],
  [/thinking|reasoning/i, 58], [/flash/i, 40], [/mini/i, 30], [/haiku/i, 30],
  [/lite/i, 22], [/nano/i, 16], [/small|tiny/i, 12], [/fast/i, 20],
];
const FAM = [
  [/claude/i, 30], [/gpt-?5/i, 26], [/gemini/i, 22], [/grok/i, 20],
  [/deepseek/i, 18], [/qwen/i, 14], [/llama/i, 10], [/mistral/i, 10], [/kimi/i, 12],
];
/* modelos que NAO sao de chat de proposito geral (ficam por ultimo, mas nao somem) */
const ESPECIALISTA = /tts|whisper|embed|translat|coder|math|guard|moderat|rerank|ocr|audio/i;
const VISUAL = /\bvl\b|vision|image|omni|multimodal/i;

function verBonus(id) {
  const m = String(id).match(/\d+(?:\.\d+)?/g);
  if (!m) return 0;
  let best = 0;
  for (const x of m) { const v = parseFloat(x); if (v > best && v < 100) best = v; }
  return Math.min(best * 3, 30);
}
function scoreModel(id, visao) {
  let sc = 0;
  for (const [re, w] of TIER) if (re.test(id)) sc += w;
  for (const [re, w] of FAM) if (re.test(id)) sc += w;
  sc += verBonus(id);
  if (/:free/i.test(id)) sc += 45;
  if (/preview|experimental|alpha|beta/i.test(id)) sc -= 12;
  if (/:batch/i.test(id)) sc -= 150;
  if (ESPECIALISTA.test(id)) sc -= 70;
  if (VISUAL.test(id)) sc += visao ? 20 : -70;
  return sc;
}
const STAGE_W = {
  plan:    { think: 1.35, big: 1.30, fast: 0.80 },
  code:    { think: 1.20, big: 1.25, fast: 0.90 },
  chat:    { think: 1.00, big: 1.00, fast: 1.10 },
  fast:    { think: 0.85, big: 0.85, fast: 1.35 },
  visao:   { think: 1.00, big: 1.10, fast: 1.00 },
  other:   { think: 1.00, big: 1.00, fast: 1.00 },
};
function scoreFor(id, stage) {
  const w = STAGE_W[stage] || STAGE_W.other;
  let sc = scoreModel(id, stage === 'visao');
  if (/thinking|reasoning|opus|fable|\br1\b/i.test(id)) sc *= w.think;
  if (/fable|opus|ultra|max|\bpro\b|sonnet|405b|70b/i.test(id)) sc *= w.big;
  if (/flash|mini|nano|lite|fast|haiku/i.test(id)) sc *= w.fast;
  return sc;
}

/* ---------- circuit breaker: modelo que falha sai da roda ---------- */
const Breaker = {
  banned: new Map(),
  ban(id, ms = 10 * 60 * 1000) { this.banned.set(id, Date.now() + ms); },
  ok(id) {
    const t = this.banned.get(id);
    if (!t) return true;
    if (Date.now() > t) { this.banned.delete(id); return true; }
    return false;
  },
  clear() { this.banned.clear(); },
  reset() { this.banned.clear(); },
  size() { for (const [k, t] of this.banned) if (Date.now() > t) this.banned.delete(k); return this.banned.size; },
};

/* texto de uma resposta do Puter (string, objeto OpenAI-like, conteudo em array do Claude...) */
function textOf(res) {
  if (res === null || res === undefined) return '';
  if (typeof res === 'string') return res;
  let c;
  if (typeof res.text === 'string') c = res.text;
  else if (res.message && res.message.content !== undefined) c = res.message.content;
  else if (res.content !== undefined) c = res.content;
  else if (res.choices && res.choices[0]) c = res.choices[0].message?.content ?? res.choices[0].text;
  if (Array.isArray(c)) c = c.map(p => (typeof p === 'string' ? p : (p && (p.text || p.content)) || '')).join('');
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && typeof c.text === 'string') return c.text;
  if (typeof res.toString === 'function' && res.toString !== Object.prototype.toString) {
    const s = res.toString(); if (s && s !== '[object Object]') return s;
  }
  return '';
}

/* quanto a resposta pode ter. O Puter, sem isto, usa o MAXIMO do modelo:
   e por aí que o saldo evapora. 2048 cobre 99% do que se pede no chat. */
function maxTokens() {
  const v = Number(LS.get('arkher_max_tokens', 2048));
  return (Number.isFinite(v) && v >= 128 ? Math.min(v, 32000) : 2048);
}
/* "low balance" e parentes: o saldo da conta Puter acabou (nao e o modelo que morreu) */
function saldoLow(msg) {
  return /low[_ -]?balance|insufficient[_ -]?(funds|balance|credit)|no credit|funding|not enough (funds|credit)|usage-?limited|402|saldo|sem credit|esgotad/i.test(String(msg));
}

/* ---------- LISTA 1: Puter (+ a via gratis dele) ----------
   Dois truques que seguram o "low balance":
   a) VIA GRATIS: o catalogo do Puter traz os modelos gratuitos do OpenRouter,
      com o id terminando em ":free". Esses NAO gastam saldo — respondem com a
      conta zerada. Entao, quando o saldo acaba, o Puter nao morre: ele muda
      de pista e continua atendendo.
   b) REST: existe o endpoint OpenAI-compativel api.puter.com/puterai/openai/v1
      com o MESMO token da conta. Se o puter.js nao carregar (bloqueador de
      anuncios) ou se precisarmos escolher a conta na mao (armazem), é por ele. */
const Puter = {
  models: null,
  REST: 'https://api.puter.com/puterai/openai/v1/chat/completions',
  /* true = ja vimos "low balance": so entram os modelos :free */
  get livre() { try { return LS.get('arkher_puter_livre', false) === true; } catch (e) { return false; } },
  set livre(v) { try { LS.set('arkher_puter_livre', !!v); } catch (e) {} },
  /* orcamento enxuto por resposta, quando a conta tem pouco saldo:
     o 402 do Puter é sobre o custo estimado do pedido, entao pedir menos
     tokens de saida e cortar o historico faz o MESMO pedido passar.        */
  get limiteBaixo() { try { return Number(LS.get('arkher_limite_baixo', 0)) || 0; } catch (e) { return 0; } },
  set limiteBaixo(v) { try { LS.set('arkher_limite_baixo', Number(v) || 0); } catch (e) {} },
  /* id da pista gratis: termina em ":free" (openrouter:x/y:free) ou "/free" */
  eLivre(id) { return /[:/]free\b/i.test(String(id)); },

  async list() {
    if (this.models) return this.models;
    const r = await fetch('https://api.puter.com/puterai/chat/models');
    if (!r.ok) throw new Error('catalogo Puter HTTP ' + r.status);
    const j = await r.json();
    const raw = j.models || j.data || j;
    const ids = (Array.isArray(raw) ? raw : [])
      .map(m => (typeof m === 'string' ? m : (m.id || m.name)))
      .filter(Boolean)
      .filter(id => !/:batch/i.test(id));
    this.models = Array.from(new Set(ids));
    return this.models;
  },
  /* so os que nao gastam saldo */
  async listLivre() { return (await this.list()).filter(id => this.eLivre(id)); },
  ready() { return typeof puter !== 'undefined' && puter.ai && typeof puter.ai.chat === 'function'; },

  /* token que deve ser usado AGORA.
     Ordem: (1) a conta logada NESTE navegador — que é o user-pays, cada um
     com a sua; (2) só se o site estiver no modo 'dono' e você for o dono,
     cai no armazem compartilhado. Visitante nunca gasta a cota de outro. */
  tokenDe() {
    if (typeof Pool !== 'undefined') {
      if (Pool.tokenParaUsar) return Pool.tokenParaUsar() || '';
      if (Pool.tokenAtualPuter) { const t = Pool.tokenAtualPuter(); if (t) return t; }
    }
    return '';
  },

  /* de quem é a cota que está sendo usada agora (pra mostrar na tela) */
  deQuem() {
    const meu = (typeof Pool !== 'undefined' && Pool.tokenAtualPuter) ? Pool.tokenAtualPuter() : '';
    if (meu) return 'sua conta';
    if (typeof Pool !== 'undefined' && Pool.modo && Pool.modo() === 'dono' && Pool.souDono()) return 'cota do dono do site';
    return 'sem conta';
  },

  /* saldo da conta, quando o Puter expoe. Silencioso: se nao der, devolve null
     (nunca quebra nada — e so pra voce ver o saldo chegando antes do erro). */
  async saldo(token) {
    const t = token || this.tokenDe();
    if (!t) return null;
    if (this._saldo && this._saldo.t === t && Date.now() - this._saldo.quando < 5 * 60e3) return this._saldo.v;
    let v = null;
    for (const url of ['https://api.puter.com/metering/usage']) {
      try {
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
        if (!r.ok) continue;
        const j = await r.json();
        const cand = [j?.usage?.allowanceInfo?.remaining, j?.allowanceInfo?.remaining, j?.remaining,
                      j?.usage?.remaining, j?.funding?.remaining, j?.balance, j?.credits, j?.credit];
        for (const c of cand) if (typeof c === 'number' && Number.isFinite(c)) { v = c; break; }
        if (v !== null) break;
      } catch (e) {}
    }
    this._saldo = { t, quando: Date.now(), v };
    return v;
  },

  /* ---------- DIAGNOSTICO DE SALDO ----------
     O erro "low balance" do Puter NAO e sempre "acabou o credito":
     ele aparece quando o custo ESTIMADO do pedido passa do que a conta
     tem. Pedido grande (historico + memoria + max_tokens alto do modelo)
     estoura com saldo sobrando. E se TODAS as contas falham no mesmo
     pedido, quase sempre nao e a conta: e o dispositivo/IP (o Puter mede
     por conta + aparelho) ou o pedido esta caro demais.

     est: ~4 caracteres por token (estimativa grosseira, serve pra ordem
     de grandeza de quem esta decidindo). */
  est: (messages, maxTok) => {
    const txt = (messages || []).map(m => typeof m.content === 'string' ? m.content
      : JSON.stringify(m.content || '')).join('\n');
    return { chars: txt.length, entrada: Math.ceil(txt.length / 4), saida: maxTok || maxTokens() };
  },

  /* deixa o pedido barato: corta o historico e os blocos gigantes */
  enxugar(messages, quantas = 6, limite = 4000) {
    const ms = (messages || []).slice();
    const sys = ms.filter(m => m.role === 'system');
    const resto = ms.filter(m => m.role !== 'system').slice(-quantas);
    const poda = m => ({ ...m, content: typeof m.content === 'string'
      ? (m.content.length > limite ? m.content.slice(0, limite) + '\n[...cortado para economizar cota]' : m.content)
      : m.content });
    return sys.map(poda).concat(resto.map(poda));
  },

  /* teste minúsculo por conta: responde em segundos e diz se AQUELA conta tem saldo.
     Usa o endpoint REST justamente porque ai o token é escolhido na mao
     (o puter.js nao deixa trocar a conta por chamada). */
  async teste(token, modelo = 'gpt-5-nano') {
    const t = token || this.tokenDe();
    if (!t) return { ok: false, err: 'sem token' };
    try {
      const r = await fetch(this.REST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
        body: JSON.stringify({ model: modelo, max_tokens: 8,
          messages: [{ role: 'user', content: 'ok' }] }),
      });
      if (!r.ok) {
        let d = '';
        try { const j = await r.json(); d = j.error?.message || j.error || JSON.stringify(j).slice(0, 160); } catch (e) {}
        return { ok: false, status: r.status, err: String(d || ('HTTP ' + r.status)) };
      }
      const j = await r.json();
      return { ok: true, resposta: textOf(j).slice(0, 40) };
    } catch (e) {
      return { ok: false, err: 'sem acesso ao endpoint REST (CORS/bloqueio/rede): ' + (e.message || e) };
    }
  },

  /* caminho REST: mesma coisa que o puter.js, mas escolhendo a conta na mao */
  async askREST(model, messages, onDelta, token, maxTok) {
    const t = token || this.tokenDe();
    if (!t) throw new Error('sem token do Puter (entre no Puter ou capture uma conta no armazem)');
    const r = await fetch(this.REST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
      body: JSON.stringify({ model, messages, stream: !!onDelta, max_tokens: maxTok || maxTokens() }),
    });
    if (!r.ok) {
      let d = '';
      try { const j = await r.json(); d = j.error?.message || j.error || j.message || JSON.stringify(j).slice(0, 300);
            if (typeof d !== 'string') d = JSON.stringify(d); } catch (e) {}
      throw new Error('Puter HTTP ' + r.status + ' ' + d);
    }
    if (onDelta && r.body && r.body.getReader) {
      const leitor = r.body.getReader(); const dec = new TextDecoder();
      let buf = '', cheio = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const linhas = buf.split('\n'); buf = linhas.pop();
        for (const l of linhas) {
          const s = l.trim(); if (!s.startsWith('data:')) continue;
          const dado = s.slice(5).trim(); if (!dado || dado === '[DONE]') continue;
          let j; try { j = JSON.parse(dado); } catch (e) { continue; }
          const t2 = textOf(j);
          if (t2) { cheio += t2; onDelta(t2); }
        }
      }
      if (!cheio.trim()) throw new Error('resposta vazia');
      return cheio;
    }
    const j = await r.json();
    const out = textOf(j);
    if (!out || !out.trim()) throw new Error('resposta vazia');
    if (onDelta) onDelta(out);
    return out;
  },

  async ask(model, messages, onDelta, token, maxTok) {
    /* sem puter.js (bloqueador de anuncios, internet instavel): vai de REST com o token do armazem */
    if (!this.ready()) return this.askREST(model, messages, onDelta, token, maxTok);
    /* com token explicito (conta escolhida do armazem) tambem vai de REST: e a
       unica via em que a conta desta chamada e de verdade a que voce pediu */
    if (token) return this.askREST(model, messages, onDelta, token, maxTok);
    let res;
    try {
      res = await puter.ai.chat(messages, { model, stream: !!onDelta, max_tokens: maxTok || maxTokens() });
    } catch (e) { throw new Error(_err(e)); }
    // o Puter as vezes RESOLVE com um objeto de erro em vez de rejeitar
    if (res && typeof res === 'object' && res.success === false) throw new Error(_err(res));
    if (onDelta && res && typeof res[Symbol.asyncIterator] === 'function') {
      let full = '';
      for await (const part of res) {
        if (part && part.error) throw new Error(_err(part.error));
        const t = textOf(part);
        if (t) { full += t; onDelta(t); }
      }
      if (!full.trim()) throw new Error('resposta vazia');
      return full;
    }
    const out = textOf(res);
    if (!out || !out.trim()) throw new Error('resposta vazia');
    if (onDelta) onDelta(out);
    return out;
  },
};

/* ---------- LISTA 2: Hugging Face Hub ---------- */
const HF = {
  models: null,
  /** todas as credenciais candidatas, na ordem: campo simples, cofre, armazem */
  creds() {
    const out = [];
    const t = LS.get('arkher_hf_token', '');
    if (t) out.push({ src: 'campo', token: t });
    if (typeof Vault !== 'undefined') { const c = Vault.pick('hf'); if (c) out.push({ src: 'vault', id: c.id, token: c.token }); }
    if (typeof Pool !== 'undefined') {
      const now = Date.now();
      for (const x of (Pool.local().hf || [])) if (!x.ate || x.ate < now) out.push({ src: 'pool', id: x.id, token: x.t });
    }
    return out;
  },
  token() { const c = this.creds(); return c.length ? c[0].token : ''; },
  async list() {
    if (this.models) return this.models;
    const url = 'https://huggingface.co/api/models?inference_provider=all'
      + '&pipeline_tag=text-generation&limit=1000&sort=downloads&direction=-1'
      + '&expand[]=inferenceProviderMapping';
    const r = await fetch(url);
    if (!r.ok) throw new Error('HF Hub HTTP ' + r.status);
    const arr = await r.json();
    const live = [];
    for (const m of arr) {
      let maps = m.inferenceProviderMapping || [];
      if (!Array.isArray(maps)) maps = Object.values(maps);
      if (maps.some(p => p && p.status === 'live' && (p.task === 'conversational' || !p.task))) live.push(m.id);
    }
    this.models = live;
    return live;
  },
  _fail(cred, msg) {
    if (!cred || !cred.id) return;
    if (cred.src === 'vault' && typeof Vault !== 'undefined') Vault.fail(cred.id, msg);
    if (cred.src === 'pool' && typeof Pool !== 'undefined') Pool.falhou('hf', cred.id, msg);
  },
  _ok(cred) {
    if (!cred || !cred.id) return;
    if (cred.src === 'vault' && typeof Vault !== 'undefined') Vault.ok(cred.id);
  },
  async ask(model, messages, onDelta) {
    const cred = this.creds()[0];
    if (!cred) throw new Error('sem token HF');
    const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cred.token },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 2048 }),
    });
    if (!r.ok) {
      let d = '';
      try { const j = await r.json(); d = j?.error?.message || j?.error || j?.message || ''; if (typeof d !== 'string') d = JSON.stringify(d); } catch (e) {}
      const msg = 'HTTP ' + r.status + ' ' + d;
      if (r.status === 401 || r.status === 402 || r.status === 429) this._fail(cred, msg);
      throw new Error(msg);
    }
    const j = await r.json();
    const t = textOf(j);
    if (!t || !t.trim()) throw new Error('resposta vazia');
    this._ok(cred);
    if (onDelta) onDelta(t);
    return t;
  },
};

/* ---------- erro fatal: trocar de modelo nao resolve ---------- */
function fatal(msg) {
  const e = String(msg).toLowerCase();
  return /\b401\b|\b403\b|invalid api key|unauthorized|permission|sem token|nao carregou|not logged|auth/.test(e);
}
/* ---------- erro do modelo: bane e segue ---------- */
function deadModel(msg) {
  const e = String(msg).toLowerCase();
  return /\b404\b|not found|does not exist|decommission|model_not_found|\b400\b|unsupported|not supported|no endpoints|invalid model/.test(e);
}
/* ---------- cota da conta (Puter): trocar de conta resolve ---------- */
function cota(msg) {
  return /\b429\b|quota|limit|usage|credit|insufficient|funds|permission_denied|usage-limited|too many/i.test(String(msg));
}

/* ============================================================
   CASCATA: Puter inteiro -> HF inteiro. So falha se TODOS falharem.
   ============================================================ */
/* ---------- LISTA 3: o no com GPU (Kaggle/PC) — modelos de ponta de graca ----------
   Aqui NAO se paga por token: o modelo roda na sua propria GPU. Por isso a
   lista e curada (o que cabe na VRAM), nao um catalogo de milhoes.       */
const GPU = {
  models: null,
  base() {
    if (typeof LS === 'undefined') return '';
    return (LS.get('arkher_kaggle', '') || LS.get('arkher_agent', '') || '').replace(/\/+$/, '');
  },
  pronto() { return !!this.base(); },
  async cat(recarregar) {
    const b = this.base();
    if (!b) throw new Error('sem no configurado (aba VM)');
    if (this.models && !recarregar) return this.models;
    const r = await fetch(b + '/infer' + (recarregar ? '?refresh=1' : ''));
    const j = await r.json();
    if (!j.ok) throw new Error(j.err || 'o no nao respondeu o catalogo');
    const ids = [];
    for (const m of (j.modelos || [])) {
      if (m.tarefa === 'chat' || m.tarefa === 'visao') ids.push('gpu:' + m.id);
    }
    for (const t of (j.treinados || [])) ids.push('gpu:local:' + t.nome);   // LoRA seu
    this.models = ids;
    this.info = j;
    return ids;
  },
  async ask(id, messages, onTry) {
    const b = this.base();
    const modelo = String(id).replace(/^gpu:/, '');
    const r = await fetch(b + '/infer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarefa: 'chat', modelo, messages, max_tokens: 2048 }),
    });
    const j = await r.json();
    if (!j.id) throw new Error(j.err || 'o no recusou o pedido');
    for (let i = 0; i < 150; i++) {                    // ate 5 min
      await new Promise(s => setTimeout(s, 2000));
      const st = await (await fetch(b + '/infer?job=' + j.id)).json();
      if (st.estado === 'rodando') { if (onTry) onTry({ id: modelo, src: 'gpu (pensando ' + (st.sec || 0) + 's)' }, 0); continue; }
      if (st.estado === 'pronto' && st.meta) {
        if (!st.meta.texto) throw new Error('o modelo nao devolveu texto');
        return st.meta.texto;
      }
      throw new Error((st.erro || 'falhou no no') + (st.como_resolver ? ' — ' + st.como_resolver : ''));
    }
    throw new Error('o no demorou demais (5 min)');
  },
};

const Arkher = {
  /* quem recusa o que: fica gravado e o conselho evita esses modelos naquele tipo de pedido */
  recusas: (typeof LS !== 'undefined' && LS.get('arkher_recusas', null)) || {},
  _recusou(src, id) {
    const k = src + ':' + id;
    this.recusas[k] = (this.recusas[k] || 0) + 1;
    try { LS.set('arkher_recusas', this.recusas); } catch (e) {}
  },
  recusaPior(src, id) { return (this.recusas[src + ':' + id] || 0) >= 2; },
  _recusaAte: {},   // 'src:id' -> quando volta a ser tentado
  recusado(src, id) { const t = this._recusaAte[src + ':' + id]; return !!t && t > Date.now(); },
  _banirRecusa(src, id, ms) { this._recusaAte[src + ':' + id] = Date.now() + (ms || 10 * 60 * 1000); },

  /* quem paga o quê (o que decide a ordem da cascata):
       'auto'     = gratis primeiro (via gratis do Puter + provedores gratis), depois o que gasta saldo
       'gratis'   = SO o que nao custa nada (Puter :free, provedores gratis, no com GPU)
       'completo' = tudo, inclusive o que consome saldo do Puter e credito do HF */
  modo(v) {
    if (v) { try { LS.set('arkher_economia', v); } catch (e) {} }
    try { return LS.get('arkher_economia', 'auto'); } catch (e) { return 'auto'; }
  },

  /* ---------- ROTEADOR DE QUALIDADE ----------
     A top tier custa saldo; entao a pergunta certa nao é "como ter de graca",
     é "em quais mensagens a top tier muda o resultado?". Estas sao essas:
     texto longo, codigo, varias etapas, imagem, depuracao. Mensagem curta
     ("bom dia", "resume isso", "traduz") nao melhora com modelo de ponta —
     vai pro gratis e o saldo fica pra quando importa.
       sempre     = top tier em tudo (queima rapido, qualidade maxima)
       automatico = decide pela mensagem (padrao)
       economico  = top tier só em pedido grande de verdade        */
  topModo(v) {
    if (v) { try { LS.set('arkher_top_modo', v); } catch (e) {} }
    try { return LS.get('arkher_top_modo', 'auto'); } catch (e) { return 'auto'; }
  },

  /* heuristica: 0..10 de "quanto essa mensagem merece a ponta" */
  mereceTop(messages) {
    const ms = messages || [];
    const ultima = (ms.filter(m => m.role === 'user').pop() || {}).content;
    const txt = (typeof ultima === 'string' ? ultima
      : JSON.stringify(ultima || '')).toLowerCase();
    const hist = ms.filter(m => m.role !== 'system').length;
    let n = 0;
    if (/^\s*(!top|\/top|top:|usa a top|modo top)/i.test(txt)) return 10;   // pediu na mao
    if (txt.length > 300) n += 2;
    if (/```|function |class |import |def |const |erro|stack trace|exception/.test(txt)) n += 2;
    if (/analis|arquitet|refator|compar|planej|passo a passo|debug|otimiz|projet|estrateg/.test(txt)) n += 2;
    if (Array.isArray(ultima) && ultima.some(p => p && p.type === 'image_url')) n += 3;
    if (hist > 8) n += 1;
    if (txt.length < 80 && !/codigo|erro|por que|como funciona/.test(txt)) n -= 2;
    return Math.max(0, Math.min(10, n));
  },

  /* deve gastar saldo nesta mensagem? */
  querTop(messages) {
    const m = this.topModo();
    if (m === 'sempre') return true;
    if (m === 'gratis' || m === 'economico') return this.mereceTop(messages) >= 7;
    return this.mereceTop(messages) >= 4;        // automatico
  },

  /* ---------- medidor de consumo (prova de onde o saldo foi) ---------- */
  usoCarregar() {
    const hoje = new Date().toISOString().slice(0, 10);
    let u = null;
    try { u = LS.get('arkher_uso', null); } catch (e) {}
    if (!u || u.dia !== hoje) u = { dia: hoje, top: 0, gratis: 0, modelos: {} };
    return u;
  },
  usoAnotar(src, modelo, viaLivre) {
    const u = this.usoCarregar();
    const gratis = src === 'free' || viaLivre || src === 'gpu';
    if (gratis) u.gratis++; else u.top++;
    u.modelos[modelo] = (u.modelos[modelo] || 0) + 1;
    u.ultimo = Date.now();
    try { LS.set('arkher_uso', u); } catch (e) {}
    return u;
  },
  uso() { return this.usoCarregar(); },

  /* ---------- METRICAS DO SITE (anonimas de verdade) ----------
     O painel do UPG precisa mostrar numero: quantas sessoes, quantos
     pedidos, quanto foi gratis. Isso é contador, e contador NÃO precisa
     de identidade — entao aqui só existem INTEIROS:

       • nenhum token, e-mail, username ou id de conta é gravado;
       • nenhuma cota é lida, transferida ou somada ao nome de ninguem;
       • "sessao" = uma vez por navegador por dia (o proprio navegador
         marca que ja contou), sem dizer quem é.

     Se o Sync (Supabase) estiver ligado, os contadores vao para o doc
     compartilhado e o painel mostra o total do site. Sem Sync, tudo
     fica local e o painel mostra só o seu navegador.                   */
  metricaLigar(v) {
    if (v !== undefined) { try { LS.set('arkher_metrica_on', !!v); } catch (e) {} }
    try { return LS.get('arkher_metrica_on', true) !== false; } catch (e) { return true; }
  },
  metricsLocal() {
    const hoje = new Date().toISOString().slice(0, 10);
    let m = null;
    try { m = LS.get('arkher_metrics', null); } catch (e) {}
    if (!m || m.dia !== hoje) m = { dia: hoje, sessoes: 0, pedidos: 0 };
    return m;
  },
  _metricsSalvar(m) { try { LS.set('arkher_metrics', m); } catch (e) {} },

  /* historico ANONIMO por dia: {dia, sessoes, pedidos, pagos}. Só inteiros.
     É isso que vira o "log de movimento" do painel: quanta gente passou e
     quanta capacidade o site ganhou em cada dia. Nenhuma linha aponta para
     uma pessoa, e nenhuma linha diz "sua cota aumentou" — porque cota de
     visitante não entra na cota de ninguém.                               */
  histLer() {
    let h = null;
    try { h = LS.get('arkher_metrics_hist', null); } catch (e) {}
    return Array.isArray(h) ? h.slice(0, 30) : [];   // teto de 30 dias, sempre
  },
  _histGravar(dia, campo, n) {
    if (!n) return;
    const h = this.histLer();
    let d = h.find(x => x.dia === dia);
    if (!d) { d = { dia: dia, sessoes: 0, pedidos: 0, pagos: 0 }; h.push(d); }
    d[campo] = (d[campo] || 0) + n;
    h.sort((a, b) => (a.dia < b.dia ? 1 : -1));
    try { LS.set('arkher_metrics_hist', h.slice(0, 30)); } catch (e) {}
  },

  /* conta UMA sessao por navegador por dia */
  async metricaSessao() {
    if (!this.metricaLigar()) return null;
    const m = this.metricsLocal();
    if (m.sessoes > 0) return m;                 // ja contou hoje neste navegador
    m.sessoes = 1;
    this._metricsSalvar(m);
    this._histGravar(m.dia, 'sessoes', 1);
    await this._metricaSite(1, 0);
    return m;
  },

  /* um pedido concluido: soma no local e (se ligado) no contador do site */
  async metricaPedido(gastouSaldo) {
    if (!this.metricaLigar()) return null;
    const m = this.metricsLocal();
    m.pedidos = (m.pedidos || 0) + 1;
    this._metricsSalvar(m);
    this._histGravar(m.dia, 'pedidos', 1);
    if (gastouSaldo) this._histGravar(m.dia, 'pagos', 1);
    await this._metricaSite(0, 1, gastouSaldo ? 1 : 0);
    return m;
  },

  /* incrementa os contadores compartilhados — SO INTEIROS, nada mais */
  async _metricaSite(sessoes, pedidos, pagos) {
    try {
      if (!(window.Sync && Sync.get && Sync.ligado && Sync.ligado())) return null;
      const k = 'arkher_metrics_site';
      const hoje = new Date().toISOString().slice(0, 10);
      const atual = (await Sync.get(k)) || {};
      const novo = (atual.dia === hoje) ? atual : { dia: hoje, sessoes: 0, pedidos: 0, pagos: 0 };
      novo.sessoes = (novo.sessoes || 0) + (sessoes || 0);
      novo.pedidos = (novo.pedidos || 0) + (pedidos || 0);
      novo.pagos = (novo.pagos || 0) + (pagos || 0);
      await Sync.set(k, novo);
      return novo;
    } catch (e) { return null; }
  },

  /* o que o painel mostra */
  async metricas() {
    const local = this.metricsLocal();
    let site = null;
    try {
      if (window.Sync && Sync.get && Sync.ligado && Sync.ligado()) site = await Sync.get('arkher_metrics_site');
    } catch (e) {}
    const u = this.usoCarregar();
    const contas = (typeof Pool !== 'undefined' && Pool.capacidade) ? Pool.capacidade() : { contas: 0, puter: 0, hf: 0, gratis: 0 };
    let gratis = 0;
    try { gratis = (typeof Free !== 'undefined' && Free.prontos) ? Free.prontos().length : 0; } catch (e) {}
    return { local, site, uso: u, contas, gratis, hist: this.histLer() };
  },

  async rank(stage) {
    const out = { puterLivre: [], puter: [], free: [], hf: [], gpu: [] };
    try {
      const ids = (await Puter.list()).slice().sort((a, b) => scoreFor(b, stage) - scoreFor(a, stage));
      for (const id of ids) (Puter.eLivre(id) ? out.puterLivre : out.puter).push(id);
    } catch (e) { out.puterErr = _err(e); }
    /* lista 1-B: provedores gratuitos com chave propria (freeai.js) */
    if (typeof Free !== 'undefined' && Free.catalogo) {
      try {
        const todos = await Free.catalogo();
        /* papel: quem e gratis fica no bloco zero; quem e 'top' (API que voce
           paga/credito) entra junto do bloco pago — assim a ponta so gasta
           quando a mensagem merece, igual o Puter. */
        out.free = todos.filter(x => x.papel !== 'top').sort((a, b) => scoreFor(b.id, stage) - scoreFor(a.id, stage));
        out.freeTop = todos.filter(x => x.papel === 'top').sort((a, b) => scoreFor(b.id, stage) - scoreFor(a.id, stage));
      } catch (e) { out.freeErr = _err(e); }
    }
    try { out.hf = (await HF.list()).slice().sort((a, b) => scoreFor(b, stage) - scoreFor(a, stage)); }
    catch (e) { out.hfErr = _err(e); }
    try { out.gpu = await GPU.cat(); }
    catch (e) { out.gpuErr = _err(e); }
    return out;
  },

  /* melhor modelo da via gratis do Puter (o que nao gasta saldo) */
  melhorLivre(lista, stage) {
    const ok = (lista || []).filter(id => Breaker.ok('puter:' + id));
    if (!ok.length) return '';
    return ok.slice().sort((a, b) => scoreFor(b, stage) - scoreFor(a, stage))[0];
  },

  /* ainda existe conta Puter com saldo no armazem? (sem armazem, confia na conta logada) */
  temSaldoPuter() {
    if (Puter.livre && (!Pool || !Pool.temSaldo || !Pool.temSaldo())) return false;
    if (typeof Pool === 'undefined' || !Pool.temSaldo) return true;
    const o = Pool.local();
    if (!(o.puter || []).length) return true;   // conta avulsa logada no navegador
    return Pool.temSaldo();
  },

  /**
   * Monta as mensagens finais: regras aprendidas + memoria neural (RAG) + assunto.
   * Nao mexe no que voce escreveu: acrescenta UM bloco de sistema na frente.
   */
  async preparar(messages, opts = {}) {
    if (typeof Neural === 'undefined') return messages;
    const pergunta = (messages.filter(m => m.role === 'user').pop() || {}).content || '';
    try {
      if (!Neural.pronto) await Neural.init();
      const regras = Neural.regrasTexto(18);
      const ctx = opts.semContexto ? '' : await Neural.contexto(pergunta, opts.memoria || 5);
      if (!regras && !ctx) return messages;
      const bloco = 'MEMORIA DO ARKHER (use isto quando for relevante; se nao tiver nada a ver, ignore):\n'
        + (regras ? 'Regras aprendidas:\n' + regras + '\n\n' : '')
        + (ctx ? 'Trechos guardados:\n' + ctx : '');
      const sys = messages.find(m => m.role === 'system');
      if (sys) sys.content = sys.content + '\n\n' + bloco;
      else messages = [{ role: 'system', content: bloco }].concat(messages);
    } catch (e) { /* memoria e bonus: nunca derruba a conversa */ }
    return messages;
  },

  async ask(messages, opts = {}) {
    const stage = opts.stage || 'chat';
    const onTry = opts.onTry || (() => {});
    const onDelta = opts.onDelta || null;
    const maxTries = opts.maxTries || 25;
    const forced = opts.model;
    const modo = opts.modo || this.modo();      // auto | gratis | completo
    const soGratis = modo === 'gratis' || opts.gratis === true;

    /* ---------- TRABALHO DE FUNDO: NUNCA na cota do Puter ----------
       Tarefa auxiliar (destilar regra, resumir, indexar, operário
       trabalhando) NÃO pode gastar o crédito de ninguém. Ela usa o que
       é grátis de verdade: modelos :free do Puter, provedores grátis do
       site, Hugging Face (cota do SITE) e o nó com GPU.
       Regra fixa: fundo = zero crédito de usuário. Sempre.              */
    const deFundo = opts.fundo === true;

    /* ---------- BIBLIOTECA COMUM (custo zero) ----------
       Antes de escolher qualquer provedor: alguém já perguntou isso?
       Se sim, a resposta sai do que o site já tem — instantânea e sem
       gastar crédito de ninguém. É o "cada uso deixa o site mais barato":
       o que sustenta o site é o TRABALHO já feito, não a cota de ninguém. */
    let chaveCache = '';
    try {
      if (opts.cache !== false && typeof Resp !== 'undefined' && Resp.posso(messages)) {
        chaveCache = Resp.chave(messages, stage);
        const it = await Resp.buscar(chaveCache);
        if (it) {
          try { this.metricaPedido(false); } catch (e) {}     // conta como grátis
          return { text: it.t, model: (it.m || 'resposta do site'), src: 'cache',
                   prov: 'site', viaLivre: true, gastouSaldo: false, tried: 0, doCache: true };
        }
      }
    } catch (e) { chaveCache = ''; }

    const r = await this.rank(stage);
    let fila = [];
    if (forced) {
      /* free:groq/llama-3.3-70b-versatile  ·  hf:…  ·  gpu:…  ·  resto = Puter */
      if (forced.startsWith('free:')) {
        const resto = forced.slice(5);
        const i = resto.indexOf('/');
        const prov = i > 0 ? resto.slice(0, i) : resto;
        const modelo = i > 0 ? resto.slice(i + 1) : '';
        fila = [{ src: 'free', prov, id: modelo || '(auto)', modelo }];
      } else {
        const src = forced.startsWith('hf:') ? 'hf' : forced.startsWith('gpu:') ? 'gpu' : 'puter';
        fila = [{ src, id: forced.replace(/^(hf|gpu):/, '') }];
      }
    } else {
      /* o que NAO custa nada, em ordem de preferencia */
      const zero = [];
      for (const id of r.puterLivre) zero.push({ src: 'puter', id, livre: true });
      for (const it of r.free) zero.push(it);
      /* o que custa saldo (Puter pago) / credito (HF) */
      const forcarTudo = modo === 'completo';            // usuario mandou usar tudo
      const comSaldo = forcarTudo || this.temSaldoPuter();
      const pago = [];
      if (!soGratis && !deFundo && comSaldo) for (const id of r.puter) pago.push({ src: 'puter', id });
      if (!soGratis && !deFundo) for (const it of (r.freeTop || [])) pago.push(it);   // provedores 'top' seus
      /* roteador: esta mensagem merece a top tier? (top: false/true força) */
      const querTop = (opts.top === true) || (opts.top !== false && this.querTop(messages));

      if (soGratis) {
        /* MODO SO GRATIS: nada que gaste saldo do Puter ou credito do HF */
        fila = zero.slice();
      } else if (deFundo) {
        /* TRABALHO DE FUNDO: grátis + HF (cota do site) + GPU. O crédito
           do Puter e os provedores 'top' seus ficam de fora — trabalho
           auxiliar não come o saldo de ninguém. */
        fila = zero.slice();
        for (const id of (r.hf || [])) fila.push({ src: 'hf', id });
        for (const id of (r.gpu || [])) fila.push({ src: 'gpu', id });
      } else {
        /* Com saldo E merecendo a ponta: top tier primeiro (qualidade).
           Caso contrario: gratis primeiro e o pago entra depois, como reserva.
           Sem saldo, a via gratis assume — e o chat nao para. */
        fila = (comSaldo && querTop) ? pago.concat(zero) : zero.slice();
        if (!(comSaldo && querTop)) fila = fila.concat(pago);
        for (const id of r.hf) fila.push({ src: 'hf', id });
      }
      if (opts.preferirGPU && (r.gpu || []).length) {
        // tarefa pesada de game dev (3D, visao, codigo longo): usa a GPU primeiro
        fila = (r.gpu || []).map(id => ({ src: 'gpu', id })).concat(fila);
      } else {
        // o no com GPU entra por ultimo (antes de desistir) e com o seu LoRA na frente
        for (const id of (r.gpu || []).slice().sort((a, b) => (b.startsWith('gpu:local:') ? 1 : 0) - (a.startsWith('gpu:local:') ? 1 : 0))) fila.push({ src: 'gpu', id });
      }
    }
    // VISAO: so modelos que enxergam imagem (aba Piloto)
    if (opts.visao && !forced) {
      const VE = /gpt-?4|gpt-?5|4o|fable|claude|sonnet|opus|haiku|gemini|pixtral|llava|qwen.*vl|intern-?vl|molmo|vision|multimodal|omni|grok.*(vision|4)|llama.*(3\.2|4).*(11|90|vision|scout|maverick)|free/i;
      const f2 = fila.filter(x => VE.test(x.id) && !/whisper|tts|embed|audio/i.test(x.id));
      if (f2.length) fila = f2;
    }
    if (!fila.length) {
      const semChave = (modo === 'gratis')
        ? ' — e nenhum provedor gratis tem chave: cadastre em Config > Provedores gratis.'
        : '';
      throw new Error('nenhum catalogo disponivel: ' + (r.puterErr || '') + ' ' + (r.hfErr || '') + semChave);
    }
    // quem costuma recusar pedido legal vai pro fim da fila (ordem estavel)
    fila.sort((a, b) => ((this.recusas[a.src + ':' + a.id] || 0) - (this.recusas[b.src + ':' + b.id] || 0)));

    const hasHF = !!HF.token();
    const hasPuter = Puter.ready() || !!Puter.tokenDe();   // sem puter.js ainda da pra ir de REST
    let tried = 0, lastErr = null, puterMorto = false, hfMorto = false;
    const provMorta = {};          // provedor gratis que falhou 3x sai da fila desta rodada
    for (const item of fila) {
      if (tried >= maxTries) break;
      if (item.src === 'hf' && (!hasHF || hfMorto)) continue;
      if (item.src === 'puter' && (!hasPuter || (puterMorto && !item.livre))) continue;
      if (item.src === 'free' && (provMorta[item.prov] || 0) >= 3) continue;
      if (!Breaker.ok(item.src + ':' + item.id)) continue;
      if (this.recusado(item.src, item.id)) continue;
      tried++;
      onTry(item, tried);
      try {
        let t;
        const perguntar = async (msgs) => {
          if (item.src === 'puter') {
            try {
              Puter._barato = false;      // marca se a resposta veio de um pedido enxuto
              /* se a conta ja mostrou que tem pouco saldo, nem tenta o pedido
                 caro: manda enxuto desde a primeira tentativa */
              if (Puter.limiteBaixo && !item.livre && !Puter.eLivre(item.id)) {
                Puter._barato = true;
                return await Puter.ask(item.id, Puter.enxugar(msgs), onDelta,
                  undefined, Math.min(512, Puter.limiteBaixo));
              }
              return await Puter.ask(item.id, msgs, onDelta);
            } catch (e1) {
              const m1 = _err(e1);

              /* ---------- O CASO "LOW BALANCE" ----------
                 1) PEDIDO CARO: o 402 do Puter aparece quando o custo ESTIMADO
                    deste pedido passa do que a conta tem. Entao a primeira
                    tentativa é repetir BARATO: menos historico (enxugar) e
                    menos tokens de saida. Muita vez passa e voce nem percebe.
                 2) CONTA: repete o mesmo pedido com o token de CADA outra conta
                    do armazem, pelo endpoint REST — é a única forma de garantir
                    que a chamada saiu mesmo por outra conta (o puter.js não
                    aceita trocar a conta por chamada). */
              if (saldoLow(m1) && !Puter.eLivre(item.id)) {
                const e = Puter.est(msgs);
                const tk = Puter.tokenDe();
                onTry({ id: item.id, src: 'puter (barato: ' + Math.min(512, maxTokens()) + ' tokens)' }, tried);
                try {
                  const t2 = await Puter.askREST(item.id, Puter.enxugar(msgs), onDelta, tk, 512);
                  Puter.limiteBaixo = 512;      // funciona assim: economiza as proximas
                  Puter._barato = true;
                  return t2;
                } catch (e2) { lastErr = _err(e2); }

                if (typeof Pool !== 'undefined' && Pool.contasPuter) {
                  const outras = Pool.contasPuter().filter(k => k.t !== tk);
                  for (const k of outras.slice(0, 6)) {
                    onTry({ id: item.id, src: 'puter (conta ' + k.nome + ' via REST)' }, tried);
                    try {
                      return await Puter.askREST(item.id, msgs, onDelta, k.t);
                    } catch (e3) {
                      lastErr = _err(e3);
                      if (!saldoLow(lastErr)) continue;
                      /* essa conta tambem tem pouco: ainda da pra arrancar uma
                         resposta enxuta dela antes de descartar */
                      try {
                        const t3 = await Puter.askREST(item.id, Puter.enxugar(msgs), onDelta, k.t, 512);
                        Puter.limiteBaixo = 512;
                        Puter._barato = true;
                        return t3;
                      } catch (e4) {
                        lastErr = _err(e4);
                        if (typeof Pool.marcarSemSaldo === 'function') await Pool.marcarSemSaldo(k.t, lastErr);
                      }
                    }
                  }
                }
                lastErr = 'Puter sem saldo para este pedido (' + e.entrada + ' tokens de entrada + '
                  + e.saida + ' de saida): ' + m1;
                throw new Error(lastErr);
              }
              throw e1;
            }
          }
          if (item.src === 'free') {
            /* provedor gratis: se o modelo veio vazio, o Free escolhe o melhor da lista */
            if (!item.modelo) {
              const ms = await Free.listar(item.prov, true);
              if (!ms.length) throw new Error('sem modelos no ' + item.prov);
              item.modelo = ms[0]; item.id = ms[0];
            }
            return await Free.ask(item.prov, item.modelo, msgs, onDelta);
          }
          if (item.src === 'hf') return await HF.ask(item.id, msgs, onDelta);
          return await GPU.ask(item.id, msgs, onTry);
        };
        t = await perguntar(messages);
        /* um modelo PAGO do Puter respondeu = a conta tem saldo de verdade:
           limpa a marca da via gratis e volta a usar a qualidade cheia */
        if (item.src === 'puter' && !Puter.eLivre(item.id)) {
          try {
            if (typeof Pool !== 'undefined' && Pool.marcarComSaldo) await Pool.marcarComSaldo(Puter.tokenDe());
            if (Puter.livre) Puter.livre = false;
            if (!Puter._barato) Puter.limiteBaixo = 0;   // pedido cheio passou: saldo saudavel
          } catch (e) {}
        }
        // ANTI-RECUSA: recusa para pedido legal nao e resposta — reforca e, se insistir, troca de modelo
        if (opts.politica !== false && typeof recusaDe === 'function' && recusaDe(t)) {
          onTry({ id: item.id, src: item.src + ' (recusou — reforçando)' }, tried);
          const reforcadas = messages.concat([
            { role: 'user', content: (typeof REFORCO_ARKHER !== 'undefined' ? REFORCO_ARKHER : '') },
          ]);
          let t2 = '';
          try { t2 = await perguntar(reforcadas); } catch (e) { t2 = ''; }
          if (t2 && !recusaDe(t2)) {
            t = t2;                       // resolveu no reforco
          } else {
            this._recusou(item.src, item.id);
            this._banirRecusa(item.src, item.id, 10 * 60 * 1000);
            onTry({ id: item.id, src: item.src + ' (recusou de novo — outro modelo)' }, tried);
            lastErr = 'o modelo ' + item.id + ' recusou um pedido legal (trocando de modelo)';
            continue;
          }
        }
        // APRENDIZADO AUTOMATICO: guarda o par pergunta/resposta como dado de treino
        const ehRecusa = (typeof recusaDe === 'function') && recusaDe(t);
        if (opts.licao !== false && !ehRecusa && typeof Neural !== 'undefined' && Neural.pronto) {
          try {
            const p = (messages.filter(m => m.role === 'user').pop() || {}).content || '';
            if (Neural.cfg.auto && Date.now() - (this._ultimaLicao || 0) > 30000) {
              this._ultimaLicao = Date.now();
              Neural.licao(p, t, { modelo: item.id });
            }
          } catch (e) {}
        }
        const gastou = !(item.src === 'free' || item.livre || item.src === 'gpu');
        try { this.usoAnotar(item.src, item.id, item.livre); } catch (e) {}
        try { this.metricaPedido(gastou); } catch (e) {}
        /* a resposta vira patrimônio do site (só se passar pelos filtros) */
        try {
          if (chaveCache && typeof Resp !== 'undefined') Resp.guardar(chaveCache, t, item.id);
        } catch (e) {}
        return { text: t, model: item.id, src: item.src, prov: item.prov, viaLivre: !!item.livre,
                 gastouSaldo: !(item.src === 'free' || item.livre || item.src === 'gpu'), tried };
      } catch (e) {
        const msg = _err(e);
        lastErr = msg;
        if (item.src === 'puter') {
          /* --- O CASO DO "LOW BALANCE" -------------------------------------
             O saldo da conta acabou. O Puter NAO morre: ele muda de pista.
             1) marca a conta como sem-saldo (ela continua valendo pra via gratis);
             2) tenta outra conta sua que ainda tenha saldo;
             3) sem outra conta: repete o pedido num modelo :free do Puter,
                que nao gasta nada, com a MESMA conta zerada;
             4) se nem isso: segue a cascata (provedores gratis / HF / GPU).  */
          if (saldoLow(msg) && !Puter.eLivre(item.id)) {
            const tk = Puter.tokenDe();
            if (typeof Pool !== 'undefined' && Pool.marcarSemSaldo) await Pool.marcarSemSaldo(tk, msg);
            Puter.livre = true;
            onTry({ id: item.id, src: 'puter (saldo acabou — indo pra via gratis)' }, tried);
            if (typeof Pool !== 'undefined' && Pool.girarPuter) {
              const g = await Pool.girarPuter(msg, { precisoSaldo: true });
              if (g.ok) {
                try {
                  const t2 = await Puter.ask(item.id, messages, onDelta);
                  return { text: t2, model: item.id, src: 'puter', tried };
                } catch (e2) { lastErr = _err(e2); if (!saldoLow(lastErr)) { /* segue */ } }
              }
            }
            const fr = this.melhorLivre(r.puterLivre, stage);
            if (fr) {
              try {
                const t3 = await Puter.ask(fr, messages, onDelta);
                onTry({ id: fr, src: 'puter (via grátis)' }, tried);
                return { text: t3, model: fr, src: 'puter', viaLivre: true, tried };
              } catch (e3) { lastErr = _err(e3); }
            }
            lastErr = 'Puter sem saldo (' + msg + ') — seguindo pelos provedores grátis';
            continue;
          }
          if (fatal(msg)) {                     // auth/401: trocar de modelo nao resolve
            if (forced) throw new Error('Puter: ' + msg);
            puterMorto = true; continue;
          }
          if (cota(msg)) {                      // cota/limite do modelo: nao derruba a via gratis
            if (!item.livre) Breaker.ban('puter:' + item.id, 60 * 1000);
            if (forced) throw new Error('Puter: ' + msg + ' — e nao ha outra lista para continuar (Config).');
            continue;
          }
        }
        if (item.src === 'hf' && /\b401\b|\b402\b/.test(msg)) {
          hfMorto = true;                        // credito do HF acabou: nao insiste em 1000 modelos
          lastErr = 'Hugging Face: ' + msg;
          continue;
        }
        if (item.src === 'free') {
          const p = (typeof Free !== 'undefined' && Free.prov(item.prov)) || { nome: item.prov };
          provMorta[item.prov] = (provMorta[item.prov] || 0) + 1;
          if (provMorta[item.prov] >= 3) onTry({ id: '-', src: p.nome + ' (sem cota agora — pulando)' }, tried);
          Breaker.ban(item.src + ':' + item.id, /401|403|402/.test(msg) ? 10 * 60 * 1000 : 5 * 60 * 1000);
          continue;
        }
        if (deadModel(msg)) Breaker.ban(item.src + ':' + item.id, 30 * 60 * 1000);
        else Breaker.ban(item.src + ':' + item.id, 60 * 1000);
        if (/\b429\b|rate/i.test(msg)) await new Promise(s => setTimeout(s, 1200));
      }
    }
    if (!tried) {
      const temFree = (typeof Free !== 'undefined' && Free.temAlgum && Free.temAlgum());
      if (!hasPuter && !hasHF && !temFree) throw new Error('nenhum provedor disponivel: puter.js nao carregou, nao ha token HF e nenhum provedor gratis tem chave (Config).');
      throw new Error('nenhum modelo elegivel (todos em quarentena?). Use "Limpar quarentena" em Config.');
    }
    throw new Error((lastErr || 'nenhum modelo respondeu') + ' (tentei ' + tried + ')');
  },
};

if (typeof window !== 'undefined') {
  window.Arkher = Arkher; window.Nexus = Arkher; window.Puter = Puter; window.HF = HF;
  window.GPU = GPU;
  window.Breaker = Breaker; window.scoreFor = scoreFor; window.LS = LS;
  window.saldoLow = saldoLow; window.maxTokens = maxTokens;
}
if (typeof module !== 'undefined') {
  module.exports = { Arkher, Puter, HF, GPU, Breaker, scoreFor, fatal, deadModel, textOf, saldoLow, maxTokens };
}
