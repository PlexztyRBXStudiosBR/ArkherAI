/* ============================================================
   RESP (economia compartilhada) — o que sustenta o site é o TRABALHO,
   não a cota.

   A ideia que este arquivo implementa, dita do jeito certo:

     O crédito, quando alguém usa, ACABA. Ele compra uma resposta e some —
     não sobra nada dele, não vira saldo, não vira bônus, não sustenta
     ninguém. (Isso é física de crédito, não regra de contrato: a conta
     paga o custo daquela inferência e o valor é consumido ali.)

     O que SOBRA e continua valendo é a RESPOSTA. Se alguém já perguntou
     aquilo, a próxima pessoa não precisa pagar de novo — o site responde
     do que já foi feito, de graça.

   É essa a tradução honesta de "usar o que ele já usou para sustentar
   todo o site": o site reaproveita o TRABALHO já pago. Um usuário a mais
   deixa o site mais barato para todos, porque a biblioteca comum cresce.

   Regras de privacidade (todas verificadas em teste_cache.js):
     • guardamos o HASH da pergunta, nunca o texto dela;
     • só a PRIMEIRA pergunta de uma conversa (sem histórico, que é onde
       cabe contexto pessoal);
     • nada que cheire a dado pessoal entra: senha, token, CPF, cartão,
       e-mail, telefone, endereço, CEP, OTP;
     • a resposta também passa pelo filtro antes de ser guardada;
     • dá para desligar em Config a qualquer momento.
   ============================================================ */
'use strict';

const Resp = {
  LIMITE_ITENS: 200,          // quantas respostas a biblioteca guarda
  LIMITE_TEXTO: 4000,         // resposta maior que isso não entra
  MIN_PERGUNTA: 24,           // pergunta curta demais não vale a pena

  ON(v) {
    if (v !== undefined) LS.set('arkher_cache_on', !!v);
    return LS.get('arkher_cache_on', true) !== false;   // ligado por padrão
  },

  /* hash FNV-1a: a pergunta NAO é guardada, só a impressão digital dela */
  _hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16) + '-' + s.length.toString(16);
  },

  normalizar(s) {
    return String(s || '').toLowerCase()
      .replace(/\s+/g, ' ').trim();
  },

  /* o que nao pode entrar na biblioteca comum */
  /* Duas camadas, porque as duas falham sozinhas:
       (a) PALAVRAS que denunciam o assunto (senha, cpf, telefone…);
       (b) FORMATOS que denunciam o dado (e-mail, CPF, cartão, telefone). */
  SENSIVEL: new RegExp(
      // (a) palavras
      '(senha|password|passwd|\\btoken\\b|api[ _-]?key|chave (de|api)|secret|segredo'
    + '|\\bcpf\\b|\\bcnpj\\b|\\brg\\b|cart[ãa]o|\\bcvv\\b|\\bcep\\b|\\bendere[çc]o\\b'
    + '|\\botp\\b|2fa|autentica[çc][ãa]o de dois fatores'
    + '|\\btelefone\\b|\\bcelular\\b|whatsapp|\\bfone\\b|\\bzap\\b'
    + '|\\bmeu nome\\b|\\bminha idade\\b|\\bdata de nascimento\\b'
    + '|\\bconta banc[áa]ria\\b|\\bag[êe]ncia\\b|\\bmeu c[óo]digo\\b)'
      // (b) formatos
    + '|[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}'
    + '|\\b\\d{3}\\.\\d{3}\\.\\d{3}-?\\d{2}\\b'
    + '|\\b\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-?\\d{2}\\b'
    + '|\\b\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}\\b'                 // cartão
    + '|(?:\\+?\\d{1,2}[ -]?)?\\(?\\d{2}\\)?[ -]?\\d{4,5}[- ]?\\d{4}\\b'      // telefone
    + '|\\b\\d{5}-?\\d{3}\\b'                                       // CEP
  , 'i'),

  sensivel(txt) { return this.SENSIVEL.test(String(txt || '')); },

  /* esta conversa pode usar a biblioteca comum? */
  posso(messages) {
    if (!this.ON()) return false;
    const ms = (messages || []).filter(m => m && m.role !== 'system');
    if (ms.length !== 1) return false;                    // só a 1a pergunta
    const p = ms[0];
    if (!p || p.role !== 'user') return false;
    if (typeof p.content !== 'string') return false;      // visão/imagem fica fora
    const q = p.content.trim();
    if (q.length < this.MIN_PERGUNTA || q.length > 2000) return false;
    if (this.sensivel(q)) return false;
    return true;
  },

  chave(messages, etapa) {
    const ms = (messages || []).filter(m => m && m.role !== 'system');
    const q = ms.length ? String(ms[ms.length - 1].content || '') : '';
    return (etapa || 'chat') + ':' + this._hash(this.normalizar(q));
  },

  /* onde guardar: no doc compartilhado se o Sync estiver ligado, senao local */
  async _ler() {
    try {
      if (window.Sync && Sync.ligado && Sync.ligado()) {
        const v = await Sync.get('arkher_cache');
        if (v && typeof v === 'object') return v;
      }
    } catch (e) {}
    const v = LS.get('arkher_cache', null);
    return (v && typeof v === 'object') ? v : {};
  },

  async _gravar(obj) {
    try {
      if (window.Sync && Sync.ligado && Sync.ligado()) { await Sync.set('arkher_cache', obj); return; }
    } catch (e) {}
    LS.set('arkher_cache', obj);
  },

  /** achou? devolve {t: texto, m: modelo, n: usos} */
  async buscar(chave) {
    if (!this.ON()) return null;
    const o = await this._ler();
    const it = o[chave];
    if (!it || !it.t) return null;
    it.n = (it.n || 0) + 1;
    it.ultimo = Date.now();
    this._gravar(o);                       // best-effort, nao bloqueia a resposta
    return it;
  },

  /** guarda uma resposta nova (só se passar pelos filtros) */
  async guardar(chave, texto, modelo) {
    if (!this.ON()) return false;
    const t = String(texto || '').trim();
    if (!t || t.length > this.LIMITE_TEXTO) return false;
    if (this.sensivel(t)) return false;     // a resposta pode conter dado pessoal
    const o = await this._ler();
    if (o[chave]) return false;             // já tem: não sobrescreve
    o[chave] = { t: t, m: String(modelo || '').slice(0, 60), n: 0, quando: Date.now() };
    const chaves = Object.keys(o);
    if (chaves.length > this.LIMITE_ITENS) {
      /* tira as mais antigas (e menos usadas primeiro) */
      chaves.sort((a, b) => ((o[a].n || 0) - (o[b].n || 0)) || ((o[a].quando || 0) - (o[b].quando || 0)));
      for (const k of chaves.slice(0, chaves.length - this.LIMITE_ITENS)) delete o[k];
    }
    await this._gravar(o);
    return true;
  },

  async stats() {
    const o = await this._ler();
    const ks = Object.keys(o);
    let usos = 0;
    for (const k of ks) usos += (o[k].n || 0);
    return { itens: ks.length, usos: usos };
  },

  async limpar() { await this._gravar({}); return true; },

  /* quanto o site já economizou: cada uso da biblioteca é um pedido que
     ninguém pagou de novo (custo zero, resposta instantânea) */
  async economia() {
    const s = await this.stats();
    return { respostas: s.itens, reaproveitamentos: s.usos };
  },
};

if (typeof window !== 'undefined') window.Resp = Resp;
if (typeof module !== 'undefined' && module.exports) module.exports = { Resp };
