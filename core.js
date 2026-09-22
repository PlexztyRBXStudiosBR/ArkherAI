/* ARKHER — base compartilhada (carrega primeiro) */
'use strict';
/* LS — armazenamento. Se o navegador nao deixar usar localStorage (modo
   restrito, file://, storage cheio), cai pra memoria: nao persiste, mas a
   sessao CONTINUA funcionando em vez de "salvar" e nao salvar nada. */
const LS = (() => {
  const mem = Object.create(null);
  let tem = false;
  try {
    localStorage.setItem('__arkher_t', '1');
    localStorage.removeItem('__arkher_t');
    tem = true;
  } catch (e) { tem = false; }
  return {
    tem: () => tem,
    get(k, d) {
      if (tem) { try { const v = localStorage.getItem(k); return v === null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch (e) {} }
      return (k in mem) ? mem[k] : d;
    },
    set(k, v) {
      mem[k] = v;
      if (!tem) return;
      try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del(k) { delete mem[k]; if (tem) { try { localStorage.removeItem(k); } catch (e) {} } },
  };
})();

/* normaliza endereco de agente/DsOS: aceita "100.1.2.3:8765", "http://x/", etc. */
function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

/* transforma qualquer erro (Error, objeto do Puter, string, resposta HTTP) em texto util.
   O puter.js rejeita com {success:false, error:{code,message}} — nao e um Error, entao
   e.message vinha undefined e a cascata nao conseguia classificar 429/401. */
function errText(e) {
  if (e === null || e === undefined) return 'erro desconhecido';
  if (typeof e === 'string') return e;
  if (typeof e.message === 'string' && e.message) return e.message;
  const er = (e.error && typeof e.error === 'object') ? e.error : e;
  const parts = [];
  const st = er.status || e.status || er.statusCode;
  if (st) parts.push('HTTP ' + st);
  if (er.code) parts.push(String(er.code));
  if (typeof er.message === 'string' && er.message) parts.push(er.message);
  else if (typeof er === 'string') parts.push(er);
  else if (typeof e.error === 'string') parts.push(e.error);
  if (!parts.length) { try { return JSON.stringify(e).slice(0, 300); } catch (x) { return String(e); } }
  return parts.join(' ');
}

/* atalho curto para o errText. Fica declarado UMA vez, aqui (o core.js carrega
   primeiro), porque scripts classicos dividem o MESMO escopo global: quando
   skills.js e app.js declaravam cada um o seu `const _err`, o segundo script
   morria no parse com "SyntaxError: Identifier '_err' has already been
   declared" — o app.js inteiro nao carregava, e Puter, Arkher, HF, GPU e
   Breaker ficavam indefinidos (chat, cascata de modelos e enxame sem funcionar).
   `function` de proposito: redeclaracao de funcao nao gera SyntaxError. */
function _err(e) { return (typeof errText === 'function') ? errText(e) : ((e && e.message) || String(e)); }

if (typeof window !== 'undefined') { window.LS = LS; window.normUrl = normUrl; window.errText = errText; window._err = _err; }
if (typeof module !== 'undefined') module.exports = { LS, normUrl, errText, _err };
