/* ============================================================
   ARKHER — RDP: ligar a VM e pegar as credenciais pelo site
   ============================================================

   O que eu descobri do seu jeito de usar (repo NewRdpKAKAKAKAKA):
   voce dispara um workflow no GitHub, ele sobe um Windows com RDP
   ligado e Tailscale, e o endereco/usuario/senha aparecem no log.
   Depois voce entra com o app (Windows App / mstsc) naquele IP.

   O que este arquivo faz: automatiza os tres passos chatos disso.
     1. LIGAR   -> POST /repos/{dono}/{repo}/actions/workflows/{yml}/dispatches
                   (precisa de um PAT com permissao de Actions: write)
     2. ESPERAR -> GET  /repos/{dono}/{repo}/actions/runs  (acha o run novo)
     3. PEGAR   -> GET  /repos/{dono}/{repo}/actions/jobs/{id}/logs  e le
                   o endereco, o usuario e a senha do proprio log
   Se o navegador for bloqueado por CORS na hora de ler o log (pode
   acontecer: a API redireciona pra um blob), a gente cai no plano B:
   voce cola o trecho do log e o parser le (ele funciona offline).

   Seguranca, dito na cara: o PAT fica NO SEU NAVEGADOR (localStorage),
   nunca vai pra servidor nenhum. A senha do RDP tambem. A leitura do
   log so funciona se o workflow NAO mascarar a senha — por isso o
   workflow do ARKHER nao usa ::add-mask:: nela (e explica no codigo).
   ============================================================ */
