/* NEXUS — interface, sandbox e integracoes */
'use strict';
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x) n.textContent = x; return n; };
const icon = id => `<svg class="ico"><use href="#${id}"/></svg>`;
/* nome curto de quem respondeu — deixa claro quando foi via grátis (sem gastar saldo) */
function rotuloFonte(it) {
  if (!it) return '?';
  if (it.src === 'cache') return 'biblioteca do site (custo zero)';
  if (it.src === 'free') return 'grátis: ' + (it.prov || '');
  if (it.viaLivre || it.livre) return 'puter :free';
  return it.src || '?';
}
/* ---------- abas ---------- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t.dataset.v));
});
$('#b-cfg').onclick = () => document.querySelector('.tab[data-v="cfg"]').click();
/* ---------- chat ---------- */
const logEl = $('#log');
function addMsg(who, txt, cls) {
  const m = el('div', 'msg' + (who === 'me' ? ' me' : ''));
  const av = el('div', 'av');
  av.innerHTML = icon(who === 'me' ? 'i-user' : 'i-bolt');
  const b = el('div', 'bub');
  const h = el('div', 'who'); h.textContent = who === 'me' ? 'Você' : 'ARKHER';
  const body = el('div', 'body' + (cls ? ' ' + cls : ''));
  body.textContent = txt || '';
  b.append(h, body); m.append(av, b); logEl.append(m);
  logEl.scrollTop = logEl.scrollHeight;
  return { body, head: h };
}
function fmt(body) {
  const raw = body.textContent;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  body.innerHTML = esc(raw)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c.replace(/\n$/, '')}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}
const history = [];
// memoria compartilhada (chats, abas, IAs e VMs): carrega e sincroniza sem travar a tela
if (window.Memoria) {
  try {
    Memoria.init(t => { try { console.log('[memoria] ' + t); } catch (e) {} });
    setInterval(() => { try { Memoria.sincronizar(); } catch (e) {} }, 120000);
    // de tempo em tempo: indexa o que entrou (busca por significado) e, se voce
    // ligou, destila o quadro em regras (aprendizado sem GPU)
    setInterval(async () => {
      try { await Memoria.indexar(24); } catch (e) {}
      try { await Memoria.autoDestilar(t => { try { console.log('[memoria] ' + t); } catch (e) {} }); } catch (e) {}
    }, 600000);
  } catch (e) {}
}
let busy = false;
async function send() {
  const inp = $('#inp');
  const text = inp.value.trim();
  if (!text || busy) return;
  inp.value = ''; inp.style.height = 'auto';
  addMsg('me', text);
  history.push({ role: 'user', content: text });
  busy = true;
  const out = addMsg('ai', '');
  const dot = $('#d-cur');
  dot.className = 'dot work';
  // ---------- MODO ENXAME: varias IAs com as mesmas ferramentas ----------
  if (window.Enxame && Enxame.ligado()) {
    try {
      out.head.innerHTML = 'ARKHER <span class="tag">enxame</span>';
      let linhas = '';
      const r = await Enxame.rodar(text, {
        n: Enxame.cfg.n,
        onLog: t => { linhas += '· ' + t + '\n'; out.body.textContent = linhas.slice(-4000); out.body.classList.add('tool'); logEl.scrollTop = logEl.scrollHeight; },
      });
      out.body.classList.remove('tool');
      out.body.textContent = r.texto;
      out.head.innerHTML = 'ARKHER <span class="tag">enxame · ' + r.agentes + ' IAs · ' + r.tarefa + ' · '
        + String(r.modelo || '').split('/').pop() + '</span>';
      fmt(out.body);
      history.push({ role: 'assistant', content: r.texto });
      dot.className = 'dot on';
    } catch (e) {
      out.body.className = 'body err';
      out.body.textContent = 'O conselho falhou: ' + errText(e)
        + '\n\nDica: com 4 ou mais agentes o consumo de cota sobe (cada agente e uma chamada de modelo). '
        + 'Baixe o numero em Config/Cérebro ou desligue o modo enxame.';
      dot.className = 'dot bad';
    }
    busy = false;
    refreshBan();
    return;
  }
  try {
    // ferramentas no chat principal: web, VM, piloto, bash, 3D...
    let msgs = history.slice(-12);
    if (window.systemPrompt && !msgs.some(m => m.role === 'system'))
      msgs.unshift({ role: 'system', content: systemPrompt() });
    // memoria neural: regras aprendidas + trechos guardados (RAG) entram no prompt
    if (Arkher.preparar) { try { msgs = await Arkher.preparar(msgs); } catch (e) {} }
    // MEMORIA COMPARTILHADA: o que ja foi descoberto nos outros chats/abas/VMs
    // (com busca por significado: o que tem a ver com ESTA pergunta vem na frente)
    if (window.Memoria) {
      try {
        msgs = Memoria.injetarAssinc ? await Memoria.injetarAssinc(msgs, Memoria.sessao(), 8, text)
                                     : Memoria.injetar(msgs, Memoria.sessao(), 8, text);
      } catch (e) { try { msgs = Memoria.injetar(msgs, Memoria.sessao(), 8, text); } catch (e2) {} }
    }
    const fixo = LS.get('arkher_modelo', '');
    const r = await Arkher.ask(msgs, {
      model: fixo || undefined,
      stage: /codigo|code|script|programa|lua|python|erro/i.test(text) ? 'code' : 'chat',
      onTry: (it, n) => {
        $('#s-cur').textContent = it.id.split('/').pop().slice(0, 22);
        out.head.innerHTML = `ARKHER <span class="tag">${rotuloFonte(it)} · tentativa ${n}</span>`;
      },
      onDelta: t => { out.body.textContent += t; logEl.scrollTop = logEl.scrollHeight; },
    });
    out.body.textContent = r.text;
    out.head.innerHTML = `ARKHER <span class="tag">${rotuloFonte(r)} · ${r.model.split('/').pop()}</span>`;
    if (window.pintarUso) pintarUso();
    if (window.Memoria) {           // o que rolou nesta sessao fica pro proximo chat/aba/VM
      try {
        Memoria.add({ tipo: 'nota', texto: 'pergunta: ' + text.slice(0, 200),
                      escopo: 'sessao:' + Memoria.sessao(), de: 'chat', tags: ['chat'] });
        if (r.text && r.text.length > 40) {
          Memoria.add({ tipo: 'achado', texto: 'respondido (' + r.model.split('/').pop() + '): '
                        + r.text.replace(/\s+/g, ' ').slice(0, 300),
                        escopo: 'sessao:' + Memoria.sessao(), de: 'chat' });
        }
      } catch (e) {}
    }
    $('#s-cur').textContent = r.model.split('/').pop().slice(0, 22);
    // se o modelo pediu uma ferramenta, executo e devolvo pra ele (ate 3 voltas)
    let txt = r.text, ultimo = out;
    for (let volta = 0; volta < 3; volta++) {
      const call = window.parseTool ? parseTool(txt) : null;
      if (!call) break;
      ultimo.body.textContent = 'usando ' + call.tool + '…';
      ultimo.body.classList.add('tool');
      const box = addMsg('ai', '');
      box.head.innerHTML = 'ARKHER <span class="tag">' + call.tool + '</span>';
      box.body.textContent = 'executando…';
      let res;
      try { res = await runTool(call, t => { box.body.textContent = t; }); }
      catch (e) { res = { ok: false, err: errText(e) }; }
      const saida = String(res.out || res.err || '').trim();
      box.body.textContent = (saida.slice(0, 4000) || (res.ok ? 'ok' : 'falhou')) + (saida.length > 4000 ? '\n…' : '');
      if (!res.ok) box.body.classList.add('err');
      if (res.img) { const im = document.createElement('img'); im.src = res.img; im.style.cssText = 'max-width:100%;border-radius:10px;margin-top:8px'; box.body.appendChild(im); }
      if (res.glb) { const a = document.createElement('a'); a.href = res.glb; a.textContent = 'baixar o modelo (.glb)';
        a.setAttribute('download', ''); a.style.cssText = 'display:inline-block;margin-top:8px'; box.body.appendChild(a); }
      history.push({ role: 'assistant', content: txt });
      history.push({ role: 'user', content: 'RESULTADO da ferramenta ' + call.tool + (res.ok ? '' : ' (FALHOU)') + ':\n' +
        (saida.slice(0, 6000) || '(vazio)') + '\n\nResponda ao usuario com base nisso, em texto normal.' });
      ultimo = addMsg('ai', '');
      const r2 = await Arkher.ask(history.slice(-14), {
        model: fixo || undefined, stage: 'chat',
        onDelta: t => { ultimo.body.textContent += t; logEl.scrollTop = logEl.scrollHeight; },
      });
      txt = r2.text; ultimo.body.textContent = txt;
      ultimo.head.innerHTML = `ARKHER <span class="tag">${r2.src} · ${r2.model.split('/').pop()}</span>`;
    }
    fmt(ultimo.body);
    history.push({ role: 'assistant', content: txt });
    dot.className = 'dot on';
  } catch (e) {
    out.body.className = 'body err';
    const m = errText(e);
    let dica = '';
    if (/low[_ -]?balance|saldo|insufficient[_ -]?(funds|balance|credit)|402/i.test(m)) {
      dica = 'Low balance. O ARKHER já tenta sozinho, nesta ordem: repetir o pedido ENXUTO '
        + '(512 tokens, histórico cortado), usar outra conta do armazém pelo endpoint REST '
        + 'e cair na via grátis (:free). Se TODAS as suas contas caem na mesma mensagem, '
        + 'quase sempre é uma das duas coisas: o pedido estava grande demais (baixe o teto de '
        + 'tokens em Config) ou o limite é do dispositivo/IP — nesse caso rode '
        + 'Config > "Testar as contas (por que caíram?)" e use as chaves grátis '
        + '(Gemini, Groq, Cerebras) em Config > Provedores grátis.';
    } else if (/puter\.js nao carregou|nenhum provedor/i.test(m)) dica = 'O puter.js nao carregou: confira a internet/bloqueador de anuncios, ou cadastre um token do Hugging Face em Config.';
    else if (/sem token|401|403/i.test(m)) dica = 'Entre no Puter (Config > Entrar no Puter) ou cadastre um token HF em Config.';
    else if (/quarentena/i.test(m)) dica = 'Use "Limpar quarentena" em Config.';
    else dica = 'Se persistir: Config > Recarregar catalogos, e confira login do Puter / token HF.';
    out.body.textContent = 'Falhou: ' + m + '\n\n' + dica;
    dot.className = 'dot bad';
  }
  busy = false;
  refreshBan();
}
$('#b-send').onclick = send;
$('#inp').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#inp').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px';
});
/* ---------- catalogos ---------- */
async function loadCatalogs() {
  $('#d-net').className = 'dot work';
  let p = 0, lv = 0, fq = 0, h = 0, ep = '', eh = '';
  try { const ps = await Puter.list(); p = ps.length; lv = ps.filter(id => Puter.eLivre(id)).length; }
  catch (e) { ep = errText(e); }
  if (typeof Free !== 'undefined') {
    try { fq = (await Free.catalogo(true)).length; } catch (e) { fq = 0; }
  }
  try { h = HF.token() ? (await HF.list()).length : 0; } catch (e) { eh = errText(e); }
  const set = (sel, txt, title) => { const el = $(sel); if (!el) return; el.textContent = txt; el.title = title || ''; };
  set('#n-puter', p || (ep ? 'erro: ' + ep.slice(0, 40) : '—'), ep);
  set('#n-livre', lv || (p ? 'nenhum no momento' : '—'), 'modelos do catálogo do Puter terminados em ":free" — não gastam saldo');
  set('#n-free', typeof Free === 'undefined' ? '—' : (fq || 'sem chave (veja Config)'),
      'soma dos modelos dos provedores grátis com chave cadastrada');
  set('#n-hf', HF.token() ? (h || (eh ? 'erro: ' + eh.slice(0, 40) : '—')) : 'sem token', eh);
  set('#n-tot', p + lv + fq + h, 'Puter + via grátis + provedores grátis + HF');
  const semPuter = !Puter.ready();
  const total = p + lv + fq + h;
  $('#s-models').textContent = total + ' modelos' + (semPuter ? ' · puter.js nao carregou' : '');
  $('#s-models').title = semPuter ? 'js.puter.com nao carregou: sem internet ou bloqueado. A cascata segue pelo endpoint REST do Puter, pela lista HF e pelos provedores grátis.' : '';
  $('#d-net').className = 'dot ' + (total > 0 ? 'on' : 'bad');
  if (typeof pintarGratis === 'function') pintarGratis();
}
function refreshBan() { $('#n-ban').textContent = Breaker.size(); }
$('#b-reload').onclick = () => {
  Puter.models = null; HF.models = null;
  if (typeof Free !== 'undefined' && Free.esquecer) Free.esquecer();
  loadCatalogs();
};
$('#b-unban').onclick = () => { Breaker.clear(); refreshBan(); };
/* ---------- config ---------- */
$('#f-hf').value = LS.get('arkher_hf_token', '');
$('#f-agent').value = LS.get('arkher_agent', '');
$('#b-savehf').onclick = () => {
  LS.set('arkher_hf_token', $('#f-hf').value.trim());
  HF.models = null; loadCatalogs();
  $('#b-savehf').innerHTML = icon('i-check') + 'Salvo';
  setTimeout(() => $('#b-savehf').innerHTML = icon('i-check') + 'Salvar', 1500);
};
$('#b-saveagent').onclick = () => {
  LS.set('arkher_agent', normUrl($('#f-agent').value));
  $('#f-agent').value = LS.get('arkher_agent', '');
  $('#b-saveagent').innerHTML = icon('i-check') + 'Salvo';
  setTimeout(() => $('#b-saveagent').innerHTML = icon('i-check') + 'Salvar', 1500);
  pingAgent();
};
/* voltou do Google? guarda a sessao ANTES de decidir se mostra o gate.
   Sem await solto no topo: este arquivo entra como script classico
   (<script src="ui.js">), onde top-level await e SyntaxError — o arquivo
   inteiro morria no parse e a tela ficava vazia, so "carregando…". */
const __capturaSocial = (async () => {
  try { if (window.AuthSocial) return await AuthSocial.capturarRetorno(); } catch (e) {}
  return false;
})();
const bGoo = $('#g-google');
if (bGoo) {
  bGoo.onclick = async () => {
    try { msg('abrindo o Google…'); await AuthSocial.entrarGoogle(); }
    catch (e) { msg(String(e.message || e)); }
  };
}
if (bGoo && (!window.AuthSocial || !AuthSocial.googleProvalvel())) bGoo.style.display = 'none';
$('#b-login').onclick = async () => {
  if (typeof puter === 'undefined' || !puter.auth) { $('#s-who').textContent = 'puter.js nao carregou (internet/bloqueador). Recarregue a pagina.'; return; }
  try { await puter.auth.signIn(); $('#s-who').textContent = 'Conectado.'; loadCatalogs(); }
  catch (e) { $('#s-who').textContent = 'Falhou: ' + errText(e); }
};
$('#b-who').onclick = async () => {
  if (typeof puter === 'undefined' || !puter.auth) { $('#s-who').textContent = 'puter.js nao carregou.'; return; }
  try { const u = await puter.auth.getUser(); $('#s-who').textContent = 'Conta: ' + (u.username || u.email || '?'); }
  catch (e) { $('#s-who').textContent = 'Não conectado.'; }
};
/* ============================================================
   SANDBOX — terminal ligado ao agente do PC (Tailscale)
   ============================================================ */
