/* ============================================================
   SYNC — estado COMPARTILHADO entre as contas (via Supabase).
   Os dois usuarios enxergam a MESMA VM, o mesmo historico e
   quem esta online. Nada fica preso num navegador so.

   Tabela no Supabase (SQL no PUBLICAR.txt):
     arkher_state(k text primary key, v jsonb, updated_at timestamptz)
     arkher_log(id bigserial, who text, kind text, txt text, at timestamptz)
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

const Sync = {
  _lastLogId: 0,
  _timer: null,
  ultimoErro: '',

  cfg() { return (typeof Auth !== 'undefined') ? Auth.cfg() : LS.get('arkher_supabase', {}); },
  tok() { return (typeof Auth !== 'undefined') ? (Auth.sess()?.access_token || '') : ''; },
  me() { return (typeof Auth !== 'undefined') ? (Auth.email() || 'anon') : 'anon'; },

  /* ---------- APELIDO: o time vê o NICK, nunca o e-mail ----------
     O e-mail continua sendo a chave interna (é ele que identifica a
     conta no banco), mas NADA que outra pessoa vê mostra e-mail:
     a presença e o log carregam o apelido junto.                     */
  apelido() {
    const n = LS.get('arkher_nick', '');
    if (n) return String(n).slice(0, 24);
    /* primeiro uso: sugere um apelido a partir do e-mail, mas não vaza o
       e-mail inteiro — só a parte antes do @ fica como sugestão */
    const m = this.me();
    return String(m).split('@')[0].slice(0, 24) || 'anônimo';
  },
  setApelido(n) { LS.set('arkher_nick', String(n || '').trim().slice(0, 24)); return this.apelido(); },

  /* mapa who(email) -> apelido, lido do estado compartilhado */
  async apelidos() {
    const mapa = {};
    try {
      const r = await this._rest('/arkher_state?k=like.' + encodeURIComponent('nick:*') + '&select=k,v', { method: 'GET' });
      for (const x of (r || [])) if (x.v && x.v.who) mapa[x.v.who] = x.v.nick;
    } catch (e) {}
    return mapa;
  },
  /* nome para exibir: apelido do mapa, senão o nick local se for eu, senão a parte antes do @ */
  nomeDe(who, mapa) {
    const w = String(who || '');
    if (mapa && mapa[w]) return mapa[w];
    if (w === this.me()) return this.apelido();
    return w.split('@')[0] || 'anônimo';
  },

  /** Supabase configurado E usuario logado (as tabelas tem RLS: anonimo nao le nem escreve) */
  ligado() { const c = this.cfg(); return !!(c && c.url && c.anon && this.tok()); },

  _h(extra) {
    const c = this.cfg();
    const t = this.tok();
    return Object.assign({
      'Content-Type': 'application/json',
      'apikey': c.anon,
      'Authorization': 'Bearer ' + (t || c.anon),
    }, extra || {});
  },

  async _rest(path, opt, extraHeaders) {
    const c = this.cfg();
    if (!c.url) throw new Error('Supabase nao configurado');
    // renova o token se estiver vencendo (senao tudo vira 401 depois de 1h)
    if (typeof Auth !== 'undefined' && Auth.garantir) { try { await Auth.garantir(); } catch (e) {} }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    let r;
    try {
      r = await fetch(c.url + '/rest/v1' + path, Object.assign({ headers: this._h(extraHeaders), signal: ctl.signal }, opt || {}));
    } catch (e) {
      this.ultimoErro = 'sem conexao com o Supabase';
      throw new Error(this.ultimoErro);
    } finally { clearTimeout(to); }
    if (!r.ok) {
      let d = ''; try { d = (await r.json())?.message || ''; } catch (e) {}
      if (r.status === 404 && /relation|does not exist|schema cache/i.test(d))
        d = 'tabela nao existe — rode o SQL do PUBLICAR.txt no Supabase';
      if (r.status === 401 || r.status === 403) d = d || 'sem permissao (faca login de novo)';
      this.ultimoErro = 'HTTP ' + r.status + ' ' + d;
      throw new Error('sync ' + this.ultimoErro);
    }
    this.ultimoErro = '';
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  },

  /* ---------- chave/valor compartilhado ---------- */
  async set(k, v) {
    return this._rest('/arkher_state', {
      method: 'POST',
      body: JSON.stringify([{ k, v, updated_at: new Date().toISOString() }]),
    }, { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  },

  async get(k, dflt) {
    try {
      const r = await this._rest('/arkher_state?k=eq.' + encodeURIComponent(k) + '&select=v', { method: 'GET' });
      return (r && r[0]) ? r[0].v : dflt;
    } catch (e) { return dflt; }
  },

  /* ---------- a VM: um endereco pros dois ---------- */
  async setVM(url) {
    await this.set('agent_url', { url, por: this.me(), em: Date.now() });
  },
  async getVM() {
    const v = await this.get('agent_url', null);
    return v && v.url ? v : null;
  },

  /* ---------- presenca: quem esta online ---------- */
  async bater() {
    try {
      await this.set('presence:' + this.me(), { who: this.me(), at: Date.now(), nick: this.apelido() });
      await this.set('nick:' + this.me(), { who: this.me(), nick: this.apelido() });
    } catch (e) {}
  },
  async online() {
    try {
      const r = await this._rest('/arkher_state?k=like.' + encodeURIComponent('presence:*') + '&select=k,v', { method: 'GET' });
      const lim = Date.now() - 90000;
      return (r || []).map(x => x.v).filter(v => v && v.at > lim);
    } catch (e) { return []; }
  },

  /* ---------- log compartilhado (o amigo ve o que voce fez) ---------- */
  async log(kind, txt) {
    try {
      await this._rest('/arkher_log', {
        method: 'POST',
        body: JSON.stringify([{ who: this.me(), kind, txt: String(txt).slice(0, 2000) }]),
      }, { 'Prefer': 'return=minimal' });
    } catch (e) {}
  },

  async novos() {
    try {
      const r = await this._rest(
        '/arkher_log?id=gt.' + this._lastLogId + '&order=id.asc&limit=40&select=id,who,kind,txt', { method: 'GET' });
      if (r && r.length) this._lastLogId = r[r.length - 1].id;
      return r || [];
    } catch (e) { return []; }
  },

  async iniciarLog() {
    try {
      const r = await this._rest('/arkher_log?order=id.desc&limit=1&select=id', { method: 'GET' });
      this._lastLogId = (r && r[0]) ? r[0].id : 0;
    } catch (e) {}
  },

  /* ---------- trava: evita os dois mandarem comando junto ----------
     devolve null se a trava e sua; devolve {who,until} se OUTRA pessoa a tem */
  async pegarTrava(seg) {
    const atual = await this.get('lock', null);
    const agora = Date.now();
    if (atual && atual.who && atual.who !== this.me() && atual.until > agora) return atual;  // ocupado
    try { await this.set('lock', { who: this.me(), until: agora + (seg || 60) * 1000 }); } catch (e) {}
    return null;
  },
  async soltarTrava() {
    try {
      const a = await this.get('lock', null);
      if (a && a.who === this.me()) await this.set('lock', { who: null, until: 0 });
    } catch (e) {}
  },
};

if (typeof window !== 'undefined') window.Sync = Sync;
if (typeof module !== 'undefined') module.exports = { Sync };
