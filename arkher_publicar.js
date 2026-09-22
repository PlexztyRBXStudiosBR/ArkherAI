/* ARKHER PUBLICAR — põe o jogo no ar e ouve o que os jogadores dizem
   ==================================================================
   Publicar em 2026 acontece em dois lugares: o codigo (GitHub) e o jogo
   (Roblox, pelo Open Cloud). Este modulo faz os dois e, depois, LIGA a
   telemetria do jogo ao que ja foi publicado: sobe a versao, ve o que
   aconteceu de verdade com os jogadores, e a proxima versao sai daquilo.

   O QUE ELE NUNCA VAI FAZER (e por que)
     - Nao gera .rbxl no navegador: o formato do Roblox nao e aberto. Quem
       salva o jogo como arquivo e o Studio (Arquivo -> Salvar como .rbxl).
       Aqui a gente PUBLICA esse arquivo, e diz isso na cara.
     - Nao adivinha numero: cada resposta mostra o que a API respondeu
       (401, 403, 404, 422). Erro de token e erro de token, nomeado.
     - Nao guarda o token do Roblox em lugar nenhum alem do seu navegador,
       e nunca o manda para outro lugar que nao seja a API do Roblox. */

(function () {
  const P = {};
  const LSg = (k, d) => (window.LS ? LS.get(k, d) : d);
  const LSs = (k, v) => { if (window.LS) LS.set(k, v); };

  P.cfg = function () {
    return {
      repo: LSg('arkher_repo', ''),
      gh: LSg('arkher_gh_pat', ''),
      rbxKey: LSg('arkher_roblox_key', ''),
      universo: LSg('arkher_universe', ''),
      lugar: LSg('arkher_place', ''),
      tel: LSg('arkher_tel_url', ''),
      jogo: LSg('arkher_jogo', ''),
    };
  };
  P.salvar = function (c) {
    const mapa = { repo: 'arkher_repo', gh: 'arkher_gh_pat', rbxKey: 'arkher_roblox_key',
      universo: 'arkher_universe', lugar: 'arkher_place', tel: 'arkher_tel_url', jogo: 'arkher_jogo' };
    for (const k in mapa) if (c[k] !== undefined) LSs(mapa[k], String(c[k] || '').trim());
    return P.cfg();
  };
  P.norm = function (u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u;
  };

  async function req(url, opt, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 25000);
    try {
      const r = await fetch(url, Object.assign({ signal: ac.signal }, opt || {}));
      let corpo = null, texto = '';
      try { texto = await r.text(); corpo = texto ? JSON.parse(texto) : null; } catch (e) { corpo = null; }
      return { ok: r.ok, status: r.status, j: corpo, texto: texto, r: r };
    } finally { clearTimeout(t); }
  }

  function erroDe(r, quem, dica) {
    const j = r && r.j;
    const m = (j && (j.message || j.error || j.erro)) || (r && r.texto ? String(r.texto).slice(0, 160) : '');
    let d = '';
    if (r && r.status === 401) d = 'token recusado (401) — confira se ele foi copiado inteiro';
    else if (r && r.status === 403) d = 'o token nao tem permissao (403) — precisa do escopo certo';
    else if (r && r.status === 404) d = 'nao encontrei (404) — confira o nome/identificador';
    else if (r && r.status === 422) d = 'a API recusou os dados (422)';
    else if (r && r.status === 413) d = 'arquivo grande demais para esse caminho';
    else if (r && r.status >= 500) d = 'o servidor deles falhou (' + r.status + ') — tente de novo';
    return { ok: false, quem: quem, status: r ? r.status : 0, motivo: m || d || 'sem resposta',
      o_que_fazer: d, dica: dica || '' };
  }

  /* ------------------------------------------------------------------
     GITHUB — o codigo do jogo (e o CI que monta o build)
     ------------------------------------------------------------------ */
  P.ghCaminho = function (cfg, caminho) {
    return 'https://api.github.com/repos/' + cfg.repo + '/contents/' + encodeURI(caminho);
  };
  P.ghCabecalho = function (tok) {
    return { 'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json',
             'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
  };

  /* sobe UM arquivo (cria ou atualiza). Texto, para caber no repo sem lixo. */
  P.paraGitHub = async function (caminho, texto, mensagem) {
    const cfg = P.cfg();
    if (!cfg.repo) return { ok: false, motivo: 'sem repositorio (ex: dono/ARKHER-JOGO)', o_que_fazer: 'preencha o repositorio' };
    if (!cfg.gh) return { ok: false, motivo: 'sem token do GitHub', o_que_fazer: 'crie um token com escopo de conteudo do repositorio' };
    const b64 = (typeof btoa === 'function')
      ? btoa(unescape(encodeURIComponent(texto)))
      : Buffer.from(texto, 'utf8').toString('base64');
    /* precisa do sha para ATUALIZAR; se nao existir, e criacao */
    const atual = await req(P.ghCaminho(cfg, caminho), { headers: P.ghCabecalho(cfg.gh) });
    const corpo = { message: mensagem || ('ARKHER: ' + caminho), content: b64 };
    if (atual.ok && atual.j && atual.j.sha) corpo.sha = atual.j.sha;
    const r = await req(P.ghCaminho(cfg, caminho), { method: 'PUT', headers: P.ghCabecalho(cfg.gh), body: JSON.stringify(corpo) });
    if (!r.ok) return erroDe(r, 'github', 'o token precisa de permissao de escrita em conteudo');
    const c = r.j && (r.j.commit || {});
    return { ok: true, caminho: caminho, commit: (c.sha || '').slice(0, 7),
      url: (c.html_url || ''), criou: !(atual.ok && atual.j && atual.j.sha) };
  };

  /* ------------------------------------------------------------------
     ROBLOX OPEN CLOUD — publica o .rbxl que o Studio salvou
     ------------------------------------------------------------------ */
  P.rbxUrl = function (cfg, salvo) {
    return 'https://apis.roblox.com/universes/v1/' + encodeURIComponent(cfg.universo) +
      '/places/' + encodeURIComponent(cfg.lugar) + '/versions?versionType=' + (salvo ? 'Saved' : 'Published');
  };

  /* dados: Uint8Array/ArrayBuffer com o .rbxl (ou string base64) */
  P.paraRoblox = async function (dados, salvo) {
    const cfg = P.cfg();
    if (!cfg.rbxKey) return { ok: false, motivo: 'sem chave do Open Cloud',
      o_que_fazer: 'crie uma chave em create.roblox.com com o escopo universe-places:write' };
    if (!cfg.universo || !cfg.lugar) return { ok: false, motivo: 'sem universo/lugar',
      o_que_fazer: 'o numero do universo e o do lugar aparecem na URL do Studio' };
    if (!dados) return { ok: false, motivo: 'sem arquivo .rbxl',
      o_que_fazer: 'no Studio: Arquivo -> Salvar como .rbxl, e mande o arquivo aqui' };
    let corpo = dados;
    if (typeof dados === 'string') {
      /* base64 -> bytes */
      const bin = (typeof atob === 'function') ? atob(dados) : Buffer.from(dados, 'base64').toString('binary');
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      corpo = u;
    }
    const r = await req(P.rbxUrl(cfg, salvo), {
      method: 'POST', headers: { 'x-api-key': cfg.rbxKey, 'Content-Type': 'application/octet-stream' }, body: corpo,
    }, 120000);
    if (!r.ok) return erroDe(r, 'roblox', 'a chave precisa do escopo universe-places:write');
    const j = r.j || {};
    return { ok: true, versao: j.versionNumber || null, tipo: salvo ? 'salvo' : 'publicado',
      url: cfg.universo && cfg.lugar ? ('https://www.roblox.com/games/' + cfg.lugar) : '' };
  };

  /* ------------------------------------------------------------------
     TELEMETRIA — o que os jogadores fizeram de verdade
     ------------------------------------------------------------------ */
  P.telemetria = async function (url, jogo) {
    const u = P.norm(url || P.cfg().tel);
    const g = jogo || P.cfg().jogo || 'jogo';
    if (!u) return { ok: false, motivo: 'sem endereco da telemetria',
      o_que_fazer: 'suba o telemetria.py no no (python3 telemetria.py) e cole o endereco' };
    try {
      const [h, res, sug] = await Promise.all([
        req(u + '/health', {}, 10000), req(u + '/resumo?jogo=' + encodeURIComponent(g), {}, 10000),
        req(u + '/sugestoes?jogo=' + encodeURIComponent(g), {}, 10000),
      ]);
      if (!h.ok) return erroDe(h, 'telemetria', 'confira se o telemetria.py esta no ar nesse endereco');
      return { ok: true, saude: h.j || {}, resumo: (res.j || {}), sugestoes: ((sug.j || {}).sugestoes || []) };
    } catch (e) {
      const https = location.protocol === 'https:' && /^http:\/\//i.test(u);
      return { ok: false, motivo: String(e.message || e),
        o_que_fazer: https ? 'site https chamando endereco http: veja o passo 3 do cartao do DsOS' :
          'nao consegui falar com a telemetria (no desligado ou rede diferente)' };
    }
  };

  /* o codigo que o jogo cola no Studio para falar com o seu no */
  P.snippet = function (url, jogo) {
    const u = P.norm(url || P.cfg().tel) || 'http://SEU-NO:8777';
    const g = (jogo || P.cfg().jogo || 'meu-jogo');
    return [
      '-- cole num Script do servidor (ServerScriptService)',
      'local T = require(game.ReplicatedStorage.ARKHER_Telemetria)',
      'local tel = T.novo({ url = "' + u + '", jogo = "' + g + '" })',
      'tel:ligar(game:GetService("HttpService"))',
      '',
      '-- exemplos do que marcar (o que interessa e onde doi)',
      'tel:registrar("chegou", { fase = 1 })',
      'tel:registrar("morte", { fase = 3, x = 120, z = -44, causa = "queda" })',
      'tel:registrar("travou", { fase = 3, x = 118, z = -40 })',
      'tel:registrar("saiu", { fase = 4 })',
      '',
      '-- na saida de cada jogador, manda o que ficou na fila',
      'game:GetService("Players").PlayerRemoving:Connect(function(p)',
      '  tel:registrar("saiu", { fase = 0 }, p.UserId)',
      '  pcall(function() tel:enviar(game:GetService("HttpService"), game:GetService("HttpService").JSONEncode) end)',
      'end)',
    ].join('\n');
  };

  /* ------------------------------------------------------------------
     A VIDA DO JOGO — versao publicada + o que a telemetria disse
     Guarda localmente o retrato de cada versao para comparar depois.
     ------------------------------------------------------------------ */
  P.versoes = function () { return LSg('arkher_versoes', []) || []; };

  P.marcar = function (info) {
    const l = P.versoes().slice();
    l.push({ quando: Date.now(), versao: info.versao || ('v' + (l.length + 1)),
      resumo: info.resumo || null, sugestoes: info.sugestoes || [] });
    while (l.length > 30) l.shift();       /* teto: 30 versoes guardadas */
    LSs('arkher_versoes', l);
    return l[l.length - 1];
  };

  /* compara dois retratos: o que melhorou, o que piorou, com numero.
     Sem dois retratos com dado suficiente, diz que nao da para comparar. */
  P.comparar = function (a, b) {
    if (!a || !b) return { ok: false, motivo: 'preciso de duas versoes marcadas' };
    const ra = a.resumo || {}, rb = b.resumo || {};
    if (!ra.eventos || !rb.eventos) return { ok: false, motivo: 'uma das versoes ficou sem telemetria' };
    const out = { ok: true, de: a.versao, para: b.versao, mudou: [] };
    const mf = (r) => r.mortes_por_fase || {};
    const fa = mf(ra), fb = mf(rb);
    const fases = {};
    Object.keys(fa).forEach(f => { fases[f] = 1; });
    Object.keys(fb).forEach(f => { fases[f] = 1; });
    const totA = Object.keys(fa).reduce((s, f) => s + fa[f], 0) || 0;
    const totB = Object.keys(fb).reduce((s, f) => s + fb[f], 0) || 0;
    Object.keys(fases).forEach(function (f) {
      const pa = totA ? Math.round(100 * (fa[f] || 0) / totA) : 0;
      const pb = totB ? Math.round(100 * (fb[f] || 0) / totB) : 0;
      if (pa === 0 && pb === 0) return;
      if (Math.abs(pb - pa) >= 5)
        out.mudou.push({ fase: f, antes: pa + '%', depois: pb + '%',
          direcao: pb < pa ? 'melhorou' : 'piorou' });
    });
    const da = ra.minutos_por_sessao, db = rb.minutos_por_sessao;
    if (typeof da === 'number' && typeof db === 'number' && Math.abs(db - da) >= 0.3)
      out.mudou.push({ o_que: 'minutos por sessao', antes: da, depois: db,
        direcao: db > da ? 'melhorou' : 'piorou' });
    out.texto = out.mudou.length
      ? out.mudou.map(m => (m.fase ? ('fase ' + m.fase + ': ' + m.antes + ' → ' + m.depois + ' (' + m.direcao + ')')
                                   : (m.o_que + ': ' + m.antes + ' → ' + m.depois + ' (' + m.direcao + ')'))).join(' · ')
      : 'nada mudou o suficiente para aparecer nos numeros (diferenca menor que 5%)';
    return out;
  };

  window.Publicar = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})();
