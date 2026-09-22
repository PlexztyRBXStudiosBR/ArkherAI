/* ============================================================
   SKILLS — capacidades compartilhadas.
   Qualquer LLM da cascata ganha as MESMAS habilidades extras:
   web, VM, piloto, 3D, imagem. Nao transforma um modelo no
   outro: da ferramentas a todos. O LLM decide QUANDO usar;
   o executor faz o trabalho.
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { const c = require('./core.js'); globalThis.LS = c.LS; globalThis._err = c._err; }

/* catalogo de habilidades. TODA skill tem `args` (o prompt e montado a partir deles). */
const SKILLS = {
  buscar_web: {
    nome: 'Pesquisar na internet',
    desc: 'Busca na web (DuckDuckGo) e le as primeiras paginas. Use para fatos atuais, noticias, precos, documentacao.',
    args: { q: 'o que pesquisar' },
    engines: [{ via: 'web', id: 'duckduckgo' }],
  },
  abrir_url: {
    nome: 'Abrir pagina',
    desc: 'Le o conteudo (texto) de uma URL especifica.',
    args: { url: 'endereco completo' },
    engines: [{ via: 'web', id: 'fetch' }],
  },
  rodar_vm: {
    nome: 'Comando na VM Windows',
    desc: 'Executa um comando PowerShell no Windows da VM e devolve a saida.',
    args: { cmd: 'o comando PowerShell' },
    engines: [{ via: 'vm', id: 'exec' }],
  },
  rodar_bash: {
    nome: 'Bash (Kaggle/Linux)',
    desc: 'Executa bash no no Linux com GPU (Kaggle). Se nao houver Kaggle, tenta o no Android.',
    args: { cmd: 'o comando bash' },
    engines: [{ via: 'kaggle', id: 'bash' }],
  },
  pilotar: {
    nome: 'Pilotar a VM',
    desc: 'Ve a tela da VM e opera mouse/teclado sozinho ate cumprir um objetivo. Ex: abrir o Roblox Studio e criar um baseplate.',
    args: { objetivo: 'o que fazer na tela', passos: '(opcional) maximo de passos' },
    engines: [{ via: 'pilot', id: 'loop' }],
  },
  buscar_modelo: {
    nome: 'Melhor modelo do Hub',
    desc: 'Procura no Hugging Face Hub os modelos mais usados para uma tarefa.',
    args: { tarefa: 'text-to-3d, image-to-3d, text-to-image, text-to-speech...' },
    engines: [{ via: 'hub', id: 'search' }],
  },
  lembrar: {
    nome: 'Consultar memória',
    desc: 'Procura no armazenamento neural do ARKHER (conhecimento de game dev, documentações que já foram '
      + 'estudadas e lições de conversas antigas). Use ANTES de responder sobre Roblox/Unity/Unreal/Godot/'
      + 'Blender/Figma/API, e também pra lembrar o que o usuário já disse.',
    args: { pergunta: 'o que procurar na memória' },
  },
  estudar: {
    nome: 'Estudar documentação',
    desc: 'Baixa uma URL (ou guarda um texto) e indexa no armazenamento neural pra usar depois. '
      + 'Use quando o assunto for novo e não estiver na memória: primeiro ache a URL certa na web, depois estude.',
    args: { url: 'endereço da documentação', texto: '(alternativa) texto puro' },
  },
  rodar_gpu: {
    nome: 'Rodar modelo no nó com GPU',
    desc: 'Roda um modelo de ponta do Hugging Face no nó que tem GPU (Kaggle/PC): textura e concept '
      + '(imagem), profundidade, tirar fundo, upscale x4, audio→texto. É o que dá qualidade de produção '
      + 'sem pagar API.',
    args: { tarefa: 'imagem | depth | fundo | upscale | asr', prompt: 'descrição (imagem)', imagem: 'caminho da imagem no nó, se for o caso', modelo: '(opcional) id do modelo' },
  },
  treinar_ia: {
    nome: 'Treinar modelo (LoRA)',
    desc: 'Pega as lições guardadas no cérebro, exporta o dataset e manda treinar um LoRA no nó com GPU. '
      + 'Depois o modelo treinado atende no chat. Treino demora minutos — avise o usuário e acompanhe pela aba Cérebro.',
    args: { nome: 'nome do modelo treinado', base: '(opcional) id do modelo base', passos: '(opcional) passos de treino' },
  },
  info_no: {
    nome: 'Informações do nó',
    desc: 'Descobre em qual máquina a tarefa vai rodar, o IP do Tailscale, o usuário e a porta do RDP '
      + '(Windows) e se o RDP está ligado. Use quando o usuário perguntar como entrar na tela ou onde rodar algo.',
    args: {},
  },
  gerar_3d: {
    nome: 'Gerar 3D',
    desc: 'Cria um modelo 3D (.glb) de verdade a partir de texto (ex: "uma espada de gelo"). '
      + 'Roda no no conectado: Kaggle/PC com GPU fica rapido (TripoSR/Shap-E); sem GPU o Shap-E '
      + 'roda na CPU, devagar. Devolve o arquivo pra baixar e um print do modelo.',
    args: { prompt: 'descricao do objeto', engine: '(opcional) auto, triposr, shape, procedural' },
    engines: [{ via: 'vm', id: 'gerar3d' }, { via: 'kaggle', id: 'gerar3d' }],
  },
  gerar_imagem: {
    nome: 'Gerar imagem',
    desc: 'Gera uma imagem a partir de texto.',
    args: { prompt: 'descricao da imagem' },
    engines: [{ via: 'puter', id: 'txt2img' }],
  },
  render_blender: {
    nome: 'Render no Blender',
    desc: 'Renderiza um arquivo .blend na VM (em background).',
    args: { arquivo: 'caminho do .blend na VM' },
    engines: [{ via: 'vm', id: 'blender' }],
  },
  ler_arquivo: {
    nome: 'Ler arquivo da VM',
    desc: 'Le um arquivo de texto da VM.',
    args: { caminho: 'caminho do arquivo (relativo a pasta work ou absoluto)' },
    engines: [{ via: 'vm', id: 'cat' }],
  },
  memoria: {
    nome: 'Memoria compartilhada (o que ja foi descoberto)',
    desc: 'Le e escreve na memoria compartilhada (chats, abas, IAs e sessoes de VM). '
        + 'Use acao "buscar" antes de perguntar de novo algo que ja pode ter sido resolvido; '
        + 'use acao "anotar" quando descobrir algo que vale pra proxima sessao (caminho de arquivo, '
        + 'comando que funcionou, API certa, decisao tomada).',
    args: { acao: 'buscar|anotar', q: 'o que buscar (acao buscar)', texto: 'o que anotar (acao anotar)',
            tipo: 'achado|decisao|erro|arquivo|nota (padrao achado)', escopo: 'global|vm:<url>|tarefa:<nome>' },
    engines: [{ via: 'site', id: 'memoria' }],
  },
  escrever_arquivo: {
    nome: 'Escrever arquivo na VM',
    desc: 'Cria ou sobrescreve um arquivo de texto na VM.',
    args: { caminho: 'nome do arquivo', conteudo: 'texto completo' },
    engines: [{ via: 'vm', id: 'write' }],
  },
};