const termEl = $('#term');
function put(txt, cls) {
  const l = el('div', 'l-' + (cls || 'out'), txt);
  termEl.append(l); termEl.scrollTop = termEl.scrollHeight;
}
put('ARKHER Sandbox — Windows via Tailscale', 'sys');
put('Comandos: qualquer coisa do PowerShell/CMD.', 'sys');
put('Prefixo "ia:" faz a IA escrever e executar o comando pra você.', 'sys');
put('', 'sys');
function agentURL() { return LS.get('arkher_agent', ''); }
async function pingAgent() {
  const u = agentURL();
  const d = $('#d-rdp'), s = $('#s-rdp');
  if (!u) { d.className = 'dot'; s.textContent = 'sem agente'; return false; }
  d.className = 'dot work'; s.textContent = 'checando…';
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    let r;
    try { r = await fetch(u + '/health', { method: 'GET', signal: ctl.signal }); }
    finally { clearTimeout(to); }
    const j = await r.json();
    d.className = 'dot on';
    s.textContent = (j.cpu ? j.cpu.replace(/\(R\)|\(TM\)|CPU/g,'').trim().slice(0,28) : (j.host||'online'))
      + (j.ram_gb ? ' · ' + j.ram_gb + 'GB' : '') + (j.cpu_count ? ' · ' + j.cpu_count + ' nucleos' : '');
    return true;
  } catch (e) {
    d.className = 'dot bad';
    const https = location.protocol === 'https:' && /^http:\/\//i.test(u);
    s.textContent = e.name === 'AbortError'
      ? (https ? 'bloqueado (HTTP x HTTPS)' : 'sem resposta (8s)')
      : (https ? 'bloqueado (HTTP x HTTPS)' : 'offline');
    if (https) s.title = 'Cadeado > Configuracoes do site > Conteudo nao seguro > Permitir';
    return false;
  }
}
$('#b-conn').onclick = async () => {
  const ok = await pingAgent();
  put(ok ? '> agente conectado' : '> agente offline — confira a URL em Config e se o workflow está rodando',
      ok ? 'ok' : 'err');
};
$('#b-clear').onclick = () => termEl.innerHTML = '';
$('#b-save').onclick = () => {
  const blob = new Blob([termEl.innerText], { type: 'text/plain' });
  const a = el('a'); a.href = URL.createObjectURL(blob);
  a.download = 'arkher-sessao-' + Date.now() + '.txt'; a.click();
};
async function runCmd(cmd) {
  const u = agentURL();
  if (!u) { put('sem agente configurado (aba Config)', 'err'); return; }
  // trava: se o outro estiver usando a VM, avisa em vez de atropelar
  const comSync = (typeof Sync !== 'undefined' && Sync.ligado());
  if (comSync) {
    try {
      const dono = await Sync.pegarTrava(120);
      if (dono) { put('VM ocupada por ' + String(dono.who).split('@')[0] + ' — aguarde', 'err'); return; }
      Sync.log('cmd', cmd);
    } catch (e) {}
  }
  // tarefas longas vao pra background com saida ao vivo
  const longa = /blender|ffmpeg|choco|winget|pip install|npm i|git clone|build|render|python .*\.py/i.test(cmd);
  try {
    if (longa) {
      const r = await fetch(u + '/spawn', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({cmd}) });
      const j = await r.json();
      if (!j.ok) { put('erro: ' + (j.err||'?'), 'err'); return; }
      put('[job ' + j.id + ' em background]', 'sys');
      if (typeof RT !== 'undefined' && RT.job) {
        // WS: as linhas chegam quando saem (sem esperar 900ms de polling)
        await RT.job(u, j.id, ln => put(ln, 'out'),
          (codigo, meta) => { if (codigo >= 0) put('[saida ' + codigo + ']', codigo === 0 ? 'ok' : 'err');
                              else put('[job terminou sem codigo (' + codigo + ')]', 'sys'); },
          aviso => put('(' + aviso + ')', 'sys'));
        return;
      }
      let from = 0, tick = 0;
      while (true) {
        await new Promise(s => setTimeout(s, 900));
        const q = await (await fetch(u + '/job?id=' + j.id + '&from=' + from)).json();
        if (!q.ok) { put('job sumiu', 'err'); break; }
        for (const ln of q.lines) put(ln, 'out');
        from = q.next;
        if (q.done) { put('[saida ' + q.code + ' · ' + q.sec + 's]', q.code === 0 ? 'ok' : 'err'); break; }
        if (++tick > 1200) { put('[ainda rodando — job ' + j.id + ']', 'sys'); break; }
      }
      return;
    }
    // comando rapido: um socket so (WS) em vez de uma requisicao por comando
    let j = null;
    if (typeof RT !== 'undefined' && RT.terminal) {
      if (!termRT || termRT._base !== u) { termRT = (RT.terminal(u)); termRT._base = u; }
      try { j = await termRT.rodar(cmd, 600); } catch (e) { j = null; }
    }
    if (!j) {
      const r = await fetch(u + '/exec', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({cmd, timeout: 600}) });
      j = await r.json();
    }
    if (j.out) put(j.out.replace(/\s+$/, ''), 'out');
    if (j.err) put(j.err.replace(/\s+$/, ''), 'err');
    put('[saida ' + (j.code ?? '?') + ' · ' + (j.ms ?? '?') + 'ms]', j.code === 0 ? 'ok' : 'err');
  } catch (e) {
    put('falha ao falar com o agente: ' + (window.explicarFetch ? explicarFetch(e, u) : e.message), 'err');
    pingAgent();
  } finally {
    if (comSync) Sync.soltarTrava();
  }
}
let termRT = null;   // conexao WS do terminal (reusada entre comandos)
async function termSend() {
  const i = $('#cmd'); const v = i.value.trim();
  if (!v) return;
  i.value = '';
  put('PS> ' + v, 'cmd');
  if (/^ia:/i.test(v)) {
    const pedido = v.replace(/^ia:/i, '').trim();
    put('(pensando…)', 'sys');
    try {
      const r = await Arkher.ask([
        { role: 'system', content: 'Voce gera UM comando PowerShell para Windows. Responda SO o comando, sem crases, sem explicacao.' },
        { role: 'user', content: pedido },
      ], { stage: 'code' });
      const cmd = r.text.trim().replace(/^```\w*\n?|```$/g, '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
      if (!cmd) { put('IA nao devolveu comando', 'err'); return; }
      put('PS> ' + cmd + '   [' + r.model.split('/').pop() + ']', 'cmd');
      await runCmd(cmd);
    } catch (e) { put('IA falhou: ' + errText(e), 'err'); }
    return;
  }
  if (/^http\s/i.test(v)) {
    const m = v.match(/^http\s+(\w+)\s+(\S+)/i) || [];
    try {
      const r = await fetch(m[2], { method: (m[1] || 'GET').toUpperCase() });
      const t = await r.text();
      put('HTTP ' + r.status, r.ok ? 'ok' : 'err');
      put(t.slice(0, 4000), 'out');
    } catch (e) { put('erro: ' + e.message + ' (CORS? use o agente)', 'err'); }
    return;
  }
  await runCmd(v);
}
$('#b-run').onclick = termSend;
$('#cmd').addEventListener('keydown', e => { if (e.key === 'Enter') termSend(); });
/* ---------- integracoes ---------- */
const INTEGRACOES = [
  ['Blender', 'renderizar / modelar 3D', 'blender --background --python-expr "import bpy; bpy.ops.mesh.primitive_cube_add()"'],
  ['Roblox Studio', 'abrir projeto', 'Start-Process "C:\\Program Files\\Roblox\\Versions\\RobloxStudioLauncherBeta.exe"'],
  ['Python', 'rodar script', 'python -c "print(\'ola do PC\')"'],
  ['Node.js', 'rodar JS', 'node -e "console.log(process.version)"'],
  ['FFmpeg', 'converter vídeo', 'ffmpeg -version'],
  ['Git', 'clonar repositório', 'git clone https://github.com/usuario/repo'],
  ['Arquivos', 'listar pasta', 'Get-ChildItem C:\\ | Select-Object -First 20'],
  ['Sistema', 'CPU e memória', 'Get-CimInstance Win32_ComputerSystem | Format-List'],
  ['Download', 'baixar arquivo', 'Invoke-WebRequest -Uri URL -OutFile arquivo'],
  ['Winget', 'instalar programa', 'winget install --id Git.Git -e'],
  ['API livre', 'chamada HTTP', 'http GET https://api.github.com'],
  ['Captura', 'print da tela', 'Add-Type -AssemblyName System.Windows.Forms'],
];
const g = $('#g-integ');
INTEGRACOES.forEach(([nm, ds, cmd]) => {
  const t = el('div', 'itile');
  t.innerHTML = `<div class="nm">${nm}</div><div class="ds">${ds}</div>`;
  t.onclick = () => {
    document.querySelector('.tab[data-v="term"]').click();
    $('#cmd').value = cmd; $('#cmd').focus();
  };
  g.append(t);
});
/* ---------- boot ---------- */
addMsg('ai', 'Pronto. Pergunte qualquer coisa — se um modelo falhar eu troco sozinho, '
  + 'primeiro pelo catálogo do Puter e depois pelo Hugging Face.\n\n'
  + 'Na aba Sandbox você comanda seu PC Windows pelo Tailscale.');
loadCatalogs();
pingAgent();
setInterval(pingAgent, 30000);
/* ============================================================
   LOGIN
   ============================================================ */
(function(){
  const gate=$('#gate');
  const c=Auth.cfg();
  $('#g-url').value=c.url||''; $('#g-anon').value=c.anon||'';
  $('#g-allow').value=(LS.get('arkher_allow',[])||[]).join(', ');
  function show(v){ gate.style.display=v?'flex':'none'; }
  function msg(t,err){ const m=$('#g-msg'); m.textContent=t; m.style.color=err?'var(--err)':'var(--dim)'; }
  $('#g-save').onclick=()=>{
    Auth.setCfg($('#g-url').value,$('#g-anon').value);
    Auth.setAllow($('#g-allow').value.split(',').map(s=>s.trim()).filter(Boolean));
    msg('Configuração salva.');
  };
  $('#g-in').onclick=async()=>{
    try{ msg('entrando…'); await Auth.entrar($('#g-mail').value.trim(),$('#g-pass').value);
      show(false); boot(); }catch(e){ msg(e.message,true); }
  };
  $('#g-up').onclick=async()=>{
    try{ msg('criando…'); const j=await Auth.criar($('#g-mail').value.trim(),$('#g-pass').value);
      msg(j.access_token?'Conta criada. Entrando…':'Confirme o e-mail e volte pra entrar.');
      if(j.access_token){ show(false); boot(); } }catch(e){ msg(e.message,true); }
  };
  $('#b-out').onclick=()=>{ Auth.sair(); location.reload(); };
  const skip=$('#g-skip');
  if(skip) skip.onclick=()=>{ LS.set('arkher_local',true); show(false); boot(); };
  window.__gate=show;
  (async()=>{
    const voltou = await __capturaSocial;          // volta do Google? sessao ja guardada
    if(voltou && Auth.ativo()) return boot();      // sessao recem-capturada: o boot la de baixo nao viu
    if(Auth.ativo()) return;                       // sessao valida (ja deu boot no fim do arquivo)
    if(Auth.renovavel()){                          // expirou mas da pra renovar
      msg('renovando sessão…');
      if(await Auth.renovar()){ msg(''); return boot(); }
    }
    if(!Auth.configurado() && LS.get('arkher_local',false)) return;   // modo local escolhido antes
    show(true);
    if(!Auth.configurado()) msg('Sem Supabase configurado. Preencha abaixo, ou use "Entrar sem login" (modo local, sem equipe).');
  })();
  // renova a sessao de tempos em tempos (o access_token do Supabase dura 1h)
  setInterval(()=>{ if(Auth.sess()) Auth.garantir(); }, 10*60*1000);
})();
/* ============================================================
   CAPACIDADES
   ============================================================ */
(function(){
  const g=$('#g-skills');
  Object.entries(SKILLS).forEach(([k,v])=>{
    const t=el('div','itile');
    t.innerHTML=`<div class="nm"></div><div class="ds"></div>`;
    t.querySelector('.nm').textContent=v.nome||k; t.querySelector('.ds').textContent=v.desc;
    t.onclick=()=>{ document.querySelector('.tab[data-v="chat"]').click();
      $('#inp').value='use a ferramenta '+k+' para: '; $('#inp').focus(); };
    g.append(t);
  });
  $('#sk-go').onclick=async()=>{
    const o=$('#sk-out'); o.textContent='consultando o Hub…';
    try{
      const l=await Exec.melhorModelo($('#sk-task').value);
      o.innerHTML='<b>Top de hoje:</b><br>'+l.slice(0,8).map((m,i)=>
        `${i+1}. <code>${m.id}</code> — ${(m.downloads/1000).toFixed(0)}k downloads`).join('<br>');
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
})();
/* ============================================================
   3D — texto/imagem -> .glb (Shap-E, TripoSR...) no no conectado
   ============================================================ */
(function(){
  let nos = [];           // [{nome,url,gpu,cuda,motores}]
  const log = t => { const e=$('#t3-log'); if(e){ e.textContent += (e.textContent?'\n':'') + t;
                     e.scrollTop = e.scrollHeight; } };
  function noAtual(){
    const n = $('#t3-node').value;
    return nos.find(x => x.nome === n) || nos[0] || null;
  }
  function pintarMotores(){
    const no = noAtual(); const cap = $('#t3-cap'); const sel = $('#t3-eng');
    if(!no){ cap.textContent='nenhum nó conectado — aba Config (URL do agente) ou VM (Kaggle/Android)'; return; }
    const ms = Object.values(no.motores || {});
    const prontos = ms.filter(m => m.pronto);
    cap.textContent = no.nome + (no.cuda ? ' · GPU ' + (no.gpu||'CUDA') + ' (' + no.vram_gb + ' GB)' :
                       no.gpu ? ' · GPU ' + no.gpu : ' · sem GPU (CPU: lento, mas roda)')
      + ' — motores prontos: ' + (prontos.length ? prontos.map(m=>m.id).join(', ') : 'nenhum ainda');
    const atual = sel.value;
    sel.textContent='';
    const o0 = document.createElement('option'); o0.value='auto';
    o0.textContent='automático (o melhor pronto no nó)'; sel.appendChild(o0);
    ms.forEach(m => { const o=document.createElement('option'); o.value=m.id;
      o.textContent = m.nome + (m.pronto ? '' : '  (precisa instalar)'); sel.appendChild(o); });
    sel.value = ms.some(m => m.id===atual) ? atual : 'auto';
  }
  async function sondar(){
    const cap = $('#t3-cap'); cap.textContent='procurando nós…';
    try{
      nos = await Exec.nos3D();
      const sel = $('#t3-node'); const atual = sel.value;
      sel.textContent='';
      if(!nos.length){ const o=document.createElement('option'); o.value=''; o.textContent='— nenhum nó conectado —'; sel.appendChild(o); }
      nos.forEach(n => { const o=document.createElement('option'); o.value=n.nome;
        o.textContent = n.nome + (n.ok ? (Object.values(n.motores||{}).some(m=>m.pronto) ? ' (pronto)' : ' (sem motor instalado)')
                                       : ' (fora: ' + (n.erro||'?') + ')'); sel.appendChild(o); });
      sel.value = nos.some(n => n.nome===atual) ? atual : (nos[0] ? nos[0].nome : '');
      pintarMotores();
    }catch(e){ cap.textContent='falhou: ' + (window.errText?errText(e):e.message); }
  }
  $('#t3-ref').onclick = sondar;
  $('#t3-node').onchange = pintarMotores;
  $('#t3-setup').onclick = async()=>{
    const no = noAtual(); const o = $('#t3-out'); const motor = $('#t3-install').value;
    if(!no){ o.textContent='conecte um nó primeiro'; return; }
    o.textContent='instalando ' + motor + ' em ' + no.nome + ' (pip/git: baixa GB, demora)…';
    $('#t3-log').textContent='';
    try{
      const r = await Exec.instalar3D(motor, no.nome, log);
      o.textContent = (r.ok ? 'ok: ' : 'incompleto: ') + r.out;
      await sondar();
    }catch(e){ o.textContent='falhou: ' + (window.errText?errText(e):e.message); }
  };
  $('#t3-go').onclick = async()=>{
    const o = $('#t3-out'); const p = $('#t3-p').value.trim();
    o.textContent=''; $('#t3-log').textContent='';
    if(!p){ o.textContent='descreva o que criar'; return; }
    const no = noAtual();
    if(!no){ o.textContent='conecte um nó primeiro (aba Config/VM)'; return; }
    o.textContent='gerando… (sem GPU leva minutos na CPU)';
    try{
      const r = await Exec.gerar3D({prompt:p, engine:$('#t3-eng').value}, log);
      o.textContent='';
      const b=document.createElement('div'); b.textContent=r.out||'';
      o.appendChild(b);
      if(r.img){ const im=document.createElement('img'); im.src=r.img;
        im.style.cssText='max-width:100%;border-radius:10px;margin-top:8px;background:#0d1017';
        o.appendChild(im); }
      if(r.glb){
        const a=document.createElement('a'); a.href=r.glb; a.textContent='baixar .glb';
        a.setAttribute('download',''); a.style.cssText='display:inline-block;margin-top:8px';
        o.appendChild(a);
      }
      if(!r.verificado){ const w=document.createElement('div'); w.className='hint';
        w.textContent='(esse motor eu ainda não pude testar de ponta a ponta sem GPU — o encanamento está testado)';
        o.appendChild(w); }
    }catch(e){ o.textContent='falhou: ' + (window.errText?errText(e):e.message); }
  };
  $('#t3-ls').onclick = async()=>{
    const o=$('#t3-files'); const no=noAtual();
    if(!no){ o.textContent='nenhum nó conectado'; return; }
    try{
      const j = await Exec._get(no.url, '/ls?path=3d', 20000);
      o.textContent='';
      if(!j.items || !j.items.length){ o.textContent='pasta vazia — gere algo primeiro'; return; }
      j.items.filter(i=>!i.dir).forEach(i=>{
        const d=document.createElement('div');
        const a=document.createElement('a'); a.href=Exec.arquivo3D(no.url, '3d/'+i.name, true);
        a.textContent=i.name; a.setAttribute('download','');
        d.appendChild(a); d.append(' — ' + (i.size/1048576).toFixed(2) + ' MB');
        o.appendChild(d);
      });
    }catch(e){ o.textContent='falhou: ' + (window.errText?errText(e):e.message); }
  };
  // se ja tem no salvo, mostra os motores assim que abrir a aba
  document.querySelectorAll('.tab').forEach(t => { if(t.dataset.v==='tri') t.addEventListener('click', () => { if(!nos.length) sondar(); }); });
  if(LS.get('arkher_agent','') || LS.get('arkher_kaggle','')) sondar();
})();
/* ============================================================
   VM
   ============================================================ */
(function(){
  async function ref(){
    const u=LS.get('arkher_agent',''); if(!u) return;
    try{
      const c=new AbortController(); const t=setTimeout(()=>c.abort(),8000);
      let j; try{ j=await (await fetch(u+'/health',{signal:c.signal})).json(); } finally{ clearTimeout(t); }
      $('#vm-cpu').textContent=(j.cpu||'—').replace(/\(R\)|\(TM\)/g,'').slice(0,34);
      $('#vm-ram').textContent=(j.ram_gb?j.ram_gb+' GB':'—')+(j.ram_free_gb?' ('+j.ram_free_gb+' livre)':'');
      $('#vm-cores').textContent=j.cpu_count||'—';
      $('#vm-disk').textContent=j.disk_free_gb?j.disk_free_gb+' / '+j.disk_total_gb+' GB':'—';
      $('#vm-up').textContent=j.up?Math.floor(j.up/60)+' min':'—';
    }catch(e){}
  }
  $('#vm-ref').onclick=ref;
  $('#vm-vnc').onclick=async()=>{
    const o=$('#vm-vncout'); o.textContent='instalando servidor de tela…';
    try{
      const id=await Exec.vmJob('choco install -y tightvnc --no-progress');
      o.innerHTML='job <code>'+id+'</code>. Depois use o app Remote Desktop com o IP do Tailscale — é mais estável que noVNC.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  $('#vm-open').onclick=()=>{
    const u=LS.get('arkher_agent','').replace(/^https?:\/\//,'').split(':')[0];
    $('#vm-vncout').innerHTML=u? 'No app <b>Remote Desktop</b>: <code>'+u+'</code> · usuário <code>nexus</code> · senha no log do workflow' : 'configure a VM primeiro';
  };
  $('#vm-rclone').onclick=async()=>{
    const o=$('#vm-cloud'); o.textContent='instalando rclone…';
    try{ const id=await Exec.vmJob('choco install -y rclone --no-progress');
      o.innerHTML='job <code>'+id+'</code>. Depois rode <code>rclone config</code> pelo RDP para ligar Drive/MediaFire.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  $('#vm-push').onclick=async()=>{
    const o=$('#vm-cloud'); o.textContent='enviando…';
    try{ const id=await Exec.vmJob('rclone copy arkher_state\\work remoto:arkher -P');
      o.innerHTML='job <code>'+id+'</code> — acompanhe no Sandbox.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  setInterval(()=>{ if($('#v-vm').classList.contains('on')) ref(); }, 15000);
  window.__vmref=ref;
})();
/* ============================================================
   COFRE
   ============================================================ */
(function(){
  function draw(){
    const box=$('#v-list'); const prov=$('#v-prov').value;
    const items=Vault.all(prov); const st=Vault.stats(prov);
    if(!items.length){ box.textContent='nenhum token cadastrado'; return; }
    box.innerHTML='<b>'+st.livres+' de '+st.total+' disponíveis</b><br>'+items.map(i=>{
      const on=(i.cooldownUntil||0)<Date.now();
      return `<span style="color:${on?'var(--ok)':'var(--warn)'}">●</span> ${i.label}`
        +` — ${i.uses||0} usos${on?'':' (descansando: '+(i.motivo||'?')+')'}`
        +` <a href="#" data-del="${i.id}" style="color:var(--err)">remover</a>`;
    }).join('<br>');
    box.querySelectorAll('[data-del]').forEach(a=>a.onclick=e=>{
      e.preventDefault(); Vault.remove(a.dataset.del); draw(); });
  }
  $('#v-add').onclick=()=>{
    const ok=Vault.add($('#v-prov').value,$('#v-tok').value,$('#v-lab').value.trim());
    if(ok){ $('#v-tok').value=''; $('#v-lab').value=''; }
    draw();
  };
  $('#v-prov').onchange=draw;
  window.__vaultdraw=draw;
  draw();
})();
/* boot pos-login */
function boot(){
  loadCatalogs(); pingAgent();
  if(window.__vmref) window.__vmref();
  if(window.__vaultdraw) window.__vaultdraw();
}
if(Auth.ativo()) boot();
/* ============================================================
   EQUIPE — VM compartilhada entre as contas
   ============================================================ */
(function(){
  if (typeof Sync === 'undefined') return;
  const msg=t=>{ const m=$('#crew-msg'); if(m) m.textContent=t; };
  async function puxar(){
    if(!Sync.ligado()) return;
    try{
      const vm=await Sync.getVM();
      if(vm){
        $('#crew-url').textContent=vm.url;
        $('#crew-by').textContent=vm.por?(String(vm.por).split('@')[0]):'—';
        // adota automaticamente se eu ainda nao tenho
        if(!LS.get('arkher_agent','')){ LS.set('arkher_agent',vm.url); pingAgent(); }
      }
      const on=await Sync.online();
      const mapa=await Sync.apelidos();
      const nomes=on.map(o=>o.nick || Sync.nomeDe(o.who, mapa));
      $('#crew-on').textContent=nomes.join(', ')||'só você';
      const sc=$('#s-crew'); if(sc) sc.textContent=on.length+' online';
      const lk=await Sync.get('lock',null);
      $('#crew-lock').textContent=(lk&&lk.until>Date.now())?('com '+Sync.nomeDe(lk.who,mapa)):'livre';
      const novos=await Sync.novos();
      if(novos.length){
        const box=$('#crew-log');
        novos.forEach(l=>{ const d=el('div',null,Sync.nomeDe(l.who,mapa)+' › '+l.txt); box.prepend(d); });
        while(box.children.length>40) box.lastChild.remove();
      }
    }catch(e){}
  }
  const campoNick = $('#crew-nick');
  if (campoNick) {
    campoNick.value = Sync.apelido();
    campoNick.onchange = () => {
      Sync.setApelido(campoNick.value);
      campoNick.value = Sync.apelido();
      Sync.bater();
    };
  }
  $('#crew-pub').onclick=async()=>{
    const u=LS.get('arkher_agent','');
    if(!u){ msg('configure a URL do agente em Config primeiro'); return; }
    try{ await Sync.setVM(u); msg('publicado — seu amigo já pode usar'); puxar(); }
    catch(e){ msg('falhou: '+e.message); }
  };
  $('#crew-pull').onclick=async()=>{
    try{
      const vm=await Sync.getVM();
      if(!vm){ msg('ninguém publicou ainda'); return; }
      LS.set('arkher_agent',vm.url);
      const f=$('#f-agent'); if(f) f.value=vm.url;
      msg('usando a VM de '+vm.por); pingAgent();
    }catch(e){ msg('falhou: '+e.message); }
  };
  // registra na nuvem o que rodou na VM
  const _run=window.runCmd;
  if(typeof runCmd==='function'){
    const orig=runCmd;
    window.runCmd=async function(cmd){
      try{ await Sync.log('cmd',cmd); }catch(e){}
      return orig(cmd);
    };
  }
  let iniciado=false;
  async function iniciar(){
    if(iniciado||!Sync.ligado()) return;
    iniciado=true;
    await Sync.iniciarLog();
    Sync.bater(); puxar();
    setInterval(()=>{ Sync.bater(); }, 45000);
    setInterval(puxar, 12000);
  }
  iniciar();
  setInterval(iniciar, 5000);    // pega o momento em que o usuario loga
  window.__crew=puxar;
})();
/* ===== PILOTO: IA opera a VM vendo a tela ===== */
(function () {
  const $ = s => document.querySelector(s);
  const view = $('#pl-view'), img = $('#pl-img'), vazio = $('#pl-empty');
  const log = $('#pl-log'), st = $('#pl-st'), dot = $('#pl-dot');
  if (!view) return;
  let vivo = null, rodando = false, escala = 0.5;
  function diz(cls, txt, passo) {
    const d = document.createElement('div');
    d.className = 'pl-msg ' + (cls || '');
    d.innerHTML = (passo ? `<div class="pl-step">passo ${passo}</div>` : '') +
                  String(txt).replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;');
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function estado(t, on) { st.textContent = t; dot.classList.toggle('on', !!on); }
  function pinta(src) { if (!src) return; img.src = src; img.style.display = 'block'; vazio.style.display = 'none'; }
  async function tela() {
    try {
      const r = await Pilot.vm('/screen?scale=' + escala + '&q=55');
      if (r.ok) { pinta(r.img); realW = r.real_w || 0; realH = r.real_h || 0; estado('conectado', true); return true; }
      estado('erro: ' + (r.err || '').slice(0, 40), false);
    } catch (e) { estado(Pilot.base() ? 'agente offline' : 'sem URL do agente (Config)', false); }
    return false;
  }
  $('#pl-refresh').onclick = tela;
  $('#pl-live').onclick = function () {
    if (vivo) { clearInterval(vivo); vivo = null; this.textContent = 'Ao vivo'; estado('pausado', false); }
    else { vivo = setInterval(tela, 2000); this.textContent = 'Parar vídeo'; tela(); }
  };
  $('#pl-open-rbx').onclick = () => abrir('roblox');
  $('#pl-open-bl').onclick = () => abrir('blender');
  async function abrir(nome) {
    diz('act', 'abrindo ' + nome + '…');
    try { const r = await Pilot.abrir(nome); if (r.img) pinta(r.img);
          diz(r.ok ? 'done' : 'err', r.ok ? nome + ' aberto' : 'falhou: ' + r.err); }
    catch (e) { diz('err', e.message); }
  }
  /* clique direto na imagem controla o mouse da VM */
  let realW = 0, realH = 0;
  img.onclick = async ev => {
    if (rodando) return;
    const b = img.getBoundingClientRect();
    const fx = realW && img.naturalWidth ? realW / img.naturalWidth : 1 / escala;
    const fy = realH && img.naturalHeight ? realH / img.naturalHeight : 1 / escala;
    const x = Math.round((ev.clientX - b.left) / b.width * img.naturalWidth * fx);
    const y = Math.round((ev.clientY - b.top) / b.height * img.naturalHeight * fy);
    try { await Pilot.vm('/input', { acts: [{ do: 'click', x, y }] }); } catch (e) { diz('err', e.message); }
    setTimeout(tela, 500);
  };
  document.querySelectorAll('.chip-ex').forEach(b => b.onclick = () => {
    $('#pl-inp').value = b.textContent; $('#pl-inp').focus();
  });
  async function go() {
    const obj = $('#pl-inp').value.trim();
    if (!obj || rodando) return;
    $('#pl-inp').value = '';
    diz('me', obj);
    rodando = true; $('#pl-stop').style.display = ''; $('#pl-go').disabled = true;
    if (vivo) { clearInterval(vivo); vivo = null; $('#pl-live').textContent = 'Ao vivo'; }
    // trava compartilhada: pegarTrava devolve null se e sua, ou {who} se OUTRA pessoa esta usando
    let dono = null;
    try { if (window.Sync && Sync.ligado()) dono = await Sync.pegarTrava(600); } catch (e) {}
    if (dono) { diz('err', 'VM ocupada por ' + String(dono.who).split('@')[0] + ' — aguarde'); fim(); return; }
    try { if (window.Sync && Sync.ligado()) Sync.log('piloto', obj.slice(0, 120)); } catch (e) {}
    try {
      await Pilot.correr(obj, ev => {
        if (ev.tipo === 'tela') { pinta(ev.img); estado('passo ' + ev.passo, true); }
        else if (ev.tipo === 'pensa') diz('think', ev.txt, ev.passo);
        else if (ev.tipo === 'age') diz('act', ev.acoes.map(a =>
              a.do + (a.x != null ? ` (${a.x},${a.y})` : '') + (a.text ? ` "${a.text}"` : '')).join('  ·  '));
        else if (ev.tipo === 'fim') diz('done', ev.txt);
        else if (ev.tipo === 'erro') diz('err', ev.txt);
        else if (ev.tipo === 'aviso') diz('', ev.txt);
      }, { passos: 25 });
    } catch (e) { diz('err', e.message); }
    fim();
  }
  function fim() {
    rodando = false; $('#pl-stop').style.display = 'none'; $('#pl-go').disabled = false;
    try { if (window.Sync && Sync.soltarTrava) Sync.soltarTrava(); } catch (e) {}
    tela();
  }
  $('#pl-stop').onclick = () => { Pilot.parar = true; diz('', 'parando após o passo atual…'); };
  $('#pl-go').onclick = go;
  $('#pl-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.v === 'pilot' && img.style.display === 'none') tela();
  }));
})();
/* ===== DIAGNOSTICO: traduz "Failed to fetch" pro motivo real ===== */
(function () {
  window.explicarFetch = function (e, url) {
    const m = (e && e.message) || String(e);
    if (!/failed to fetch|networkerror|load failed/i.test(m)) return m;
    const sitHttps = location.protocol === 'https:';
    const alvoHttp = /^http:\/\//i.test(url || '');
    if (sitHttps && alvoHttp)
      return 'BLOQUEIO DE CONTEUDO MISTO: o site esta em HTTPS e o agente em HTTP. ' +
             'O navegador corta essa chamada. Solucao: use o endereco https do agente — ' +
             'o workflow imprime em "Site > Config > URL do agente", algo como ' +
             'https://arkher-windows.<seu-tailnet>.ts.net (quem publica esse https e o ' +
             '`tailscale serve`). Liberar "Conteudo nao seguro" no cadeado so existe no ' +
             'Chrome de desktop e nao resolve no celular.';
    if (!url) return 'Sem URL do agente. Configure na aba VM.';
    return 'Nao alcancei ' + url + '. Verifique: (1) Tailscale ligado nos dois lados, ' +
           '(2) o workflow ainda esta rodando, (3) o IP mudou (cada sessao gera um novo).';
  };
  // avisa assim que a pagina abre, se o cenario for o do bloqueio
  document.addEventListener('DOMContentLoaded', function () {
    if (location.protocol !== 'https:') return;
    const u = (typeof LS !== 'undefined') ? LS.get('arkher_agent', '') : '';
    if (!/^http:\/\//i.test(u)) return;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 14px;' +
      'background:#3a2a10;border-top:1px solid #7a5a20;color:#ffd79b;font-size:12px;line-height:1.5';
    b.innerHTML = '<b>Atencao:</b> este site esta em HTTPS e o agente em HTTP — o navegador ' +
      'bloqueia essa conexao. Troque a URL do agente pela <b>https</b> que o workflow imprime ' +
      'em <b>Site &rarr; Config &rarr; URL do agente</b> (algo como ' +
      '<b>https://arkher-windows.&lt;seu-tailnet&gt;.ts.net</b>; quem publica esse https e o ' +
      '<b>tailscale serve</b>). No Chrome de desktop da pra liberar pelo <b>cadeado &rarr; ' +
      'Configuracoes do site &rarr; Conteudo nao seguro</b>, mas no celular isso nao existe. ' +
      '<button id="x-mix" style="margin-left:8px;padding:3px 8px;border-radius:5px;' +
      'border:1px solid #7a5a20;background:transparent;color:#ffd79b;cursor:pointer">ok</button>';
    document.body.appendChild(b);
    const x = b.querySelector('#x-mix'); if (x) x.onclick = () => b.remove();
  });
})();
/* ===== MODELO FIXO, ARMAZEM, KAGGLE, RESET ===== */
(function () {
  const $ = s => document.querySelector(s);
  let todos = [];
  /* ---- escolher modelo ---- */
  async function carregarTodos() {
    if (todos.length) return todos;
    const p = await Puter.list().catch(() => []);
    const h = await HF.list().catch(() => []);
    const g = (typeof Free !== 'undefined') ? await Free.catalogo().catch(() => []) : [];
    todos = p.map(id => ({ id, src: 'puter', chave: id }))
      .concat(h.map(id => ({ id, src: 'hf', chave: 'hf:' + id })))
      .concat(g.map(x => ({ id: x.id, src: 'free', chave: 'free:' + x.prov + '/' + x.id, prov: x.prov })));
    const t = $('#mm-tot'); if (t) t.textContent = todos.length;
    return todos;
  }
  async function buscarModelos() {
    const lst = $('#mm-list'); if (!lst) return;
    lst.innerHTML = '<div class="hint">carregando…</div>';
    await carregarTodos();
    const q = ($('#mm-q').value || '').trim().toLowerCase();
    const src = $('#mm-src').value;
    const fix = LS.get('arkher_modelo', '');
    const r = todos.filter(m => (!src || m.src === src) &&
      (!q || q.split(/\s+/).every(w => m.id.toLowerCase().includes(w)))).slice(0, 120);
    if (!r.length) { lst.innerHTML = '<div class="hint">nada encontrado</div>'; return; }
    lst.innerHTML = '';
    r.forEach(m => {
      const key = m.chave || m.id;
      const d = document.createElement('div');
      d.className = 'mm-it' + (key === fix ? ' on' : '');
      const rot = m.src === 'free' ? ('free: ' + m.prov) : (m.src === 'puter' && Puter.eLivre(m.id) ? 'puter :free' : m.src);
      d.innerHTML = '<span class="tag">' + rot + '</span><span class="nm"></span>';
      d.querySelector('.nm').textContent = m.id;
      d.onclick = () => {
        LS.set('arkher_modelo', key);
        $('#mm-cur').textContent = m.id;
        lst.querySelectorAll('.mm-it').forEach(x => x.classList.remove('on'));
        d.classList.add('on');
      };
      lst.appendChild(d);
    });
  }
  if ($('#mm-go')) {
    $('#mm-go').onclick = buscarModelos;
    $('#mm-q').addEventListener('keydown', e => { if (e.key === 'Enter') buscarModelos(); });
    $('#mm-clr').onclick = () => { LS.set('arkher_modelo', ''); $('#mm-cur').textContent = 'automatico'; buscarModelos(); };
    const f = LS.get('arkher_modelo', '');
    $('#mm-cur').textContent = f ? f.replace(/^hf:/, '') : 'automatico';
  }
  /* ---- armazem de contas ---- */
  async function pintarPool() {
    const el = $('#pl-list'); if (!el || !window.Pool) return;
    const o = await Pool.ler(true); const n = Date.now();
    const linha = (p, nome) => {
      const a = o[p] || [];
      if (!a.length) return nome + ': nenhum';
      return nome + ': ' + a.map(k => k.nome + (k.ate > n ? ' (descansando)' : ' ✓')).join(', ');
    };
    el.textContent = linha('hf', 'Hugging Face') + '  ·  ' + linha('puter', 'Puter');
  }
  if ($('#pl-add')) {
    $('#pl-add').onclick = async () => {
      const t = $('#pl-tok').value.trim(); if (!t) return;
      const r = await Pool.add($('#pl-prov').value, t, $('#pl-nome').value.trim());
      $('#pl-tok').value = ''; $('#pl-nome').value = '';
      $('#pl-list').textContent = r.ok ? 'adicionado.' : r.err;
      setTimeout(pintarPool, 300);
    };
    pintarPool();
  }
  /* ---- Kaggle ---- */
  if ($('#b-kaggle-save')) {
    $('#f-kaggle').value = LS.get('arkher_kaggle', '');
    $('#b-kaggle-save').onclick = () => {
      Kaggle.setUrl($('#f-kaggle').value);
      $('#s-kaggle').textContent = 'salvo: ' + (Kaggle.url() || 'vazio');
    };
    $('#b-kaggle-test').onclick = async () => {
      $('#s-kaggle').textContent = 'testando…';
      try {
        const h = await Kaggle.health();
        $('#s-kaggle').textContent = 'online — ' + (h.gpu || h.cpu || 'ok') +
          (h.ram_gb ? ' · ' + h.ram_gb + 'GB' : '');
      } catch (e) {
        $('#s-kaggle').textContent = window.explicarFetch
          ? explicarFetch(e, Kaggle.url()) : e.message;
      }
    };
    $('#b-kaggle-nb').onclick = () => {
      const a = document.createElement('a');
      a.href = 'arkher_kaggle.ipynb'; a.download = 'arkher_kaggle.ipynb'; a.click();
    };
  }
  /* ---- reset ---- */
  if ($('#b-reset')) {
    $('#b-reset').onclick = () => {
      if (!confirm('Apagar TUDO deste navegador? (login, tokens, endereços)')) return;
      try {
        Object.keys(localStorage).filter(k => /^arkher_/.test(k)).forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch (e) {}
      location.reload();
    };
    $('#b-reset-soft').onclick = () => {
      try {
        ['arkher_breaker', 'arkher_cache', 'arkher_modelo'].forEach(k => localStorage.removeItem(k));
        if (window.Breaker && Breaker.reset) Breaker.reset();
        if (window.Puter) Puter.models = null;
        if (window.HF) HF.models = null;
      } catch (e) {}
      $('#s-reset').textContent = 'caches e quarentena limpos.';
    };
  }
})();
/* ===== NO ANDROID ===== */
(function () {
  const $ = s => document.querySelector(s);
  if (!$('#b-droid-save')) return;
  $('#f-droid').value = LS.get('arkher_droid', '');
  $('#b-droid-save').onclick = () => {
    LS.set('arkher_droid', normUrl($('#f-droid').value));
    $('#f-droid').value = LS.get('arkher_droid', '');
    $('#s-droid').textContent = 'salvo';
  };
  $('#b-droid-test').onclick = async () => {
    const u = LS.get('arkher_droid', '');
    if (!u) { $('#s-droid').textContent = 'cole a URL primeiro'; return; }
    $('#s-droid').textContent = 'testando…';
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(u + '/health', { signal: c.signal });
      const j = await r.json();
      $('#s-droid').textContent = 'online — ' + (j.cpu || j.host || 'ok') +
        (j.cpu_count ? ' · ' + j.cpu_count + ' núcleos' : '');
    } catch (e) {
      $('#s-droid').textContent = window.explicarFetch ? explicarFetch(e, u) : 'offline';
    } finally { clearTimeout(t); }
  };
})();
/* ===== CONTAS PUTER: capturar / trocar / girar ===== */
(function () {
  const $ = s => document.querySelector(s);
  if (!$('#pu-cap')) return;
  async function pintar() {
    if (!window.Pool) return;
    const o = await Pool.ler(true), n = Date.now();
    const a = o.puter || [];
    $('#pu-list').textContent = a.length
      ? a.map(k => k.nome + (Pool.semSaldo(k) ? ' (sem saldo — via grátis)'
                     : k.ate > n ? ' (cota esgotada, volta depois)' : ' ✓')).join('  ·  ')
      : 'nenhuma conta capturada ainda';
    const s = await Pool.stats();
    $('#pu-st').textContent = s.puter.total
      ? s.puter.livres + ' de ' + s.puter.total + ' contas com cota disponível'
      : 'entre no Puter e clique em Capturar';
    const lane = $('#pu-lane');
    if (lane) {
      lane.innerHTML = Puter.livre
        ? '<b>Puter na via grátis:</b> o saldo acabou, então só entram os modelos <b>:free</b> '
          + '(não gastam nada) e os provedores grátis. Colocou crédito? Clique em '
          + '<b>Já coloquei crédito</b>.'
        : '<b>Puter normal:</b> usa o catálogo inteiro, com o teto de tokens da aba acima. '
          + (s.puter.total && !s.puter.comSaldo
              ? 'Atenção: nenhuma conta do armazém tem saldo — o ARKHER já está na via grátis.'
              : 'Se o saldo acabar, o ARKHER troca pra via grátis sozinho.');
    }
  }
  /* ---- levar o armazém de um dispositivo pro outro ---- */
  function baixar(nome, txt) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
    a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const bexp = $('#pl-exp');
  if (bexp) bexp.onclick = () => {
    if (!confirm('O arquivo vai conter os TOKENS das suas contas (é como uma senha).\n'
      + 'Salve num lugar seguro — não suba em repositório nem mande em grupo.\n\nExportar agora?')) return;
    baixar('arkher-armazem.json', JSON.stringify(Pool.exportar(true), null, 2));
    $('#pu-st').textContent = 'armazém exportado (com tokens). Guarde como senha.';
  };
  const bexp0 = $('#pl-exp0');
  if (bexp0) bexp0.onclick = () => {
    baixar('arkher-armazem-sem-tokens.json', JSON.stringify(Pool.exportar(false), null, 2));
    $('#pu-st').textContent = 'exportado só o inventário (sem tokens) — bom pra conferir/abrir issue.';
  };
  const bimp = $('#pl-imp'), fimp = $('#pl-file');
  if (bimp && fimp) {
    bimp.onclick = () => fimp.click();
    fimp.onchange = async () => {
      const f = fimp.files && fimp.files[0]; if (!f) return;
      $('#pu-st').textContent = 'importando…';
      const r = await Pool.importar(await f.text());
      $('#pu-st').textContent = r.ok
        ? 'importado: ' + r.novos + ' conta(s) nova(s) (' + r.total + ' Puter no total).'
        : 'não deu: ' + r.err;
      fimp.value = '';
      pintar();
    };
  }
  /* ---- quem paga: user-pays (padrão) ou cota do dono ---- */
  const selModo = $('#pl-modo'), hintModo = $('#pl-modo-hint');
  function pintarModo() {
    if (!selModo) return;
    const m = Pool.modo();
    selModo.value = m;
    const dono = Pool.souDono();
    if (hintModo) hintModo.innerHTML = m === 'visitante'
      ? '<b>User-pays:</b> cada pessoa entra com a própria conta Puter e usa os créditos dela — o site não paga nada. É o modelo que o próprio puter.js documenta para sites.'
      : (dono ? '<b>Você paga por todos:</b> as chamadas usam as contas do SEU armazém (duas ou três contas suas, no máximo).'
              : '<b>Só com o modo admin ligado</b> (marcado abaixo). Sem ele, o site fica no user-pays.');
  }
  function pintarUPG() {
    const el = $('#pl-upg'); if (!el || !window.Pool) return;
    const c = Pool.capacidade ? Pool.capacidade() : null;
    el.innerHTML = '<b>UPG (user-pays geral):</b> ' + (c && c.contas
      ? c.contas + ' conta(s) ligada(s) neste site'
      : 'nenhuma conta ligada ainda')
      + '. Cada pessoa usa o <b>próprio</b> crédito — o que cada novo usuário acrescenta ao site é '
      + '<b>capacidade</b> (mais gente atendida ao mesmo tempo, cada uma com a cota dela), '
      + 'não crédito transferido. O site não acumula cota de ninguém; ele deixa de pagar '
      + 'por qualquer consumo.';
  }
  window.pintarUPG = pintarUPG;
  /* Painel UPG: numeros anonimos do site + o convite honesto.
     O que o convite faz de verdade: traz gente nova, e cada pessoa nova
     usa a PROPRIA conta (mais gente atendida ao mesmo tempo). Ele NAO
     aumenta o credito de ninguem — nenhum sistema faz isso, e por isso a
     tela nao promete isso. */
  async function pintarPainelUPG() {
    const num = $('#upg-num'), conv = $('#upg-convite'), inp = $('#upg-link');
    if (!num || !window.Arkher) return;
    if (inp && !inp.value) inp.value = location.origin + location.pathname + '?ref=upg';
    let m = null;
    try { m = await Arkher.metricas(); } catch (e) {}
    if (!m) { num.textContent = '—'; return; }
    const l = m.local || { sessoes: 0, pedidos: 0 };
    const st = m.site;
    const u = m.uso || {};
    const total = (u.top || 0) + (u.gratis || 0);
    const pct = total ? Math.round((u.gratis / total) * 100) : 0;
    num.innerHTML = '<b>Este navegador hoje:</b> ' + (l.sessoes || 0) + ' sessão(ões) · '
      + (l.pedidos || 0) + ' pedido(s)<br>'
      + '<b>Roteador:</b> ' + (u.gratis || 0) + ' grátis · ' + (u.top || 0) + ' na ponta '
      + '(' + pct + '% desviado do crédito)<br>'
      + '<b>Contas ligadas:</b> ' + ((m.contas && m.contas.contas) || 0)
      + ' · <b>provedores grátis prontos:</b> ' + (m.gratis || 0)
      + (st ? '<br><b>Site (contador compartilhado):</b> ' + (st.sessoes || 0) + ' sessões · '
              + (st.pedidos || 0) + ' pedidos' : '<br><span class="hint">Sync desligado: os números ficam só neste navegador.</span>');
    try {
      const ec = window.Resp && Resp.economia ? await Resp.economia() : null;
      if (ec && ec.respostas) {
        num.innerHTML += '<br><b>Biblioteca do site:</b> ' + ec.respostas + ' resposta(s) reaproveitável(is) · '
          + ec.reaproveitamentos + ' pedido(s) que o site respondeu sem gastar crédito'
          + ' <button class="btn-mini" id="upg-resp-off">desligar</button>';
        const bo = $('#upg-resp-off');
        if (bo) bo.onclick = () => { Resp.ON(false); bo.textContent = 'desligada'; bo.disabled = true; };
      }
    } catch (e) {}
    const log = $('#upg-log');
    if (log) {
      const h = (m.hist || []).slice(0, 7);
      if (!h.length) log.textContent = 'nenhum movimento registrado ainda.';
      else log.innerHTML = h.map(d => {
        const p = d.pedidos || 0, pg = d.pagos || 0, g = p - pg;
        const hoje = d.dia === (new Date().toISOString().slice(0, 10));
        return (hoje ? '<b>hoje</b>     ' : d.dia.slice(5) + '  ')
          + '  +' + (d.sessoes || 0) + ' sessão(ões)'
          + '  ·  ' + p + ' pedido(s)'
          + (p ? ' (' + g + ' grátis, ' + pg + ' na ponta)' : '');
      }).join('<br>')
      + '<br><br>cada sessão = uma pessoa usando a <b>cota dela</b>. O site ganha '
      + '<b>capacidade</b> — nunca crédito.';
    }
    conv.innerHTML = '<b>Convide e ganhe — o que isso faz de verdade:</b> quem entra pelo seu link '
      + 'cria a <b>conta dele</b> no Puter e usa a <b>cota dele</b>. O site ganha '
      + '<b>capacidade</b> (mais uma pessoa atendida ao mesmo tempo, sem custo pra você) '
      + 'e o contador anônimo aqui em cima sobe. <b>Não existe</b> crédito transferido de uma '
      + 'conta para outra: nenhuma tela vai dizer "sua cota aumentou", porque isso não acontece.';
  }
  window.pintarPainelUPG = pintarPainelUPG;
  /* lê o medidor de cada conta — só leitura, sem mover nada */
  async function pintarQuota() {
    const el = $('#upg-quota-linhas'); if (!el || !window.Pool || !Pool.quota) return;
    el.textContent = 'lendo…';
    let q = null;
    try { q = await Pool.quota(); } catch (e) { el.textContent = 'não deu para ler: ' + (e.message || e); return; }
    if (!q) { el.textContent = '—'; return; }
    if (!q.linhas.length && !q.hf.length) {
      el.innerHTML = 'nenhuma conta no armazém. ' +
        'Em <b>Config › contas Puter</b>, ligue "este site é meu" e capture a sua conta para ela aparecer aqui.';
      return;
    }
    const linhas = q.linhas.map(l => {
      const v = (l.saldo === null || l.saldo === undefined) ? 'o Puter não informou o saldo'
              : (l.saldo >= 1000 ? (l.saldo / 1000).toFixed(1) + 'k' : String(l.saldo)) + ' restante';
      return (l.minha ? '<b>• ' + l.nome + '</b> (em uso agora)' : '• ' + l.nome)
        + ' — ' + v
        + (l.fora ? ' · fora do armazém' : '')
        + (l.falhas ? ' · ' + l.falhas + ' falha(s)' : '');
    }).concat(q.hf.map(h => '• ' + h.nome + ' — chave HF (cota própria do Hugging Face)'));
    el.innerHTML = linhas.join('<br>') + '<br><span class="hint">'
      + q.total + ' conta(s). Cada linha é a cota daquela conta — não existe bolo comum para mover.</span>';
  }
  window.pintarQuota = pintarQuota;
  const btnQ = $('#upg-quota'); if (btnQ) btnQ.onclick = pintarQuota;
  /* ---- MEGA PACK + COFRE NEURAL ---- */
  async function pintarPack() {
    const el = $('#mp-num'); if (!el || !window.MegaPack) return;
    try {
      if (window.Neural && !Neural.pronto) await Neural.init();
      const s = MegaPack.stats();
      if (!s) { el.textContent = 'motor neural não carregado'; return; }
      const por = Object.entries(s.porFonte || {}).map(([k, v]) => k + ' ' + v).join(' · ');
      el.innerHTML = '<b>No cofre agora:</b> ' + s.itens + ' bloco(s) indexado(s) · '
        + s.regras + ' regra(s) destilada(s) · ' + s.licoes + ' lição(ões) no dataset'
        + (por ? '<br>origens: ' + por : '')
        + '<br>cofre exportável: ' + Math.round((s.tamanhoPack || 0) / 1024) + ' KB';
    } catch (e) { el.textContent = 'não deu para ler: ' + (e.message || e); }
  }
  window.pintarPack = pintarPack;
  const bnMp = $('#mp-ver'); if (bnMp) bnMp.onclick = pintarPack;
  const bMpAdd = $('#mp-add');
  if (bMpAdd) bMpAdd.onclick = async () => {
    const st = $('#mp-st'); st.textContent = 'lendo…';
    const r = await MegaPack.ingerir($('#mp-txt').value, t => { st.textContent = t; });
    if (!r.ok) { st.textContent = r.err; return; }
    st.innerHTML = '<b>' + r.adicionados + '</b> de ' + r.blocos + ' bloco(s) entraram · '
      + r.novos + ' novo(s) · base agora com ' + r.base;
    await pintarPack();
  };
  const fMp = $('#mp-file');
  if (fMp) fMp.onchange = async () => {
    const st = $('#mp-st'); const f = fMp.files && fMp.files[0];
    if (!f) return;
    st.textContent = 'lendo ' + f.name + '…';
    const r = await MegaPack.ingerirArquivo(f, t => { st.textContent = t; });
    st.innerHTML = r.ok ? (f.name + ': ' + r.adicionados + '/' + r.blocos + ' blocos · base com ' + r.base)
                        : (f.name + ': ' + r.err);
    fMp.value = '';
    await pintarPack();
  };
  const bMpExp = $('#mp-exp');
  if (bMpExp) bMpExp.onclick = () => {
    const txt = MegaPack.exportar();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/markdown' }));
    a.download = 'cofre-neural-arkher-' + new Date().toISOString().slice(0, 10) + '.md';
    a.click();
    $('#mp-st').textContent = 'cofre exportado (' + Math.round(txt.length / 1024) + ' KB)';
  };
  const bMpLim = $('#mp-lim');
  if (bMpLim) bMpLim.onclick = async () => {
    if (!confirm('Apagar os docs/manuais indexados? (as regras e lições ficam)')) return;
    MegaPack.limpar('docs');
    $('#mp-st').textContent = 'docs limpos';
    await pintarPack();
  };
  /* ---- INGESTÃO CONTÍNUA: fila que trabalha sozinha (custo de IA zero) ---- */
  function pintarDin() {
    const el = $('#din-st'); if (!el || !window.Dinamico) return;
    const s = Dinamico.stats();
    el.innerHTML = '<b>Fila:</b> ' + s.fila + ' · <b>páginas visitadas:</b> ' + s.visitadas
      + ' · <b>blocos no cofre:</b> ' + s.blocosWeb + ' (web)'
      + ' · <b>contínuo:</b> ' + (s.ligado ? '<b>LIGADO</b>' : 'desligado')
      + (s.ultimo ? ' · última rodada ' + s.ultimo.slice(11, 19) : '');
  }
  window.pintarDin = pintarDin;
  const dinVer = $('#din-ver'); if (dinVer) dinVer.onclick = pintarDin;
  const dinAdd = $('#din-add');
  if (dinAdd) dinAdd.onclick = () => {
    const u = $('#din-url').value.trim();
    if (!u) return;
    const r = Dinamico.enfileirar(u.split(/\s+/));
    $('#din-url').value = '';
    pintarDin();
  };
  const dinRodar = $('#din-rodar');
  if (dinRodar) dinRodar.onclick = async () => {
    const el = $('#din-st'); el.textContent = 'baixando…';
    const r = await Dinamico.rodar(4, t => { el.textContent = t; });
    el.innerHTML = r.ok ? (r.baixadas + ' baixada(s) · ' + r.indexados + ' bloco(s) novos · '
      + r.links + ' link(s) enfileirado(s) · fila: ' + r.fila
      + (r.erros && r.erros.length ? '<br>erros: ' + r.erros.map(e => e.erro.slice(0, 60)).join(' · ') : ''))
      : r.err;
  };
  const dinOn = $('#din-on');
  if (dinOn) dinOn.onclick = () => {
    Dinamico.ligar(30, t => { const el = $('#din-st'); if (el) el.textContent = t; });
    pintarDin();
  };
  const dinOff = $('#din-off'); if (dinOff) dinOff.onclick = () => { Dinamico.desligar(); pintarDin(); };
  const dinLim = $('#din-limpar');
  if (dinLim) dinLim.onclick = () => { if (confirm('Limpar a fila e a lista de visitadas?')) { Dinamico.limpar(); pintarDin(); } };
  /* ---- OPERÁRIOS: a cota gratuita ociosa trabalhando no cofre ---- */
  function pintarOp() {
    const el = $('#op-st'); if (!el || !window.Operarios) return;
    const s = Operarios.stats();
    el.innerHTML = '<b>Trabalhando agora:</b> ' + s.trabalhando
      + ' · <b>contínuo:</b> ' + (s.ligado ? '<b>LIGADO</b>' : 'desligado')
      + '<br><b>Rodadas:</b> ' + s.rodadas + ' · <b>blocos digeridos:</b> ' + s.digeridos
      + ' · <b>regras criadas:</b> ' + s.regras + ' (total no motor: ' + s.regras + ')'
      + '<br><b>Fila do cofre:</b> ' + s.pendentes + ' bloco(s) pendente(s) de ' + s.cofre
      + (s.ultimo ? ' · última rodada ' + s.ultimo.slice(11, 19) : '')
      + (s.seca ? ' · <b>cota seca, esperando o reset</b>' : '');
  }
  window.pintarOp = pintarOp;
  const opVer = $('#op-ver'); if (opVer) opVer.onclick = pintarOp;
  const opRodar = $('#op-rodar');
  if (opRodar) opRodar.onclick = async () => {
    const el = $('#op-st'); el.textContent = 'operário trabalhando…';
    const r = await Operarios.rodada(t => { el.textContent = t; });
    if (!r.ok && r.semCota) el.innerHTML = '<b>sem cota gratuita agora</b> — volta no reset diário';
    else if (r.vazio) el.textContent = 'cofre em dia: nada novo para digerir';
    else pintarOp();
  };
  const opOn = $('#op-on');
  if (opOn) opOn.onclick = () => { Operarios.ligar(60, t => { const el = $('#op-st'); if (el) el.textContent = t; }); pintarOp(); };
  const opOff = $('#op-off'); if (opOff) opOff.onclick = () => { Operarios.desligar(); pintarOp(); };
  /* ---- WORKER: busca passiva (CPU + RAM, custo zero) ---- */
  const wkBaixar = $('#wk-baixar');
  if (wkBaixar) wkBaixar.onclick = () => {
    const el = $('#wk-st');
    const seeds = $('#wk-seeds').value.split(/\s+/).filter(Boolean);
    const r = Worker.baixarScript({ seeds: seeds.length ? seeds : ['https://pt.wikipedia.org/wiki/Intelig%C3%AAncia_artificial'], paginas: 60, depth: 1 });
    el.innerHTML = r.ok
      ? 'script gerado com ' + r.sementes + ' semente(s) · ' + r.paginas + ' página(s). Rode com <code>python3 arkher_worker.py</code> e importe o <code>pack-worker.md</code> aqui.'
      : r.err;
  };
  const wkPassivo = $('#wk-passivo');
  if (wkPassivo) wkPassivo.onclick = async () => {
    const el = $('#wk-st'); el.textContent = 'baixando e indexando (sem chamar modelo)…';
    const seeds = $('#wk-seeds').value.split(/\s+/).filter(Boolean);
    if (seeds.length) Dinamico.enfileirar(seeds);
    const r = await Worker.passivo(4, t => { el.textContent = t; });
    el.innerHTML = r.ok
      ? ('<b>' + r.baixadas + '</b> página(s) · <b>' + r.blocos + '</b> bloco(s) novos no cofre · '
         + r.links + ' link(s) na fila · <b>cota de IA usada: 0</b>')
      : r.err;
  };
  /* ---- as duas cotas, lado a lado, com a direção entre elas ---- */
  async function pintarCotas() {
    const el = $('#ct-num'); if (!el || !window.Cotas) return;
    el.textContent = 'lendo…';
    let p = null;
    try { p = await Cotas.painel(); } catch (e) { el.textContent = 'não deu para ler: ' + (e.message || e); return; }
    const s = p.site, q = p.puter, d = p.direcao;
    el.innerHTML =
      '<b>COTA DO SITE</b> (é sua, fica no site)<br>'
      + '&nbsp;&nbsp;• ' + s.gratis + ' provedor(es) grátis com chave<br>'
      + '&nbsp;&nbsp;• Hugging Face: ' + (s.hf ? 'ligado' : 'sem token') + (s.hfContas ? ' (+' + s.hfContas + ' conta(s) no armazém)' : '') + '<br>'
      + '&nbsp;&nbsp;• nó com GPU: ' + (s.gpu ? s.gpu + ' ligado(s)' : 'nenhum') + '<br>'
      + '&nbsp;&nbsp;• biblioteca comum: ' + d.semCusto + ' resposta(s) reaproveitada(s)<br><br>'
      + '<b>COTA DO PUTER</b> (é de quem está usando)<br>'
      + '&nbsp;&nbsp;• conta nesta sessão: ' + (q.sessaoAqui ? 'sim' : 'não') + '<br>'
      + '&nbsp;&nbsp;• contas capturadas no armazém: ' + q.contas + '<br><br>'
      + '<b>DIREÇÃO</b><br>'
      + '&nbsp;&nbsp;site → Puter: <b>' + d.site_pediu_puter + '</b> pedido(s)<br>'
      + '&nbsp;&nbsp;Puter → site: <b>' + d.puter_pediu_site + '</b> — esse caminho não existe<br>'
      + '<span class="hint">O site é cliente da API do Puter: ele pede, o Puter responde. '
      + 'Não há callback, webhook nem endereço nosso que o Puter possa chamar — por isso ele '
      + 'não tem como gastar a cota do site. E as credenciais do site (chaves, HF, GPU) nunca '
      + 'vão junto num pedido ao Puter: isso é verificado em <code>teste_cotas.js</code>.</span>';
  }
  window.pintarCotas = pintarCotas;
  /* colar vários provedores de uma vez */
  const bVarios = $('#pp-varios-add');
  if (bVarios) bVarios.onclick = () => {
    const st = $('#pp-varios-st');
    const r = Free.addVarios($('#pp-varios').value);
    st.innerHTML = r.ok ? (r.ok + ' provedor(es) adicionado(s)' +
        (r.erros.length ? ' · ' + r.erros.length + ' linha(s) com problema: ' + r.erros.slice(0, 2).join(' · ') : ''))
      : ('nada adicionado' + (r.erros.length ? ' — ' + r.erros[0] : ''));
    if (r.ok) {
      $('#pp-varios').value = '';
      try { loadCatalogs(); } catch (e) {}
      if (typeof pintar === 'function') pintar();
    }
  };
  const btnCt = $('#ct-ver'); if (btnCt) btnCt.onclick = pintarCotas;
  const btnAt = $('#upg-atualizar'); if (btnAt) btnAt.onclick = () => { pintarPainelUPG(); pintarQuota(); pintarCotas(); if (window.pintarUso) pintarUso(); };
  const btnCp = $('#upg-copiar'); if (btnCp) btnCp.onclick = () => {
    const inp = $('#upg-link'); if (!inp) return;
    inp.select(); try { document.execCommand('copy'); btnCp.textContent = 'copiado!'; } catch (e) {}
    setTimeout(() => { btnCp.textContent = 'copiar'; }, 1500);
  };
  /* quem chegou pelo convite: conta como UMA sessao anonima e some da URL.
     Nao guardamos quem veio de onde — so o numero. */
  try {
    if (/[?&]ref=upg/.test(location.search) && window.Arkher && Arkher.metricaSessao) {
      Arkher.metricaSessao();
      history.replaceState({}, '', location.pathname);
    }
  } catch (e) {}
  pintarPainelUPG();
  if (selModo) {
    selModo.onchange = () => { Pool.modo(selModo.value); pintarModo(); pintar(); pintarUPG(); };
    const cAdm = $('#pl-admin');
    if (cAdm) {
      cAdm.checked = Pool.admin();
      cAdm.onchange = () => {
        if (cAdm.checked && !confirm('Confirmar: este site é seu e as contas que você capturar são SUAS?\n\n'
          + 'O armazém não deve receber conta de visitante — o crédito de quem entra é de quem entra.')) {
          cAdm.checked = false; return;
        }
        Pool.admin(cAdm.checked); pintarModo(); pintar();
      };
    }
    pintarModo();
    pintarUPG();
    if (window.pintarPainelUPG) pintarPainelUPG();
  }
  /* ---- "testar as contas": responde por que todas caíram juntas ---- */
  const bdiag = $('#pu-diag');
  if (bdiag) bdiag.onclick = async () => {
    const lane = $('#pu-lane');
    if (lane) lane.textContent = 'mandando um pedido pequeno por conta…';
    const r = await Pool.testarContas(nome => { if (lane) lane.textContent = 'testando ' + nome + '…'; });
    const linhas = r.contas.map(c => (c.ok ? '✓ ' : '✗ ') + c.nome
      + (c.ok ? '' : ' — ' + (c.status ? c.status + ' ' : '') + String(c.err).slice(0, 60))).join('<br>');
    if (lane) lane.innerHTML = '<b>Teste das contas</b><br>' + (linhas || 'nenhuma conta no armazém')
      + '<br><br><b>Diagnóstico:</b> ' + r.diagnostico;
    pintar();
  };
  const bcheck = $('#pu-check');
  if (bcheck) bcheck.onclick = async () => {    const g = $('#pu-grana'); if (g) g.textContent = 'checando…';
    const v = await Puter.saldo();
    if (v === null) { if (g) g.textContent = 'esta conta não expôs o saldo (sem problema: a cascata se vira sozinha).'; return; }
    if (g) g.textContent = 'saldo lido: ' + v + ' (unidade do Puter).';
    if (v <= 0 && !Puter.livre) { Puter.livre = true; if (g) g.textContent += ' Saldo zerado — mudei pra via grátis (:free).'; pintar(); }
    else if (v > 0 && Puter.livre) { Puter.livre = false; if (g) g.textContent += ' Tem saldo — voltei pro catálogo completo.'; pintar(); }
  };
  const bsaldo = $('#pu-saldo');
  if (bsaldo) bsaldo.onclick = async () => {
    if (window.Pool && Pool.limparSemSaldo) await Pool.limparSemSaldo();
    Puter.livre = false;
    $('#pu-st').textContent = 'marcas limpas: o Puter volta a usar o catálogo inteiro (contas com crédito).';
    pintar();
  };
  $('#pu-cap').onclick = async () => {
    $('#pu-st').textContent = 'capturando…';
    const r = await Pool.capturarPuter();
    $('#pu-st').textContent = r.ok
      ? 'guardada: ' + r.nome + ' (' + r.total + ' no total)'
      : r.err;
    pintar();
  };
  $('#pu-troca').onclick = async () => {
    await Pool.trocarConta();
    $('#pu-st').textContent = 'desconectado. Entre com a próxima conta em "Conta Puter" e capture.';
  };
  $('#pu-next').onclick = async () => {
    const r = await Pool.usarProximoPuter();
    $('#pu-st').textContent = r.ok ? 'ativa agora: ' + r.nome : r.err;
    pintar();
  };
  pintar();
})();
/* ===== PROVEDORES GRATIS (freeai.js) — chaves, testes, modo de gasto =====
   Isto é a resposta prática ao "low balance" do Puter: cada provedor aqui
   tem cota gratuita própria. Duas ou três chaves = o chat não para mais. */
(function () {
  const $ = s => document.querySelector(s);
  if (!$('#fr-list') || typeof Free === 'undefined') return;
  function linha(p) {
    const d = document.createElement('div');
    d.style.cssText = 'border:1px solid var(--lin,#2a2a2a);border-radius:9px;padding:8px 10px;margin:8px 0';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap';
    const nome = document.createElement('b'); nome.style.fontSize = '12.5px'; nome.textContent = p.nome;
    const lim = document.createElement('span'); lim.className = 'hint'; lim.style.margin = '0'; lim.textContent = p.gratis;
    top.append(nome, lim);
    const row = document.createElement('div'); row.className = 'row'; row.style.margin = '6px 0';
    const inp = document.createElement('input'); inp.className = 'fr-tok'; inp.placeholder = p.chave;
    inp.style.flex = '1'; inp.style.minWidth = '160px'; inp.setAttribute('aria-label', 'chave ' + p.nome);
    const bAdd = document.createElement('button'); bAdd.className = 'fr-add'; bAdd.textContent = 'Adicionar';
    const bTest = document.createElement('button'); bTest.className = 'ghost fr-test'; bTest.textContent = 'Testar';
    row.append(inp, bAdd, bTest);
    if (p.proprio) {
      const bRm = document.createElement('button'); bRm.className = 'ghost';
      bRm.textContent = 'Remover'; bRm.title = 'tirar este provedor do hub';
      bRm.onclick = () => { Free.removerProprio(p.id); delete linhas[p.id]; montarLinhas(); pintar(); loadCatalogs(); };
      row.append(bRm);
    }
    const lista = document.createElement('div'); lista.className = 'hint'; lista.style.marginTop = '4px';
    const st = document.createElement('div'); st.className = 'hint fr-st'; st.dataset.prov = p.id;
    const link = document.createElement('div'); link.className = 'hint';
    link.innerHTML = 'Pegue a chave em <a href="' + p.site + '" target="_blank" rel="noopener">'
      + p.site.replace(/^https?:\/\//, '') + '</a>. '
      + (p.visao ? 'Enxerga imagem. ' : '')
      + (p.local ? 'Roda na sua máquina: sem chave e sem internet. ' + (p.dica || '') : 'Dá para colar várias chaves de uma vez (uma por linha): o ARKHER gira entre elas.');
    d.append(top, row, lista, st, link);
    bAdd.onclick = async () => {
      const r = Free.add(p.id, inp.value);
      if (!r.ok) { st.textContent = r.err || 'não deu'; return; }
      inp.value = '';
      st.textContent = 'adicionada (' + r.total + ' no total). Testando…';
      pintar();
      try { const t = await Free.testar(p.id); st.textContent = 'funcionou: ' + t.modelo + ' → ' + t.resposta; }
      catch (e) { st.textContent = 'salva, mas o teste falhou: ' + errText(e); }
      pintar();
      if (typeof loadCatalogs === 'function') loadCatalogs();
      if (window.pintarUso) pintarUso();
    };
    bTest.onclick = async () => {
      st.textContent = 'testando…';
      try { const t = await Free.testar(p.id); st.textContent = 'ok: ' + t.modelo + ' → ' + t.resposta; }
      catch (e) { st.textContent = 'falhou: ' + errText(e); }
      pintar();
    };
    lista._pintar = () => {
      const ks = Free.chaves(p.id);
      lista.innerHTML = ks.length
        ? 'chaves: ' + ks.map(k => k.nome + (k.ate > Date.now() ? ' (descansando até amanhã)' : ' ✓')).join(' · ')
        : (p.local ? 'sem chave (é local)' : 'nenhuma chave ainda');
    };
    d._lista = lista;
    return d;
  }
  const box = $('#fr-list');
  const linhas = {};
  function montarLinhas() {
    box.innerHTML = '';
    for (const p of Free.provs()) { const l = linha(p); linhas[p.id] = l; box.append(l); }
  }
  montarLinhas();
  function pintar() {
    const C = Free.capacidade();
    const porProv = {};
    for (const x of C.linhas) porProv[x.id] = x;
    for (const p of Free.provs()) {
      const l = linhas[p.id];
      if (!l) continue;
      l._lista._pintar();
      const st = l.querySelector('.fr-st');
      const r = Free.resumo().find(x => x.id === p.id);
      if (!r) continue;
      const t = [];
      if (r.local) t.push('local');
      else t.push(r.total ? (r.livres + '/' + r.total + ' chave(s) viva(s)') : 'sem chave');
      const cap = porProv[p.id];
      if (cap) t.push(cap.chaves + ' × ' + (isFinite(cap.dia) ? cap.dia : '∞') + '/dia');
      if (r.modelos) t.push(r.modelos + ' modelos no catálogo');
      if (r.erro) t.push('último erro: ' + r.erro.slice(0, 90));
      st.textContent = t.join(' · ');
    }
    const cp = $('#fr-cap');
    if (cp) {
      cp.innerHTML = C.contas
        ? '<b>Capacidade do armazém:</b> ' + C.contas + ' conta(s) grátis → ~'
          + C.pedidos.toLocaleString('pt-BR') + ' pedidos/dia'
          + (C.ilimitado ? ' + ilimitado (você tem provedor local)' : '')
          + '. É a soma das cotas que cada provedor <b>publica</b> — e por cima disso vêm '
          + 'a via grátis do Puter (:free) e o nó com GPU. Nada de conta fake: cada chave é sua, '
          + 'no provedor dela.'
        : '<b>Capacidade do armazém:</b> zero ainda — cadastre uma chave grátis acima '
          + '(Gemini e Groq já levam o dia inteiro).';
    }
    const resumo = $('#fr-st');
    if (resumo) {
      const prontos = Free.prontos().length;
      resumo.textContent = prontos
        ? prontos + ' provedor(es) grátis prontos. Eles entram na cascata ANTES do Puter pago.'
        : 'nenhum provedor grátis configurado — por enquanto só o Puter (e a via grátis :free dele) responde.';
    }
  }
  window.pintarGratis = pintar;
  pintar();
  pintarUso();
  $('#fr-reload').onclick = () => { Free.esquecer(); loadCatalogs(); };
  $('#fr-testall').onclick = async () => {
    const alvos = Free.prontos();
    if (!alvos.length) { $('#fr-st').textContent = 'nenhuma chave cadastrada ainda.'; return; }
    const out = [];
    for (const id of alvos) {
      const l = linhas[id]; const st = l.querySelector('.fr-st');
      st.textContent = 'testando…';
      try { const t = await Free.testar(id); out.push(id + ' ok'); st.textContent = 'ok: ' + t.modelo + ' → ' + t.resposta; }
      catch (e) { out.push(id + ' falhou'); st.textContent = 'falhou: ' + errText(e); }
    }
    $('#fr-st').textContent = out.join(' · ');
    pintar();
  };
  /* --- adicionar provedor proprio ao hub --- */
  const ppAdd = $('#pp-add');
  if (ppAdd) {
    const ler = () => ({
      nome: $('#pp-nome').value.trim(),
      url: $('#pp-url').value.trim(),
      token: $('#pp-tok').value.trim(),
      modelos: $('#pp-mod').value,
      papel: $('#pp-papel').value,
      dia: Number($('#pp-dia').value) || undefined,
      visao: $('#pp-visao').checked,
    });
    ppAdd.onclick = async () => {
      const f = ler();
      const r = Free.addProprio(f);
      if (!r.ok) { $('#pp-st').textContent = r.err; return; }
      if (f.token) Free.add(r.id, f.token, 'principal');
      $('#pp-st').textContent = 'adicionado ao hub. Testando…';
      pintar();
      try {
        const t = await Free.testar(r.id);
        $('#pp-st').textContent = 'funcionou: ' + t.modelo + ' → ' + t.resposta;
      } catch (e) { $('#pp-st').textContent = 'salvo, mas o teste falhou: ' + errText(e); }
      montarLinhas(); pintar();
      if (typeof loadCatalogs === 'function') loadCatalogs();
    };
    $('#pp-test').onclick = async () => {
      const f = ler();
      $('#pp-st').textContent = 'salvando e testando…';
      const r = Free.addProprio(f);
      if (!r.ok) { $('#pp-st').textContent = r.err; return; }
      if (f.token) Free.add(r.id, f.token, 'principal');
      try { const t = await Free.testar(r.id); $('#pp-st').textContent = 'ok: ' + t.modelo + ' → ' + t.resposta; }
      catch (e) { $('#pp-st').textContent = 'falhou: ' + errText(e); }
      montarLinhas(); pintar();
    };
  }
  /* --- medidor do dia: quanto foi na ponta e quanto foi gratis ---
     É o numero que mostra se o roteador esta funcionando: se "gratis" for
     muito maior que "ponta", o credito dura muito mais.                     */
  function pintarUso() {
    const el = $('#ec-uso'); if (!el) return;
    const u = Arkher.uso ? Arkher.uso() : null;
    if (!u) { el.textContent = '—'; return; }
    const total = (u.top || 0) + (u.gratis || 0);
    if (!total) { el.innerHTML = 'hoje ainda não houve chamada nenhuma.'; return; }
    const pct = Math.round((u.gratis / total) * 100);
    const top3 = Object.entries(u.modelos || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([m, n]) => m.split('/').pop().slice(0, 26) + ' ×' + n).join(' · ');
    el.innerHTML = '<b>Hoje:</b> ' + u.gratis + ' grátis · ' + u.top + ' na ponta/pago'
      + ' (' + pct + '% economizado pelo roteador)'
      + (top3 ? '<br>mais usados: ' + top3 : '')
      + '<br>Quem paga agora: <b>' + (typeof Puter.deQuem === 'function' ? Puter.deQuem() : '?') + '</b>';
  }
  window.pintarUso = pintarUso;
  /* --- modo de gasto + teto de tokens --- */
  const md = $('#ec-modo');
  if (md) {
    md.value = Arkher.modo();
    md.onchange = () => { Arkher.modo(md.value); $('#fr-st').textContent = 'modo: ' + md.options[md.selectedIndex].text; };
  }
  const tk = $('#ec-tok');
  if (tk) {
    tk.value = LS.get('arkher_max_tokens', 2048);
    tk.onchange = () => {
      const v = Math.max(128, Math.min(32000, Number(tk.value) || 2048));
      LS.set('arkher_max_tokens', v); tk.value = v;
    };
  }
})();
/* ===== AUTO-CONFIG: detecta contas sem clique ===== */
(function () {
  const $ = s => document.querySelector(s);
  if (!window.Pool || !Pool.auto) return;
  function toast(txt) {
    let t = $('#ark-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ark-toast';
      t.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;max-width:320px;' +
        'padding:10px 13px;border-radius:9px;background:#14301f;border:1px solid #2f7a4a;' +
        'color:#a8f0c4;font-size:12px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.5)';
      document.body.appendChild(t);
    }
    t.textContent = txt;
    t.style.display = 'block';
    clearTimeout(t._x);
    t._x = setTimeout(() => { t.style.display = 'none'; }, 6000);
  }
  async function rodar() {
    try {
      const r = await Pool.auto(toast);
      const s = await Pool.stats();
      const chip = $('#s-pool');
      if (chip) {
        chip.textContent = s.puter.livres + '/' + s.puter.total + ' puter · ' +
                           s.hf.livres + '/' + s.hf.total + ' hf';
        chip.title = 'contas com cota disponível no armazém';
      }
      const st = $('#pu-st');
      if (st && r.puter) {
        st.textContent = (r.puter.novo ? 'detectada e guardada: ' : 'conta ativa: ') + r.puter.nome +
          ' · ' + s.puter.livres + ' de ' + s.puter.total + ' com cota';
      }
    } catch (e) {}
  }
  // roda no load, depois do login, e vigia troca de conta
  setTimeout(rodar, 1500);
  Pool.onMudou = rodar;          // atualiza o chip na hora que troca a conta
  Pool.vigiar(toast);
  const bin = $('#b-in');
  if (bin) bin.addEventListener('click', () => setTimeout(rodar, 2500));
  const bp = $("#b-login");
  if (bp) bp.addEventListener('click', () => setTimeout(rodar, 3000));
})();
/* ===== Game dev: o loop verificado (gera, roda, le o erro, conserta) ===== */
(function () {
  const $ = s => document.querySelector(s);
  const logEl = $('#gd-log'), est = $('#gd-estado');
  if (!logEl || !window.GD) return;
  function diz(t) { est.textContent = t; }
  function log(t, cls) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = t;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }
  let parado = false;
  $('#gd-parar').onclick = () => { parado = true; diz('parando depois desta rodada…'); };
  function pintaPasso(p) {
    if (p.tipo === 'rodada') log('— rodada ' + p.n + ' de ' + p.de + ' —', 'r');
    else if (p.tipo === 'codigo') log('escreveu: ' + (p.arquivos || []).join(', ') + (p.explica ? (' · ' + p.explica) : ''));
    else if (p.tipo === 'escrito') log('gravou na máquina: ' + (p.arquivos || []).length + ' arquivo(s)');
    else if (p.tipo === 'rodou') log('rodando: ' + p.cmd);
    else if (p.tipo === 'diagnostico') {
      const e = (p.erros || []);
      if (p.estado === 'ok') log('a máquina rodou LIMPO ✓', 'o');
      else if (p.estado === 'nao-rodou') log('nem rodou: ' + (p.naoRodou || ''), 'e');
      else log('erros encontrados: ' + e.length + ' · ' + (e[0] ? (e[0].arquivo || '?') + (e[0].linha ? ':' + e[0].linha : '') + ' — ' + e[0].msg : ''), 'e');
    }
    else if (p.tipo === 'esqueleto') log('esqueleto do ' + p.motor + ' pronto em ' + p.pasta
      + ' (' + ((p.arquivos || []).length) + ' arquivo(s) para comecar)')
    else if (p.tipo === 'aviso') log('aviso: ' + (p.txt || ''));
    else if (p.tipo === 'fim') log(p.ok ? 'PRONTO: rodou limpo' : ('parei: ' + (p.motivo || '')), p.ok ? 'o' : 'e');
  }
  $('#gd-rodar').onclick = async function () {
    const objetivo = String($('#gd-objetivo').value || '').trim();
    const motor = $('#gd-motor').value;
    const projeto = String($('#gd-projeto').value || '').trim() || ('/tmp/arkher-' + motor + '-jogo');
    if (!objetivo) { diz('escreva o que o jogo deve fazer'); return; }
    const umaVez = String(GD.__rodando || '');
    if (umaVez) { diz(umaVez); return; }
    const base = (window.LS && (LS.get('arkher_agent', '') || LS.get('arkher_kaggle', ''))) || '';
    if (!base) { diz('sem máquina: ligue a VM ou o nó em Config ▸ Ligar tudo (sem máquina eu não posso verificar)'); return; }
    parado = false; logEl.innerHTML = '';
    this.disabled = true; GD.__rodando = 'rodando…';
    diz('rodando o loop (a IA de fundo escreve, a máquina testa)…');
    try {
      const r = await GD.loop({
        objetivo: objetivo, motor: motor, projeto: projeto, nome: motor + '-jogo',
        esqueleto: !!($('#gd-esq') && $('#gd-esq').checked),
        maxRodadas: Math.max(1, Math.min(8, parseInt($('#gd-rodadas').value, 10) || 4)),
        vm: GD.vmReal(base),
        onPasso: p => { if (!parado) pintaPasso(p); },
      });
      log('custo: ' + r.custo.chamadas + ' chamada(s) de IA · cota de usuário gasta: ' + (r.custo.gastouSaldo ? 'SIM' : 'não'));
      if (r.ok) diz('PRONTO — rodou limpo em ' + r.rodadas + ' rodada(s), sem gastar cota de ninguém');
      else diz('não fechou: ' + r.motivo + (r.oQueFazer ? (' · ' + r.oQueFazer) : ''));
    } catch (e) {
      log('falhou: ' + (e.message || e), 'e');
      diz('falhou: ' + (e.message || e));
    } finally { this.disabled = false; GD.__rodando = ''; }
  };
})();
/* ===== Publicar e telemetria: o jogo no ar e vivo ===== */
(function () {
  const $ = s => document.querySelector(s);
  const out = $('#pb-out'), codigo = $('#pb-codigo'), listaVer = $('#pb-versoes');
  if (!out || !window.Publicar) return;
  const P = Publicar;
  function texto(t, ruim) { out.textContent = t; out.style.color = ruim ? '#ff9b9b' : ''; }
  /* ---- campos ---- */
  const repo = $('#pb-repo'), key = $('#pb-rbx-key'), ids = $('#pb-ids'),
        tel = $('#pb-tel'), jogo = $('#pb-jogo');
  const cfg = P.cfg();
  if (repo) repo.value = cfg.repo;
  if (key) key.value = cfg.rbxKey;
  if (ids) ids.value = (cfg.universo && cfg.lugar) ? (cfg.universo + ':' + cfg.lugar) : '';
  if (tel) tel.value = cfg.tel;
  if (jogo) jogo.value = cfg.jogo;
  function colher() {
    const par = String(ids && ids.value || '').trim().split(':');
    const c = { repo: repo && repo.value, rbxKey: key && key.value, tel: tel && tel.value,
                jogo: jogo && jogo.value, universo: (par[0] || '').trim(), lugar: (par[1] || '').trim() };
    return P.salvar(c);
  }
  $('#pb-salvar').onclick = () => {
    const c = colher();
    texto('salvo: ' + (c.repo || 'sem repositorio') + ' · telemetria ' + (c.tel || 'sem endereco') +
      ' · jogo ' + (c.jogo || 'sem nome') + (c.rbxKey ? ' · chave do Roblox guardada' : ' · sem chave do Roblox'));
  };
  $('#pb-snippet').onclick = () => {
    const c = colher();
    codigo.style.display = 'block';
    codigo.textContent = P.snippet(c.tel, c.jogo);
    texto('copie o codigo acima para um Script do servidor no Studio');
  };
  $('#pb-gh').onclick = async function () {
    const c = colher();
    if (!c.repo) return texto('preencha o repositorio primeiro (dono/repositorio)', true);
    this.disabled = true; const t = this.textContent; this.textContent = 'publicando...';
    try {
      const leia = ['# Kit ARKHER do jogo', '',
        'Este repositorio guarda o jogo **' + (c.jogo || 'sem nome') + '** e o kit que liga ele ao ARKHER.',
        '', '## Como publicar o jogo',
        '1. No Studio: Arquivo -> Salvar como .rbxl',
        '2. Na aba Config do site, em "Publicar e telemetria", escolha o arquivo e publique.',
        '   (A chave do Roblox precisa do escopo universe-places:write.)',
        '', '## Telemetria',
        'No no, rode: `python3 telemetria.py`',
        'Cole o codigo abaixo num Script do servidor (ServerScriptService).',
        'O jogo passa a mandar onde o jogador morre, onde trava e quando sai.',
        'Nada de identidade sai do jogo: nome, e-mail, conversa e id sao bloqueados.',
        '', '```lua', P.snippet(c.tel, c.jogo), '```', ''].join('\n');
      const a = await P.paraGitHub('ARKHER-JOGO/LEIA-ME.md', leia, 'ARKHER: kit do jogo ' + (c.jogo || ''));
      if (!a.ok) return texto('GitHub: ' + a.motivo + (a.o_que_fazer ? ' — ' + a.o_que_fazer : ''), true);
      const b = await P.paraGitHub('ARKHER-JOGO/telemetria.lua', P.snippet(c.tel, c.jogo), 'ARKHER: telemetria do jogo');
      if (!b.ok) return texto('GitHub: ' + b.motivo + (b.o_que_fazer ? ' — ' + b.o_que_fazer : ''), true);
      texto('kit publicado no GitHub: ' + a.caminho + ' (' + a.commit + ',' + (a.criou ? 'criado' : 'atualizado') +
        ') · ' + b.caminho + ' (' + b.commit + ')');
    } finally { this.disabled = false; this.textContent = t; }
  };
  const arq = $('#pb-rbx-arq');
  if (arq) arq.onchange = async function () {
    const c = colher();
    const f = this.files && this.files[0];
    if (!f) return;
    if (!c.rbxKey || !c.universo || !c.lugar)
      return texto('preencha a chave do Roblox e o universo:lugar antes de publicar o arquivo', true);
    texto('lendo ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB)...');
    const buf = new Uint8Array(await f.arrayBuffer());
    const r = await P.paraRoblox(buf, false);
    if (!r.ok) return texto('Roblox: ' + r.motivo + (r.o_que_fazer ? ' — ' + r.o_que_fazer : ''), true);
    texto('publicado no Roblox: versao ' + (r.versao || '?') + (r.url ? ' · ' + r.url : ''));
  };
  $('#pb-tel-ver').onclick = async function () {
    const c = colher();
    this.disabled = true; const t = this.textContent; this.textContent = 'lendo...';
    try {
      const r = await P.telemetria(c.tel, c.jogo);
      if (!r.ok) return texto('telemetria: ' + r.motivo + (r.o_que_fazer ? ' — ' + r.o_que_fazer : ''), true);
      const res = r.resumo || {};
      const partes = [
        res.eventos + ' eventos · ' + res.sessoes + ' sessoes' +
        (res.minutos_por_sessao != null ? ' · ' + res.minutos_por_sessao + ' min por sessao' : ''),
        'mortes por fase: ' + (Object.keys(res.mortes_por_fase || {}).length
          ? Object.keys(res.mortes_por_fase).map(f => f + '=' + res.mortes_por_fase[f]).join(' ') : 'sem dados'),
        'onde trava: ' + ((res.onde_trava || []).length
          ? res.onde_trava.slice(0, 3).map(p => '(' + p.x + ',' + p.z + ') x' + p.n).join(' ') : 'nada registrado'),
      ];
      texto(partes.join(' · '));
      codigo.style.display = 'block';
      codigo.textContent = (r.sugestoes || []).length
        ? r.sugestoes.map(s => '• ' + s.texto).join('\n')
        : 'sem sugestoes ainda';
    } finally { this.disabled = false; this.textContent = t; }
  };
  $('#pb-marcar').onclick = async function () {
    const c = colher();
    this.disabled = true; const t = this.textContent; this.textContent = 'marcando...';
    try {
      const r = await P.telemetria(c.tel, c.jogo);
      const v = P.marcar({ versao: 'v' + (P.versoes().length + 1),
        resumo: r.ok ? r.resumo : null, sugestoes: r.ok ? r.sugestoes : [] });
      texto('versao ' + v.versao + ' marcada' + (r.ok ? (' com os numeros de agora (' + (r.resumo.eventos || 0) + ' eventos)')
        : ' SEM telemetria (marque de novo quando o no estiver no ar)'));
      pintarVersoes();
    } finally { this.disabled = false; this.textContent = t; }
  };
  function pintarVersoes() {
    if (!listaVer) return;
    const l = P.versoes();
    listaVer.innerHTML = '';
    if (!l.length) return;
    const d = document.createElement('div');
    d.className = 'pb-ver';
    d.textContent = 'versoes marcadas: ' + l.map(v => v.versao + (v.resumo ? '(' + (v.resumo.eventos || 0) + ')' : '(sem dado)')).join(' · ');
    listaVer.appendChild(d);
  }
  $('#pb-comparar').onclick = () => {
    const l = P.versoes();
    if (l.length < 2) return texto('preciso de duas versoes marcadas para comparar', true);
    const r = P.comparar(l[l.length - 2], l[l.length - 1]);
    if (!r.ok) return texto('comparar: ' + r.motivo, true);
    texto('de ' + r.de + ' para ' + r.para + ': ' + r.texto);
  };
  pintarVersoes();
})();
/* ===== Ligar tudo: um lugar so para ligar no, DsOS, piloto e tokens ===== */
(function () {
  const $ = s => document.querySelector(s);
  const corpo = $('#lg-corpo');
  if (!corpo || !window.Ligar) return;
  const resumo = $('#lg-resumo'), passos = $('#lg-passos');
  function linhas() {
    corpo.innerHTML = '';
    Ligar.pontos.forEach(p => {
      const l = document.createElement('div');
      l.className = 'lg-linha';
      const esq = document.createElement('div');
      const nome = document.createElement('div');
      nome.className = 'lg-nome';
      nome.innerHTML = '<span class="dot"></span>';
      const b = document.createElement('b'); b.textContent = p.nome;
      nome.appendChild(b);
      const oq = document.createElement('div');
      oq.className = 'lg-oque'; oq.textContent = p.oQueE;
      esq.appendChild(nome); esq.appendChild(oq);
      const dir = document.createElement('div');
      if (p.campoPainel) {
        const inp = document.createElement('input');
        inp.id = p.campoPainel; inp.placeholder = p.exemplo || '';
        inp.value = Ligar.valorDe(p) || '';
        if (p.tipo === 'token') inp.autocomplete = 'off';
        dir.appendChild(inp);
      }
      const st = document.createElement('div');
      st.className = 'lg-st'; st.dataset.st = p.id;
      st.textContent = p.campoPainel ? '—' : 'testar para ver';
      dir.appendChild(st);
      l.appendChild(esq); l.appendChild(dir);
      corpo.appendChild(l);
    });
  }
  function pintarResultado(r) {
    r.lista.forEach(x => {
      const l = corpo.querySelector('[data-st="' + x.id + '"]');
      if (!l) return;
      l.className = 'lg-st ' + (x.ok ? 'ok' : 'ruim');
      l.textContent = x.ok ? ('ok · ' + x.detalhe)
        : ((x.detalhe ? x.detalhe : 'sem resposta') + (x.falta ? ' · o que fazer: ' + x.falta : ''));
      const dot = corpo.querySelector('[data-st="' + x.id + '"]');
      const nl = dot && dot.closest ? dot.closest('.lg-linha') : null;
      const d = nl ? nl.querySelector('.dot') : null;
      if (d) d.className = 'dot ' + (x.ok ? 'ok' : 'ruim');
    });
    resumo.textContent = Ligar.resumo(r);
    if (r.passos && r.passos.length) {
      passos.style.display = 'block';
      passos.innerHTML = r.passos.map(t => '· ' + t).join('<br>');
    } else if (passos) passos.style.display = 'none';
  }
  $('#lg-testar').onclick = async function () {
    this.disabled = true; const t = this.textContent; this.textContent = 'testando...';
    try {
      Ligar.salvarCampos();
      pintarResultado(await Ligar.testarTudo());
    } catch (e) { resumo.textContent = 'erro ao testar: ' + e.message; }
    finally { this.disabled = false; this.textContent = t; }
  };
  $('#lg-ligar').onclick = async function () {
    this.disabled = true; const t = this.textContent; this.textContent = 'ligando...';
    try {
      const r = await Ligar.ligarTudo(parcial => { pintarResultado(parcial); });
      pintarResultado(r);
    } catch (e) { resumo.textContent = 'erro ao ligar: ' + e.message; }
    finally { this.disabled = false; this.textContent = t; }
  };
  linhas();
})();
/* ===== DsOS remoto: o site e so a tela + o controle ===== */
(function () {
  const $ = s => document.querySelector(s);
  const img = $('#dsr-img'); if (!img || !window.DsC) return;
  const off = $('#dsr-off'), st = $('#dsr-st'), dot = $('#dsr-dot'),
        hwEl = $('#dsr-hw'), fpsEl = $('#dsr-fps'), msg = $('#dsr-msg'),
        draw = $('#dsr-draw'), drawT = $('#dsr-draw-t'), drawB = $('#dsr-draw-b');
  function estado(t, on) { st.textContent = t; dot.classList.toggle('on', !!on); }
  function mostrarTela(v) {
    img.style.display = v ? 'block' : 'none';
    off.style.display = v ? 'none' : 'block';
  }
  const inp = $('#dsr-url');
  if (inp) inp.value = DsC.url();
  async function conectar() {
    const u = normUrl(inp.value);
    if (!u) { msg.textContent = 'Cole o endereco que o DsOS imprimiu.'; return; }
    inp.value = u;
    DsC.setUrl(u);
    estado('conectando...', false);
    try {
      const j = await DsC.health();
      hwEl.textContent = DsC.resumoHw();
      if (j.tela) {
        estado('no ar · ' + (j.hw.backend || '?'), true);
        iniciar();
      } else {
        estado('conectado, sessao grafica desligada', true);
        msg.innerHTML = 'DsOS respondeu (' + DsC.resumoHw() +
          ').<br>Clique em <b>Ligar DsOS</b> para subir o desktop.';
      }
    } catch (e) {
      estado('falhou', false);
      msg.textContent = 'Nao consegui falar com o DsOS: ' + (window.explicarFetch ? explicarFetch(e, u) : e.message);
    }
  }
  /* linha de estado: fps · latencia · qualidade · resolucao transmitida */
  function pintaLinha(fps, ms) {
    const q = DsC.qual === 'auto' ? ('auto:' + DsC._nivel) : DsC.qual;
    fpsEl.textContent = (fps != null ? fps + ' fps · ' + ms + ' ms · ' : '') +
      q + ' · ' + (DsC.stream.escala || 100) + '%' +
      (DsC.cursor.modo === 'mouse' ? ' · mouse' : ' · toque');
  }
  function iniciar() {
    mostrarTela(true);
    DsC.ligarVista(img, $('#dsr-zoom'), $('#dsr-cursor'));
    DsC.ligarEntrada(img, $('#dsr-zoom'));
    DsC.setQualidade(DsC.qual);
    DsC.iniciarStream(img,
      err => { estado('tela indisponivel', false); msg.textContent = err; mostrarTela(false); },
      (fps, ms) => { pintaLinha(fps, ms); pintaGirar(); });
  }
  $('#dsr-go').onclick = conectar;
  $('#dsr-cfg2').onclick = () => { DsC.pararStream(); mostrarTela(false); };
  /* ---------- controles da tela: mouse/toque, encaixe, zoom, qualidade ---------- */
  const bCursor = $('#dsr-mouse'), bFit = $('#dsr-fit'), selQ = $('#dsr-q');
  function pintaBotaoCursor() {
    if (bCursor) bCursor.textContent = DsC.cursor.modo === 'mouse' ? 'Mouse ✓' : 'Mouse';
  }
  function pintaBotaoFit() { if (bFit) bFit.textContent = DsC.rotuloVista(DsC.vista.modo); }
  if (bCursor) bCursor.onclick = () => {
    DsC.setCursorModo(DsC.cursor.modo === 'mouse' ? 'toque' : 'mouse');
    pintaBotaoCursor(); pintaLinha();
    if (DsC.cursor.modo === 'mouse')
      msg.textContent = 'Cursor de mouse ligado: arraste o dedo para mover, toque curto = clique, toque longo = botao direito. Dois dedos = mover a tela/zoom.';
  };
  if (bFit) bFit.onclick = () => { DsC.cicloVista(); pintaBotaoFit(); };
  if (selQ) { selQ.value = DsC.qual; selQ.onchange = () => { DsC.setQualidade(selQ.value); pintaLinha(); }; }
  const bZmais = $('#dsr-zp'), bZmenos = $('#dsr-zm');
  if (bZmais) bZmais.onclick = () => DsC.zoom(1.25);
  if (bZmenos) bZmenos.onclick = () => DsC.zoom(0.8);
  /* tela cheia: usar Studio/Blender sem a barra do site comendo a tela */
  const bFull = $('#dsr-full'), avisoGirar = $('#dsr-girar');
  function pintaFull() { if (bFull) bFull.textContent = DsC.emTelaCheia() ? 'Sair' : 'Tela'; }
  if (bFull) bFull.onclick = async () => {
    const r = await DsC.telaCheia();
    if (!r.ok && msg) msg.textContent = r.erro;
    pintaFull();
  };
  if (avisoGirar) {
    const bx = $('#dsr-girar-x');
    if (bx) bx.onclick = async () => {
      const r = await DsC.travarPaisagem();
      if (msg) msg.textContent = r.ok ? 'deitado e travado em paisagem' : r.erro;
    };
  }
  function pintaGirar() {
    if (avisoGirar) avisoGirar.style.display = DsC.precisaGirar() ? 'flex' : 'none';
  }
  if (window.addEventListener) window.addEventListener('orientationchange', () => setTimeout(() => { pintaGirar(); DsC.recalcular(); }, 250));
  if (document.addEventListener) document.addEventListener('fullscreenchange', pintaFull);
  pintaFull();
  DsC.onQualidade = (n, p, motivo) => {
    if (selQ && String(n).indexOf('auto') === 0) selQ.value = 'auto';
    pintaLinha();
    if (motivo && msg) msg.textContent = 'Qualidade ' + motivo;
  };
  DsC.onCursorModo = pintaBotaoCursor;
  pintaBotaoCursor(); pintaBotaoFit();
  $('#dsr-boot').onclick = async function () {
    this.disabled = true; const txt = this.textContent; this.textContent = 'ligando...';
    try {
      const r = await DsC.boot();
      if (r.ok) {
        estado('desktop no ar · ' + (r.modo || ''), true);
        if (r.faltando && r.faltando.length)
          alert('DsOS subiu, mas faltam pacotes no backend: ' + r.faltando.join(', ') +
                '\nInstale-os no notebook/workflow para tela e entrada completas.');
        iniciar();
      } else {
        estado('nao subiu', false);
        alert('Nao consegui subir a sessao grafica: ' + (r.erro || '?') +
              (r.faltando ? '\nFaltando: ' + r.faltando.join(', ') : ''));
      }
    } catch (e) { alert('erro: ' + e.message); }
    this.disabled = false; this.textContent = txt;
  };
  function abrirGaveta(titulo) { drawT.textContent = titulo; draw.style.display = 'flex'; }
  $('#dsr-draw-x').onclick = () => { draw.style.display = 'none'; };
  $('#dsr-apps').onclick = async () => {
    abrirGaveta('Apps instalados'); drawB.innerHTML = '<p style="color:var(--dim);font-size:12px">lendo...</p>';
    try {
      const j = await DsC.apps();
      const a = j.apps || [];
      if (!a.length) {
        drawB.innerHTML = '<p style="color:var(--dim);font-size:12px;line-height:1.6">' +
          'Nenhum app grafico instalado neste backend.<br><br>' +
          'Isso e real, nao um erro: o DsOS so lista o que existe de verdade na maquina. ' +
          'Instale no notebook/workflow (ex: blender, xterm) e recarregue.</p>';
        return;
      }
      drawB.innerHTML = '';
      a.forEach(x => {
        const d = document.createElement('div');
        d.className = 'dsr-it';
        d.innerHTML = '<svg class="ico"><use href="#i-cube"/></svg><span class="nm"></span>';
        d.querySelector('.nm').textContent = x.nome;
        d.onclick = async () => { await DsC.abrir(x.bin); draw.style.display = 'none'; };
        drawB.appendChild(d);
      });
    } catch (e) { drawB.innerHTML = '<p style="color:#ff9b9b;font-size:12px">' + e.message + '</p>'; }
  };
  const hud = $('#hud');
  $('#dsr-hud').onclick = () => {
    hud.style.display = hud.style.display === 'none' ? 'block' : 'none';
  };
  hud.querySelectorAll('button[data-k]').forEach(b => {
    b.onclick = e => { e.preventDefault(); DsC.tecla(b.dataset.k); };
  });
  $('#dsr-kb').onclick = () => {
    const t = prompt('Texto para digitar no DsOS:');
    if (t) DsC.texto(t);
  };
  // teclado fisico: clique na tela remota e digite
  img.tabIndex = 0;
  DsC.teclado(img);
  img.addEventListener('mousedown', () => img.focus());
  // reconecta sozinho se ja tinha endereco salvo
  if (DsC.url()) setTimeout(conectar, 2000);
})();
/* ===== Compute Manager (item 17) + HUD configuravel (item 7) + gestos ===== */
(function () {
  const $ = s => document.querySelector(s);
  if (!window.CM || !$('#cm-pane')) return;
  const pane = $('#cm-pane'), corpo = $('#cm-b');
  function tag(txt, ok) {
    return '<span class="tg ' + (ok === true ? 'on' : ok === false ? 'off' : '') + '">' + txt + '</span>';
  }
  async function pintar() {
    corpo.innerHTML = '<p style="color:var(--dim);font-size:12px">sondando backends...</p>';
    const l = await CM.sondarTodos();
    corpo.innerHTML = '';
    l.forEach(b => {
      const d = document.createElement('div');
      d.className = 'cmb';
      const c = b.cap || {}, cp = c.compat || {}, h = c.hw || {};
      const on = b.online;
      let tags = '';
      if (on) {
        tags += tag('Linux', !!(cp.linux || {}).ok);
        tags += tag('Windows' + ((cp.windows || {}).via === 'wine' ? ' (Wine)' : ''), !!(cp.windows || {}).ok);
        tags += tag('Android', !!(cp.android || {}).ok);
        tags += tag('Tela', !!c.tela);
        tags += tag('Entrada', !!c.entrada);
        tags += tag('GPU CUDA', !!c.gpu_compute);
      }
      d.innerHTML =
        '<div class="cmb-t"><span class="dot' + (on ? ' on' : '') + '"></span>' +
        '<b></b><span class="grow"></span>' +
        (b.tipo === 'browser' ? '' : '<button class="mini" data-rm="' + b.id + '">remover</button>') +
        '</div>' +
        '<div class="cmb-hw"></div>' +
        '<div class="cmb-tags">' + tags + '</div>';
      d.querySelector('b').textContent = b.nome;
      d.querySelector('.cmb-hw').textContent = CM.resumo(b.id);
      corpo.appendChild(d);
    });
    corpo.querySelectorAll('[data-rm]').forEach(b => {
      b.onclick = () => { CM.remover(b.dataset.rm); pintar(); };
    });
    // onde cada tarefa vai cair AGORA
    const box = document.createElement('div');
    box.className = 'cmb';
    let html = '<div class="cmb-t"><b>Para onde vai cada tarefa</b></div><div class="cmb-hw">';
    Object.keys(CM.tarefas).forEach(k => {
      const r = CM.rotear(k);
      html += CM.tarefas[k].nome + ' &rarr; ' +
        (r.ok ? '<span style="color:#8ae3ae">' + r.backend.nome + '</span>'
              : '<span style="color:#ff9b9b">' + r.motivo + '</span>') + '<br>';
    });
    box.innerHTML = html + '</div>';
    corpo.appendChild(box);
  }
  $('#dsr-cm').onclick = () => { pane.style.display = 'flex'; pintar(); };
  $('#cm-x').onclick = () => { pane.style.display = 'none'; };
  $('#cm-scan').onclick = pintar;
  $('#cm-add').onclick = () => {
    const n = $('#cm-nome').value.trim(), u = $('#cm-url').value.trim();
    if (!n || !u) { alert('preencha nome e endereco'); return; }
    CM.add(n, u); $('#cm-nome').value = ''; $('#cm-url').value = ''; pintar();
  };
  // o endereco do DsOS conectado alimenta o backend correspondente
  if (window.DsC && DsC.url()) {
    const l = CM.lista();
    const alvo = l.find(b => b.tipo === 'dsos' && !b.url);
    if (alvo) CM.setUrl(alvo.id, DsC.url());
  }
  /* ---------- HUD configuravel ---------- */
  const hud = $('#hud');
  const CH = 'dsos_hud';
  function carregar() {
    return (window.LS ? LS.get(CH, null) : null) ||
      [{ k: 'Up', r: '\u25B2' }, { k: 'Left', r: '\u25C0' }, { k: 'Right', r: '\u25B6' },
       { k: 'Down', r: '\u25BC' }, { k: 'Return', r: 'OK' }, { k: 'Escape', r: 'ESC' },
       { k: 'Tab', r: 'TAB' }, { k: 'super', r: 'MENU' }, { k: 'BackSpace', r: '\u232B' }];
  }
  function salvar(l) { if (window.LS) LS.set(CH, l); }
  function montarHud() {
    const l = carregar();
    const dpad = hud.querySelector('.hud-dpad'), btns = hud.querySelector('.hud-btns');
    const dir = ['Up', 'Left', 'Right', 'Down'];
    btns.innerHTML = '';
    l.filter(x => dir.indexOf(x.k) < 0).forEach(x => {
      const b = document.createElement('button');
      b.textContent = x.r; b.dataset.k = x.k;
      b.onclick = e => { e.preventDefault(); if (window.DsC) DsC.tecla(x.k); };
      btns.appendChild(b);
    });
    dpad.querySelectorAll('button').forEach(b => {
      b.onclick = e => { e.preventDefault(); if (window.DsC) DsC.tecla(b.dataset.k); };
    });
  }
  montarHud();
  /* ---------- conjuntos prontos: Roblox Studio, Blender, desktop ---------- */
  const selPreset = $('#hud-preset');
  if (selPreset && window.HUD) {
    HUD.montarSelect(selPreset);
    selPreset.onchange = () => {
      const n = selPreset.value;
      if (!n) return;
      HUD.aplicar(n);
      montarHud();
      const d = HUD.presets[n].dica;
      if (d) $('#dsr-msg').textContent = d;
    };
  }
  const hudMouse = $('#hud-mouse'), hudTela = $('#hud-tela'), hudX = $('#hud-x');
  function pintaHudMouse() { if (hudMouse) hudMouse.textContent = (window.DsC && DsC.cursor.modo === 'mouse') ? 'Mouse ✓' : 'Mouse'; }
  if (hudMouse) hudMouse.onclick = e => {
    e.preventDefault();
    DsC.setCursorModo(DsC.cursor.modo === 'mouse' ? 'toque' : 'mouse');
    pintaHudMouse();
  };
  if (hudTela) hudTela.onclick = async e => { e.preventDefault(); const r = await DsC.telaCheia(); if (!r.ok) alert(r.erro); };
  if (hudX) hudX.onclick = e => { e.preventDefault(); hud.style.display = 'none'; };
  pintaHudMouse();
  let editor = null;
  $('#dsr-hudcfg').onclick = function () {
    if (editor) { editor.remove(); editor = null; return; }
    editor = document.createElement('div');
    editor.className = 'hud-edit';
    editor.innerHTML = '<input id="he-r" placeholder="rotulo (ex: F5)">' +
      '<input id="he-k" placeholder="tecla (ex: F5, ctrl+s)">' +
      '<button class="mini" id="he-add">adicionar</button>' +
      '<span id="he-l" style="display:flex;gap:5px;flex-wrap:wrap"></span>';
    $('#dsr-tela').appendChild(editor);
    const lista = editor.querySelector('#he-l');
    function pintaL() {
      lista.innerHTML = '';
      carregar().forEach((x, i) => {
        const c = document.createElement('span');
        c.className = 'hud-chip';
        c.innerHTML = '<span></span><button>&times;</button>';
        c.querySelector('span').textContent = x.r + ' = ' + x.k;
        c.querySelector('button').onclick = () => {
          const l = carregar(); l.splice(i, 1); salvar(l); montarHud(); pintaL();
        };
        lista.appendChild(c);
      });
    }
    pintaL();
    editor.querySelector('#he-add').onclick = () => {
      const r = editor.querySelector('#he-r').value.trim();
      const k = editor.querySelector('#he-k').value.trim();
      if (!r || !k) { alert('preencha rotulo e tecla'); return; }
      if (!/^[A-Za-z0-9+_-]+$/.test(k)) { alert('tecla invalida. Use letras, numeros e +'); return; }
      const l = carregar(); l.push({ k, r }); salvar(l); montarHud(); pintaL();
      editor.querySelector('#he-r').value = ''; editor.querySelector('#he-k').value = '';
    };
  };
  /* ---------- pinch e dois dedos na tela remota ---------- */
  const img = $('#dsr-img');
  if (img && window.DsC && !img._gestos) {
    img._gestos = true;
    let d0 = 0, cx = 0, cy = 0;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    img.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        d0 = dist(e.touches);
        cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: true });
    img.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && d0) {
        const d1 = dist(e.touches);
        if (Math.abs(d1 - d0) > 40) {
          const p = DsC.coord(img, cx, cy);
          if (p) DsC.enviar({ t: 'pinch', x: p.x, y: p.y, escala: d1 > d0 ? 1.2 : 0.8, n: 2 });
          d0 = d1;
        }
        e.preventDefault();
      }
    }, { passive: false });
    img.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }
  /* ---------- gamepad fisico (item 6) ---------- */
  if (navigator.getGamepads) {
    const MAPA = ['Return', 'Escape', 'Tab', 'space', 'Up', 'Down', 'Left', 'Right'];
    let ant = [];
    setInterval(() => {
      const gp = navigator.getGamepads()[0];
      if (!gp || !window.DsC || !DsC.stream.rodando) return;
      gp.buttons.forEach((b, i) => {
        if (b.pressed && !ant[i] && MAPA[i]) DsC.enviar({ t: 'gamepad', tecla: MAPA[i] });
        ant[i] = b.pressed;
      });
      const ex = gp.axes[0] || 0, ey = gp.axes[1] || 0;
      if (Math.abs(ex) > 0.3 || Math.abs(ey) > 0.3)
        DsC.enviar({ t: 'trackpad', dx: Math.round(ex * 14), dy: Math.round(ey * 14) });
    }, 120);
  }
})();
