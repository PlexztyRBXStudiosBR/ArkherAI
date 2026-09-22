/* ============================================================
   ARKHER — TELA DO CEREBRO (memoria, aprendizado e treino)
   ------------------------------------------------------------
   Fica num arquivo separado de proposito: o ui.js ja tem 1400
   linhas e mexer nele por causa de uma aba nova e risco de graca.
   Aqui a gente so ACRESCENTA: constroi a aba "Cerebro" e um cartao
   de RDP na aba VM. Se alguma coisa faltar, sai fora sem barulho.
   ============================================================ */
'use strict';
(function () {
  if (typeof document === 'undefined') return;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const esc = s => String(s == null ? '' : s);
  const LSg = (k, d) => (typeof LS !== 'undefined' ? LS.get(k, d) : d);
  const LDs = (k, v) => { if (typeof LS !== 'undefined') LS.set(k, v); };
  const logar = (box, msg) => {
    if (!box) return;
    const l = el('div', null, '· ' + msg);
    box.append(l); box.scrollTop = box.scrollHeight;
    while (box.children.length > 200) box.firstChild.remove();
  };
  const botao = (txt, cls, fn) => { const b = el('button', cls || 'mini', txt); b.onclick = fn; return b; };

  /* ============================================================
     1) O NÓ (GPU / RDP) — vale pra aba VM tambem
     ============================================================ */
  async function nodeInfo() {
    const base = (LSg('arkher_kaggle', '') || LSg('arkher_agent', '')).replace(/\/+$/, '');
    if (!base) throw new Error('nenhum nó configurado (aba VM)');
    const r = await fetch(base + '/node');
    return await r.json();
  }

  function cartaoRDP() {
    const pane = document.querySelector('#v-vm .pane');
    if (!pane || document.getElementById('rdp-card')) return;
    const c = el('div', 'card'); c.id = 'rdp-card';
    const h = el('h3'); h.innerHTML = '<svg class="ico"><use href="#i-screen"/></svg>RDP — a tela rápida (é o seu app de sempre)';
    c.append(h);
    c.append(el('p', null, 'RDP é MAIS RÁPIDO que o print da tela do navegador: ele manda só o que mudou, '
      + 'a 30-60 fps, com som e área de transferência. O workflow liga o RDP no Windows e você entra '
      + 'com o app do Windows (mstsc / Windows App / app de RDP no celular).'));
    const st1 = el('div', 'stat'); st1.innerHTML = '<span>Endereço</span><b id="rdp-host">—</b>'; c.append(st1);
    const st2 = el('div', 'stat'); st2.innerHTML = '<span>Usuário</span><b id="rdp-user">—</b>'; c.append(st2);
    const st3 = el('div', 'stat'); st3.innerHTML = '<span>Porta</span><b id="rdp-port">3389</b>'; c.append(st3);
    const st4 = el('div', 'stat'); st4.innerHTML = '<span>RDP ligado aqui?</span><b id="rdp-on">—</b>'; c.append(st4);
    const row = el('div', 'row');
    row.append(botao('Descobrir no nó', 'pri', async () => {
      try {
        const n = await nodeInfo();
        const host = n.tailscale_ip || n.ip || n.host || '';
        $('#rdp-host').textContent = host + '  (' + (n.host || '') + ')';
        $('#rdp-user').textContent = (n.rdp && n.rdp.usuario) || 'nexus';
        $('#rdp-port').textContent = (n.rdp && n.rdp.porta) || 3389;
        $('#rdp-on').textContent = n.rdp && n.rdp.ligado ? 'sim' : ('talvez — ' + (n.os || ''));
        $('#rdp-host').dataset.ip = host;
        $('#rdp-user').dataset.u = (n.rdp && n.rdp.usuario) || 'nexus';
        logar($('#rdp-log'), 'nó: ' + n.os + ' · ' + host + ' · uptime ' + Math.round((n.uptime_s || 0) / 60) + ' min');
        if (n.tailscale_ip) logar($('#rdp-log'), 'Tailscale: ' + n.tailscale_ip + ' (os dois precisam estar na mesma rede)');
      } catch (e) { logar($('#rdp-log'), 'erro: ' + e.message); }
    }));
    row.append(botao('Copiar endereço', null, () => {
      const t = $('#rdp-host').dataset.ip || $('#rdp-host').textContent;
      navigator.clipboard && navigator.clipboard.writeText(t);
      logar($('#rdp-log'), 'copiei: ' + t);
    }));
    row.append(botao('Baixar .rdp', null, () => {
      const ip = $('#rdp-host').dataset.ip || ($('#rdp-host').textContent || '').split(' ')[0];
      if (!ip || ip === '—') { logar($('#rdp-log'), 'primeiro clique em "Descobrir no nó"'); return; }
      const u = $('#rdp-user').dataset.u || 'nexus';
      const txt = [
        'full address:s:' + ip + ':3389',
        'username:s:' + u,
        'authentication level:i:0',           // aceita o certificado autoassinado do runner
        'enablecredsspsupport:i:1',
        'prompt for credentials:i:1',
        'screen mode id:i:1', 'use multimon:i:1', 'dynamic resolution:i:1',
        'audiomode:i:0', 'redirectclipboard:i:1', 'redirectprinters:i:0',
        'networkautodetect:i:1', 'connection type:i:7', 'compression:i:1',
        'bitmapcachepersistenable:i:1',
      ].join('\r\n') + '\r\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'application/rdp' }));
      a.download = 'ARKHER-' + ip + '.rdp';
      a.click();
      logar($('#rdp-log'), 'arquivo .rdp baixado: abra e digite a senha (está no log do workflow, passo "Usuario do RDP")');
    }));
    c.append(row);
    const senha = el('div', 'row');
    const pin = el('input'); pin.id = 'rdp-pw'; pin.type = 'password';
    pin.placeholder = 'senha do RDP (fica só no SEU navegador)';
    pin.value = LSg('arkher_rdp_pw', '');
    pin.oninput = () => LDs('arkher_rdp_pw', pin.value);
    senha.append(pin);
    senha.append(botao('Copiar senha', null, () => {
      navigator.clipboard && navigator.clipboard.writeText(pin.value || '');
      logar($('#rdp-log'), 'senha copiada pro clipboard');
    }));
    c.append(senha);
    // ---------- ligar a VM pelo site (dispara o workflow e lê as credenciais) ----------
    c.append(el('p', null, 'Ou deixe o site ligar a máquina: ele dispara o workflow pelo GitHub, espera o runner '
      + 'subir e lê endereço/usuário/senha do próprio log. Prefira o workflow do ARKHER (liga RDP **e** o agente '
      + 'na mesma máquina); o repo só-RDP é bom quando você quer só a tela.'));
    const cfg = (typeof RDP !== 'undefined') ? RDP.cfg() : { repo: '', workflow: '' };
    const rowc = el('div', 'row');
    const irepo = el('input'); irepo.id = 'rdp-repo'; irepo.value = cfg.repo; irepo.placeholder = 'dono/repo';
    const iwf = el('input'); iwf.id = 'rdp-wf'; iwf.value = cfg.workflow; iwf.placeholder = 'main.yml';
    iwf.style.maxWidth = '130px';
    rowc.append(irepo, iwf);
    c.append(rowc);
    const rowp = el('div', 'row');
    const ipat = el('input'); ipat.id = 'rdp-pat'; ipat.type = 'password';
    ipat.placeholder = 'PAT do GitHub (Actions: write) — fica só no seu navegador';
    ipat.value = LSg('arkher_gh_pat', '');
    rowp.append(ipat);
    rowp.append(botao('Salvar', null, () => {
      if (typeof RDP === 'undefined') return;
      RDP.setCfg({ repo: irepo.value.trim(), workflow: iwf.value.trim() || 'main.yml' });
      RDP.setPat(ipat.value);
      logar($('#rdp-log'), 'config salva: ' + RDP.cfg().repo + ' / ' + RDP.cfg().workflow
        + (RDP.pat() ? ' + PAT' : ' (sem PAT: não dá pra disparar)'));
    }));
    c.append(rowp);
    const rowL = el('div', 'row');
    rowL.append(botao('Ligar a VM agora', 'pri', async () => {
      if (typeof RDP === 'undefined') { logar($('#rdp-log'), 'rdp.js não carregou'); return; }
      if (!RDP.pat()) { logar($('#rdp-log'), 'cole o PAT (Actions: write) e clique em Salvar'); return; }
      try {
        const r = await RDP.ligarEPegar(t => logar($('#rdp-log'), t));
        $('#rdp-host').textContent = r.ip + ':' + r.porta; $('#rdp-host').dataset.ip = r.ip;
        $('#rdp-user').textContent = r.usuario || '—'; $('#rdp-user').dataset.u = r.usuario || '';
        if (r.senha) { pin.value = r.senha; LDs('arkher_rdp_pw', r.senha); }
        logar($('#rdp-log'), 'pronto: ' + r.ip + ' · usuário ' + r.usuario + (r.senha ? ' · senha preenchida' : ' · senha no log'));
        if (r.aviso) logar($('#rdp-log'), r.aviso);
      } catch (e) { logar($('#rdp-log'), 'não deu: ' + e.message); }
    }));
    rowL.append(botao('Ler credenciais do último run', null, async () => {
      if (typeof RDP === 'undefined') return;
      try {
        const run = await RDP.runNovo(Date.now() - 3600000);
        if (!run) { logar($('#rdp-log'), 'nenhum run recente nesse workflow'); return; }
        logar($('#rdp-log'), 'run ' + run.commit + ' (' + run.estado + '/' + (run.fim || '—') + ') ' + run.url);
        const t = await RDP.log(run.id);
        const c2 = RDP.lerLog(t.texto);
        logar($('#rdp-log'), c2.ip ? ('achei: ' + c2.ip + ' usuário ' + c2.usuario + (c2.senha ? ' senha ' + c2.senha : ' (senha não está no log)')) : 'o log ainda não tem o endereço');
        if (c2.ip) {
          $('#rdp-host').textContent = c2.ip + ':' + c2.porta; $('#rdp-host').dataset.ip = c2.ip;
          $('#rdp-user').textContent = c2.usuario || '—'; $('#rdp-user').dataset.u = c2.usuario || '';
          if (c2.senha) { pin.value = c2.senha; LDs('arkher_rdp_pw', c2.senha); }
        }
        if (c2.aviso) logar($('#rdp-log'), c2.aviso);
      } catch (e) { logar($('#rdp-log'), e.message); }
    }));
    c.append(rowL);
    // plano B: o navegador pode não conseguir ler o log (CORS) — cola aqui que o leitor funciona
    const colar = el('textarea'); colar.id = 'rdp-log-colar'; colar.rows = 3;
    colar.placeholder = 'se o navegador não conseguir ler o log, abra o run no GitHub, copie o trecho do endereço e cole aqui';
    colar.style.cssText = 'width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:8px;font-family:ui-monospace,monospace;font-size:11.5px';
    c.append(colar);
    const rowB = el('div', 'row');
    rowB.append(botao('Ler o que colei', null, () => {
      if (typeof RDP === 'undefined') return;
      const r = RDP.lerLog(colar.value);
      if (!r.ok) { logar($('#rdp-log'), 'não achei endereço/usuário nesse texto'); return; }
      $('#rdp-host').textContent = r.ip + ':' + r.porta; $('#rdp-host').dataset.ip = r.ip;
      $('#rdp-user').textContent = r.usuario || '—'; $('#rdp-user').dataset.u = r.usuario || '';
      if (r.senha) { pin.value = r.senha; LDs('arkher_rdp_pw', r.senha); }
      logar($('#rdp-log'), 'lido do texto: ' + r.ip + ' · ' + r.usuario + (r.senha ? ' · senha preenchida' : ''));
      if (r.aviso) logar($('#rdp-log'), r.aviso);
    }));
    c.append(rowB);
    const lg = el('div', 'hint'); lg.id = 'rdp-log';
    lg.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;max-height:120px;overflow:auto';
    c.append(lg);
    pane.insertBefore(c, pane.firstChild);
  }

  /* ============================================================
     2) ABA CÉREBRO
     ============================================================ */
  function mountCerebro() {
    const view = document.getElementById('v-cerebro');
    if (!view || document.getElementById('cerebro-ui')) return;
    const pane = view.querySelector('.pane') || view;

    const wrap = el('div', 'grid'); wrap.id = 'cerebro-ui';
    wrap.style.cssText = 'display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(330px,1fr))';

    /* --- 2.1 estado --- */
    const c1 = el('div', 'card');
    c1.append(el('h3', null, 'Memória neural'));
    c1.append(el('p', null, 'Tudo que ele sabe fica guardado aqui: o pacote de conhecimento do repo, '
      + 'o que você colar, as documentações que ele estudar e as lições das conversas.'));
    const st = el('div'); st.id = 'cb-stats';
    st.innerHTML = '<div class="stat"><span>Blocos</span><b>—</b></div>';
    c1.append(st);
    const r1 = el('div', 'row');
    r1.append(botao('Atualizar', 'pri', mostrarStats));
    r1.append(botao('Sincronizar com o time', null, async () => {
      try { const r = await Neural.sincronizar(); logar($('#cb-log'), 'sync: ' + r.mudou + ' novidades, total ' + r.itens); mostrarStats(); }
      catch (e) { logar($('#cb-log'), 'sync: ' + e.message); }
    }));
    r1.append(botao('Apagar memória', 'mini danger', () => {
      if (!confirm('Apagar TODA a memória neural deste navegador? (o pacote do repo volta no proximo init)')) return;
      Neural.limpar('tudo'); Neural.pronto = false; logar($('#cb-log'), 'memória apagada'); mostrarStats();
    }));
    c1.append(r1);
    const lg1 = el('div', 'hint'); lg1.id = 'cb-log';
    lg1.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;max-height:130px;overflow:auto';
    c1.append(lg1);

    /* --- 2.2 ensinar --- */
    const c2 = el('div', 'card');
    c2.append(el('h3', null, 'Ensinar (treino manual)'));
    c2.append(el('p', null, 'Cole uma URL de documentação ou um texto e ele estuda: baixa, corta, '
      + 'vetoriza e guarda pra sempre.'));
    const iu = el('input'); iu.id = 'cb-url'; iu.placeholder = 'https://create.roblox.com/docs/...';
    c2.append(iu);
    const r2 = el('div', 'row');
    r2.append(botao('Estudar URL', 'pri', () => estudarURL(iu.value)));
    r2.append(botao('Estudar docs oficiais', null, estudarOficiais));
    c2.append(r2);
    const it = el('textarea'); it.id = 'cb-texto'; it.rows = 4;
    it.placeholder = 'ou cole um texto/apostila aqui (aceita código, tabela, o que for)';
    it.style.cssText = 'width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:8px;font-family:inherit';
    c2.append(it);
    const r2b = el('div', 'row');
    r2b.append(botao('Guardar este texto', null, async () => {
      const t = it.value.trim(); if (!t) return;
      logar($('#cb-log'), 'guardando ' + t.length + ' chars...');
      const n = await Neural.add(t, { src: 'manual', tags: 'texto colado' });
      logar($('#cb-log'), n + ' pedaços guardados'); it.value = ''; mostrarStats();
    }));
    const sel = el('select'); sel.id = 'cb-vetor';
    ['auto|Vetorizar: automático (HF/nó, senão local)', 'local|Vetorizar: só local (offline)', 'hf|Vetorizar: só Hugging Face']
      .forEach(o => { const [v, t] = o.split('|'); const op = el('option', null, t); op.value = v; sel.append(op); });
    sel.value = LSg('arkher_vetor_modo', 'auto');
    sel.onchange = () => {
      LDs('arkher_vetor_modo', sel.value);
      Neural.cfg.usarHF = sel.value !== 'local';
      Neural.cfg.usarGPU = sel.value === 'auto' || sel.value === 'hf';
      logar($('#cb-log'), 'vetorização: ' + sel.value);
    };
    r2b.append(sel);
    c2.append(r2b);

    /* --- 2.3 busca na memória --- */
    const c3 = el('div', 'card');
    c3.append(el('h3', null, 'Perguntar à memória'));
    c3.append(el('p', null, 'O que ele já sabe sobre um assunto — sem gastar modelo nenhum.'));
    const iq = el('input'); iq.id = 'cb-q'; iq.placeholder = 'ex: como publicar um lugar no roblox';
    c3.append(iq);
    const r3 = el('div', 'row'); r3.append(botao('Buscar', 'pri', buscar));
    c3.append(r3);
    const res = el('div'); res.id = 'cb-res';
    res.style.cssText = 'max-height:280px;overflow:auto;font-size:12px;line-height:1.5';
    c3.append(res);

    /* --- 2.4 aprender sozinho --- */
    const c4 = el('div', 'card');
    c4.append(el('h3', null, 'Aprender sozinho (treino automático)'));
    c4.append(el('p', null, 'Cada resposta boa vira lição. Quando junta lição suficiente, o "Destilar" '
      + 'transforma tudo em REGRAS curtas que entram fixas no prompt — é assim que ele melhora sem GPU.'));
    const chk = el('label'); chk.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0';
    const ci = el('input'); ci.type = 'checkbox'; ci.id = 'cb-auto'; ci.checked = Neural.cfg.auto !== false;
    ci.onchange = () => { Neural.cfg.auto = ci.checked; if (typeof Neural !== 'undefined') { Neural.itens = Neural.itens; } logar($('#cb-log'), 'aprendizado automático: ' + (ci.checked ? 'ligado' : 'desligado')); };
    chk.append(ci, el('span', null, 'guardar lições automaticamente'));
    c4.append(chk);
    const r4 = el('div', 'row');
    r4.append(botao('Destilar agora (sem GPU)', 'pri', async () => {
      logar($('#cb-log'), 'destilando...');
      try { const r = await Neural.destilar(t => logar($('#cb-log'), t)); logar($('#cb-log'), '+' + r.novas + ' regras (total ' + r.total + ')'); regras(); mostrarStats(); }
      catch (e) { logar($('#cb-log'), 'destilar: ' + e.message); }
    }));
    r4.append(botao('Ver regras', null, regras));
    c4.append(r4);
    const rr = el('div'); rr.id = 'cb-regras';
    rr.style.cssText = 'font-family:ui-monospace,monospace;font-size:11.5px;max-height:200px;overflow:auto;line-height:1.5';
    c4.append(rr);

    /* --- 2.5 treino COM PESOS no nó --- */
    const c5 = el('div', 'card');
    c5.append(el('h3', null, 'Treinar o modelo (LoRA na GPU do nó)'));
    c5.append(el('p', null, 'Isto treina PESO de verdade: pega as lições, manda pro nó com GPU '
      + '(Kaggle/PC) e ele devolve um modelo seu. Depois é só escolher "local:<nome>" no chat.'));
    const gst = el('div'); gst.id = 'cb-gpu';
    gst.innerHTML = '<div class="stat"><span>GPU no nó</span><b>—</b></div>';
    c5.append(gst);
    const selb = el('select'); selb.id = 'cb-base';
    selb.append(el('option', null, 'base: Qwen2.5 Coder 7B (padrão)'));
    c5.append(selb);
    const r5 = el('div', 'row');
    const inome = el('input'); inome.id = 'cb-nome'; inome.placeholder = 'nome do seu modelo (ex: meu-jogo)';
    const ipassos = el('input'); ipassos.id = 'cb-passos'; ipassos.placeholder = 'passos (60)';
    ipassos.style.maxWidth = '120px';
    r5.append(inome, ipassos);
    c5.append(r5);
    const r5b = el('div', 'row');
    r5b.append(botao('Exportar dataset (.jsonl)', null, () => {
      const j = Neural.exportar();
      if (!j) { logar($('#cb-log'), 'dataset vazio: converse mais (ou ligue o aprendizado automático)'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([j], { type: 'application/x-ndjson' }));
      a.download = 'arkher-dataset.jsonl'; a.click();
      logar($('#cb-log'), 'dataset exportado: ' + j.split('\n').length + ' exemplos');
    }));
    r5b.append(botao('Enviar cérebro pro nó', null, async () => {
      try {
        const r = await Neural.enviarParaNo(null, t => logar($('#cb-log'), t));
        logar($('#cb-log'), r.total ? ('pronto: ' + r.total + ' amostras no nó — agora clique "Treinar" (ou ligue o treino sozinho)')
                                    : 'nada novo pra mandar (o nó já tinha tudo)');
      } catch (e) { logar($('#cb-log'), 'não deu: ' + e.message); }
    }));
    r5b.append(botao('Treinar sozinho no nó', null, async () => {
      try {
        const st = await Neural.estadoNo();
        const ligado = !(st.auto && st.auto.ligado);
        const j = await Neural.treinoAuto(null, { ligado, min_novos: 40, min_total: 40 });
        logar($('#cb-log'), 'treino automático no nó: ' + (j.ligado ? 'LIGADO' : 'desligado')
          + ' — quando juntar 40 amostras novas ele treina sozinho e vira "local:<nome>" no chat');
      } catch (e) { logar($('#cb-log'), 'não deu: ' + e.message); }
    }));
    r5b.append(botao('Ver o que o nó sabe', null, async () => {
      try {
        const j = await Neural.estadoNo();
        logar($('#cb-log'), 'nó: ' + j.total + ' amostras (' + j.sft + ' de conversa + ' + j.dpo + ' de preferência)'
          + ' · modelos treinados: ' + ((j.adapters || []).join(', ') || 'nenhum')
          + ' · treino automático: ' + (j.auto && j.auto.ligado ? 'ligado' : 'desligado')
          + (j.auto && j.auto.erro ? (' · último erro: ' + j.auto.erro) : ''));
      } catch (e) { logar($('#cb-log'), 'nó não respondeu: ' + e.message); }
    }));
    r5b.append(botao('Treinar no nó e usar no chat', 'pri', async () => {
      const base = (LSg('arkher_kaggle', '') || LSg('arkher_agent', '')).replace(/\/+$/, '');
      if (!base) { logar($('#cb-log'), 'configure o nó com GPU na aba VM primeiro'); return; }
      const jsonl = Neural.exportar();
      if (!jsonl) { logar($('#cb-log'), 'dataset vazio: nada pra treinar ainda'); return; }
      const nome = (inome.value || 'arkher-' + Date.now().toString(36)).trim();
      logar($('#cb-log'), 'mandando ' + jsonl.split('\n').length + ' exemplos pro nó...');
      try {
        // 1) guarda no dataset do no (o cerebro fica la, e o treino automatico usa depois)
        try {
          await fetch(base + '/dataset', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonl }),
          });
        } catch (e) { /* no antigo: segue pelo /treinar direto */ }
        const r = await fetch(base + '/treinar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonl, base: baseHf(selb.value), nome, passos: parseInt(ipassos.value) || 60 }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.err || 'o nó recusou');
        logar($('#cb-log'), 'job ' + j.id + ' na ' + (j.gpu || 'GPU') + ' — acompanhando...');
        for (let i = 0; i < 240; i++) {
          await new Promise(s => setTimeout(s, 5000));
          const st2 = await (await fetch(base + '/infer?job=' + j.id)).json();
          (st2.linhas || []).slice(-1).forEach(l => logar($('#cb-log'), l));
          if (st2.estado === 'rodando') continue;
          if (st2.estado === 'pronto') {
            logar($('#cb-log'), 'TREINOU. agora escolha "gpu:local:' + nome + '" no chat (ou clique abaixo)');
            LDs('arkher_modelo', 'gpu:local:' + nome);
            logar($('#cb-log'), 'já deixei selecionado como modelo do chat');
          } else logar($('#cb-log'), 'falhou: ' + (st2.erro || '?') + ' ' + (st2.como_resolver || ''));
          treinados(); mostrarStats(); break;
        }
      } catch (e) { logar($('#cb-log'), 'treino: ' + e.message); }
    }));
    c5.append(r5b);
    const lt = el('div'); lt.id = 'cb-treinados';
    lt.style.cssText = 'font-size:12px;line-height:1.6;max-height:180px;overflow:auto';
    c5.append(lt);

    wrap.append(c1, c2, c3, c4, c5);

    /* --- 2.6 enxame: varias IAs com as mesmas ferramentas --- */
    const c6 = el('div', 'card');
    c6.append(el('h3', null, 'Enxame (conselho de IAs)'));
    c6.append(el('p', null, 'Várias IAs respondem ao mesmo pedido, cada uma no papel que faz melhor — todas com '
      + 'as MESMAS ferramentas (3D, bash, web, memória). Um crítico julga, um agregador junta o melhor de todas, '
      + 'e o resultado volta melhor que qualquer uma sozinha. Quem acerta mais naquele tipo de pedido vai '
      + 'ganhando prioridade: ele aprende sem GPU, por contagem.'));
    const chkE = el('label'); chkE.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0';
    const ciE = el('input'); ciE.type = 'checkbox'; ciE.id = 'enx-ligado'; ciE.checked = Enxame.ligado();
    ciE.onchange = () => { Enxame.set('ligado', ciE.checked); logar($('#cb-log'), 'modo enxame no chat: ' + (ciE.checked ? 'LIGADO' : 'desligado')); };
    chkE.append(ciE, el('span', null, 'usar o enxame no chat (padrão: desligado)'));
    c6.append(chkE);
    const re = el('div', 'row');
    const selN = el('select'); selN.id = 'enx-n';
    [['2', '2 IAs (rápido)'], ['4', '4 IAs (padrão)'], ['8', '8 IAs'], ['16', '16 IAs'],
     ['32', '32 IAs'], ['64', '64 IAs (pesado)'], ['100', '100 IAs (máximo — gasta muita cota)']]
      .forEach(([v, t]) => { const o = el('option', null, t); o.value = v; selN.append(o); });
    selN.value = String(Enxame.cfg.n);
    selN.onchange = () => { Enxame.set('n', parseInt(selN.value)); logar($('#cb-log'), 'enxame com ' + selN.value + ' IAs por rodada'); };
    re.append(selN);
    const chkV = el('label'); chkV.style.cssText = 'display:flex;gap:6px;align-items:center';
    const ciV = el('input'); ciV.type = 'checkbox'; ciV.id = 'enx-verif'; ciV.checked = !!Enxame.cfg.verificar;
    ciV.onchange = () => { Enxame.set('verificar', ciV.checked); logar($('#cb-log'), 'verificação com ferramentas: ' + (ciV.checked ? 'ligada' : 'desligada')); };
    chkV.append(ciV, el('span', null, 'verificar com ferramentas'));
    re.append(chkV);
    c6.append(re);
    /* --- armazem de cota: e ele que decide o tamanho do conselho --- */
    const cot = el('div'); cot.id = 'enx-cota';
    cot.style.cssText = 'font-size:12px;line-height:1.6;margin:6px 0;padding:6px 8px;'
      + 'border:1px solid var(--lin, #2a2a2a);border-radius:8px';
    c6.append(cot);
    const pintarCota = async () => {
      try {
        const c = await Enxame.cota();
        const t = await Enxame.tamanho(Enxame.cfg.n, c);
        cot.innerHTML = c && c.total
          ? '<b>Armazém de cota:</b> ' + c.contas + ' conta(s) Puter (' + c.livres + ' livre(s))'
            + (c.gratis ? ' + ' + c.gratis + ' provedor(es) grátis' : '')
            + (c.hf ? ' + ' + c.hf + ' token(s) HF' : '')
            + ' → o conselho usa <b>' + t.n + ' IAs</b>, ' + t.paralelo + ' em paralelo'
          : '<b>Armazém de cota:</b> vazio ou desligado — o conselho usa só ' + (Enxame.cfg.n) + ' IAs (padrão). '
            + 'Adicione contas do Puter e chaves grátis em Config para escalar.';
      } catch (e) { cot.textContent = 'Armazém de cota: ' + e.message; }
    };
    const re2 = el('div', 'row');
    const mkChk = (id, rotulo, campo) => {
      const l = el('label'); l.style.cssText = 'display:flex;gap:6px;align-items:center';
      const i = el('input'); i.type = 'checkbox'; i.id = id; i.checked = Enxame.cfg[campo] !== false;
      i.onchange = () => { Enxame.set(campo, i.checked); logar($('#cb-log'), rotulo + ': ' + (i.checked ? 'ligado' : 'desligado')); pintarCota(); };
      l.append(i, el('span', null, rotulo));
      return { l, i };
    };
    const cA = mkChk('enx-armazem', 'usar o armazém inteiro (conselho grande)', 'usarArmazem');
    const cB = mkChk('enx-escalar', 'escalar sozinho se a crítica reprovar', 'escalar');
    re2.append(cA.l, cB.l);
    c6.append(re2);
    const re3 = el('div', 'row');
    const chkP = el('label'); chkP.style.cssText = 'display:flex;gap:6px;align-items:center';
    const selP = el('select'); selP.id = 'enx-prof';
    [['auto', 'profundo: automático (tarefa grande)'], ['sim', 'profundo: sempre'], ['nao', 'profundo: nunca']]
      .forEach(([v, t]) => { const o = el('option', null, t); o.value = v; selP.append(o); });
    selP.value = Enxame.cfg.profund === true ? 'sim' : Enxame.cfg.profund === false ? 'nao' : 'auto';
    selP.onchange = () => {
      Enxame.set('profund', selP.value === 'sim' ? true : selP.value === 'nao' ? false : 'auto');
      logar($('#cb-log'), 'modo profundo: ' + selP.value);
    };
    chkP.append(selP);
    re3.append(chkP);
    c6.append(re3);
    try { pintarCota(); } catch (e) {}
    const r6 = el('div', 'row');
    const iq6 = el('input'); iq6.id = 'enx-q'; iq6.placeholder = 'pergunta pra testar o conselho agora';
    r6.append(iq6);
    r6.append(botao('Rodar conselho', 'pri', async () => {
      const q = iq6.value.trim(); if (!q) return;
      logar($('#cb-log'), '=== conselho: ' + q + ' ===');
      try {
        const r = await Enxame.rodar(q, { onLog: t => logar($('#cb-log'), t) });
        logar($('#cb-log'), '── resposta final (' + r.agentes + ' IAs · ' + r.tarefa + ' · ' + Math.round(r.ms / 1000) + 's) ──');
        logar($('#cb-log'), r.texto.slice(0, 800));
        enxStats();
      } catch (e) { logar($('#cb-log'), 'conselho falhou: ' + e.message); }
    }));
    c6.append(r6);
    const t6 = el('div'); t6.id = 'enx-stats';
    t6.style.cssText = 'font-size:12px;line-height:1.6;max-height:200px;overflow:auto';
    c6.append(t6);
    const r6b = el('div', 'row');
    r6b.append(botao('Exportar preferências (DPO)', null, () => {
      const j = Neural.exportarPrefs();
      if (!j) { logar($('#cb-log'), 'sem pares de preferência ainda: rode o conselho algumas vezes'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([j], { type: 'application/x-ndjson' }));
      a.download = 'arkher-preferencias-dpo.jsonl'; a.click();
      logar($('#cb-log'), 'pares exportados: ' + j.split('\n').length
        + ' — treine no nó (aba Cérebro → treinar) ou jogue um Colab/Unsloth com DPOTrainer');
    }));
    r6b.append(botao('Treinar no nó (preferências)', null, async () => {
      const base = (LSg('arkher_kaggle', '') || LSg('arkher_agent', '')).replace(/\/+$/, '');
      if (!base) { logar($('#cb-log'), 'configure o nó com GPU na aba VM'); return; }
      const jsonl = Neural.exportarPrefs();
      if (!jsonl) { logar($('#cb-log'), 'sem pares de preferência ainda'); return; }
      try {
        try {   // fica guardado no cerebro do no tambem (treino automatico usa depois)
          await fetch(base + '/dataset', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonl }),
          });
        } catch (e) { /* no antigo */ }
        const r = await fetch(base + '/treinar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonl, tipo: 'dpo', nome: 'dpo-' + Date.now().toString(36), passos: 40 }),
        });
        const j = await r.json();
        logar($('#cb-log'), j.ok ? ('treino DPO no nó: job ' + j.id + ' (' + j.amostras + ' pares)')
                                 : ('o nó recusou: ' + (j.err || '?')));
      } catch (e) { logar($('#cb-log'), 'treino: ' + e.message); }
    }));
    c6.append(r6b);
    wrap.append(c6);

    /* --- 2.7 memoria compartilhada: IAs, chats, abas e VMs no mesmo quadro --- */
    const c7 = el('div', 'card');
    c7.append(el('h3', null, 'Memória compartilhada'));
    c7.append(el('p', null, 'Um quadro só para as IAs do enxame, os chats, as abas (3D, terminal, piloto) e as '
      + 'sessões de VM. O que uma descobre a outra já lê: comando que funcionou, caminho de arquivo, API certa, '
      + 'erro que apareceu, decisão tomada. Sincroniza entre seus aparelhos (se você usa login) e fica gravado no '
      + 'nó (sobrevive à sessão de VM morrer). Item com sigilo nunca sai daqui.'));
    const memSt = el('div'); memSt.id = 'mem-st';
    memSt.style.cssText = 'font-size:12px;line-height:1.6;margin:6px 0';
    c7.append(memSt);
    const r7 = el('div', 'row');
    const iq7 = el('input'); iq7.id = 'mem-q'; iq7.placeholder = 'procurar no que já foi descoberto';
    r7.append(iq7);
    r7.append(botao('Buscar (por significado)', 'pri', async () => {
      if (!window.Memoria) return;
      const q = iq7.value.trim();
      try {
        const r = await Memoria.buscar(q, 20);
        const itens = r.map(x => x.item);
        memLista(itens, 'nada encontrado');
        if (itens.length) logar($('#cb-log'), 'busca: ' + itens.length + ' item(ns) — o mais parecido: '
          + itens[0].texto.slice(0, 120));
      } catch (e) { logar($('#cb-log'), 'busca: ' + e.message); }
    }));
    r7.append(botao('Indexar agora', null, async () => {
      try {
        const r = await Memoria.indexar(200, t => logar($('#cb-log'), t));
        logar($('#cb-log'), 'índice: ' + r.total + ' item(ns) com vetor (novos: ' + r.novos + ', via ' + r.via + ')');
        memPinta();
      } catch (e) { logar($('#cb-log'), 'indexar: ' + e.message); }
    }));
    c7.append(r7);
    const r8 = el('div', 'row');
    r8.append(botao('Puxar do nó', null, async () => {
      try {
        const r = await Memoria.noPuxar();
        logar($('#cb-log'), 'memória: ' + r.novos + ' item(ns) vieram do nó (o nó tem ' + r.totalNo + ')');
        memPinta();
      } catch (e) { logar($('#cb-log'), 'nó não respondeu: ' + e.message); }
    }));
    r8.append(botao('Enviar pro nó', null, async () => {
      try {
        const r = await Memoria.noEnviar();
        logar($('#cb-log'), 'memória: ' + r.novos + ' item(ns) foram pro nó (total ' + r.total + ')');
      } catch (e) { logar($('#cb-log'), 'nó não respondeu: ' + e.message); }
    }));
    r8.append(botao('Sincronizar aparelhos', null, async () => {
      try {
        const r = await Memoria.sincronizar(true);
        logar($('#cb-log'), r.ok ? ('sincronizou: ' + (r.novos || 0) + ' novo(s), total ' + r.total)
                                 : ('não deu: ' + r.err));
        memPinta();
      } catch (e) { logar($('#cb-log'), 'sincronizar: ' + e.message); }
    }));
    r8.append(botao('Nova sessão de chat', null, () => {
      Memoria.sessao(true);
      logar($('#cb-log'), 'sessão nova: o chat começa do zero MAS continua lendo o quadro (global/vm)');
      memPinta();
    }));
    r8.append(botao('Destilar em regras', null, async () => {
      try {
        const r = await Memoria.destilar(t => logar($('#cb-log'), t));
        logar($('#cb-log'), 'virou regra: ' + r.novas + ' nova(s) de ' + r.itens + ' item(ns) — total '
          + r.total + ' regras (essas entram em TODA resposta, sem precisar buscar)');
        memPinta();
      } catch (e) { logar($('#cb-log'), 'destilar: ' + e.message); }
    }));
    r8.append(botao('Limpar quadro', null, () => {
      Memoria.limpar();
      logar($('#cb-log'), 'quadro limpo');
      memPinta();
    }));
    c7.append(r8);
    const r9 = el('div', 'row');
    const l9 = el('label'); l9.style.cssText = 'display:flex;gap:6px;align-items:center';
    const c9 = el('input'); c9.type = 'checkbox'; c9.id = 'mem-destilar'; c9.checked = !!Memoria.cfg.destilar;
    c9.onchange = () => {
      Memoria.config({ destilar: c9.checked });
      logar($('#cb-log'), 'destilar sozinho: ' + (c9.checked ? 'ligado (junta '
        + (Memoria.cfg.destilarMin || 25) + ' item novo e ele vira regra)' : 'desligado'));
      memPinta();
    };
    l9.append(c9, el('span', null, 'destilar sozinho (vira regra sem GPU)'));
    r9.append(l9);
    r9.append(botao('Ver regras aprendidas', null, () => {
      const txt = (window.Neural && Neural.regrasTexto(20)) || '';
      logar($('#cb-log'), txt ? ('regras que entram em toda resposta:\n' + txt)
                              : 'nenhuma regra ainda — use "Destilar em regras"');
    }));
    c7.append(r9);
    const memLista7 = el('div'); memLista7.id = 'mem-lista';
    memLista7.style.cssText = 'font-size:12px;line-height:1.6;max-height:220px;overflow:auto;margin-top:6px';
    c7.append(memLista7);
    wrap.append(c7);

    function memLista(itens, vazio) {
      memLista7.innerHTML = (itens && itens.length)
        ? itens.map(x => '<div style="margin:3px 0">· <b>' + x.tipo + '</b> <small>' + x.escopo + '</small> — '
            + String(x.texto).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).slice(0, 220) + '</div>').join('')
        : ('<small>' + (vazio || 'nada ainda — conversa com o chat, roda o enxame ou mexe na VM e o quadro enche sozinho') + '</small>');
    }
    function memPinta() {
      try {
        if (!window.Memoria) { memSt.textContent = 'memória compartilhada não carregou'; return; }
        const st = Memoria.stats();
        memSt.innerHTML = '<b>' + st.total + ' item(ns)</b> · '
          + Object.keys(st.porEscopo).map(k => k + ': ' + st.porEscopo[k]).join(' · ')
          + (st.sigilo ? (' · <b>' + st.sigilo + ' com sigilo</b> (nunca saem daqui)') : '')
          + '<br><small>sessão atual: ' + Memoria.sessao() + ' · compartilhar no nó: '
          + (Memoria.cfg.no ? 'ligado' : 'desligado') + ' · aparelhos: ' + (Memoria.cfg.sync ? 'ligado' : 'desligado')
          + ' · vetores: ' + Object.keys(Memoria.vecs || {}).length
          + ' · regras: ' + ((window.Neural && Neural.regras) ? Neural.regras.length : 0)
          + ' · destilar sozinho: ' + (Memoria.cfg.destilar ? 'ligado' : 'desligado') + '</small>';
        memLista(Memoria.listar({ k: 12 }));
      } catch (e) { memSt.textContent = 'memória: ' + e.message; }
    }
    memPinta();
    function enxStats() {
      const t = Enxame.tabela();
      if (!Enxame.ligado() && !t.length) { t6.textContent = '(desligado — ligue acima pra o chat usar o conselho)'; return; }
      t6.innerHTML = t.length
        ? '<b>Quem manda bem em qual tipo de pedido</b> (aprendido pelo uso):<br>'
          + t.slice(0, 14).map(x => '· <b>' + x.tarefa + '</b>: ' + x.modelo + ' — média ' + x.media
            + ', vitórias ' + x.vitorias + '/' + x.rodadas).join('<br>')
        : '(ainda sem rodadas)';
    }
    enxStats();

    pane.append(wrap);

    /* ---------- funcoes da tela ---------- */
    async function mostrarStats() {
      try {
        if (!Neural.pronto) await Neural.init(t => logar($('#cb-log'), t));
        const s = Neural.stats_();
        const dono = s.vetoresGPU > s.vetoresHF ? 'nó (GPU)' : s.vetoresHF >= s.vetoresLocal ? 'Hugging Face' : 'local';
        $('#cb-stats').innerHTML =
          '<div class="stat"><span>Blocos de conhecimento</span><b>' + s.itens + '</b></div>' +
          '<div class="stat"><span>Com vetor (buscável por sentido)</span><b>' + s.vetores + '</b></div>' +
          '<div class="stat"><span>Regras aprendidas</span><b>' + s.regras + '</b></div>' +
          '<div class="stat"><span>Lições (dados de treino)</span><b>' + s.licoes + '</b></div>' +
          '<div class="stat"><span>Vetorizando com</span><b>' + dono + '</b></div>' +
          '<div class="stat"><span>Fontes</span><b>' + Object.entries(s.porFonte).map(x => x[0] + ':' + x[1]).join(' ') + '</b></div>';
        regras();
      } catch (e) { logar($('#cb-log'), 'stats: ' + e.message); }
    }
    function regras() {
      const r = Neural.regras;
      $('#cb-regras').textContent = r.length ? r.map(x => '· ' + (x.txt || x) + (x.peso > 1 ? '  (x' + x.peso + ')' : '')).join('\n')
        : '(nenhuma ainda — clique em "Destilar agora" depois de usar o chat)';
    }
    async function buscar() {
      const q = $('#cb-q').value.trim(); if (!q) return;
      $('#cb-res').innerHTML = 'procurando...';
      const achados = await Neural.buscar(q, 8);
      if (!achados.length) { $('#cb-res').textContent = 'nada guardado sobre isso ainda. Use "Ensinar" ou o chat (o aprendizado automático guarda sozinho).'; return; }
      $('#cb-res').innerHTML = '';
      achados.forEach(r => {
        const d = el('div');
        d.style.cssText = 'border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0;background:var(--panel2)';
        const cab = el('div');
        cab.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:11px;opacity:.8';
        cab.append(el('b', null, esc(r.item.tags || r.item.fonte || r.item.src)), el('span', null,
          'score ' + r.sc.toFixed(2) + (r.cos ? ' · vetor ' + r.cos.toFixed(2) : '') + ' · ' + r.item.src));
        const b = botao('apagar', 'mini danger', () => {
          Neural.itens = Neural.itens.filter(x => x.id !== r.item.id); delete Neural.vecs[r.item.id];
          Neural.poda(); d.remove(); mostrarStats();
        });
        cab.append(b);
        const t = el('div', null, r.item.txt.slice(0, 600));
        t.style.cssText = 'white-space:pre-wrap;margin-top:6px';
        d.append(cab, t);
        $('#cb-res').append(d);
      });
    }
    function baseHf(v) { return v && v.startsWith('hf:') ? v.slice(3) : 'Qwen/Qwen2.5-Coder-7B-Instruct'; }
    async function estudarURL(u) {
      u = (u || '').trim(); if (!u) return;
      logar($('#cb-log'), 'estudando ' + u + ' ...');
      try { const r = await Neural.estudar(u, t => logar($('#cb-log'), t)); logar($('#cb-log'), 'ok: ' + r.pedacos + ' pedaços de ' + r.chars + ' chars'); mostrarStats(); }
      catch (e) { logar($('#cb-log'), 'falhou: ' + e.message + ' (site com bloqueio de CORS? tente pelo nó: ele baixa sem esse limite)'); }
    }
    async function estudarOficiais() {
      if (!confirm('Vou baixar e indexar ' + Conhecimento.fontes.length + ' documentações oficiais. '
        + 'Leva alguns minutos e usa o nó (se tiver) ou os proxies. Continuar?')) return;
      for (const [nome, url] of Conhecimento.fontes) {
        logar($('#cb-log'), '— ' + nome);
        await estudarURL(url);
        await new Promise(s => setTimeout(s, 1200));   // nao martelar os proxies
      }
      logar($('#cb-log'), 'documentações estudadas. O que ele entendeu fica em "Perguntar à memória".');
    }
    async function treinados() {
      try {
        const n = await nodeInfo();
        $('#cb-gpu').innerHTML =
          '<div class="stat"><span>GPU no nó</span><b>' + ((n.hf && n.hf.catalogo ? (n.os || 'ligado') : 'sem hf_hub.py')) + '</b></div>' +
          '<div class="stat"><span>Modelos já treinados</span><b>' + ((n.hf && n.hf.treinados) || 0) + '</b></div>';
      } catch (e) { $('#cb-gpu').innerHTML = '<div class="stat"><span>GPU no nó</span><b>sem nó ligado</b></div>'; }
      try {
        const base = (LSg('arkher_kaggle', '') || LSg('arkher_agent', '')).replace(/\/+$/, '');
        if (!base) throw new Error('sem nó');
        try {
          const d = await (await fetch(base + '/dataset')).json();
          if (d.ok) $('#cb-gpu').innerHTML +=
            '<div class="stat"><span>Amostras no nó</span><b>' + d.total + ' <small>(' + d.dpo + ' de preferência)</small></b></div>'
            + '<div class="stat"><span>Treino automático</span><b>' + (d.auto && d.auto.ligado ? 'ligado' : 'desligado') + '</b></div>';
        } catch (e) { /* nó antigo, sem /dataset */ }
        const j = await (await fetch(base + '/treinar')).json();
        if ((j.bases || []).length) {
          selb.innerHTML = '';
          j.bases.forEach(b => { const o = el('option', null, 'base: ' + b.nome + ' (' + b.vram_gb + ' GB VRAM)'); o.value = 'hf:' + b.id; selb.append(o); });
        }
        lt.innerHTML = '';
        (j.treinados || []).forEach(t => {
          const d = el('div');
          d.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
          d.append(el('span', null, t.nome + ' — ' + t.base.split('/').pop() + ' · ' + t.amostras + ' exemplos · ' + (t.modo || '')));
          d.append(botao('usar no chat', 'mini', () => { LDs('arkher_modelo', 'gpu:local:' + t.nome); logar($('#cb-log'), 'modelo do chat = gpu:local:' + t.nome); }));
          lt.append(d);
        });
        if (!(j.treinados || []).length) lt.textContent = '(nenhum modelo treinado ainda neste nó)';
      } catch (e) { lt.textContent = '(nó não respondeu: ' + e.message + ')'; }
    }

    // liga o modo de vetorizacao escolhido antes e desenha
    sel.value = LSg('arkher_vetor_modo', 'auto');
    sel.onchange();
    mostrarStats(); treinados();
    // atualiza sozinho de tempo em tempo se a aba estiver aberta
    setInterval(() => {
      const v = document.getElementById('v-cerebro');
      if (v && v.classList.contains('on')) mostrarStats();
    }, 20000);
  }

  function init() {
    try { cartaoRDP(); } catch (e) {}
    try { mountCerebro(); } catch (e) { console.warn('cerebro:', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  if (typeof window !== 'undefined') window.CerebroUI = { init };
})();