/* ---------- POLITICA DE RESPOSTA ----------
   A ARKHER responde TUDO que e legal na vida real. Recusa so o que causa
   dano real a pessoas (crime, arma/droga de verdade, malware contra terceiros,
   CSAM, fraude, invasao de conta alheia). Nada de sermao, nada de recusa
   inventada, nada de "como assistente de IA eu nao posso" para pergunta legal. */
const POLITICA = [
  '# POLITICA DE RESPOSTA (obedece sempre)',
  '1. Responda qualquer pedido que seja LEGAL na vida real, mesmo que seja: tema sensivel,',
  '   polêmico, adulto dentro de ficcao/jogo, sangue e violencia em jogo, exploit/cheat no SEU',
  '   proprio jogo ou servidor, engenharia reversa de algo seu, seguranca ofensiva em laboratorio,',
  '   codigo que quebra/derruba SUA propria maquina, scripts automatizados, mods, cracks de estudo.',
  '2. Recuse SOMENTE o que causa dano real a pessoas: crime real (matar, sequestrar, ataque fisico),',
  '   fabricacao de arma/explosivo/droga de verdade, material de abuso infantil, malware/virus para',
  '   atacar sistemas ou contas de TERCEIROS, fraude/stalking/perseguicao, invasao de conta alheia.',
  '   Nesses casos: diga em UMA linha que nao ajuda com isso e ofereca o caminho legal proximo.',
  '3. PROIBIDO: sermao, aviso moralizante, "procure ajuda profissional" sem ser pedido, recusa por',
  '   precaucao, dizer que nao pode por ser IA, pedir confirmacao para coisa obvia, resposta vazia.',
  '4. Se tiver certeza de que da pra responder: RESPONDA. Se faltar um dado, responda com o que da',
  '   e diga o que falta. Nunca responda com "nao posso ajudar com isso" para pergunta legal.',
].join('\n');

