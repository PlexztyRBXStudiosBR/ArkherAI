/* ============================================================
   AUTH — login real via Supabase (e-mail + senha).
   Acesso restrito: so os e-mails da lista ALLOW entram.
   Sem backend proprio; o Supabase faz a verificacao.
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

const Auth = {
  cfg() { return LS.get('arkher_supabase', { url: '', anon: '' }); },
  // conserta os erros comuns: url do painel, falta de https, barra no fim
  normalizar(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    // https://supabase.com/dashboard/project/REF  ->  https://REF.supabase.co
    var m = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
    if (m) return 'https://' + m[1] + '.supabase.co';
    // colou so o ref
    if (/^[a-z0-9]{15,}$/i.test(u)) return 'https://' + u + '.supabase.co';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    // tira sufixos de API que o painel mostra: /rest/v1, /auth/v1, /storage/v1...
    u = u.replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?.*$/i, '');
    return u.replace(/\/+$/, '');
  },
  setCfg(url, anon) {
    LS.set('arkher_supabase', { url: this.normalizar(url), anon: (anon || '').trim() });
  },
  configurado() { const c = this.cfg(); return !!(c.url && c.anon); },

  /** quem pode entrar (lido na hora, nao na carga do arquivo) */
  get ALLOW() { return LS.get('arkher_allow', []); },
  setAllow(list) { LS.set('arkher_allow', list); },

  sess() { return LS.get('arkher_sess', null); },

  /** sessao valida agora (sem considerar renovacao) */
  ativo() {
    const s = this.sess();
    if (!s || !s.access_token) return false;
    if (s.expires_at && Date.now() / 1000 > s.expires_at) return false;
    return true;
  },

  /** da pra renovar? (token expirou mas temos refresh_token) */
  renovavel() {
    const s = this.sess();
    return !!(s && s.refresh_token);
  },

  email() { return this.sess()?.user?.email || ''; },

  permitido(email) {
    const l = (this.ALLOW || []).map(x => String(x).toLowerCase().trim()).filter(Boolean);
    if (!l.length) return true;               // lista vazia = liberado (1o uso)
    return l.includes(String(email).toLowerCase().trim());
  },

  async _post(path, body) {
    const c = this.cfg();
    if (!c.url || !c.anon) throw new Error('Supabase nao configurado (preencha URL e anon key abaixo)');
    let r;
    try {
      r = await fetch(c.url + '/auth/v1' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': c.anon },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('nao alcancei o Supabase em ' + c.url + ' — confira a Project URL (termina em .supabase.co)');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = j.error_description || j.msg || j.message || j.error || ('HTTP ' + r.status);
      if (r.status === 401 && /api key|apikey/i.test(String(m))) throw new Error('anon key invalida — copie de novo em Settings > API');
      throw new Error(String(m));
    }
    return j;
  },

  _guardar(j) {
    if (!j.expires_at && j.expires_in) j.expires_at = Math.floor(Date.now() / 1000) + Number(j.expires_in);
    LS.set('arkher_sess', j);
  },

  async entrar(email, senha) {
    if (!this.permitido(email)) throw new Error('Este e-mail nao tem acesso.');
    const j = await this._post('/token?grant_type=password', { email, password: senha });
    if (!j.access_token) throw new Error('login sem token');
    this._guardar(j);
    return j;
  },

  async criar(email, senha) {
    if (!this.permitido(email)) throw new Error('Este e-mail nao tem acesso.');
    const j = await this._post('/signup', { email, password: senha });
    if (j.access_token) this._guardar(j);
    return j;
  },

  /** renova o access_token com o refresh_token. true se a sessao ficou valida. */
  async renovar() {
    const s = this.sess();
    if (!s || !s.refresh_token) return false;
    try {
      const j = await this._post('/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      if (!j.access_token) return false;
      if (!j.user) j.user = s.user;
      this._guardar(j);
      return true;
    } catch (e) {
      // refresh token invalido/revogado: sessao morreu de verdade
      if (/invalid|revoked|not found|expired/i.test(String(e.message))) LS.set('arkher_sess', null);
      return false;
    }
  },

  /** garante sessao valida: renova se estiver perto de vencer (5 min). */
  async garantir() {
    const s = this.sess();
    if (!s || !s.access_token) return false;
    const falta = (s.expires_at || 0) - Date.now() / 1000;
    if (falta > 300) return true;
    return this.renovar();
  },

  sair() { LS.set('arkher_sess', null); },
};

if (typeof window !== 'undefined') window.Auth = Auth;
if (typeof module !== 'undefined') module.exports = { Auth };