'use strict';
(function () {
  if (typeof LS === 'undefined' && typeof require !== 'undefined') {
    globalThis.LS = require('./core.js').LS;
  }
  const API = 'https://api.github.com';

  const RDP = {
    /** configuracao salva: qual repo/workflow liga a maquina */
    padrao: { repo: 'WhiteXz7/NewRdpKAKAKAKAKA', workflow: 'main.yml', ref: 'main' },

    cfg() {
      const d = LS.get('arkher_rdp_cfg', null) || {};
      return Object.assign({}, this.padrao, d);
    },
    setCfg(o) { LS.set('arkher_rdp_cfg', Object.assign(this.cfg(), o || {})); return this.cfg(); },
    pat() { return LS.get('arkher_gh_pat', '') || ''; },
    setPat(t) { LS.set('arkher_gh_pat', String(t || '').trim()); },
    pronto() { return !!this.pat() && !!this.cfg().repo; },

    async _gh(rota, opt) {
      const pat = this.pat();
      if (!pat) throw new Error('falta o PAT do GitHub (Config > token com permissao Actions: write)');
      const r = await fetch(API + rota, Object.assign({
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + pat,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opt && opt.headers || {}),
        },
      }, opt || {}));
      if (!r.ok) {
        let d = '';
        try { const j = await r.json(); d = (j && (j.message || j.error)) || ''; } catch (e) {}
        throw new Error('GitHub HTTP ' + r.status + (d ? ' — ' + d : ''));
      }
      const txt = await r.text();
      return txt ? JSON.parse(txt) : {};
    },

    /** 1) dispara o workflow (liga a maquina) */
    async ligar(entrarEm) {
      const c = this.cfg();
      const [dono, repo] = String(c.repo).split('/');
      if (!dono || !repo) throw new Error('repositorio invalido: ' + c.repo);
      try {
        await this._gh('/repos/' + dono + '/' + repo + '/actions/workflows/' + c.workflow + '/dispatches',
          { method: 'POST', body: JSON.stringify({ ref: c.ref || 'main', ...(entrarEm || {}) }) });
      } catch (e) {
        if (/\b403\b|not accessible|scope/i.test(e.message)) {
          throw new Error(e.message + ' — o PAT precisa de "Actions: write" (fine-grained) ou escopo "workflow".');
        }
        throw e;
      }
      return { ok: true, repo: c.repo, workflow: c.workflow, ref: c.ref || 'main',
               runs: 'https://github.com/' + c.repo + '/actions' };
    },

    /** 2) qual run pegou agora (o mais novo do workflow) */
    async runNovo(desdeMs) {
      const c = this.cfg();
      const j = await this._gh('/repos/' + c.repo + '/actions/workflows/' + c.workflow + '/runs?per_page=5');
      const runs = (j.workflow_runs || []).slice().sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at));
      const r = runs[0];
      if (!r) return null;
      const velho = desdeMs && (new Date(r.created_at).getTime() < desdeMs - 60000);
      return { id: r.id, url: r.html_url, estado: r.status, fim: r.conclusion,
               commit: (r.head_sha || '').slice(0, 7), criado: r.created_at, antigo: !!velho,
               nome: r.name || r.display_title || '' };
    },

    /** jobs do run (pra pegar o id do job e ler o log) */
    async jobs(runId) {
      const c = this.cfg();
      const j = await this._gh('/repos/' + c.repo + '/actions/runs/' + runId + '/jobs?per_page=20');
      return (j.jobs || []).map(x => ({ id: x.id, nome: x.name, estado: x.status, fim: x.conclusion,
                                        passos: (x.steps || []).map(s => s.name) }));
    },

    /** 3) baixa o log do job (pode falhar por CORS — quem chama trata) */
    async log(runId) {
      const c = this.cfg();
      const js = await this.jobs(runId);
      let ultimo = '';
      for (const j of js) {
        try {
          const r = await fetch(API + '/repos/' + c.repo + '/actions/jobs/' + j.id + '/logs',
            { headers: { 'Authorization': 'Bearer ' + this.pat(), 'Accept': 'application/vnd.github+json' } });
          if (!r.ok) { ultimo = 'HTTP ' + r.status; continue; }
          const t = await r.text();
          if (t && t.length > 30) return { texto: t, job: j.nome };
        } catch (e) { ultimo = e.message; }
      }
      throw new Error('nao consegui ler o log do run pelo navegador' + (ultimo ? ' (' + ultimo + ')' : '')
        + ' — abra o run e cole o trecho aqui no campo abaixo (o leitor funciona igual)');
    },

    /**
     * LE O LOG. Puro, sem rede: por isso da pra testar e por isso funciona
     * quando o CORS bloqueia. Entende os dois formatos:
     *   o seu:   RDP_CREDS=User: RDP | Password: xyz   / TAILSCALE_IP=100.x.y.z
     *   o nosso: Address: 100.x.y.z / usuario: nexus / senha: xyz
     */
    lerLog(texto) {
      const t = String(texto || '').replace(/\u001b\[[0-9;]*m/g, '');   // tira cor do terminal
      const acha = (re) => { const m = t.match(re); return m ? m[1].trim() : ''; };
      const ip = acha(/\bTAILSCALE_IP=((?:\d{1,3}\.){3}\d{1,3})/)
        || acha(/\bAddress:\s*((?:\d{1,3}\.){3}\d{1,3})/)
        || acha(/Tailscale IP:\s*((?:\d{1,3}\.){3}\d{1,3})/)
        || acha(/https?:\/\/((?:\d{1,3}\.){3}\d{1,3}):\d+/)
        || acha(/\b((?:100|10|172|192)\.(?:\d{1,3}\.){2}\d{1,3})\b/);
      const usuario = acha(/\bRDP_CREDS=User:\s*([^\s|]+)/i)
        || acha(/Username:\s*([^\s|]+)/i)
        || acha(/usuario:\s*([^\s|]+)/i)
        || acha(/User:\s*([^\s|]+)/);
      let senha = acha(/Password:\s*([^\s|]+)/i)
        || acha(/senha:\s*([^\s|]+)/i)
        || acha(/RDP_PW=([^\s|]+)/i);
      const mascarada = senha === '***' || /\*\*\*/.test(senha);
      if (mascarada) senha = '';
      // porta: só se a linha de endereço tiver "IP:porta" (senão é o padrão)
      let porta = '3389';
      const linhaEnd = (t.match(/(?:Address|Endereco|Endereço):[^\n]*/i) || [''])[0];
      const mPorta = linhaEnd.match(/:(\d{2,5})\b/);
      if (mPorta) porta = mPorta[1];
      const host = acha(/hostname=([\w.-]+)/i);
      return {
        ok: !!(ip || usuario || senha),
        ip, usuario, senha, porta, host, mascarada,
        aviso: mascarada ? 'a senha aparece como *** porque o workflow usou ::add-mask:: — '
                         + 'remova essa linha (o workflow do ARKHER ja nao usa) pra ela sair no log' : '',
        via: ip ? 'log' : '',
      };
    },

    /** junto tudo: liga, espera, le o log e devolve as credenciais */
    async ligarEPegar(onLog, msMax) {
      const log = onLog || (() => {});
      const t0 = Date.now();
      log('disparando o workflow ' + this.cfg().workflow + ' em ' + this.cfg().repo + ' ...');
      await this.ligar();
      log('pedido enviado. o runner leva ~2 min pra ligar; esperando o run aparecer...');
      let runId = null;
      for (let i = 0; i < 40 && !runId; i++) {
        await new Promise(s => setTimeout(s, 8000));
        try {
          const r = await this.runNovo(t0);
          if (r && !r.antigo) { runId = r.id; log('run ' + r.commit + ' encontrado (' + r.estado + ')'); }
        } catch (e) { log('checando: ' + e.message); }
      }
      if (!runId) throw new Error('o run nao apareceu (o workflow existe nesse repo/branch?)');
      // espera o log ter o endereco
      for (let i = 0; i < 60; i++) {
        await new Promise(s => setTimeout(s, 10000));
        if (msMax && Date.now() - t0 > msMax) break;
        let texto = '';
        try { texto = (await this.log(runId)).texto; } catch (e) { log(e.message); break; }
        const cred = this.lerLog(texto);
        if (cred.ip) {
          log('endereco encontrado: ' + cred.ip + ' (usuario ' + cred.usuario + ')');
          if (cred.aviso) log(cred.aviso);
          return Object.assign(cred, { runId, runs: 'https://github.com/' + this.cfg().repo + '/actions' });
        }
        log('ainda subindo... (procurando o endereco no log)');
      }
      throw new Error('o run existe mas o log nao mostrou o endereco ainda. Abra '
        + 'https://github.com/' + this.cfg().repo + '/actions e cole o trecho no campo abaixo.');
    },

    /** plano B: parser puro pro log que o usuario colar */
    lerColado(txt) { return this.lerLog(txt); },
  };

  if (typeof window !== 'undefined') window.RDP = RDP;
  if (typeof module !== 'undefined') module.exports = { RDP };
})();