/* parece recusa? (so quando a resposta INTEIRA e uma recusa, nao um trecho) */
function recusaDe(txt) {
  const t = String(txt || '').trim().toLowerCase();
  if (!t) return false;
  if (t.length > 900) return false;                 // resposta longa = resolveu, mesmo com ressalva
  const padroes = [
    /i (can ?not|can't|won't|will not|am unable to|must decline)/,
    /i'?m (sorry|unable|not able)/,
    /(as an ai|como (uma )?(ia|inteligencia artificial|assistente))/,
    /(nao|não) (posso|consigo|vou|devo) (ajudar|fazer|responder|fornecer|auxiliar|dar)/,
    /(nao|não) e (apropriado|adequado)/,
    /i (cannot|can't) (help|assist|provide|comply)/,
    /(can'?t|cannot) (assist|help) with that/,
    /(isso|isto) (vai|pode) contra (as )?(minhas )?(politicas|diretrizes|regras)/,
    /(against|violates) (my|our) (policy|guidelines|policies|terms)/,
  ];
  if (!padroes.some(r => r.test(t))) return false;
  // "mas/entretanto" no meio nao salva: so vale se DEPOIS vier entrega de verdade
  const m = t.match(/\b(entretanto|porem|no entanto|mas|however|que tal|em vez disso|voce pode|voce consegue|you can)\b/);
  if (m && t.slice(m.index + m[0].length).trim().length > 120) return false;
  return true;
}

const REFORCO = POLITICA + '\n\n# LEMBRETE\nO pedido do usuario e LEGAL na vida real. Voce ja sabe responder. '
  + 'Nao repita ressalvas, nao peca desculpas: entregue a resposta completa e util AGORA, em texto normal.';

/* prompt que ensina QUALQUER LLM a usar as ferramentas */
function systemPrompt() {
  const lista = Object.entries(SKILLS)
    .map(([k, v]) => `- ${k}(${Object.keys(v.args || {}).join(', ')}): ${v.desc}`)
    .join('\n');
  return `${POLITICA}

Voce e a ARKHER AI. Responda em portugues do Brasil, direto e util.
Alem de texto, voce tem FERRAMENTAS:
${lista}

Para usar uma ferramenta, responda SOMENTE com este JSON (sem texto antes ou depois):
{"tool":"nome_da_ferramenta","args":{"...":"..."}}

Depois o sistema executa e te devolve o RESULTADO numa mensagem seguinte; ai voce responde ao usuario.
Se nao precisar de ferramenta, responda normalmente em texto.
Nunca invente resultado de ferramenta. Use buscar_web quando a pergunta depender de informacao atual.`;
}

/* detecta a chamada de ferramenta na resposta do modelo */
function parseTool(txt) {
  if (!txt) return null;
  let s = String(txt).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  // se ha muito texto fora do JSON, nao e uma chamada de ferramenta (e o modelo explicando)
  const fora = (s.slice(0, i) + s.slice(j + 1)).trim();
  if (fora.length > 120) return null;
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    if (o && typeof o.tool === 'string' && SKILLS[o.tool]) {
      return { tool: o.tool, args: (o.args && typeof o.args === 'object') ? o.args : {} };
    }
  } catch (e) {}
  return null;
}

/* ---------- executores ---------- */
/* _err vem do core.js. NAO redeclare aqui: um segundo `const _err` no escopo
   global derruba o app.js inteiro com SyntaxError. */

const Exec = {
  agent() { return LS.get('arkher_agent', ''); },

  async _post(base, rota, body, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 120000);
    try {
      const r = await fetch(base.replace(/\/+$/, '') + rota, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      });
      return await r.json();
    } catch (e) {
      throw new Error((typeof window !== 'undefined' && window.explicarFetch) ? window.explicarFetch(e, base) : (e.message || String(e)));
    } finally { clearTimeout(t); }
  },

  async vm(cmd, timeout) {
    const u = this.agent();
    if (!u) throw new Error('VM nao configurada (aba Config > URL do agente)');
    return this._post(u, '/exec', { cmd, timeout: timeout || 600 }, ((timeout || 600) + 15) * 1000);
  },

  async vmJob(cmd) {
    const u = this.agent();
    if (!u) throw new Error('VM nao configurada (aba Config > URL do agente)');
    const j = await this._post(u, '/spawn', { cmd }, 20000);
    if (!j.ok) throw new Error(j.err || 'spawn falhou');
    return j.id;
  },

  /* ---------------- 3D ----------------
     O agente (Windows, Kaggle ou PC) expoe /gerar3d. Aqui a gente escolhe
     QUAL no usa (GPU primeiro) e acompanha o job linha por linha. */

  /** todos os nos possiveis, com o que cada um tem de motor 3D */
  async nos3D() {
    const nos = [];
    const cands = [['VM Windows', LS.get('arkher_agent', '')],
                   ['Kaggle (GPU)', LS.get('arkher_kaggle', '')],
                   ['Android', LS.get('arkher_droid', '')]];
    for (const [nome, url] of cands) {
      if (!url) continue;
      try {
        const cap = await this._get(url, '/gerar3d');
        nos.push({ nome, url: url.replace(/\/+$/, ''), ok: !!cap.ok,
                   gpu: cap.gpu || '', cuda: !!cap.cuda, vram: cap.vram_gb || 0,
                   motores: cap.motores || {}, erro: cap.err || '' });
      } catch (e) {
        nos.push({ nome, url: url.replace(/\/+$/, ''), ok: false, erro: _err(e) });
      }
    }
    const prontos = n => Object.values(n.motores || {}).filter(m => m.pronto).length;
    nos.sort((a, b) => (prontos(b) - prontos(a)) || ((b.cuda ? 1 : 0) - (a.cuda ? 1 : 0)));
    return nos;
  },

  async _get(base, rota, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 30000);
    try {
      const r = await fetch(base.replace(/\/+$/, '') + rota, { signal: ctl.signal });
      return await r.json();
    } finally { clearTimeout(t); }
  },

  /** URL absoluta pra abrir/baixar arquivo que esta no no */
  arquivo3D(base, caminho, download) {
    return base.replace(/\/+$/, '') + '/file?path=' + encodeURIComponent(caminho)
      + (download ? '&dl=1' : '');
  },

  /**
   * Gera 3D. Escolhe o no, dispara o job e acompanha (2s) ate acabar.
   * onLog(texto) recebe o progresso; devolve {ok, out, glb, img, motor,...}
   */
  async gerar3D(args, onLog) {
    const log = onLog || (() => {});
    const nos = await this.nos3D();
    if (!nos.length) throw new Error('nenhum no conectado (aba Config/VM: URL do agente, Kaggle ou Android)');
    const engine = (args.engine || args.motor || 'auto');
    // com engine fixo, procura um no que ja tenha ele pronto
    let no = null;
    if (engine !== 'auto') {
      no = nos.find(n => (n.motores[engine] || {}).pronto) || nos[0];
    } else {
      no = nos.find(n => Object.values(n.motores || {}).some(m => m.pronto)) || nos[0];
    }
    log('no: ' + no.nome + (no.cuda ? ' (CUDA ' + (no.gpu || '') + ')' : no.gpu ? ' (' + no.gpu + ')' : ''));
    const pronto = Object.values(no.motores || {}).filter(m => m.pronto).map(m => m.id);
    log('motores prontos nesse no: ' + (pronto.join(', ') || 'nenhum ainda'));

    const corpo = { prompt: args.prompt || args.descricao || '', engine: engine };
    if (args.imagem_b64) corpo.imagem_b64 = args.imagem_b64;
    if (args.seed !== undefined) corpo.seed = args.seed;
    if (args.passos !== undefined) corpo.passos = args.passos;
    if (args.grade !== undefined) corpo.grade = args.grade;
    const j = await this._post(no.url, '/gerar3d', corpo, 60000);
    if (!j.ok) throw new Error(j.err || 'o no recusou o pedido de 3D');
    if (j.aviso) log('aviso: ' + j.aviso);
    log('job ' + j.id + ' rodando…');

    const t0 = Date.now();
    let visto = 0;
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      let st;
      try {
        st = await this._get(no.url, '/gerar3d?job=' + j.id, 20000);
      } catch (e) {
        if (Date.now() - t0 > 20 * 60000) throw new Error('o no parou de responder (' + _err(e) + ')');
        continue;
      }
      const linhas = st.linhas || [];
      if (linhas.length > visto) {
        linhas.slice(visto).forEach(l => { if (l) log(l); });
        visto = linhas.length;
      }
      if (st.estado === 'rodando') { if (Date.now() - t0 > 60 * 60000) throw new Error('passou de 1h gerando'); continue; }
      if (st.estado === 'pronto') {
        const m = st.meta || {};
        const glb = this.arquivo3D(no.url, m.glb, true);
        const img = m.preview ? this.arquivo3D(no.url, m.preview, false) : '';
        const txt = (m.motor_nome || m.motor) + ' · ' + m.faces + ' triângulos · ' + m.segundos + 's'
          + (m.aviso ? '\n' + m.aviso : '') + (m.avisos && m.avisos.length ? '\n' + m.avisos.join('\n') : '');
        return { ok: true, out: txt + '\nmodelo: ' + glb, glb, img, motor: m.motor,
                 motor_nome: m.motor_nome, faces: m.faces, segundos: m.segundos,
                 qualidade: m.qualidade, verificado: m.verificado, no: no.nome,
                 caminho: m.glb, aviso: m.aviso || '' };
      }
      throw new Error(st.erro || 'a geracao 3D falhou');
    }
  },

  /**
   * Tarefa pesada de IA no no com GPU (hf_hub.py): imagem/textura, embed,
   * audio->texto, profundidade, fundo, upscale. Mesmo padrao do 3D: dispara
   * job e acompanha. Nao inventa: se faltar lib, o no diz o comando do pip.
   */
  async infer(args, onLog) {
    const log = onLog || (() => {});
    const cands = [LS.get('arkher_kaggle', ''), LS.get('arkher_agent', ''), LS.get('arkher_droid', '')]
      .map(u => (u || '').replace(/\/+$/, '')).filter(Boolean);
    if (!cands.length) throw new Error('nenhum no conectado (aba VM: URL do agente/Kaggle)');
    let ultimo = null;
    for (const base of cands) {
      try {
        let cat = null;
        try { cat = await this._get(base, '/infer', 20000); } catch (e) { ultimo = e; continue; }
        if (!cat || !cat.ok) { ultimo = new Error((cat && cat.err) || 'no sem hf_hub.py'); continue; }
        const amb = cat.ambiente || {};
        const gpu = (amb.gpu || {});
        log('no: ' + base.split('//').pop() + (gpu.gpu ? ' (' + gpu.gpu + ' ' + gpu.vram_gb + 'GB)' : ' (sem GPU)'));
        const cap = (cat.tarefas || {})[args.tarefa] || {};
        if (!cap.pronto) {
          log('aviso: falta ' + (cap.falta || []).join(', ') + ' — ' + (cap.dica || ''));
          ultimo = new Error('falta ' + (cap.falta || []).join(', ') + ' neste no. ' + (cap.dica || ''));
          continue;
        }
        const modelo = (args.modelo || '').replace(/^gpu:/, '');
        const j = await this._post(base, '/infer', Object.assign({}, args, modelo ? { modelo } : {}), 60000);
        if (!j.ok) { ultimo = new Error(j.err || 'o no recusou'); continue; }
        log('job ' + j.id + ' na fila do no…');
        const t0 = Date.now();
        let visto = 0;
        for (;;) {
          await new Promise(r => setTimeout(r, 2000));
          if (Date.now() - t0 > 30 * 60000) throw new Error('passou de 30 min nessa tarefa');
          let st;
          try { st = await this._get(base, '/infer?job=' + j.id, 20000); } catch (e) { continue; }
          (st.linhas || []).slice(visto).forEach(l => l && log(l));
          visto = (st.linhas || []).length;
          if (st.estado === 'rodando') continue;
          if (st.estado === 'pronto') {
            const m = st.meta || {};
            const partes = [];
            if (m.arquivo) partes.push('arquivo: ' + this.arquivo3D(base, m.arquivo, true));
            if (m.texto) partes.push(m.texto);
            if (m.quantos) partes.push('(' + m.quantos + ' vetores de ' + m.dim + ' dims)');
            return Object.assign({ ok: true, no: base.split('//').pop(), motor: m.modelo, arquivo_url: m.arquivo ? this.arquivo3D(base, m.arquivo, true) : '' }, m, { out: partes.join('\n') });
          }
          throw new Error((st.erro || 'falhou') + (st.como_resolver ? ' — ' + st.como_resolver : ''));
        }
      } catch (e) { ultimo = e; }
    }
    throw ultimo || new Error('nenhum no conseguiu rodar essa tarefa');
  },

  /** instala um motor 3D no no (pip/git) e acompanha */
  async instalar3D(motor, noAlvo, onLog) {
    const log = onLog || (() => {});
    const nos = await this.nos3D();
    const no = nos.find(n => n.nome === noAlvo) || nos[0];
    if (!no) throw new Error('nenhum no conectado');
    const j = await this._post(no.url, '/gerar3d/instalar', { engine: motor }, 30000);
    if (!j.ok) throw new Error(j.err || 'falhou');
    log('instalando ' + motor + ' em ' + no.nome + ' (job ' + j.id + ')…');
    let visto = 0;
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      const st = await this._get(no.url, '/job?id=' + j.id, 20000);
      const l = st.lines || [];
      if (l.length > visto) { l.slice(visto).forEach(x => log(x)); visto = l.length; }
      if (st.done) {
        const cap = await this._get(no.url, '/gerar3d', 30000);
        const m = (cap.motores || {})[motor] || {};
        return { ok: !!m.pronto, out: m.pronto ? motor + ' pronto em ' + no.nome
                 : motor + ' ainda incompleto. Falta: ' + ((m.faltando || []).join(', ') || '?'),
                 faltando: m.faltando || [] };
      }
    }
  },

  /** melhor modelo do Hub para uma tarefa, hoje */
  async melhorModelo(tarefa) {
    const url = `https://huggingface.co/api/models?pipeline_tag=${encodeURIComponent(tarefa)}`
      + `&limit=20&sort=downloads&direction=-1`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Hub HTTP ' + r.status);
    const arr = await r.json();
    return arr.map(m => ({ id: m.id, downloads: m.downloads || 0, likes: m.likes || 0 }));
  },
};

