/* ARKHER POOL — armazem central de contas.
   Os tokens ficam no Supabase (tabela arkher_state). Quem loga no site
   usa os tokens do DONO. Ninguem precisa criar conta no Puter/HF. */
(function () {
  const P = {};
  const KEY = 'pool_v1';
  let seq = 0;
  function novoId() { return 'k' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6); }
  let cache = null, quando = 0;

  P.local = function () { return LS.get('arkher_pool', { puter: [], hf: [] }); };
  P.salvarLocal = function (o) { LS.set('arkher_pool', o); };

  /* le do Supabase (compartilhado) e cai no local se offline */
  P.ler = async function (forcar) {
    if (!forcar && cache && Date.now() - quando < 60000) return cache;
    try {
      if (window.Sync && Sync.get && Sync.ligado()) {
        const v = await Sync.get(KEY);
        if (v && (v.puter || v.hf)) { cache = v; quando = Date.now(); P.salvarLocal(v); return v; }
      }
    } catch (e) {}
    cache = P.local(); quando = Date.now();
    return cache;
  };

  P.gravar = async function (o) {
    P.salvarLocal(o); cache = o; quando = Date.now();
    try { if (window.Sync && Sync.set && Sync.ligado()) await Sync.set(KEY, o); } catch (e) {}
  };

  P.add = async function (prov, token, apelido) {
    const o = await P.ler(true);
    const lista = o[prov] || (o[prov] = []);
    if (lista.some(x => x.t === token)) return { ok: false, err: 'token ja existe' };
    lista.push({ id: novoId(), t: token,
                 nome: apelido || (prov + ' ' + (lista.length + 1)), falhas: 0, ate: 0 });
    await P.gravar(o);
    return { ok: true, total: lista.length };
  };

  P.remover = async function (prov, id) {
    const o = await P.ler(true);
    o[prov] = (o[prov] || []).filter(x => x.id !== id);
    await P.gravar(o);
  };

  /* escolhe o proximo token livre.
     opts.precisoSaldo = true  ->  so contas com saldo (a via gratis nao precisa) */
  P.pegar = async function (prov, opts) {
    const o = await P.ler();
    const agora = Date.now();
    const pedeSaldo = !!(opts && opts.precisoSaldo);
    const livres = (o[prov] || []).filter(x => (!x.ate || x.ate < agora) &&
      (!pedeSaldo || !P.semSaldo(x)));
    if (!livres.length) return null;
    livres.sort((a, b) => (a.falhas || 0) - (b.falhas || 0));
    return livres[0];
  };

  /* conta marcada como sem saldo nas ultimas 12h (volta a valer sozinha depois) */
  P.semSaldo = function (k) {
    return !!(k && k.semSaldo && (Date.now() - k.semSaldo) < 12 * 3600e3);
  };

  /* o Puter tem alguma conta com saldo? (sem isso, so a via gratis :free responde) */
  P.temSaldo = function () {
    const a = P.local().puter || [];
    if (!a.length) return true;                 // conta avulsa logada no navegador
    return a.some(k => !P.semSaldo(k));
  };

  /* marca a conta como "sem saldo" SEM banir: ela continua valendo pra via gratis */
  P.marcarSemSaldo = async function (token, msg) {
    const o = await P.ler(true);
    const k = (o.puter || []).find(x => x.t === token) ||
              (P.ativo && (o.puter || []).find(x => x.id === P.ativo));
    if (!k) return { ok: false };
    k.semSaldo = Date.now();
    k.semSaldoMsg = String(msg || '').slice(0, 160);
    k.falhas = (k.falhas || 0) + 1;
    await P.gravar(o);
    return { ok: true, nome: k.nome };
  };

  P.falhou = async function (prov, id, msg) {
    const o = await P.ler(true);
    const k = (o[prov] || []).find(x => x.id === id);
    if (!k) return;
    k.falhas = (k.falhas || 0) + 1;
    const m = String(msg || '').toLowerCase();
    /* Puter: "low balance" nao e banimento — a conta segue util na via gratis (:free) */
    if (prov === 'puter' && /low[_ -]?balance|insufficient|funding|no credit|sem credit|saldo/.test(m)) {
      k.semSaldo = Date.now(); k.semSaldoMsg = String(msg || '').slice(0, 160); k.ate = 0;
    }
    else if (/429|quota|rate|limit|usage|credit|insufficient|funds/.test(m)) k.ate = Date.now() + 6 * 3600e3;
    else if (/401|403|invalid|unauthor/.test(m)) k.ate = Date.now() + 24 * 3600e3;
    else k.ate = Date.now() + 120e3;
    await P.gravar(o);
  };

  /* ---------- POR QUE 9 CONTAS CAIRAM NA MESMA MENSAGEM? ----------
     Este teste responde. Ele manda um pedido MINUSCULO (8 tokens) por
     conta, pelo endpoint REST (onde o token é escolhido na mao) e mostra
     o que cada uma devolve. A leitura do resultado:

       • todas respondem 402/low balance mesmo num pedido minusculo
         → nao é a conta: é o dispositivo/IP (o Puter mede por conta +
           aparelho) ou as contas foram marcadas. Rotacionar conta nao
           resolve. Ai o caminho é a via gratis (:free) + provedores
           gratis + o no com GPU.
       • algumas respondem e outras nao
         → é a conta mesmo (aquelas zeraram). O ARKHER marca as que
           falharam e passa a usar as que respondem.
       • diferenca entre a 1a e a ultima: alguma responde "ok"
         → o saldo é pouco: o pedido real (historico + memoria + saida
           longa) é que nao cabia. Ai entra o teto de tokens e a
           repeticao "barata" que o app.js faz sozinho.                */
  P.testarContas = async function (onPasso) {
    const contas = P.local().puter || [];
    const out = [];
    const ehSaldo = m => /low[_ -]?balance|insufficient|funding|no credit|sem credit|saldo|402/i.test(String(m || ''));
    for (const k of contas) {
      if (onPasso) onPasso('conta ' + k.nome);
      const r = (typeof Puter !== 'undefined' && Puter.teste)
        ? await Puter.teste(k.t)
        : { ok: false, err: 'app.js nao carregou' };
      if (r.ok) await P.marcarComSaldo(k.t);
      else if (ehSaldo(r.err)) await P.marcarSemSaldo(k.t, r.err);
      out.push({ nome: k.nome, ok: !!r.ok, status: r.status || 0, err: r.err || '' });
      await new Promise(s => setTimeout(s, 500));      // espacado: nada de rajada
    }
    const ok = out.filter(x => x.ok).length;
    let diagnostico;
    if (!out.length) diagnostico = 'nenhuma conta no armazem ainda.';
    else if (ok === out.length) diagnostico = 'todas as contas respondem a um pedido pequeno — '
      + 'o problema era o TAMANHO do pedido (historico/memoria/saida longa), nao o saldo. '
      + 'O teto de tokens e a repeticao barata resolvem.';
    else if (ok === 0) diagnostico = 'NENHUMA responde nem a um pedido minusculo: nao é a conta, '
      + 'é o dispositivo/IP (ou as contas foram marcadas). Trocar de conta nao resolve aqui — '
      + 'use a via gratis do Puter (:free), as chaves gratis e o no com GPU.';
    else diagnostico = ok + ' de ' + out.length + ' contas respondem: sao essas que o ARKHER vai usar.';
    return { contas: out, diagnostico };
  };

  /* contas do armazem que podem ser usadas agora (para rotacionar DE VERDADE,
     passando o token de cada uma por chamada no endpoint REST) */
  P.contasPuter = function (precisoSaldo) {
    const n = Date.now();
    return (P.local().puter || []).filter(k => (!k.ate || k.ate < n) &&
      (!precisoSaldo || !P.semSaldo(k)));
  };

  /* conta respondeu um modelo pago: TEM saldo — limpa a marca */
  P.marcarComSaldo = async function (token) {
    const o = await P.ler(true);
    const k = (o.puter || []).find(x => x.t === token) ||
              (P.ativo && (o.puter || []).find(x => x.id === P.ativo));
    if (!k) return { ok: false };
    k.semSaldo = 0; k.ate = 0; k.falhas = 0;
    await P.gravar(o);
    return { ok: true, nome: k.nome };
  };

  /* token pra usar AGORA, sem esperar rede: prefere conta com saldo.
     Serve pra quando o puter.js nao carrega e a cascata vai pelo endpoint REST. */
  P.tokenLivre = function (precisoSaldo) {
    const a = (P.local().puter || []);
    const n = Date.now();
    const vivas = a.filter(x => (!x.ate || x.ate < n) && (!precisoSaldo || !P.semSaldo(x)));
    const ordenadas = vivas.slice().sort((x, y) => (P.semSaldo(x) ? 1 : 0) - (P.semSaldo(y) ? 1 : 0));
    return ordenadas.length ? ordenadas[0].t : '';
  };

  /* "ja coloquei credito": limpa a marca de sem saldo de todas as contas */  P.limparSemSaldo = async function () {
    const o = await P.ler(true);
    for (const k of (o.puter || [])) { k.semSaldo = 0; k.ate = 0; }
    await P.gravar(o);
    return true;
  };

  P.ok = async function (prov, id) {
    const o = await P.ler(true);
    const k = (o[prov] || []).find(x => x.id === id);
    if (k) { k.falhas = 0; k.ate = 0; k.semSaldo = 0; await P.gravar(o); }
  };


  /* ---------- PUTER: coletar e trocar contas que VOCE JA TEM ----------
     Nao cria conta nenhuma. Le o token da sessao ja aberta e guarda.
     Depois alterna entre eles pra distribuir a cota. */

  P.tokenAtualPuter = function () {
    try {
      if (typeof puter !== 'undefined' && puter.authToken) return puter.authToken;
      return localStorage.getItem('puter.auth.token') || '';
    } catch (e) { return ''; }
  };

  /* captura a conta logada agora e guarda no armazem.
     Só funciona com o modo admin ligado: o armazem existe para as contas
     DO DONO do site. Conta de outra pessoa não entra aqui — nem por engano. */
  P.capturarPuter = async function () {
    if (!P.admin()) return { ok: false, err:
      'o armazém é só para as contas do dono do site. Se este site é seu, ligue ' +
      '"Este armazém é meu" em Config. Conta de visitante não entra no armazém.' };
    const tk = P.tokenAtualPuter();
    if (!tk) return { ok: false, err: 'nenhuma conta Puter logada neste navegador' };
    let nome = 'conta';
    try {
      if (typeof puter !== 'undefined' && puter.auth && puter.auth.getUser) {
        const u = await puter.auth.getUser();
        nome = u.username || u.email || nome;
      }
    } catch (e) {}
    const o = await P.ler(true);
    const lista = o.puter || (o.puter = []);
    const ja = lista.find(x => x.t === tk);
    if (ja) return { ok: false, err: 'essa conta ja esta no armazem (' + ja.nome + ')' };
    lista.push({ id: novoId(), t: tk, nome: nome, falhas: 0, ate: 0 });
    await P.gravar(o);
    return { ok: true, nome: nome, total: lista.length };
  };

  /* desloga pra voce entrar com a proxima conta */
  P.trocarConta = async function () {
    try {
      if (typeof puter !== 'undefined' && puter.auth && puter.auth.signOut) await puter.auth.signOut();
      else localStorage.removeItem('puter.auth.token');
    } catch (e) { try { localStorage.removeItem('puter.auth.token'); } catch (e2) {} }
    return { ok: true };
  };

  /* ativa no navegador o proximo token livre do armazem */
  P.usarProximoPuter = async function (opts) {
    const k = await P.pegar('puter', opts);
    if (!k) return { ok: false, err: (opts && opts.precisoSaldo)
      ? 'nenhuma conta Puter com saldo no armazem (a via gratis :free segue funcionando)'
      : 'nenhum token de Puter livre no armazem' };
    try {
      if (typeof puter !== 'undefined' && puter.setAuthToken) puter.setAuthToken(k.t);
      else localStorage.setItem('puter.auth.token', k.t);
    } catch (e) { return { ok: false, err: e.message }; }
    P.ativo = k.id;
    return { ok: true, nome: k.nome, id: k.id, semSaldo: P.semSaldo(k) };
  };

  /* chamado quando a cota da conta ativa estoura: passa pra proxima.
     opts.precisoSaldo = true  ->  procura conta COM saldo (pedido que gasta) */
  P.girarPuter = async function (msg, opts) {
    const atual = P.tokenAtualPuter();
    const o = await P.ler(true);
    const k = (o.puter || []).find(x => x.t === atual) || (P.ativo && (o.puter || []).find(x => x.id === P.ativo));
    if (k) await P.falhou('puter', k.id, msg || '429');
    const prox = await P.pegar('puter', opts);
    if (!prox || prox.t === atual) return { ok: false, err: 'nenhuma outra conta Puter com cota no armazem' };
    P.ativo = prox.id;
    try {
      if (typeof puter !== 'undefined' && puter.setAuthToken) puter.setAuthToken(prox.t);
      else localStorage.setItem('puter.auth.token', prox.t);
    } catch (e) { return { ok: false, err: e.message }; }
    return { ok: true, nome: prox.nome, id: prox.id };
  };


  /* ---------- QUEM PAGA? (o desenho do site) ----------
     O puter.js foi feito para sites de terceiros no modelo USER-PAYS:
     cada visitante entra com a PROPRIA conta Puter e usa os creditos
     dela; o dono do site nao paga nada. É o caminho documentado pelo
     Puter — e é o padrao aqui.

     O outro caminho, 'dono', é o dono pagando por todos: usa os tokens
     do armazem compartilhado. Só vale para quem É o dono (ou quem ele
     autorizou) — porque compartilhar a mesma conta entre muitas pessoas
     é o que os termos do Puter proíbem.                                */
  P.modo = function (v) {
    if (v) LS.set('arkher_pool_modo', v);
    return LS.get('arkher_pool_modo', 'visitante');
  };

  /* O armazem é do DONO do site — e isso é uma escolha declarada, NÃO "o
     primeiro que logou". (Antes era o primeiro login; isso virava um furo:
     bastava um visitante entrar para o token dele entrar no armazem.)
     Aqui: admin só existe se a pessoa marcar, em Config, que o site é dela. */
  P.admin = function (v) {
    if (v !== undefined) LS.set('arkher_pool_admin', !!v);
    return LS.get('arkher_pool_admin', false) === true;
  };
  P.souDono = function () { return P.admin(); };

  /* token que deve ser usado AGORA, respeitando o modo do site */
  P.tokenParaUsar = function () {
    const meu = P.tokenAtualPuter();
    if (meu) return meu;                                   // sessão aberta aqui: é ela, sempre
    if (P.modo() === 'dono' && P.admin()) return P.tokenLivre ? (P.tokenLivre() || '') : '';
    return '';
  };

  /* ---------- AUTO: detecta e configura sozinho ----------
     Roda no load, apos o login e quando a aba volta ao foco.
     Se achar sessao Puter nova, guarda no armazem sem pedir nada. */

  P.auto = async function (onAviso) {
    const aviso = onAviso || function () {};
    const res = { puter: null, hf: null };

    // 1) sessao Puter ativa neste navegador
    const tk = P.tokenAtualPuter();
    if (tk) {
      const o = await P.ler();
      const ja = (o.puter || []).find(x => x.t === tk);
      if (ja) {
        P.ativo = ja.id;
        res.puter = { novo: false, nome: ja.nome };
      } else {
        /* A conta é da pessoa que entrou: fica no navegador dela e atende os
           pedidos dela. NÃO existe captura automática para o armazém — o
           único caminho é o dono clicar "Capturar conta logada", e só com o
           modo admin ligado. Assim nenhum token de visitante sobe sozinho. */
        res.puter = { propria: true, nome: 'conta deste navegador' };
      }
    }

    // 2) vincula ao e-mail do login do site
    try {
      const sess = LS.get('arkher_sess', null);
      const email = sess && (sess.email || (sess.user && sess.user.email));
      if (email && res.puter) {
        const o = await P.ler(true);
        const k = (o.puter || []).find(x => x.t === P.tokenAtualPuter());
        if (k && !k.dono) { k.dono = email; await P.gravar(o); }
        res.email = email;
      }
    } catch (e) {}

    // 3) HF: se o campo simples esta vazio mas ha token no armazem, usa
    try {
      const simples = LS.get('arkher_hf_token', '');
      const o = await P.ler();
      const livres = (o.hf || []).filter(x => !x.ate || x.ate < Date.now());
      if (!simples && livres.length) {
        res.hf = { usando: livres[0].nome, total: livres.length };
      } else if (simples) {
        // grava o token avulso no armazem tambem, pra virar compartilhado
        if (!(o.hf || []).some(x => x.t === simples)) {
          await P.add('hf', simples, 'principal');
          res.hf = { novo: true };
          aviso('Token do Hugging Face movido para o armazém compartilhado');
        }
      }
    } catch (e) {}

    return res;
  };

  /* ---------- LEVAR O ARMAZEM DE UM DISPOSITIVO PRO OUTRO ----------
     Você entra no Puter em vários navegadores ao longo do tempo (o seu
     celular, o PC de casa, o notebook do trabalho). Cada login vira uma
     conta no armazém. Estes dois métodos levam o armazém inteiro junto —
     sem repetir o login conta por conta.
     ATENÇÃO: o arquivo exportado contém tokens de verdade. Trate como
     senha: não suba em repositório público, nem em chat/grupo.          */
  P.exportar = function (comTokens) {
    const o = P.local();
    const limpa = a => (a || []).map(k => comTokens
      ? { t: k.t, nome: k.nome, dono: k.dono || '' }
      : { nome: k.nome, dono: k.dono || '', falhas: k.falhas || 0, semSaldo: !!k.semSaldo });
    return {
      arkher: 'pool', versao: 1, quando: new Date().toISOString(),
      comTokens: !!comTokens,
      puter: limpa(o.puter), hf: limpa(o.hf),
    };
  };

  /* junta um armazém exportado com o que já existe (não perde nada, não duplica) */
  P.importar = async function (json) {
    let d = json;
    if (typeof json === 'string') { try { d = JSON.parse(json); } catch (e) { return { ok: false, err: 'arquivo não é JSON válido' }; } }
    if (!d || d.arkher !== 'pool') return { ok: false, err: 'não parece um armazém do ARKHER' };
    if (!d.comTokens) return { ok: false, err: 'esse arquivo foi exportado SEM os tokens (não dá pra importar)' };
    const o = await P.ler(true);
    let novos = 0;
    for (const prov of ['puter', 'hf']) {
      const lista = o[prov] || (o[prov] = []);
      for (const k of (d[prov] || [])) {
        if (!k || !k.t || lista.some(x => x.t === k.t)) continue;
        lista.push({ id: novoId(), t: k.t, nome: k.nome || (prov + ' ' + (lista.length + 1)),
                     dono: k.dono || '', falhas: 0, ate: 0 });
        novos++;
      }
    }
    await P.gravar(o);
    return { ok: true, novos, total: (o.puter || []).length };
  };

  /* vigia troca de conta: se o token do Puter mudar, captura o novo */
  P.vigiar = function (onAviso) {
    let ultimo = P.tokenAtualPuter();
    setInterval(async () => {
      const agora = P.tokenAtualPuter();
      if (agora && agora !== ultimo) {
        ultimo = agora;
        await P.auto(onAviso);
        try { if (P.onMudou) P.onMudou(); } catch (e) {}
      }
    }, 4000);
    try {
      window.addEventListener('focus', () => P.auto(onAviso));
    } catch (e) {}
  };

  /* quantas contas estao ligadas neste site (pro painel do UPG) */
  P.capacidade = function () {
    const o = P.local();
    const p = (o.puter || []).length, h = (o.hf || []).length;
    let gratis = 0;
    try { gratis = (typeof Free !== 'undefined' && Free.prontos) ? Free.prontos().length : 0; } catch (e) {}
    return { contas: p + h + gratis, puter: p, hf: h, gratis: gratis };
  };

  /* ARMAZEM DE QUOTA — do jeito que o Puter mantem, e SÓ LEITURA.
     Cada conta do armazem tem o seu proprio medidor (o proprio endpoint de
     metering do Puter, com a chave daquela conta). Aqui a gente:
        • lê o saldo de cada conta, uma por uma;
        • mostra lado a lado;
        • NUNCA soma, transfere, empresta ou gasta o credito de outra.
     Nao existe "cota geral" para mover: cada linha e a cota daquela conta.
     A conta que este navegador esta usando tambem aparece, marcada.        */
  P.quota = async function () {
    const o = await P.ler();
    const atualNeste = P.tokenAtualPuter ? P.tokenAtualPuter() : '';
    const linhas = [];
    for (const c of (o.puter || [])) {
      let saldo = null;
      try { saldo = await Puter.saldo(c.t); } catch (e) {}
      linhas.push({ nome: c.nome || 'conta', saldo: saldo, minha: c.t === atualNeste,
                    dono: !!c.dono, falhas: c.falhas || 0 });
    }
    if (atualNeste && !(o.puter || []).some(x => x.t === atualNeste)) {
      let saldo = null;
      try { saldo = await Puter.saldo(atualNeste); } catch (e) {}
      linhas.push({ nome: 'esta sessão (não está no armazém)', saldo: saldo, minha: true, fora: true });
    }
    const hf = (o.hf || []).map(c => ({ nome: c.nome || 'HF', hf: true }));
    return { linhas: linhas, hf: hf, total: linhas.length + hf.length };
  };

  P.stats = async function () {
    const o = await P.ler(); const n = Date.now();
    const c = p => ({ total: (o[p] || []).length,
                      livres: (o[p] || []).filter(x => !x.ate || x.ate < n).length });
    const puter = c('puter');
    puter.comSaldo = (o.puter || []).filter(x => !P.semSaldo(x)).length;
    puter.semSaldo = puter.total - puter.comSaldo;
    return { puter, hf: c('hf') };
  };

  if (typeof window !== 'undefined') window.Pool = P;
  if (typeof module !== 'undefined') module.exports = P;
})();
