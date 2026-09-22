/* ARKHER LIGAR — um lugar só para ligar tudo
   ==========================================
   Antes disso, ligar a VM, o nó, o agente, o piloto e o DsOS era caçar
   campo em quatro telas diferentes. Agora é uma lista só.

   Regra desta peça: NUNCA dizer "ligado" sem resposta real.
     - sem endereço  -> falta o endereço, e diz onde conseguir;
     - endereço ruim -> diz o erro que voltou (HTTP 404, sem rota, etc.);
     - token vazio   -> diz que falta o token, e para que serve;
     - resposta boa  -> mostra o que a máquina respondeu (CPU/RAM/GPU).
   Nada aqui inventa sucesso. */
(function () {
  const L = {};
  const LSg = (k, d) => (window.LS ? LS.get(k, d) : d);
  const LSs = (k, v) => { if (window.LS) LS.set(k, v); };

  L.norm = function (u) {
    u = String(u == null ? '' : u).trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u;
  };

  async function pega(url, ms, opt) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 12000);
    try {
      const r = await fetch(url, Object.assign({ signal: ac.signal }, opt || {}));
      let j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      return { status: r.status, ok: r.ok, j: j };
    } finally { clearTimeout(t); }
  }

  function resumoHw(j) {
    const h = (j && (j.hw || j)) || {};
    const p = [];
    if (h.cpu) p.push(String(h.cpu).replace(/\(R\)|\(TM\)|CPU|Processor/g, '').trim() +
      (h.cpu_count ? ' x' + h.cpu_count : ''));
    if (h.ram_gb) p.push(h.ram_gb + ' GB RAM');
    p.push(h.gpu && !/sem gpu/i.test(h.gpu) ? h.gpu : 'sem GPU');
    if (h.host) p.push(h.host);
    return p.join(' · ');
  }

  /* erros que o navegador dá quando https chama http, ou quando o host não existe */
  function traduzErro(e, u) {
    const m = String((e && e.message) || e);
    const https = (typeof location !== 'undefined') && location.protocol === 'https:' && /^http:\/\//i.test(u);
    if (/abort/i.test(m)) return 'não respondeu em 12 s';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return https
        ? 'o navegador bloqueou (site https chamando endereço http) — veja o passo 3 do cartão'
        : 'não consegui falar com esse endereço (host errado, nó desligado, ou rede diferente)';
    }
    return m;
  }

  /* ------------------------------------------------------------------
     OS PONTOS. Cada um sabe se testar e sabe dizer o que falta.
     ------------------------------------------------------------------ */
  L.pontos = [
    {
      id: 'dsos', nome: 'DsOS (a tela no celular)', tipo: 'url', chave: 'dsos_url',
      campoPainel: 'lg-f-dsos', exemplo: 'http://100.x.y.z:8766', campo: 'dsr-url',
      oQueE: 'A máquina que você vê e controla pelo dedo.',
      falta: 'no nó, rode: python dsos_core.py — ele imprime o endereço http://100.x.y.z:8766',
      testar: async function (u) {
        const r = await pega(u + '/health', 12000);
        if (!r.ok) return { ok: false, detalhe: 'respondeu HTTP ' + r.status };
        const j = r.j || {};
        return { ok: true, tela: !!j.tela,
          detalhe: resumoHw(j) + (j.tela ? ' · tela ligada' : ' · sessão gráfica desligada (dá para ligar)') };
      },
    },
    {
      id: 'vm', nome: 'VM Windows (agente + piloto)', tipo: 'url', chave: 'arkher_agent',
      campoPainel: 'lg-f-vm', exemplo: 'http://100.x.y.z:8765', campo: 'f-vm',
      oQueE: 'Onde rodam Roblox Studio e Blender (Windows de verdade).',
      falta: 'suba o agent.py na máquina Windows (ou o workflow do GitHub) e cole o endereço :8765',
      testar: async function (u) {
        const r = await pega(u + '/health', 12000);
        if (!r.ok) return { ok: false, detalhe: 'respondeu HTTP ' + r.status + ' (a rota /health existe no agent.py)' };
        const j = r.j || {};
        return { ok: true, detalhe: resumoHw(j) };
      },
    },
    {
      id: 'kaggle', nome: 'Nó Linux / GPU (Kaggle)', tipo: 'url', chave: 'arkher_kaggle',
      campoPainel: 'lg-f-kaggle', exemplo: 'http://100.x.y.z:8765', campo: 'f-kaggle',
      oQueE: 'CPU + RAM para o Worker e GPU para treinar/renderizar.',
      falta: 'rode o notebook do nó (Kaggle ou Codespaces) e cole o endereço :8765',
      testar: async function (u) {
        const r = await pega(u + '/health', 12000);
        if (!r.ok) return { ok: false, detalhe: 'respondeu HTTP ' + r.status };
        const j = r.j || {};
        return { ok: true, detalhe: resumoHw(j) };
      },
    },
    {
      id: 'android', nome: 'Nó Android (Termux)', tipo: 'url', chave: 'arkher_droid',
      campoPainel: 'lg-f-android', exemplo: 'http://100.x.y.z:8765', campo: 'f-droid',
      oQueE: 'O nó que fica ligado 24 h (sem o corte de 6 h).',
      falta: 'instale o Termux, rode o agent.py e cole o endereço :8765',
      testar: async function (u) {
        const r = await pega(u + '/health', 12000);
        if (!r.ok) return { ok: false, detalhe: 'respondeu HTTP ' + r.status };
        const j = r.j || {};
        return { ok: true, detalhe: resumoHw(j) };
      },
    },
    {
      id: 'hf', nome: 'Token do Hugging Face', tipo: 'token', chave: 'arkher_hf_token',
      campoPainel: 'lg-f-hf', exemplo: 'hf_... (só leitura)', campo: 'f-hf',
      oQueE: 'Cota do SITE: roda o trabalho de fundo (nunca a sua).',
      falta: 'crie um token de leitura em huggingface.co/settings/tokens e cole aqui',
      testar: async function (v) {
        const r = await pega('https://huggingface.co/api/whoami-v2', 12000,
          { headers: { Authorization: 'Bearer ' + v } });
        if (r.status === 401) return { ok: false, detalhe: 'o Hugging Face recusou esse token (401)' };
        if (!r.ok) return { ok: false, detalhe: 'respondeu HTTP ' + r.status };
        const nome = (r.j && (r.j.name || (r.j.user && r.j.user.name))) || 'conta ok';
        return { ok: true, detalhe: 'conta: ' + nome };
      },
    },
    {
      id: 'gh', nome: 'Token do GitHub (publicar)', tipo: 'token', chave: 'arkher_gh_pat',
      campoPainel: 'lg-f-gh', exemplo: 'ghp_... (escopo workflow)', campo: 'f-gh',
      oQueE: 'Publicar o jogo, rodar o CI e ligar a VM Windows.',
      falta: 'crie um token clássico com o escopo workflow em github.com/settings/tokens',
      testar: async function (v) {
        const r = await pega('https://api.github.com/user', 12000,
          { headers: { Authorization: 'Bearer ' + v, Accept: 'application/vnd.github+json' } });
        if (r.status === 401) return { ok: false, detalhe: 'o GitHub recusou esse token (401)' };
        if (!r.ok) return { ok: false, detalhe: 'respondeu HTTP ' + r.status };
        return { ok: true, detalhe: 'conta: ' + ((r.j && r.j.login) || 'ok') };
      },
    },
    {
      id: 'puter', nome: 'Conta Puter (crédito de quem usa)', tipo: 'interno', chave: 'puter.auth.token',
      oQueE: 'A ponta: os modelos mais fortes. Só entra no pedido de verdade.',
      falta: 'entre com a conta Puter no site (botão de login) — sem ela o site roda no grátis',
      testar: async function () {
        let t = LSg('puter.auth.token', '');
        try { if (!t && typeof puter !== 'undefined' && puter.auth && puter.auth.token) t = await puter.auth.token; } catch (e) {}
        if (!t) return { ok: false, detalhe: 'ninguém logado no Puter neste navegador' };
        try {
          if (typeof puter !== 'undefined' && puter.auth && puter.auth.getUser) {
            const u = await puter.auth.getUser();
            const nome = (u && (u.username || u.email)) || 'ok';
            return { ok: true, detalhe: 'logado: ' + String(nome).split('@')[0] };
          }
        } catch (e) { return { ok: false, detalhe: 'token existe mas a conta não respondeu: ' + traduzErro(e, '') }; }
        return { ok: true, detalhe: 'token presente (a checagem completa é feita no primeiro pedido)' };
      },
    },
    {
      id: 'chaves', nome: 'Provedores grátis com chave', tipo: 'interno', chave: null,
      oQueE: 'Os gratuitos que exigem chave (Groq, Cerebras, Together…).',
      falta: 'em Config, cole as chaves em “Adicionar ao hub”. Sem nenhuma chave o site ainda funciona com os :free do Puter',
      testar: async function () {
        if (typeof Free === 'undefined') return { ok: false, detalhe: 'módulo de provedores não carregou' };
        const prontos = (Free.prontos ? Free.prontos() : []) || [];
        const chaves = (Free.chaves ? Free.chaves() : []) || [];
        if (!prontos.length) return { ok: false, detalhe: 'nenhuma chave colada ainda (o site segue no grátis sem chave)' };
        const nomes = prontos.slice(0, 5).map(p => p.nome || p.id).join(', ');
        return { ok: true, detalhe: prontos.length + ' provedor(es) pronto(s): ' + nomes +
          (chaves.length > prontos.length ? ' (+' + (chaves.length - prontos.length) + ' com cota no compasso)' : '') };
      },
    },
  ];

  L.porId = function (id) { return L.pontos.filter(p => p.id === id)[0] || null; };
  L.valorDe = function (p) { return p.chave ? LSg(p.chave, '') : ''; };

  /* o campo do painel "Ligar tudo" (lg-f-<id>) manda; o campo antigo da
     outra aba, quando existe, espelha o mesmo valor (duas telas, um dado) */
  L.elDe = function (p, id) {
    if (p.campo && id) { const a = document.getElementById(id); if (a) return a; }
    return p.campo ? document.getElementById(p.campo) : null;
  };
  function espelhar(p, v) {
    if (!p.campo) return;
    const el = document.getElementById(p.campo);
    if (el && el.value !== v) el.value = v;
  }

  /* grava o que está no campo (se houver) antes de testar */
  L.salvarCampos = function () {
    const salvos = [];
    L.pontos.forEach(function (p) {
      if (!p.chave) return;
      const el = L.elDe(p, p.campoPainel);
      if (!el) return;
      const v = String(el.value || '').trim();
      /* campo vazio NAO apaga o que ja esta salvo: quem liga tudo muitas
         vezes so abriu a tela. Apagar endereco por descuido e pior do que
         nao salvar. */
      if (!v) return;
      const novo = (p.tipo === 'url') ? L.norm(v) : v;
      if (novo !== L.valorDe(p)) { LSs(p.chave, novo); salvos.push(p.id); }
      if (p.campo) espelhar(p, novo);
      if (el.value !== novo) el.value = novo;
    });
    return salvos;
  };

  /* testa UM ponto. Sempre devolve o mesmo formato. */
  L.testar = async function (p) {
    const r = { id: p.id, nome: p.nome, ok: false, detalhe: '', falta: '', quando: Date.now() };
    try {
      if (p.tipo === 'interno') {
        const v = await p.testar();
        r.ok = !!v.ok; r.detalhe = v.detalhe || '';
        if (v.tela !== undefined) r.tela = v.tela;
      } else {
        const valor = L.valorDe(p);
        if (!valor) {
          r.falta = p.falta || 'sem endereço';
          r.detalhe = p.tipo === 'url' ? 'sem endereço' : 'sem token';
        } else {
          const v = await p.testar(valor);
          r.ok = !!v.ok; r.detalhe = v.detalhe || '';
          if (v.tela !== undefined) r.tela = v.tela;
          if (!v.ok && !r.detalhe) r.detalhe = 'não respondeu';
        }
      }
    } catch (e) {
      r.detalhe = traduzErro(e, L.valorDe(p) || '');
      r.erro = true;
    }
    return r;
  };

  /* testa todos, em paralelo: um nó caído não pode travar a lista inteira */
  L.testarTudo = async function () {
    const rs = await Promise.all(L.pontos.map(p => L.testar(p)));
    const ok = rs.filter(r => r.ok).length;
    return { lista: rs, ok: ok, total: rs.length,
      faltam: rs.filter(r => !r.ok).map(r => r.id) };
  };

  /* LIGAR: salva os campos, testa tudo e, no DsOS, sobe a sessão gráfica
     se a máquina estiver de pé mas a tela desligada. Nada além disso:
     ligar a máquina em si é no nó (isto aqui não tem como acordar um PC). */
  L.ligarTudo = async function (aoVivo) {
    const salvos = L.salvarCampos();
    const r = await L.testarTudo();
    const passos = [];
    const ds = r.lista.filter(x => x.id === 'dsos')[0];
    const pontoDsos = L.porId('dsos');
    if (ds && ds.ok && ds.tela === false && pontoDsos) {
      passos.push('DsOS respondeu; subindo a sessão gráfica…');
      if (aoVivo) aoVivo(L._parcial(r, passos));
      try {
        const resp = await pega(L.valorDe(pontoDsos) + '/boot', 90000, { method: 'POST' });
        const j = resp.j || {};
        if (j.ok) {
          passos.push('sessão gráfica no ar (' + (j.modo || j.wm || 'ok') + ')');
          ds.tela = true;
        } else {
          passos.push('a sessão gráfica NÃO subiu: ' + (j.erro || 'motivo não informado') +
            (j.faltando && j.faltando.length ? ' · falta: ' + j.faltando.join(', ') : ''));
        }
      } catch (e) { passos.push('falhou ao subir a sessão gráfica: ' + traduzErro(e, L.valorDe(pontoDsos))); }
    }
    r.salvos = salvos;
    r.passos = passos;
    return r;
  };

  /* texto curto e honesto: quantos responderam, e o que fazer com quem não */
  /* o mesmo formato do resultado final, para a tela nao ter dois caminhos */
  L._parcial = function (r, passos) {
    const ok = r.lista.filter(x => x.ok).length;
    return { lista: r.lista, ok: ok, total: r.total, passos: (passos || []).slice(),
      faltam: r.lista.filter(x => !x.ok).map(x => x.id) };
  };

  L.resumo = function (r) {
    if (!r || !r.lista) return 'nada testado ainda';
    const ok = r.lista.filter(x => x.ok);
    const nao = r.lista.filter(x => !x.ok);
    let t = ok.length + ' de ' + r.total + ' responderam' +
      (ok.length ? ': ' + ok.map(x => x.nome.split(' (')[0]).join(', ') : '');
    if (nao.length) t += ' · faltando: ' + nao.map(x => x.nome.split(' (')[0] + ' — ' + (x.detalhe || 'sem endereço')).join(' · ');
    return t;
  };

  window.Ligar = L;
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
})();