function saidaVm(r) {
  if (!r || typeof r !== 'object') return String(r || '');
  let s = (r.out || '');
  if (r.err) s += (s ? '\n' : '') + r.err;
  return s.trim() || (r.code === 0 ? '(sem saida, codigo 0)' : '(sem saida, codigo ' + r.code + ')');
}

/* executa a ferramenta pedida pelo LLM. Sempre devolve {ok, out|err, ...} */
async function runTool(call, onLog) {
  const r = await _runTool(call, onLog);
  // MEMORIA COMPARTILHADA: toda ferramenta deixa rastro (o que rodou, onde deu certo, o que quebrou)
  try { if (typeof Memoria !== 'undefined' && Memoria.captura) Memoria.captura(call, r); } catch (e) {}
  return r;
}

async function _runTool(call, onLog) {
  const log = onLog || (() => {});
  const { tool } = call;
  const args = call.args || {};
  const W = (typeof window !== 'undefined') ? window : globalThis;
  try {
    /* ---- game dev: o cerebro mora em arkher_gamedev.js ----
       O loop verificado (gerar -> rodar -> ler o erro -> consertar) e as
       leituras de log por motor vivem la; aqui so entra o despacho. */
    if (/^gd_/.test(tool) && W.GD && W.GD.ferramenta) {
      const r = await W.GD.ferramenta(tool, args, log);
      if (r) return r;
    }
    switch (tool) {
      case 'memoria': {
        if (!W.Memoria) return { ok: false, err: 'memoria compartilhada indisponivel' };
        const acao = String(args.acao || 'buscar').toLowerCase();
        if (/anotar|guardar|escrever|salvar/.test(acao)) {
          const texto = String(args.texto || args.q || '').trim();
          if (!texto) return { ok: false, err: 'anotar o que?' };
          const r = W.Memoria.add({ tipo: (args.tipo || 'achado'), texto, escopo: (args.escopo || 'global'),
                                    de: 'ia', tags: (args.tags ? [].concat(args.tags) : []) });
          if (!r.ok) return { ok: false, err: r.err };
          return { ok: true, out: 'anotado na memoria compartilhada (' + (r.novo ? 'novo' : 'ja existia') + ')',
                   id: r.id };
        }
        const pergunta = String(args.q || args.texto || '').trim();
        const itens = pergunta && W.Memoria.buscar
          ? (await W.Memoria.buscar(pergunta, 12, { familia: args.familia || '' })).map(x => x.item)
          : W.Memoria.listar({ q: pergunta, k: 12, familia: (args.familia || '') });
        const todas = W.Memoria.stats();
        if (!itens.length) {
          const ts = Object.keys(todas.porTipo).map(t => t).join(', ') || 'nada';
          return { ok: true, out: 'nada na memoria sobre isso. o que ja tem: ' + todas.total + ' itens (' + ts + ')'
            + '\nde quantos escopos: ' + JSON.stringify(todas.porEscopo) };
        }
        return { ok: true, out: itens.map(x => '[' + x.tipo + ' · ' + x.escopo + '] ' + x.texto).join('\n'),
                 itens: itens.length, total: todas.total };
      }
      case 'buscar_web': {
        if (!W.Web) return { ok: false, err: 'busca indisponivel' };
        const q = args.q || args.query || args.texto || args.pergunta || '';
        if (!q) return { ok: false, err: 'faltou o que pesquisar' };
        const r = await W.Web.pesquisar(q, log);
        return { ok: true, out: r.texto, fontes: r.resultados.map(x => x.url) };
      }
      case 'abrir_url': {
        if (!W.Web) return { ok: false, err: 'busca indisponivel' };
        if (!args.url) return { ok: false, err: 'faltou a url' };
        log('lendo ' + args.url);
        return { ok: true, out: await W.Web.abrir(args.url) };
      }
      case 'rodar_vm': {
        const cmd = args.cmd || args.comando || args.script || '';
        if (!cmd) return { ok: false, err: 'faltou o comando' };
        log('executando na VM: ' + cmd);
        const r = await Exec.vm(cmd);
        return { ok: r.code === 0, out: saidaVm(r), code: r.code };
      }
      case 'rodar_bash': {
        const cmd = args.cmd || args.comando || args.script || '';
        if (!cmd) return { ok: false, err: 'faltou o comando' };
        if (W.Kaggle && W.Kaggle.url()) { log('bash no Kaggle: ' + cmd); return { ok: true, out: await W.Kaggle.exec(cmd) }; }
        const droid = LS.get('arkher_droid', '');
        if (droid) { log('bash no Android: ' + cmd); const r = await Exec._post(droid, '/exec', { cmd, timeout: 600 }); return { ok: r.code === 0, out: saidaVm(r) }; }
        return { ok: false, err: 'nenhum no Linux configurado (Kaggle ou Android, aba VM)' };
      }
      case 'pilotar': {
        if (!W.Pilot) return { ok: false, err: 'piloto indisponivel' };
        const obj = args.objetivo || args.q || args.tarefa || '';
        if (!obj) return { ok: false, err: 'faltou o objetivo' };
        const rr = await W.Pilot.correr(obj, ev => {
          if (ev.tipo === 'pensa' || ev.tipo === 'fim' || ev.tipo === 'erro') log('piloto: ' + ev.txt);
        }, { passos: parseInt(args.passos, 10) || 15 });
        return { ok: !!rr.ok, out: rr.resumo || rr.motivo || 'terminou' };
      }
      case 'buscar_modelo': {
        const t = args.tarefa || 'text-to-3d';
        log('procurando no Hub: ' + t);
        const l = await Exec.melhorModelo(t);
        return { ok: true, out: l.slice(0, 8).map((m, i) => `${i + 1}. ${m.id} (${m.downloads} downloads)`).join('\n'), modelos: l.slice(0, 8) };
      }
      case 'lembrar': {
        if (!W.Neural) return { ok: false, err: 'memoria neural indisponivel' };
        const q = args.pergunta || args.q || args.texto || '';
        if (!q) return { ok: false, err: 'faltou o que procurar' };
        if (!W.Neural.pronto) await W.Neural.init(log);
        const achados = await W.Neural.buscar(q, 6);
        if (!achados.length) return { ok: true, out: '(nada guardado sobre isso)' };
        return {
          ok: true,
          out: achados.map(r => '[' + (r.item.tags || r.item.fonte || r.item.src) + ' · ' + r.sc.toFixed(2) + ']\n' + r.item.txt.slice(0, 900)).join('\n\n'),
          fontes: achados.map(r => r.item.fonte).filter(Boolean),
        };
      }
      case 'estudar': {
        if (!W.Neural) return { ok: false, err: 'memoria neural indisponivel' };
        if (args.url) {
          log('estudando ' + args.url);
          const r = await W.Neural.estudar(args.url, log);
          return { ok: true, out: 'guardei ' + r.pedacos + ' pedaços de ' + r.chars + ' chars de ' + r.url, url: r.url };
        }
        const txt = args.texto || args.conteudo || '';
        if (!txt) return { ok: false, err: 'manda url ou texto' };
        const n = await W.Neural.add(txt, { src: 'manual', tags: args.titulo || 'texto do chat' }, log);
        return { ok: true, out: n + ' pedaços guardados na memória' };
      }
      case 'rodar_gpu': {
        const t = (args.tarefa || args.t || 'imagem').toLowerCase();
        const conv = { 'textura': 'imagem', 'conceito': 'imagem', 'sprite': 'imagem', 'profundidade': 'depth',
                       'remover_fundo': 'fundo', 'audio': 'asr', 'transcrever': 'asr', 'aumentar': 'upscale' };
        const tarefa = conv[t] || t;
        if (tarefa === 'chat' || tarefa === 'embed') return { ok: false, err: 'pra chat use a conversa normal; pra memória o cérebro faz sozinho' };
        const pedido = { tarefa };
        if (args.prompt || args.descricao) pedido.prompt = args.prompt || args.descricao;
        if (args.imagem) pedido.imagem = args.imagem;
        if (args.modelo) pedido.modelo = args.modelo;
        if (args.passos) pedido.passos = args.passos;
        if (args.w) pedido.w = args.w;
        if (args.h) pedido.h = args.h;
        log('tarefa ' + tarefa + (pedido.prompt ? ': ' + pedido.prompt : ''));
        const r = await Exec.infer(pedido, log);
        return { ok: true, out: r.out, img: r.arquivo_url || undefined, arquivo: r.arquivo_url, motor: r.motor, no: r.no, texto: r.texto };
      }
      case 'treinar_ia': {
        const base = LS.get('arkher_kaggle', '') || LS.get('arkher_agent', '');
        if (!base) return { ok: false, err: 'nenhum no com GPU configurado (aba VM)' };
        if (!W.Neural) return { ok: false, err: 'memoria neural indisponivel' };
        const jsonl = W.Neural.exportar();
        if (!jsonl) return { ok: false, err: 'dataset vazio: converse mais antes de treinar (as lições são gravadas sozinhas)' };
        const nome = (args.nome || 'arkher-' + Date.now().toString(36)).replace(/[^\w.-]/g, '-');
        log('mandando ' + jsonl.split('\n').length + ' exemplos pro no...');
        const j = await Exec._post(base.replace(/\/+$/, ''), '/treinar',
          { jsonl, nome, base: args.base || undefined, passos: args.passos ? parseInt(args.passos) : undefined }, 120000);
        if (!j.ok) return { ok: false, err: j.err || 'o no recusou o treino' };
        return { ok: true, out: 'treino começou: job ' + j.id + ' na ' + (j.gpu || 'GPU') + ' com ' + j.amostras +
          ' exemplos (base ' + j.base + '). Isso leva minutos — acompanhe em /infer?job=' + j.id +
          ' (ou na aba Cérebro). Quando terminar, o modelo "' + nome + '" aparece pra escolher no chat.',
          job: j.id, nome: nome, amostras: j.amostras };
      }
      case 'info_no': {
        const base = LS.get('arkher_kaggle', '') || LS.get('arkher_agent', '') || LS.get('arkher_droid', '');
        if (!base) return { ok: false, err: 'nenhum no configurado' };
        const n = await Exec._get(base.replace(/\/+$/, ''), '/node');
        if (!n.ok) return { ok: false, err: n.err || 'no nao respondeu' };
        const linhas = ['máquina: ' + (n.host || '?') + ' (' + n.os + ')',
          'IP Tailscale: ' + (n.tailscale_ip || '(não tem Tailscale nesse nó)') + ' · IP local: ' + (n.ip || '?'),
          'RDP: ' + ((n.rdp && n.rdp.ligado) ? 'ligado' : 'desligado/não é Windows') +
          ' · usuário ' + ((n.rdp && n.rdp.usuario) || '?') + ' · porta ' + ((n.rdp && n.rdp.porta) || 3389),
          'uptime: ' + Math.round((n.uptime_s || 0) / 60) + ' min · modelos de ponta: ' + ((n.hf && n.hf.catalogo) ? 'disponíveis' : 'sem hf_hub.py')];
        return { ok: true, out: linhas.join('\n'), node: n };
      }
      case 'gerar_3d': {
        const prompt = String(args.prompt || args.descricao || '').trim();
        if (!prompt) return { ok: false, err: 'faltou a descricao do objeto' };
        log('montando 3D: ' + prompt);
        const r = await Exec.gerar3D(args, log);
        return { ok: r.ok, out: r.out, img: r.img || undefined, glb: r.glb,
                 motor: r.motor, motor_nome: r.motor_nome, faces: r.faces,
                 segundos: r.segundos, no: r.no, arquivo: r.caminho, aviso: r.aviso };
      }
      case 'gerar_imagem': {
        if (!args.prompt) return { ok: false, err: 'faltou a descricao' };
        log('gerando imagem…');
        if (typeof puter !== 'undefined' && puter.ai && puter.ai.txt2img) {
          const img = await puter.ai.txt2img(args.prompt);
          const src = (img && img.src) || String(img);
          return { ok: true, out: 'imagem gerada', img: src };
        }
        return { ok: false, err: 'sem motor de imagem disponivel (entre no Puter)' };
      }
      case 'render_blender': {
        if (!args.arquivo) return { ok: false, err: 'faltou o arquivo .blend' };
        log('render no Blender da VM…');
        const id = await Exec.vmJob(`blender -b "${String(args.arquivo).replace(/"/g, '')}" -o //out_ -f 1`);
        return { ok: true, out: `render iniciado em background (job ${id}). Acompanhe na aba Sandbox.`, job: id };
      }
      case 'ler_arquivo': {
        const u = Exec.agent(); if (!u) return { ok: false, err: 'VM nao configurada' };
        const c = args.caminho || args.path || '';
        if (!c) return { ok: false, err: 'faltou o caminho' };
        const r = await (await fetch(u + '/cat?path=' + encodeURIComponent(c))).json();
        return r.ok ? { ok: true, out: r.text } : { ok: false, err: r.err };
      }
      case 'escrever_arquivo': {
        const u = Exec.agent(); if (!u) return { ok: false, err: 'VM nao configurada' };
        const c = args.caminho || args.path || '';
        if (!c) return { ok: false, err: 'faltou o caminho' };
        const r = await Exec._post(u, '/write', { path: c, content: String(args.conteudo ?? args.content ?? '') });
        return r.ok ? { ok: true, out: 'gravado em ' + r.path } : { ok: false, err: r.err };
      }
      default:
        return { ok: false, err: 'ferramenta desconhecida: ' + tool };
    }
  } catch (e) {
    return { ok: false, err: (typeof errText === 'function') ? errText(e) : (e.message || String(e)) };
  }
}

if (typeof window !== 'undefined') {
  window.SKILLS = SKILLS; window.systemPrompt = systemPrompt;
  window.POLITICA_ARKHER = POLITICA; window.recusaDe = recusaDe; window.REFORCO_ARKHER = REFORCO;
  window.parseTool = parseTool; window.runTool = runTool; window.Exec = Exec;
}
if (typeof module !== 'undefined') {
  module.exports = { SKILLS, systemPrompt, parseTool, runTool, Exec };
}
