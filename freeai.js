/* ============================================================
   FREEAI — a "via gratis" do ARKHER.

   Problema que isto resolve: o Puter tem cota/saldo (o famoso
   "low balance"). Quando o saldo acaba, o chat morre.

   Resposta: o ARKHER passa a ter DUAS rotas sem custo nenhum:

   1) A VIA GRATIS DO PROPRIO PUTER — modelos do catalogo que
      terminam em ":free" (os gratuitos do OpenRouter que o Puter
      revende). Esses NAO consomem saldo: funcionam com a conta
      zerada. Quem entra nessa via e o app.js (Puter.livre).
   2) ESTE ARQUIVO — chaves GRATIS que voce mesmo cria, cada uma
      com cota gratuita propria e diaria. Nenhuma cobra cartao:
        gemini      Google AI Studio   1.500 req/dia (e ve imagem)
        groq        Groq Cloud         1.000 req/dia, muito rapido
        cerebras    Cerebras Cloud     1M tokens/dia
        openrouter  OpenRouter         50 req/dia nos modelos ":free"
        mistral     Mistral La Plateforme  ~1B tokens/mes
        github      GitHub Models      150-1.000 req/dia (usa o seu PAT)
        nvidia      NVIDIA NIM         ~1.000 req/dia
        cloudflare  Workers AI         10.000 neurons/dia
        ollama      Ollama na sua maquina   ilimitado, offline
        lmstudio    LM Studio na sua maquina  ilimitado, offline

   Quanto mais chaves voce empilha (varias contas suas em cada
   provedor), maior vira o "armazem": quando uma chave esgota, o
   Free gira pra proxima sozinho — igual o Pool faz com o Puter.

   Tudo roda no navegador, nada de servidor. As chaves ficam no
   seu localStorage (e no Supabase, se o Sync estiver ligado).
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

const Free = {
  KEY: 'arkher_free_v1',

  /* ---------- catalogo de provedores ----------
     campo       o que e
     id          nome curto (vira prefixo de modelo: free:groq/…)
     url         base OpenAI-compativel; /chat/completions e /models
     site        onde pegar a chave
     lim         cota gratuita, em texto (so informativo na UI)
     visao       true = modelos que enxergam imagem
     dia         estimativa de pedidos gratuitos por dia (só pra dimensionar;
                 quem manda é a cota que cada provedor publica)
     local       true = roda na sua maquina (nao precisa de chave)
     chave       formato esperado da chave (dica)
     modelos     lista de emergencia: se /models falhar, usa esta
  */
  CAT: [
    {
      id: 'gemini', nome: 'Google AI Studio (Gemini)', gratis: '1.500 req/dia · sem cartão', dia: 1500,
      url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      site: 'https://aistudio.google.com/apikey', chave: 'começa com AIza…', visao: true,
      /* posto mais alto que existe de graca hoje: Gemini 3.x Pro/Flash é a
         linha de PONTA do Google — 1.500 req/dia no Flash e 50/dia no Pro.
         Os nomes mudam de tempos em tempos; a lista viva (/models) vem primeiro
         e esta aqui e só o plano B. */
      modelos: ['gemini-3.1-pro', 'gemini-3-flash', 'gemini-3.1-flash-lite',
                'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
      tirar: /embedding|aqa|imagen|veo|tts|native-audio|-image/i,
    },
    {
      id: 'groq', nome: 'Groq Cloud', gratis: '1.000 req/dia · mais rapido do mercado', dia: 1000,
      url: 'https://api.groq.com/openai/v1',
      site: 'https://console.groq.com/keys', chave: 'começa com gsk_…', visao: true,
      modelos: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b',
                'moonshotai/kimi-k2-instruct', 'llama-3.1-8b-instant'],
      tirar: /whisper|tts|guard|embed|distil/i,
    },
    {
      id: 'cerebras', nome: 'Cerebras Cloud', gratis: '1M tokens/dia · absurdamente rapido', dia: 1000,
      url: 'https://api.cerebras.ai/v1',
      site: 'https://cloud.cerebras.ai', chave: 'começa com csk-…',
      modelos: ['gpt-oss-120b', 'qwen-3-32b', 'llama-3.3-70b', 'llama3.1-8b'],
      tirar: /embed|whisper|tts/i,
    },
    {
      id: 'openrouter', nome: 'OpenRouter (modelos :free)', gratis: '50 req/dia grátis (1.000/dia com 1 compra)', dia: 50,
      url: 'https://openrouter.ai/api/v1',
      site: 'https://openrouter.ai/settings/keys', chave: 'começa com sk-or-…', visao: true,
      modelos: ['openrouter/free', 'deepseek/deepseek-r1:free', 'qwen/qwen3-coder:free',
                'meta-llama/llama-3.3-70b-instruct:free', 'mistralai/mistral-small-3.2-24b-instruct:free'],
      soFree: true,          // so aceita modelo terminado em :free (senao cobra)
      tirar: /:online|embed/i,
    },
    {
      id: 'mistral', nome: 'Mistral (La Plateforme)', gratis: '~1B tokens/mês no modo gratuito', dia: 300,
      url: 'https://api.mistral.ai/v1',
      site: 'https://console.mistral.ai/api-keys', chave: 'sem prefixo fixo', visao: true,
      modelos: ['mistral-small-latest', 'ministral-8b-latest', 'open-mistral-nemo', 'codestral-latest'],
      tirar: /embed|moderation|ocr/i,
    },
    {
      id: 'github', nome: 'GitHub Models', gratis: '150-1.000 req/dia · usa o seu token do GitHub', dia: 150,
      url: 'https://models.github.ai/inference',
      site: 'https://github.com/settings/tokens', chave: 'PAT do GitHub (github_pat_… ou ghp_…)',
      /* unica porta GRATUITA para modelos GPT-class por API (GPT-4.1, o3, Grok-3).
         Os limites sao apertados (10-15 RPM, 50-150 req/dia, 8K entrada / 4K saida)
         — mas e o mais perto de "ponta" que existe sem cartao. */
      modelos: ['openai/gpt-4.1', 'openai/o3', 'xai/grok-3', 'openai/gpt-4o',
                'meta/Llama-3.3-70B-Instruct', 'deepseek/DeepSeek-R1'],
      tirar: /embed|whisper/i,
    },
    {
      id: 'nvidia', nome: 'NVIDIA NIM', gratis: '~1.000 req/dia (build.nvidia.com)', dia: 1000,
      url: 'https://integrate.api.nvidia.com/v1',
      site: 'https://build.nvidia.com', chave: 'começa com nvapi-…',
      modelos: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.3-nemotron-super-49b-v1',
                'qwen/qwen2.5-coder-32b-instruct', 'deepseek-ai/deepseek-r1'],
      tirar: /embed|vision-encoder|safety/i,
    },
    {
      id: 'cloudflare', nome: 'Cloudflare Workers AI', gratis: '10.000 neurons/dia', dia: 300,
      url: 'https://api.cloudflare.com/client/v4/accounts/{conta}/ai/v1',
      site: 'https://dash.cloudflare.com/profile/api-tokens',
      chave: 'escreva assim:  IDDA CONTA : TOKEN', visao: true,
      modelos: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen2.5-coder-32b-instruct',
                '@cf/meta/llama-3.1-8b-instruct'],
      contaNaChave: true,    // a chave tem que trazer o id da conta junto
      tirar: /embed|flux|stable|whisper|tts/i,
    },
    {
      id: 'sambanova', nome: 'SambaNova Cloud', gratis: 'Llama 405B grátis · 30 req/min', dia: 2000,
      url: 'https://api.sambanova.ai/v1',
      site: 'https://cloud.sambanova.ai', chave: 'começa com sn-…',
      modelos: ['Meta-Llama-3.1-405B-Instruct', 'DeepSeek-R1', 'Llama-3.3-70B-Instruct',
                'Qwen2.5-72B-Instruct'],
      tirar: /embed|whisper|tts/i,
    },
    {
      id: 'xai', nome: 'xAI (Grok) — crédito de boas-vindas', gratis: '$25 uma vez · depois é pagamento', dia: 0,
      url: 'https://api.x.ai/v1',
      site: 'https://console.x.ai', chave: 'começa com xai-…',
      modelos: ['grok-4', 'grok-4-1-fast', 'grok-3-mini'],
      tirar: /embed|image|vision-encoder/i,
    },
    {
      id: 'vercel', nome: 'Vercel AI Gateway', gratis: 'pago — o MESMO modelo top por outra cota', dia: 0,
      url: 'https://ai-gateway.vercel.sh/v1',
      site: 'https://vercel.com/docs/ai-gateway', chave: 'AI_GATEWAY_API_KEY…',
      /* aqui entram os mesmos modelos de ponta que o Puter serve — mas por uma
         SEGUNDA tomada, com credito proprio. Nao é copia do modelo (impossivel):
         é o mesmo modelo, disponivel por outro gateway. */
      modelos: ['anthropic/claude-opus-4.8', 'openai/gpt-5.5', 'google/gemini-3-pro',
                'moonshotai/kimi-k2.5', 'xai/grok-4'],
      tirar: /embed|image|video|tts|whisper/i,
    },
    {
      id: 'aigateway', nome: 'AIgateway.sh', gratis: 'pago — pass-through + 5%', dia: 0,
      url: 'https://api.aigateway.sh/v1',
      site: 'https://aigateway.sh', chave: 'começa com sk-aig-…',
      modelos: ['anthropic/claude-opus-4.7', 'openai/gpt-5.4', 'google/gemini-3.1-pro',
                'x-ai/grok-4', 'moonshotai/kimi-k2.7-code'],
      tirar: /embed|image|video|tts|whisper|moderation/i,
    },
    /* ---------- os que o usuario pediu por nome (Kimi, GLM, Qwen) ----------
       Todos API oficial, formato OpenAI, com camada gratuita ou creditos de
       entrada. Entram na MESMA fila dos gratuitos e recebem a MESMA memoria
       do site — e' por isso que um Kimi com a cabeca do ARKHER rende mais
       do que um Kimi sozinho numa aba.                                  */
    {
      id: 'moonshot', nome: 'Moonshot (Kimi)', gratis: 'créditos de entrada · contexto gigante', dia: 100,
      url: 'https://api.moonshot.ai/v1',
      site: 'https://platform.moonshot.ai/console/api-keys', chave: 'começa com sk-…',
      modelos: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'moonshot-v1-128k'],
      tirar: /embed|vision|image/i,
    },
    {
      id: 'zhipu', nome: 'Zhipu (GLM)', gratis: 'camada gratuita · GLM-4.6', dia: 200,
      url: 'https://open.bigmodel.cn/api/paas/v4',
      site: 'https://open.bigmodel.cn/usercenter/apikeys', chave: 'id.segredo',
      modelos: ['glm-4.6', 'glm-4.5', 'glm-4-flash', 'glm-4-air'],
      tirar: /embed|cogview|cogvideo|image/i,
    },
    {
      id: 'qwen', nome: 'Alibaba Qwen (DashScope)', gratis: 'camada gratuita · Qwen3', dia: 200,
      url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      site: 'https://bailian.console.alibabacloud.com', chave: 'começa com sk-…', visao: true,
      modelos: ['qwen3-max', 'qwen3-235b-a22b', 'qwen-plus', 'qwen-turbo', 'qwen2.5-coder-32b-instruct'],
      tirar: /embed|audio|tts|image|video|ocr/i,
    },
    {
      id: 'deepseek', nome: 'DeepSeek', gratis: 'créditos de entrada · barato depois', dia: 100,
      url: 'https://api.deepseek.com/v1',
      site: 'https://platform.deepseek.com/api_keys', chave: 'começa com sk-…',
      modelos: ['deepseek-chat', 'deepseek-reasoner'],
      tirar: /embed/i,
    },
    {
      id: 'siliconflow', nome: 'SiliconFlow', gratis: 'camada gratuita · muitos open-source', dia: 200,
      url: 'https://api.siliconflow.cn/v1',
      site: 'https://cloud.siliconflow.cn/account/ak', chave: 'começa com sk-…',
      modelos: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'zai-org/GLM-4.5'],
      tirar: /embed|image|video|audio|rerank/i,
    },
    {
      id: 'together', nome: 'Together AI', gratis: 'créditos iniciais · Llama/Qwen', dia: 100,
      url: 'https://api.together.xyz/v1',
      site: 'https://api.together.ai/settings/api-keys', chave: 'sem prefixo fixo',
      modelos: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
      tirar: /embed|image|video|audio|rerank|moderation/i,
    },
    {
      id: 'hyperbolic', nome: 'Hyperbolic', gratis: 'créditos iniciais', dia: 100,
      url: 'https://api.hyperbolic.xyz/v1',
      site: 'https://app.hyperbolic.xyz/settings', chave: 'sem prefixo fixo',
      modelos: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
      tirar: /embed|image|audio|video/i,
    },
    {
      id: 'novita', nome: 'Novita AI', gratis: 'camada gratuita', dia: 100,
      url: 'https://api.novita.ai/v3/openai',
      site: 'https://novita.ai/settings/key-management', chave: 'começa com sk_…',
      modelos: ['deepseek/deepseek-v3', 'meta-llama/llama-3.3-70b-instruct'],
      tirar: /embed|image|video|audio/i,
    },
    {
      id: 'fireworks', nome: 'Fireworks AI', gratis: 'créditos iniciais', dia: 100,
      url: 'https://api.fireworks.ai/inference/v1',
      site: 'https://fireworks.ai/account/api-keys', chave: 'começa com fw_…',
      modelos: ['accounts/fireworks/models/llama-v3p3-70b-instruct',
                'accounts/fireworks/models/deepseek-v3'],
      tirar: /embed|image|audio|stable-diffusion/i,
    },
    {
      id: 'deepinfra', nome: 'DeepInfra', gratis: 'camada gratuita', dia: 100,
      url: 'https://api.deepinfra.com/v1/openai',
      site: 'https://deepinfra.com/dash/api_keys', chave: 'começa com di_…',
      modelos: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
      tirar: /embed|image|audio|whisper/i,
    },
    {
      id: 'chutes', nome: 'Chutes', gratis: 'camada gratuita · open-source', dia: 200,
      url: 'https://llm.chutes.ai/v1',
      site: 'https://chutes.ai/app/api', chave: 'começa com cpk_…',
      modelos: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
      tirar: /embed|image|video|audio/i,
    },
    {
      id: 'cohere', nome: 'Cohere (modo compatível)', gratis: 'trial gratuito · Command', dia: 100,
      url: 'https://api.cohere.ai/compatibility/v1',
      site: 'https://dashboard.cohere.com/api-keys', chave: 'sem prefixo fixo',
      modelos: ['command-r-plus-08-2024', 'command-r-08-2024'],
      tirar: /embed|rerank|audio|image/i,
    },
    {
      id: 'nebius', nome: 'Nebius AI Studio', gratis: 'créditos iniciais · Llama/Qwen', dia: 100,
      url: 'https://api.studio.nebius.ai/v1',
      site: 'https://studio.nebius.ai', chave: 'sem prefixo fixo',
      modelos: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
      tirar: /embed|image|audio/i,
    },
    {
      id: 'ovh', nome: 'OVH AI Endpoints', gratis: 'camada gratuita (Europa)', dia: 100,
      url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
      site: 'https://endpoints.ai.cloud.ovh.net', chave: 'sem prefixo fixo',
      modelos: ['Meta-Llama-3_3-70B-Instruct', 'Qwen2.5-72B-Instruct'],
      tirar: /embed|image|audio/i,
    },
    {
      id: 'ollama', nome: 'Ollama (na sua máquina)', gratis: 'ilimitado · roda offline', dia: Infinity,
      url: 'http://localhost:11434/v1', site: 'https://ollama.com/download',
      chave: 'sem chave (só deixe em branco)', local: true,
      dica: 'Para o site poder chamar o Ollama: OLLAMA_ORIGINS=* ollama serve (uma vez).',
      modelos: [],
      tirar: /embed/i,
    },
    {
      id: 'lmstudio', nome: 'LM Studio (na sua máquina)', gratis: 'ilimitado · roda offline', dia: Infinity,
      url: 'http://localhost:1234/v1', site: 'https://lmstudio.ai',
      chave: 'sem chave (só deixe em branco)', local: true,
      dica: 'No LM Studio: Developer > Start Server e ligue o CORS.',
      modelos: [],
      tirar: /embed/i,
    },
  ],

  /* ---------- CATALOGO FLEXIVEL ----------
     CAT = os provedores de fabrica (acima).
     +   = os SEUS provedores, registrados em runtime: seu modelo no HF,
           sua VM com vLLM/Ollama na nuvem, um gateway, uma API compatível
           que você assinou... qualquer endpoint OpenAI-compatível.
     Um provedor por CONTA (a sua). Multiplicar conta para multiplicar cota
     é o que a gente não faz — o que multiplica aqui é provedor diferente,
     cada um com a cota que ele publica.                                  */
  provs() { return this.CAT.concat(this.proprios()); },

  proprios() { return (LS.get('arkher_prov_prop', []) || []); },

  addProprio(o) {
    o = o || {};
    if (!o.url || !/^https?:\/\//i.test(o.url)) return { ok: false, err: 'o endereço tem que começar com http(s)://' };
    const lista = LS.get('arkher_prov_prop', []) || [];
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    lista.push({
      id: id, proprio: true,
      nome: o.nome || ('provedor ' + (lista.length + 1)),
      url: String(o.url).replace(/\/+$/, ''),
      site: o.site || '',
      chave: o.chave || 'cola a chave (ou deixe vazio, se não usa)',
      gratis: o.gratis || (o.papel === 'top' ? 'pago/crédito' : 'do seu provedor'),
      dia: Number(o.dia) || (o.papel === 'top' ? 0 : 200),
      papel: o.papel || 'free',                // free | top | local
      visao: !!o.visao,
      soFree: false,
      modelos: String(o.modelos || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
    });
    LS.set('arkher_prov_prop', lista);
    return { ok: true, id: id, total: lista.length };
  },

  /* ---------- COLAR VARIOS DE UMA VEZ ----------
     Serve para empilhar dezenas de provedores sem clicar de um em um.

     Uma linha por provedor, campos separados por "|" (barra vertical):

        nome | https://api.exemplo.com/v1 | sk-chave-aqui | free | modelo-1, modelo-2

     - a chave pode ficar vazia (provedor local/aberto);
     - papel: free (padrão) | top | local  → 'top' entra na fila PAGA e só
       e usado quando a mensagem merece e ha saldo;
     - pode colar varias linhas de uma vez. Linha com # na frente é comentario. */
  addVarios(texto) {
    const linhas = String(texto || '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = { ok: 0, erros: [], ids: [] };
    for (const linha of linhas) {
      if (/^[#\/]/.test(linha)) continue;                      // comentario
      const c = linha.split('|').map(x => x.trim());
      if (c.length < 2) { out.erros.push('linha sem "|": ' + linha.slice(0, 40)); continue; }
      const [nome, url, chave, papel, modelos] = [c[0], c[1], c[2] || '', c[3] || 'free', c[4] || ''];
      if (!/^https?:\/\//i.test(url)) { out.erros.push('endereço inválido: ' + url.slice(0, 40)); continue; }
      const r = this.addProprio({ nome, url, chave, papel,
        modelos: modelos || 'modelo-padrao',
        dia: papel === 'top' ? 0 : 200, visao: false });
      if (r.ok) {
        out.ok++; out.ids.push(r.id);
        /* a chave colada entra na lista de chaves de verdade (é ela que o
           roteador usa na hora do pedido) */
        if (chave) {
          const ra = this.add(r.id, chave, 'colada');
          if (!ra.ok) out.erros.push((nome || url) + ' (chave): ' + ra.err);
        }
      } else out.erros.push((nome || url) + ': ' + r.err);
    }
    return out;
  },

  /* ---------- COLAR VARIOS DE UMA VEZ ----------
     Serve para empilhar dezenas de provedores sem clicar de um em um.

     Uma linha por provedor, campos separados por "|" (barra vertical):

        nome | https://api.exemplo.com/v1 | sk-chave-aqui | free | modelo-1, modelo-2

     - a chave pode ficar vazia (provedor local/aberto);
     - papel: free (padrão) | top | local  → 'top' entra na fila PAGA e só
       e usado quando a mensagem merece e ha saldo;
     - pode colar varias linhas de uma vez. Linha com # na frente é comentario. */
  addVarios(texto) {
    const linhas = String(texto || '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = { ok: 0, erros: [], ids: [] };
    for (const linha of linhas) {
      if (/^[#\/]/.test(linha)) continue;                      // comentario
      const c = linha.split('|').map(x => x.trim());
      if (c.length < 2) { out.erros.push('linha sem "|": ' + linha.slice(0, 40)); continue; }
      const [nome, url, chave, papel, modelos] = [c[0], c[1], c[2] || '', c[3] || 'free', c[4] || ''];
      if (!/^https?:\/\//i.test(url)) { out.erros.push('endereço inválido: ' + url.slice(0, 40)); continue; }
      const r = this.addProprio({ nome, url, chave, papel,
        modelos: modelos || 'modelo-padrao',
        dia: papel === 'top' ? 0 : 200, visao: false });
      if (r.ok) {
        out.ok++; out.ids.push(r.id);
        /* a chave colada entra na lista de chaves de verdade (é ela que o
           roteador usa na hora do pedido) */
        if (chave) {
          const ra = this.add(r.id, chave, 'colada');
          if (!ra.ok) out.erros.push((nome || url) + ' (chave): ' + ra.err);
        }
      } else out.erros.push((nome || url) + ': ' + r.err);
    }
    return out;
  },

  removerProprio(id) {
    LS.set('arkher_prov_prop', (LS.get('arkher_prov_prop', []) || []).filter(p => p.id !== id));
    const d = this.ler(); delete d.prov[id]; this.gravar(d);
    return true;
  },

  prov(id) { return this.provs().find(p => p.id === id); },
  site(id) { const p = this.prov(id); return p ? p.site : ''; },

  /* ---------- armazem (localStorage, e Supabase se ligado) ---------- */
  ler() {
    const d = LS.get(this.KEY, null);
    return (d && d.prov) ? d : { prov: {} };
  },
  gravar(d) { LS.set(this.KEY, d); },
  _p(d, id) { return d.prov[id] || (d.prov[id] = { chaves: [], conta: '', modelos: [], quando: 0, erro: '' }); },

  /* ---------- chaves ---------- */
  chaves(id) { return (this.ler().prov[id] || {}).chaves || []; },
  livres(id) { const n = Date.now(); return this.chaves(id).filter(k => !k.ate || k.ate < n); },

  add(id, texto, apelido) {
    const p = this.prov(id); if (!p) return { ok: false, err: 'provedor desconhecido' };
    const d = this.ler(); const c = this._p(d, id);
    const brutos = String(texto || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (!brutos.length && !p.local) return { ok: false, err: 'cole a chave' };
    let n = 0;
    for (const b of (brutos.length ? brutos : ['local'])) {
      if (c.chaves.some(k => k.t === b)) continue;
      c.chaves.push({ id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                      t: b, nome: (apelido || '') + (apelido ? ' ' : '') + (c.chaves.length + 1),
                      falhas: 0, usos: 0, ate: 0 });
      n++;
    }
    c.erro = '';
    this.gravar(d);
    return { ok: n > 0, n, total: c.chaves.length, err: n ? '' : 'chave já cadastrada' };
  },

  remover(id, kid) {
    const d = this.ler(); const c = this._p(d, id);
    c.chaves = c.chaves.filter(k => k.id !== kid);
    this.gravar(d);
  },

  /* id da conta do Cloudflare (fica junto da chave, formatada "conta:token") */
  partes(id, t) {
    if (id === 'cloudflare') {
      const i = String(t).indexOf(':');
      if (i > 0) return { conta: String(t).slice(0, i).trim(), token: String(t).slice(i + 1).trim() };
    }
    return { conta: (this.ler().prov[id] || {}).conta || '', token: t };
  },

  _url(id, sufixo, chave) {
    const p = this.prov(id);
    let base = p.url;
    if (id === 'cloudflare') base = base.replace('{conta}', encodeURIComponent(chave.conta || ''));
    return base.replace(/\/$/, '') + sufixo;
  },

  /* proxima chave que ainda tem cota hoje (menos usada primeiro) */
  pick(id) {
    const vivas = this.livres(id);
    if (vivas.length) { vivas.sort((a, b) => (a.usos || 0) - (b.usos || 0)); return vivas[0]; }
    // todas em descanso: se for descanso curto (rate limit), a menos castigada ainda tenta
    const todas = this.chaves(id);
    if (todas.length) return todas.slice().sort((a, b) => (a.ate || 0) - (b.ate || 0))[0];
    const p = this.prov(id);
    return p && p.local ? { id: 'local', t: 'local', nome: 'local' } : null;
  },

  /* cota estourou: deixa a chave descansando (diario) em vez de perder ela */
  falhou(id, chave, msg) {
    const d = this.ler(); const c = this._p(d, id);
    const k = c.chaves.find(x => x.id === chave.id) || c.chaves.find(x => x.t === chave.t);
    if (k) {
      k.falhas = (k.falhas || 0) + 1;
      const m = String(msg || '').toLowerCase();
      if (/401|403|invalid|unauthor|no auth|api key/.test(m)) k.ate = Date.now() + 24 * 3600e3;
      else if (/429|rate|quota|limit|credit|exceed/.test(m)) k.ate = this._amanha();
      else k.ate = Date.now() + 60e3;
      c.erro = String(msg || '').slice(0, 200);
    }
    this.gravar(d);
  },

  ok(id, chave) {
    const d = this.ler(); const c = this._p(d, id);
    const k = c.chaves.find(x => x.id === (chave && chave.id));
    if (k) { k.falhas = 0; k.ate = 0; k.usos = (k.usos || 0) + 1; c.erro = ''; this.gravar(d); }
  },

  _amanha() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0, 15, 0, 0); return d.getTime(); },

  /* ---------- capacidade do armazem ----------
     Quanto de cota gratuita VOCE tem hoje, somando as cotas que cada
     provedor publica. Serve pra dimensionar: em vez de uma conta por
     dia que pode ser banida, varias contas legitimas em provedores
     diferentes, cada uma com a cota dela. */
  capacidade() {
    const d = this.ler();
    const linhas = [];
    let contas = 0, pedidos = 0, ilimitado = false;
    for (const p of this.provs()) {
      const c = d.prov[p.id] || {};
      const chaves = p.local ? ((c.modelos || []).length ? 1 : 0) : (c.chaves || []).length;
      if (!chaves) continue;
      const dia = p.local ? Infinity : (p.dia || 0);
      contas += chaves;
      if (isFinite(dia)) pedidos += chaves * dia; else ilimitado = true;
      linhas.push({ id: p.id, nome: p.nome, chaves, dia, pedidos: isFinite(dia) ? chaves * dia : Infinity });
    }
    return { contas, pedidos, ilimitado, linhas };
  },

  /* quantos provedores podem responder AGORA.
     Local (Ollama/LM Studio) so conta depois que o /models respondeu uma vez:
     servidor desligado nao pode fingir que e provedor. */
  prontos() {
    const d = this.ler();
    return this.provs().filter(p => {
      const c = d.prov[p.id] || {};
      if (p.local) return (c.modelos || []).length > 0;   // local so conta se o /models respondeu
      return (c.chaves || []).length > 0;                 // com chave salva, mesmo em descanso, vale tentar
    }).map(p => p.id);
  },
  temAlgum() { return this.prontos().length > 0; },

  /* esquece os catalogos baixados (o botao "Recarregar" chama isto) */
  esquecer() {
    const d = this.ler();
    for (const id of Object.keys(d.prov)) d.prov[id].quando = 0;
    this.gravar(d);
    return true;
  },

  /* ---------- catalogo vivo ----------
     Puxa /models de cada provedor com chave. Se falhar, usa a lista
     estatica de emergencia (assim nunca ficamos sem opcao).        */
  async listar(id, recarregar) {
    const p = this.prov(id); if (!p) return [];
    const d = this.ler(); const c = this._p(d, id);
    if (!recarregar && c.modelos && c.modelos.length && Date.now() - (c.quando || 0) < 3600e3) return c.modelos;
    const chave = this.pick(id);
    let ids = [];
    if (chave) {
      const pr = this.partes(id, chave.t);
      try {
        const cab = { 'Content-Type': 'application/json' };
        if (pr.token && pr.token !== 'local') cab.Authorization = 'Bearer ' + pr.token;
        const r = await fetch(this._url(id, '/models', pr), { headers: cab });
        if (r.ok) {
          const j = await r.json();
          const arr = j.data || j.models || j.result || j;
          ids = (Array.isArray(arr) ? arr : [])
            .map(m => (typeof m === 'string' ? m : (m.id || m.name || m.model)))
            .filter(Boolean);
        }
      } catch (e) { /* offline/HTTPS×HTTP: cai na lista estatica */ }
    }
    let fim = ids.filter(x => !(p.tirar && p.tirar.test(x)));
    if (p.soFree) { fim = fim.filter(x => /:free$|\/free$/.test(x)); if (fim.length && !fim.includes('openrouter/free')) fim.unshift('openrouter/free'); }
    if (!fim.length) fim = (p.modelos || []).slice();
    // Gemini devolve muita coisa de terceiros? nao: filtra por familia de chat
    if (id === 'gemini') fim = fim.filter(x => /gemini|gemma/i.test(x));
    c.modelos = Array.from(new Set(fim));
    /* lista vazia costuma ser servidor local desligado / chave ainda invalida:
       tenta de novo em ~5 min, nao daqui a 1 hora */
    c.quando = Date.now() - (c.modelos.length ? 0 : 55 * 60e3);
    this.gravar(d);
    return c.modelos;
  },

  /* lista unica pronta pra cascata do app.js */
  async catalogo(recarregar) {
    const out = [];
    for (const id of this.prontos()) {
      let ms = [];
      try { ms = await this.listar(id, recarregar); } catch (e) { ms = []; }
      const p = this.prov(id) || {};
      const papel = p.papel || (p.local ? 'local' : (p.dia === 0 ? 'top' : 'free'));
      for (const m of ms) out.push({ src: 'free', prov: id, id: m, modelo: m, papel });
    }
    return out;
  },

  /* ---------- chamada (OpenAI-compativel, com streaming) ---------- */
  async ask(id, modelo, messages, onDelta) {
    const p = this.prov(id);
    if (!p) throw new Error('provedor desconhecido: ' + id);
    const chave = this.pick(id);
    if (!chave) throw new Error('sem chave viva do ' + p.nome);
    const pr = this.partes(id, chave.t);
    const cab = { 'Content-Type': 'application/json' };
    if (pr.token && pr.token !== 'local') cab.Authorization = 'Bearer ' + pr.token;
    if (id === 'openrouter') { cab['HTTP-Referer'] = location.origin; cab['X-Title'] = 'ARKHER'; }
    if (p.soFree && !/:free$/.test(modelo)) modelo = modelo + ':free';
    if (id === 'gemini' && !/(^|\/)gemini/.test(modelo)) modelo = 'gemini-2.5-flash';

    const corpo = {
      model: modelo, messages, stream: !!onDelta,
      max_tokens: LS.get('arkher_max_tokens', 2048),
    };
    let r;
    try {
      r = await fetch(this._url(id, '/chat/completions', pr), { method: 'POST', headers: cab, body: JSON.stringify(corpo) });
    } catch (e) {
      throw new Error(p.nome + ': nao consegui falar com ' + this._url(id, '', pr) +
        (/^https:/.test(location.protocol) && p.local ? ' (pagina HTTPS x servidor local: use o Chrome/Edge, ou o no Kaggle)' : '') +
        ' — ' + (e.message || e));
    }
    if (!r.ok) {
      let d = '';
      try { const j = await r.json(); d = j.error?.message || j.error || j.message || j.detail || JSON.stringify(j).slice(0, 300); } catch (e) {}
      const msg = p.nome + ' HTTP ' + r.status + ' ' + d;
      if (r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429) this.falhou(id, chave, msg);
      else this.falhou(id, chave, 'erro ' + r.status);
      throw new Error(msg);
    }

    let texto = '';
    if (onDelta && r.body && r.body.getReader) {
      texto = await this._sse(r.body, onDelta);
      if (!texto.trim()) throw new Error(p.nome + ': resposta vazia');
    } else {
      const j = await r.json().catch(() => null);
      texto = this._texto(j);
      if (!texto.trim()) throw new Error(p.nome + ': resposta vazia');
      if (onDelta) onDelta(texto);
    }
    this.ok(id, chave);
    return texto;
  },

  /* leitor de SSE (padrao OpenAI: "data: {json}") */
  async _sse(corpo, onDelta) {
    const leitor = corpo.getReader(); const dec = new TextDecoder();
    let buf = '', cheio = '';
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const linhas = buf.split('\n'); buf = linhas.pop();
      for (const l of linhas) {
        const s = l.trim();
        if (!s.startsWith('data:')) continue;
        const dado = s.slice(5).trim();
        if (!dado || dado === '[DONE]') continue;
        let j; try { j = JSON.parse(dado); } catch (e) { continue; }
        const t = this._texto(j);
        if (t) { cheio += t; onDelta(t); }
      }
    }
    return cheio;
  },

  _texto(j) {
    if (!j) return '';
    if (typeof j === 'string') return j;
    const c = j.choices && j.choices[0];
    if (c) {
      const d = c.delta || c.message || {};
      const v = (d.content !== undefined ? d.content : c.text);
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map(p => (typeof p === 'string' ? p : (p && (p.text || p.content)) || '')).join('');
    }
    if (j.message && typeof j.message.content === 'string') return j.message.content;
    return '';
  },

  /* ---------- resumo pra UI ---------- */
  resumo() {
    const out = [];
    for (const p of this.provs()) {
      const d = this.ler().prov[p.id] || {};
      const ch = d.chaves || [];
      const n = Date.now();
      out.push({
        id: p.id, nome: p.nome, gratis: p.gratis, site: p.site, chave: p.chave,
        local: !!p.local, visao: !!p.visao,
        total: ch.length, livres: ch.filter(k => !k.ate || k.ate < n).length,
        modelos: (d.modelos || []).length, erro: d.erro || '',
      });
    }
    return out;
  },

  /* testa um provedor de verdade: 1 pergunta curta */
  async testar(id, modelo) {
    const ms = modelo ? [modelo] : await this.listar(id, true);
    const m = ms[0];
    if (!m) throw new Error('nenhum modelo disponivel em ' + id);
    const t = await this.ask(id, m, [{ role: 'user', content: 'responda só: ok' }]);
    return { modelo: m, resposta: String(t).slice(0, 60) };
  },
};

if (typeof window !== 'undefined') window.Free = Free;
if (typeof module !== 'undefined') module.exports = Free;
