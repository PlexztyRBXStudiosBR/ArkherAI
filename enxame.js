/* ============================================================
   ARKHER — ENXAME (varias IAs com as MESMAS maos, cada uma no seu papel)
   ============================================================

   A ideia, dita sem enfeite:
   - Um modelo sozinho erra, alucina e tem vicio. Varios modelos
     respondendo e uma camada que SOMA os resultados bate o melhor deles.
     Isso se chama Mixture-of-Agents (MoA) e e medivel, nao e papo.
   - Aqui TODOS os agentes recebem TODAS as ferramentas (3D, bash, web,
     memoria, GPU). O GPT pode gerar 3D, o Qwen pode buscar na web.
     A diferenca entre eles e o PAPEL que cada um faz melhor, nao o
     que ele pode tocar.
   - Quem decide o papel e o proprio uso: cada rodada grava quem
     acertou mais naquele tipo de pedido, e na proxima esse modelo
     comeca na frente. Sem GPU, sem treino: e estatistica guardada.

   O ciclo de uma pergunta:
     1. CLASSIFICAR  -> que tipo de pedido e (luau, unity, 3d, arte, mundo...)
     2. ESCALAR      -> monta o time (4 a 100 agentes) pelos papeis
     3. PROPOR       -> todos respondem em paralelo (com ferramentas)
     4. CRITICAR     -> um modelo diferente da maioria julga cada proposta
     5. AGREGAR      -> um modelo forte junta o melhor de todas
     6. VERIFICAR    -> conselheiro com ferramentas confere afirmacoes
     7. APRENDER     -> grava quem ganhou; vira dado de treino (SFT e DPO)

   Custo, dito na cara: 100 agentes = 100 chamadas de modelo. Por isso
   ele LE o armazem de cota (pool.js): com 10 contas suas no Puter ele
   escala o conselho ate as cotas livres, em paralelo, e quando uma
   conta estoura (429) ele gira pro proxima e o agente nao morre —
   pedido com 3 tentativas. Sem armazem, o padrao volta a ser 4.

   E ele nao responde sempre do mesmo jeito:
   - critica reprovou? ESCALA (entra mais gente e agrega de novo).
   - tarefa grande (jogo/projeto/sistema)? MODO PROFUNDO: um planejador
     quebra em subtarefas, cada uma roda o proprio conselho, e o
     agregador final junta tudo num projeto.
   ============================================================ */
'use strict';
(function () {
  if (typeof LS === 'undefined' && typeof require !== 'undefined') {
    globalThis.LS = require('./core.js').LS;
  }
  const CHAVE_STATS = 'arkher_enxame_stats';
  const CHAVE_CFG = 'arkher_enxame_cfg';

  const ENX = {
    cfg: {
      ligado: false,          // usar enxame no chat
      n: 4,                   // quantos agentes propoem
      paralelo: 6,            // quantos ao mesmo tempo (limite de cota/rede)
      rodadas: 1,             // 1 = propor->agregar; 2 = agrega de novo com a critica
      criticar: true,
      verificar: false,       // volta extra com ferramentas (mais lento, mais exato)
      ferramentasEmTodos: true,
      tetoS: 240,             // tempo maximo por proposta (segundos)
      tetoTotalS: 900,        // tempo maximo do conselho inteiro
      usarArmazem: true,      // usa as contas do armazem de cota pra escalar o conselho
      nMax: 12,               // teto de agentes quando o armazem permite (n escolhido < nMax)
      escalar: true,          // critica reprovou? roda outra rodada com reforco
      revisar: true,          // cada agente ve as propostas dos colegas e melhora a dele
      maxRevisar: 6,          // quantos revisam (custa 1 chamada por agente)
      profund: 'auto',        // 'auto' | true | false — dividir tarefa grande em subtarefas
      maxSub: 4,              // quantas subtarefas no modo profundo
    },

    /* ---------------- cota: o armazem de contas ----------------
       Cada conta do Puter e uma cota. Com 10 contas logadas, o conselho
       pode ser grande de verdade — nao faz sentido limitar em 4.        */
    async cota() {
      try {
        if (this.cfg.usarArmazem === false || typeof Pool === 'undefined' || !Pool.stats) return null;
        const st = await Pool.stats();
        const p = (st && st.puter) || { total: 0, livres: 0 };
        const h = (st && st.hf) || { total: 0, livres: 0 };
        /* cada provedor gratis com chave viva tambem e uma cota (freeai.js).
           Assim o conselho cresce mesmo quando o saldo do Puter acabou. */
        const gratis = (typeof Free !== 'undefined' && Free.prontos) ? Free.prontos().length : 0;
        const extra = Math.min(gratis * 2, 6);
        return { contas: p.total + gratis, livres: (p.livres || 0) + extra,
                 gratis: gratis, hf: h.total, hfLivres: h.livres,
                 total: (p.livres || 0) + extra + (h.livres || 0) };
      } catch (e) { return null; }
    },

    /* quantos agentes e quantos em paralelo, dado o armazem */
    async tamanho(pedido, cota) {
      const c = cota || await this.cota();
      const pedidoN = Math.max(1, Math.min(100, pedido || this.cfg.n));
      const base = { n: pedidoN, paralelo: this.cfg.paralelo, motivo: 'padrao' };
      if (!c || !c.total) return base;
      const teto = Math.max(pedidoN, Math.min(100, this.cfg.nMax || 12));
      const n = Math.min(teto, Math.max(pedidoN, c.livres));
      const paralelo = Math.max(this.cfg.paralelo, Math.min(32, c.livres || 1));
      return { n, paralelo, motivo: 'armazem: ' + c.livres + ' cota(s) livre(s) de ' + c.contas + ' conta(s)' };
    },
    stats: {},                // {tarefa: {modelo: {n, soma, vitorias, votos}}}

    /* ---------------- papeis ----------------
       Cada papel tem: um pedaco de instrucao, um filtro de modelo e um
       peso. Nao e enfeite: o mesmo modelo responde muito melhor quando
       o pedido esta enquadrado no que ele faz bem.                   */
    PAPEIS: {
      arquiteto: {
        peso: 1.2,
        quer: /opus|fable|gpt-?5|o3|o4|r1|thinking|reasoning|sonnet|70b|405b|ultra|max/i,
        add: 'Voce e o ARQUITETO. Antes de responder, pense na estrutura: quais arquivos/sistemas/partes, '
           + 'ordem de execucao e o que pode dar errado. Aponte a decisao central e o porque. Seja especifico.',
      },
      programador: {
        peso: 1.3,
        quer: /coder|code|deepseek|qwen|gpt-?5|claude|sonnet|opus|codestral|starcoder|codellama/i,
        add: 'Voce e o PROGRAMADOR. De codigo que RODA: Luau/Roblox (task.wait, servicos, RemoteEvent com '
           + 'validacao no servidor), C#/Unity, C++/Blueprint ou GDScript conforme o pedido. Diga onde salva '
           + 'o arquivo e como testa. Sem pseudocodigo quando der pra escrever o codigo real.',
      },
      artista: {
        peso: 1.1,
        quer: /vision|vl|image|omni|multimodal|gpt-?4|gpt-?5|gemini|pixtral|llava|molmo/i,
        add: 'Voce e o ARTISTA/TECNICO. Cuide do visual: paleta, valores de PBR (base color, roughness, '
           + 'metallic), silhueta, escala em metros, texel density, LOD. Se precisar de imagem/3D, use as '
           + 'ferramentas (rodar_gpu, gerar_3d) em vez de descrever no abstrato.',
      },
      pesquisador: {
        peso: 1.0,
        quer: /.*/,
        add: 'Voce e o PESQUISADOR. Use buscar_web/lembrar/estudar pra checar o que mudou em API, versao de '
           + 'engine, limite de plataforma. Cite a fonte (nome do doc/URL curta). Se nao achou, diga que nao achou.',
      },
      critico: {
        peso: 1.0,
        quer: /opus|fable|gpt-?5|o3|o4|r1|thinking|reasoning|sonnet|70b|max/i,
        add: 'Voce e o CRITICO. Aponte o ERRO, nao o elogio: API que nao existe, flag inventada, escala '
           + 'errada, coisa que nao roda na plataforma (ex: Roblox nao tem essa classe), logica quebrada. '
           + 'De a nota de 0 a 10 e diga o que arrumar. Sem resposta em branco.',
      },
      agregador: {
        peso: 1.5,
        quer: /opus|fable|gpt-?5|sonnet|o3|o4|r1|thinking|reasoning|ultra|max|405b/i,
        add: 'Voce e o AGREGADOR. Recebe varias respostas de outros modelos (com o papel de cada um) e escreve '
           + 'a resposta FINAL. Aproveite o melhor de cada, corte o que estiver errado, junte as partes que se '
           + 'completam e nao cite os modelos. Se duas respostas se contradizem, escolha a que se sustenta e '
           + 'explique em uma linha. Nao invente resultado de ferramenta.',
      },
      verificador: {
        peso: 1.1,
        quer: /.*/,
        add: 'Voce e o VERIFICADOR. Voce tem ferramentas: use-as pra CONFERIR as afirmacoes tecnicas que '
           + 'puder (rodar o codigo, checar uma URL, gerar o asset, listar um diretorio, ver a doc). '
           + 'Devolva: (1) o que conferiu e o resultado, (2) o que nao deu pra conferir, (3) correcoes.',
      },
    },

    /* ---------------- config ---------------- */
    carregar() {
      try {
        const c = LS.get(CHAVE_CFG, null); if (c) Object.assign(this.cfg, c);
        const s = LS.get(CHAVE_STATS, null); if (s) this.stats = s;
      } catch (e) {}
      return this;
    },
    salvar() { try { LS.set(CHAVE_CFG, this.cfg); } catch (e) {} },
    set(k, v) { this.cfg[k] = v; this.salvar(); return this.cfg; },
    ligado() { return !!this.cfg.ligado; },

    /* ---------------- classificar o pedido ----------------
       Rotulo simples, por palavra-chave. Se o cérebro tiver uma regra
       aprendida, ela manda (Neural). Nada de modelo gastando cota pra
       decidir isso.                                                    */
    classificar(txt) {
      const t = String(txt || '').toLowerCase();
      const regras = [
        ['luau', /roblox|luau|studio|rojo|rbxl|part\b|humanoid|datastore/i],
        ['unity', /unity|c#|monobehaviour|prefab|navmesh|scriptableobject/i],
        ['unreal', /unreal|ue5|blueprint|uproject|niagara|lumen|nanite|gas\b/i],
        ['godot', /godot|gdscript|tscn|export_?preset/i],
        ['blender', /blender|bpy|\.blend|rigify|gltf|glb|malha|uv\b/i],
        ['arte', /textura|sprite|conceito|concept|paleta|pbr|normal map|icone|thumbnail/i],
        ['mundo', /mundo|terreno|bioma|procedural|perlin|wfc|mapa|level design|chunk/i],
        ['3d', /3d|modelo.*(espada|casa|arvore)|malha|mesh|render|armadura/i],
        ['codigo', /c[oó]digo|script|fun[cç][aã]o|bug|erro|refator|api/i],
      ];
      for (const [rot, re] of regras) if (re.test(t)) return rot;
      return 'geral';
    },

    /* ---------------- aprender quem manda bem ----------------
       Sem GPU: e contagem. Vitoria = a proposta que sobreviveu mais
       parecida com a resposta final; nota = do critico.               */
    registrar(tarefa, modelo, nota, venceu) {
      if (!modelo) return;
      this.stats[tarefa] = this.stats[tarefa] || {};
      const m = this.stats[tarefa][modelo] = this.stats[tarefa][modelo] || { n: 0, soma: 0, vitorias: 0 };
      m.n++; m.soma += Number(nota) || 0; if (venceu) m.vitorias++;
      try { LS.set(CHAVE_STATS, this.stats); } catch (e) {}
    },
    /** media de desempenho desse modelo nesse tipo de pedido (-1 = nunca rodou) */
    scoreAprendido(tarefa, modelo) {
      const m = (this.stats[tarefa] || {})[modelo];
      if (!m || !m.n) return -1;
      return (m.soma / m.n) + (m.vitorias / m.n) * 3;
    },
    melhorPara(tarefa, quantos) {
      const m = this.stats[tarefa] || {};
      return Object.entries(m)
        .sort((a, b) => this.scoreAprendido(tarefa, b[0]) - this.scoreAprendido(tarefa, a[0]))
        .slice(0, quantos || 5)
        .map(([modelo, v]) => ({ modelo, media: +(v.soma / Math.max(1, v.n)).toFixed(2), vitorias: v.vitorias, rodadas: v.n }));
    },
    tabela() {
      const out = [];
      for (const [tarefa, mm] of Object.entries(this.stats)) {
        for (const [modelo, v] of Object.entries(mm)) {
          out.push({ tarefa, modelo: modelo.split('/').pop().slice(0, 28), rodadas: v.n,
                     media: +(v.soma / Math.max(1, v.n)).toFixed(2), vitorias: v.vitorias });
        }
      }
      return out.sort((a, b) => b.vitorias - a.vitorias || b.media - a.media);
    },

    /* ---------------- montar o time ----------------
       Todo mundo entra com as mesmas ferramentas; o papel define o
       enquadramento. O que o enxame JA aprendeu entra na frente.      */
    async time(pergunta, n, excluir) {
      const tarefa = this.classificar(pergunta);
      n = Math.max(1, Math.min(100, n || this.cfg.n));
      const fora = excluir ? new Set(excluir) : null;
      let base = [];
      try {
        const r = await Arkher.rank('chat');
        // o rank devolve {puter:[], hf:[], gpu:[]}; aceito lista crua tambem
        const arr = Array.isArray(r) ? { puter: r.map(x => (x && x.id) || x) } : (r || {});
        base = (arr.puter || []).map(id => ({ src: 'puter', id }))
          .concat((arr.gpu || []).map(id => ({ src: 'gpu', id })))
          .concat((arr.hf || []).map(id => ({ src: 'hf', id })));
      } catch (e) { /* se o catalogo falhar, ainda da pra usar o que tem */ }
      // tira repeticao de familia (3 modelos qwen nao sao 3 opinioes)
      const fam = new Set(); const uniq = [];
      for (const x of base) {
        if (fora && fora.has(x.id)) continue;
        const f = String(x.id).toLowerCase().replace(/^[^/]*\//, '').replace(/[-_.]?\d.*$/, '');
        const k = f.slice(0, 12) + '|' + x.src;
        if (fam.has(k)) continue; fam.add(k); uniq.push(x);
      }
      const papeis = ['arquiteto', 'programador', 'artista', 'pesquisador', 'critico'];
      if (!uniq.length) {
        // catalogo fora do ar: o conselho continua, usando a propria cascata
        // (cada agente vira uma tentativa independente) — melhor que nao responder
        for (let i = 0; i < n; i++) {
          uniq.push({ src: 'auto', id: 'auto' });
        }
      }
      const time = [];
      for (let i = 0; i < n && i < uniq.length; i++) {
        const m = uniq[i];
        const papel = papeis[i % papeis.length];
        const aprendido = this.scoreAprendido(tarefa, m.id);
        const q = this.PAPEIS[papel].quer;
        const encaixa = q.test(m.id) ? 1.5 : 0;   // combina com o papel?
        time.push({ src: m.src, id: m.id, papel, pedido: m.src === 'auto' ? '' : ((m.src === 'hf' ? 'hf:' : m.src === 'gpu' ? 'gpu:' : '') + m.id),
                    peso: (aprendido >= 0 ? aprendido : 0) + encaixa + this.PAPEIS[papel].peso });
      }
      time.sort((a, b) => b.peso - a.peso);
      return { tarefa, time };
    },

    /* ---------------- executor: agente com ferramentas ----------------
       O MESMO loop do chat, mas pra qualquer modelo do time — e todos
       recebem o catalogo completo de ferramentas.                      */
    async agente(messages, o) {
      o = o || {};
      const log = o.onLog || (() => {});
      const maxVoltas = o.maxVoltas == null ? 3 : o.maxVoltas;
      const comFerramentas = o.ferramentas !== false && typeof runTool === 'function';
      let msgs = messages.slice();
      if (comFerramentas && typeof systemPrompt === 'function') {
        const sys = systemPrompt();
        const i = msgs.findIndex(m => m.role === 'system');
        if (i >= 0) msgs[i] = { role: 'system', content: msgs[i].content + '\n\n' + sys };
        else msgs = [{ role: 'system', content: sys }].concat(msgs);
      }
      // MEMORIA COMPARTILHADA: o que os outros agentes (e sessoes anteriores) ja descobriram
      if (o.escopo && typeof Memoria !== 'undefined' && Memoria.cfg && Memoria.cfg.ligado) {
        let quadro = '';
        try {
          if (Memoria.relevantes) {
            const it = await Memoria.relevantes(o.pergunta || '', 8, o.escopo);
            quadro = it.map(x => '- [' + x.tipo + ' · ' + x.escopo + '] ' + x.texto).join('\n');
          }
        } catch (e) { quadro = ''; }
        if (!quadro) quadro = Memoria.contexto(o.escopo, 8);
        if (quadro) {
          msgs = [{ role: 'system', content: 'MEMORIA COMPARTILHADA (descobertas dos outros agentes '
            + 'e de sessoes anteriores — use o que servir, nao repita o que ja foi feito):\n' + quadro }].concat(msgs);
          log('  quadro: ' + quadro.split('\n').length + ' descoberta(s) dos colegas');
        }
      }
      const usadas = [];
      let r = null, txt = '';
      for (let volta = 0; volta <= maxVoltas; volta++) {
        // se a cota daquela conta estourou, tenta de novo (o app gira o armazem);
        // agente perdido no meio do conselho = conselho mais fraco
        r = await this._pedir(msgs, o);
        txt = r.text || '';
        const call = comFerramentas ? (typeof parseTool === 'function' ? parseTool(txt) : null) : null;
        if (!call) break;
        log('  ferramenta: ' + call.tool);
        let res;
        try { res = await runTool(call, t => log('    ' + t)); }
        catch (e) { res = { ok: false, err: (typeof errText === 'function' ? errText(e) : String(e)) }; }
        usadas.push(call.tool);
        const saida = String(res.out || res.err || '').slice(0, 6000);
        // publica no quadro: o proximo agente (e o de amanha) ja sabe disso
        if (o.escopo && typeof Memoria !== 'undefined' && Memoria.achado) {
          try {
            Memoria.achado(o.papel + ' (' + String(o.modelo || 'auto').split('/').pop() + ') rodou ' + call.tool
              + ': ' + saida.replace(/\s+/g, ' ').slice(0, 240),
              { escopo: o.escopo, de: 'enxame', tags: [call.tool], tipo: res.ok === false ? 'erro' : 'achado' });
          } catch (e) {}
        }
        msgs.push({ role: 'assistant', content: txt });
        msgs.push({ role: 'user', content: 'RESULTADO da ferramenta ' + call.tool + (res.ok ? '' : ' (FALHOU)')
          + ':\n' + (saida || '(vazio)') + '\n\nResponda ao usuario com base nisso, em texto normal. Nao repita o JSON.' });
      }
      return { texto: txt, modelo: r ? r.model : '', src: r ? r.src : '', ferramentas: usadas, tentativas: r ? r.tried : 0 };
    },

    /* cada agente sai por uma conta diferente (o token do Puter e global:
       entao a troca e serializada, uma por agente, antes de ele comecar) */
    async _rodizio(cota) {
      if (!cota || cota.livres <= 1) return;
      if (typeof Pool === 'undefined' || !Pool.usarProximoPuter) return;
      this._fila = (this._fila || Promise.resolve()).then(async () => {
        try { await Pool.usarProximoPuter(); } catch (e) {}
      });
      try { await this._fila; } catch (e) {}
    },

    /* pedido com insistencia: 3 tentativas, com pausa crescente */
    async _pedir(msgs, o) {
      const opcoes = { stage: o.stage || 'chat', model: o.modelo, maxTries: o.maxTries || 6 };
      let ultimo = null;
      for (let t = 0; t < 3; t++) {
        try { return await Arkher.ask(msgs, opcoes); }
        catch (e) {
          ultimo = e;
          const m = String(e && e.message || e).toLowerCase();
          if (o.onLog && t < 2) o.onLog('  tropeçou (' + m.slice(0, 60) + ') — tentando de novo');
          const cota = /429|quota|limite|rate|usage|credit|insufficient/i.test(m);
          if (typeof Pool !== 'undefined' && Pool.girarPuter && cota) { try { await Pool.girarPuter(m); } catch (e2) {} }
          await new Promise(s => setTimeout(s, cota ? 1500 * (t + 1) : 400));
        }
      }
      throw ultimo;
    },

    /* ---------------- com limite de concorrencia ---------------- */
    async _comLimite(itens, limite, fn) {
      const out = new Array(itens.length);
      let i = 0;
      const trabalhadores = new Array(Math.min(limite, itens.length)).fill(0).map(async () => {
        for (;;) {
          const meu = i++;
          if (meu >= itens.length) return;
          try { out[meu] = await fn(itens[meu], meu); }
          catch (e) { out[meu] = { erro: (typeof errText === 'function' ? errText(e) : e.message || String(e)) }; }
        }
      });
      await Promise.all(trabalhadores);
      return out;
    },

    /* ---------------- 3) propor ----------------
       Todos respondem em paralelo, cada um com seu papel e ferramentas. */
    async propor(pergunta, time, o) {
      o = o || {};
      const log = o.onLog || (() => {});
      const t0 = Date.now();
      const eventos = [];
      const cota = o.cota || await this.cota();
      if (cota && cota.livres > 1) log('armazém: ' + cota.livres + ' contas livres — cada IA sai por uma');
      const propostas = await this._comLimite(time, o.paralelo || this.cfg.paralelo, async (m) => {
        if (o.cancelado && o.cancelado()) throw new Error('cancelado');
        await this._rodizio(cota);          // distribui as IAs entre as contas
        log('[' + m.papel + '] ' + String(m.id).split('/').pop().slice(0, 26) + ' pensando…');
        const ini = Date.now();
        const r = await this.agente(
          [{ role: 'system', content: this.PAPEIS[m.papel].add +
              '\n\nResponda em portugues do Brasil. Seja concreto e especifico.' },
           { role: 'user', content: pergunta }],
          { modelo: m.pedido,
            escopo: o.escopo, papel: m.papel, pergunta,
            onLog: t => log('[' + m.papel + '] ' + t.replace(/^\s+/, '')) });
        const p = { papel: m.papel, modelo: r.modelo || m.id, src: m.src || r.src,
                    pedido: m.pedido, escopo: m.escopo,
                    texto: r.texto, ms: Date.now() - ini, ferramentas: r.ferramentas || [] };
        eventos.push(p);
        log('[' + p.papel + '] pronto em ' + Math.round(p.ms / 1000) + 's'
          + (p.ferramentas.length ? ' (usou ' + p.ferramentas.join(', ') + ')' : ''));
        return p;
      });
      const boas = propostas.filter(p => p && !p.erro && p.texto && p.texto.trim().length > 20);
      const ruins = propostas.filter(p => p && (p.erro || !p.texto || p.texto.trim().length <= 20));
      if (ruins.length) log(ruins.length + ' agente(s) nao entregaram: ' + ruins.map(x => x.papel + '/' + (x.modelo || '?')).join(', '));
      return { ok: boas.length > 0, propostas: boas, falhas: ruins, ms: Date.now() - t0 };
    },

    /* ---------------- 3b) revisao cruzada ----------------
       Aqui e onde o conselho vira mais que a soma: cada agente LE o que os
       colegas propuseram e reescreve a propria proposta com o que for melhor.
       E o que a literatura chama de camada 2 do Mixture-of-Agents. */
    async revisar(pergunta, propostas, o) {
      o = o || {};
      const log = o.onLog || (() => {});
      const limite = Math.max(0, Math.min(propostas.length, o.maxRevisar != null ? o.maxRevisar : (this.cfg.maxRevisar || 6)));
      if (!limite) return { revisadas: 0 };
      const todas = propostas.map((p, i) => ({ i, papel: p.papel, modelo: p.modelo, texto: p.texto }));
      let revisadas = 0;
      await this._comLimite(propostas.slice(0, limite), o.paralelo || this.cfg.paralelo, async (p, idx) => {
        const colegas = todas.filter(x => x.i !== idx)
          .map(x => '--- colega ' + x.papel + ' (' + String(x.modelo || '?').split('/').pop() + '):\n' + x.texto.slice(0, 1800))
          .join('\n\n');
        if (!colegas) return;
        try {
          const r = await this.agente([
            { role: 'system', content: this.PAPEIS[p.papel].add + '\n\nAgora REVISE a sua propria proposta depois de ler '
              + 'os colegas: incorpore o que for melhor, corrija o que estiver errado e mantenha o que voce tem de '
              + 'melhor. Responda com a VERSAO FINAL (texto normal, nao fale sobre o processo).' },
            { role: 'user', content: 'PEDIDO:\n' + pergunta + '\n\nSUA PROPOSTA:\n' + p.texto.slice(0, 2500)
              + '\n\nPROPOSTAS DOS COLEGAS:\n' + colegas },
          ], { modelo: p.pedido, escopo: p.escopo, papel: p.papel, onLog: t => log('  [' + p.papel + '] ' + t.replace(/^\s+/, '')) });
          if (r.texto && r.texto.trim().length >= Math.max(80, p.texto.length * 0.5)) {
            p.texto = r.texto; p.revisado = true; p.ferramentas = (p.ferramentas || []).concat(r.ferramentas || []);
            revisadas++;
            log('[' + p.papel + '] revisou depois de ver os colegas');
          }
        } catch (e) { log('[' + p.papel + '] nao revisou: ' + e.message.slice(0, 60)); }
      });
      return { revisadas };
    },

    /* ---------------- 4) criticar ---------------- */
    async criticar(pergunta, propostas, modelo) {
      if (!propostas.length) return { notas: [], escolhida: -1 };
      const corpo = propostas.map((p, i) => '--- PROPOSTA ' + (i + 1) + ' (' + p.papel + ' · ' + String(p.modelo).split('/').pop() + ')\n' + p.texto.slice(0, 3500)).join('\n\n');
      const r = await this.agente([
        { role: 'system', content: 'Voce e o CRITICO do conselho. Julgue CADA proposta pelo que ela entrega de '
          + 'util e correto. Devolva no formato:\n' + 'NOTA 1: 8 | problema: <uma linha ou "nenhum">\n'
          + 'NOTA 2: 3 | problema: <uma linha>\n...\nMELHOR: <numero>\nCORRIGIR: <o que a resposta final precisa ter, em 3 linhas>' },
        { role: 'user', content: 'PEDIDO:\n' + pergunta + '\n\n' + corpo },
      ], { modelo, ferramentas: false, maxVoltas: 0, stage: 'code' });
      const txt = r.texto || '';
      const notas = [];
      const re = /NOTA\s*(\d+)\s*:\s*(\d+(?:[.,]\d+)?)\s*\|\s*problema\s*:\s*([^\n]*)/gi;
      let m;
      while ((m = re.exec(txt))) {
        notas.push({ idx: parseInt(m[1], 10) - 1, nota: parseFloat(m[2].replace(',', '.')), problema: (m[3] || '').trim() });
      }
      const mel = (txt.match(/MELHOR\s*:\s*(\d+)/i) || [])[1];
      const corrigir = (txt.match(/CORRIGIR\s*:\s*([\s\S]*)/i) || [])[1] || '';
      return { notas, escolhida: mel ? parseInt(mel, 10) - 1 : -1, corrigir: corrigir.trim().slice(0, 1200), bruto: txt.slice(0, 2000), modelo: r.modelo };
    },

    /* ---------------- 5) agregar ---------------- */
    async agregar(pergunta, propostas, critica, modelo) {
      const corpo = propostas.map((p, i) => {
        const nota = (critica.notas.find(n => n.idx === i) || {}).nota;
        const prob = (critica.notas.find(n => n.idx === i) || {}).problema;
        return '--- ' + (i + 1) + ') papel=' + p.papel + ' modelo=' + String(p.modelo).split('/').pop()
          + (nota != null ? ' nota=' + nota : '') + (prob && prob !== 'nenhum' ? ' problema=' + prob : '')
          + '\n' + p.texto.slice(0, 4000);
      }).join('\n\n');
      const r = await this.agente([
        { role: 'system', content: this.PAPEIS.agregador.add },
        { role: 'user', content: 'PEDIDO DO USUARIO:\n' + pergunta + '\n\nRESPOSTAS DO CONSELHO:\n' + corpo
          + (critica.corrigir ? '\n\nO CRITICO PEDIU QUE A RESPOSTA FINAL TIVESSE:\n' + critica.corrigir : '')
          + '\n\nEscreva a resposta final, completa e direta, sem falar de "propostas".' },
      ], { modelo, ferramentas: false, maxVoltas: 0, stage: 'chat' });
      return { texto: r.texto, modelo: r.modelo, src: r.src };
    },

    /* ---------------- 6) verificar (com ferramentas) ---------------- */
    async verificar(pergunta, resposta, modelo, onLog) {
      const log = onLog || (() => {});
      const r = await this.agente([
        { role: 'system', content: this.PAPEIS.verificador.add },
        { role: 'user', content: 'PEDIDO:\n' + pergunta + '\n\nRESPOSTA A VERIFICAR:\n' + String(resposta).slice(0, 6000)
          + '\n\nConfira o que puder com as ferramentas. Termine com "APROVADO" ou "CORRIGIR: <o que muda>".' },
      ], { modelo, onLog: t => log(t), maxVoltas: 3, stage: 'code' });
      const txt = r.texto || '';
      const aprovado = /APROVADO/i.test(txt) && !/^\s*CORRIGIR:/im.test(txt);
      const correcao = (txt.match(/CORRIGIR\s*:\s*([\s\S]*)/i) || [])[1] || '';
      return { aprovado, texto: txt, correcao: correcao.trim().slice(0, 1000), ferramentas: r.ferramentas, modelo: r.modelo };
    },

    /* ---------------- 7) aprender ---------------- */
    async aprender(pergunta, tarefa, propostas, final, critica) {
      const vencedora = critica.escolhida >= 0 ? propostas[critica.escolhida] : null;
      const notaFinal = 9;   // a resposta final e, por construcao, a melhor disponivel
      for (const p of propostas) {
        const nota = (critica.notas.find(n => n.idx === propostas.indexOf(p)) || {}).nota;
        this.registrar(tarefa, p.modelo, nota == null ? 5 : nota, p === vencedora);
      }
      if (final && final.modelo) this.registrar(tarefa, final.modelo, notaFinal, true);
      // memoria: a resposta final vira licao; o pior do conselho vira rejeitada (dado de DPO)
      try {
        if (typeof Neural !== 'undefined') {
          if (!Neural.pronto) await Neural.init();
          Neural.licao(pergunta, final.texto, { tags: tarefa, modelo: final.modelo });
          const piores = propostas.slice().sort((a, b) => {
            const na = (critica.notas.find(n => n.idx === propostas.indexOf(a)) || {}).nota || 0;
            const nb = (critica.notas.find(n => n.idx === propostas.indexOf(b)) || {}).nota || 0;
            return na - nb;
          });
          const pior = piores[0];
          if (pior && pior.texto !== final.texto && NEURAL_PREF()) {
            Neural.preferencia(pergunta, final.texto, pior.texto,
              { tags: tarefa, de: pior.modelo, para: final.modelo });
          }
        }
      } catch (e) {}
    },

    /* ---------------- tarefa grande? ---------------- */
    eGrande(pergunta) {
      const p = String(pergunta || '');
      if (p.length > 480) return true;
      return /\b(jogo|game|projeto|sistema|app|aplicativo|site|plataforma|do zero|completo|inteiro|inteira|pipeline|arquitetura|refator|migra|documenta|escala|multiplayer|rpg|fps|simulador|economia|inventario|save system|anti-?cheat|servidor)\b/i.test(p);
    },

    /* ---------------- modo profundo ----------------
       Tarefa grande nao se resolve numa resposta: um PLANEJADOR quebra em
       subtarefas, cada subtarefa roda o proprio conselho (menor) e o
       AGREGADOR final junta tudo num projeto. E mais poder, custando mais. */
    async planejar(pergunta, modelo, log) {
      const pedido = 'Divida este pedido em no maximo ' + (this.cfg.maxSub || 4) + ' SUBTAREFAS independentes, '
        + 'cada uma com entrega concreta (arquivo, sistema, numero, lista). Responda SOMENTE com um JSON: '
        + '{"tarefas":["...","..."]} — em portugues, cada tarefa em uma linha curta e acionavel.\n\nPEDIDO:\n' + pergunta;
      const r = await this._pedir([
        { role: 'system', content: this.PAPEIS.arquiteto.add + '\n\nVoce planeja e devolve so o JSON pedido.' },
        { role: 'user', content: pedido },
      ], { modelo, onLog: t => log('  ' + t) });
      const bruto = (r && (r.text || r.texto)) || '';
      let arr = [];
      try {
        const m = String(bruto).match(/\{[\s\S]*\}/);
        const j = JSON.parse(m ? m[0] : '{}');
        arr = (j.tarefas || j.subtarefas || []).map(x => String(x).trim()).filter(x => x.length > 8);
      } catch (e) { arr = []; }
      if (!arr.length) {                       // plano B: quebra por linhas
        arr = String(bruto).split('\n').map(x => x.replace(/^[\s\-*\d.]+/, '').trim())
          .filter(x => x.length > 12).slice(0, this.cfg.maxSub || 4);
      }
      return { tarefas: arr.slice(0, Math.max(1, this.cfg.maxSub || 4)), modelo: (r && r.model) || '' };
    },

    async sintetizar(pergunta, partes, modelo, critica, log) {
      const propostas = partes.map((p, i) => ({ papel: 'subtarefa ' + (i + 1), modelo: p.modelo || 'conselho',
                                                texto: 'SUBTAREFA: ' + p.sub + '\nENTREGA:\n' + p.texto, ferramentas: p.ferramentas || [] }));
      const c = critica || { notas: [], escolhida: -1,
                             corrigir: 'junte as subtarefas num projeto unico e coerente; diga onde cada arquivo vai e como testar' };
      return this.agregar(pergunta, propostas, c, modelo);
    },

    /* ---------------- o conselho inteiro ---------------- */
    async rodar(pergunta, o) {
      o = o || {};
      const log = o.onLog || (() => {});
      const t0 = Date.now();
      const tetoTotal = (o.tetoTotalS || this.cfg.tetoTotalS) * 1000;
      const esgotado = () => Date.now() - t0 > tetoTotal;

      /* 0. cota: com o armazem de contas, o conselho pode ser grande de verdade */
      const cota = await this.cota();
      const tam = await this.tamanho(o.n, cota);
      const paralelo = o.paralelo || tam.paralelo;
      const n = Math.max(1, Math.min(100, tam.n));
      log('cota: ' + (cota ? tam.motivo : 'sem armazem (padrao)') + ' -> ' + n + ' IAs, ' + paralelo + ' em paralelo');

      /* 1. modo profundo: tarefa grande vira varias subtarefas, cada uma com conselho */
      const prof = o.profund != null ? o.profund : this.cfg.profund;
      const nivel = o._nivel || 0;
      if (nivel === 0 && !esgotado() && (prof === true || (prof === 'auto' && this.eGrande(pergunta)))) {
        try {
          log('modo profundo: planejando as subtarefas...');
          const plano = await this.planejar(pergunta, o.modeloAgregador, log);
          if (plano.tarefas.length > 1) {
            log('plano: ' + plano.tarefas.length + ' subtarefas');
            const partes = [];
            for (let i = 0; i < plano.tarefas.length && !esgotado(); i++) {
              const sub = plano.tarefas[i];
              log('[' + (i + 1) + '/' + plano.tarefas.length + '] ' + sub.slice(0, 90));
              try {
                const rr = await this.rodar(sub, { n: Math.max(2, Math.min(n, 4)), criticar: true, verificar: false,
                                                   paralelo, _nivel: 1, onLog: t => log('  ' + t) });
                partes.push({ sub, texto: rr.texto, modelo: rr.modelo, ms: rr.ms, ferramentas: [] });
              } catch (e) { log('  subtarefa falhou: ' + e.message); }
            }
            if (partes.length) {
              log('juntando ' + partes.length + ' subtarefas num projeto...');
              const final = await this.sintetizar(pergunta, partes, o.modeloAgregador, null, log);
              try { await this.aprender(pergunta, 'profundo',
                    partes.map(p => ({ papel: 'subtarefa', modelo: p.modelo, texto: p.texto })),
                    final, { notas: [], escolhida: -1, corrigir: '' }); } catch (e) {}
              const resumo = { texto: final.texto, modelo: final.modelo, src: final.src, tarefa: this.classificar(pergunta),
                               agentes: partes.reduce((a, p) => a + 1, 0) + plano.tarefas.length, falhas: 0, rodadas: 1,
                               profundo: { tarefas: plano.tarefas, partes: partes.map(p => ({ sub: p.sub, ms: p.ms })) },
                               cota: cota ? { contas: cota.contas, livres: cota.livres } : null,
                               critica: { notas: [], escolhida: -1, problema: '' }, verificacao: null,
                               propostas: partes.map(p => ({ papel: 'subtarefa', modelo: p.modelo, ms: p.ms, ferramentas: [], tamanho: p.texto.length })),
                               ms: Date.now() - t0, quem: this.melhorPara('profundo', 3) };
              log('projeto pronto em ' + Math.round(resumo.ms / 1000) + 's · ' + partes.length + ' subtarefas');
              return resumo;
            }
          }
        } catch (e) { log('modo profundo nao rodou (' + e.message + ') — seguindo no conselho normal'); }
      }

      /* 2. conselho normal — com memoria compartilhada */
      const escopo = 'conselho:' + (o.id || ('c' + Date.now().toString(36)));
      const temMem = typeof Memoria !== 'undefined' && Memoria.cfg && Memoria.cfg.ligado;
      if (temMem) {
        try {
          const st = Memoria.stats();
          log('memória compartilhada: ' + st.total + ' itens (' + (st.porEscopo.conselho || 0) + ' de conselhos, '
            + (st.porEscopo.vm || 0) + ' de VMs, ' + (st.porEscopo.sessao || 0) + ' de chats)');
        } catch (e) {}
      }
      const usados = new Set();
      let { tarefa, time } = await this.time(pergunta, n);
      time.forEach(m => usados.add(m.id));
      log('tarefa: ' + tarefa + ' · time de ' + time.length + ' (n=' + n + ')');
      let prop = await this.propor(pergunta, time, { onLog: log, paralelo, cota, escopo });
      // 2b. revisao cruzada: cada agente le os colegas e melhora a propria proposta
      let revisadas = 0;
      if ((o.revisar != null ? o.revisar : this.cfg.revisar) && prop.propostas.length > 1 && !esgotado()) {
        try {
          log('revisão cruzada: cada agente vê os colegas e reescreve...');
          const rv = await this.revisar(pergunta, prop.propostas, { onLog: log, paralelo, escopo });
          revisadas = rv.revisadas || 0;
        } catch (e) { log('revisão cruzada nao rodou: ' + e.message); }
      }
      if (!prop.ok) throw new Error('nenhum agente entregou resposta — provedor fora do ar? tentativas: '
        + prop.falhas.map(f => f.erro).join(' | ').slice(0, 300));
      const teveCritica = !!(o.criticar != null ? o.criticar : this.cfg.criticar);
      let critica = teveCritica
        ? await this.criticar(pergunta, prop.propostas, o.modeloAgregador)
        : { notas: [], escolhida: -1, corrigir: '' };
      let final = await this.agregar(pergunta, prop.propostas, critica, o.modeloAgregador);
      let rodadas = 1, extra = 0;

      /* 3. escalada: a critica reprovou -> entra mais gente e agrega de novo */
      const notas = critica.notas.map(x => x.nota).filter(x => typeof x === 'number');
      const media = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 10;
      const fraco = teveCritica && (o.escalar != null ? o.escalar : this.cfg.escalar) && (critica.escolhida < 0 || media < 6.5);
      if (fraco && !esgotado() && usados.size < 60) {
        log('critica fraca (media ' + media.toFixed(1) + ') — escalando: entram mais IAs');
        try {
          const t2 = await this.time(pergunta, n, Array.from(usados));
          t2.time.forEach(m => usados.add(m.id));
          if (t2.time.length) {
            const p2 = await this.propor(pergunta, t2.time, { onLog: t => log('  ' + t), paralelo, cota, escopo });
            extra = p2.propostas.length;
            if (p2.propostas.length) {
              prop = { ok: true, propostas: prop.propostas.concat(p2.propostas), falhas: prop.falhas.concat(p2.falhas),
                       ms: prop.ms + p2.ms };
              critica = await this.criticar(pergunta, prop.propostas, o.modeloAgregador);
              final = await this.agregar(pergunta, prop.propostas, critica, o.modeloAgregador);
              rodadas++;
            }
          }
        } catch (e) { log('escalada nao deu: ' + e.message); }
      }

      /* 4. rodadas extras de revisao (se pedido) */
      const alvoRodadas = Math.max(1, o.rodadas || this.cfg.rodadas || 1);
      if (alvoRodadas > 1 && !esgotado()) {
        log('revisando com a critica (' + rodadas + ' -> ' + alvoRodadas + ' rodadas)...');
        final = await this.agregar(pergunta, prop.propostas, critica, o.modeloAgregador);
        rodadas++;
      }

      /* 5. verificacao com ferramentas */
      let verif = null;
      if ((o.verificar != null ? o.verificar : this.cfg.verificar) && !esgotado()) {
        log('verificando com ferramentas...');
        try { verif = await this.verificar(pergunta, final.texto, o.modeloAgregador, log); }
        catch (e) { log('verificacao nao rodou: ' + e.message); }
        if (verif && verif.correcao && !verif.aprovado && !esgotado()) {
          const fix = await this.agregar(pergunta,
            prop.propostas.concat([{ papel: 'correcao', modelo: 'verificador', texto: verif.texto }]),
            { notas: critica.notas, corrigir: verif.correcao }, o.modeloAgregador);
          final = fix; rodadas++;
        }
      }

      try { await this.aprender(pergunta, tarefa, prop.propostas, final, critica); } catch (e) {}
      if (temMem) {          // a decisao fica no quadro: o proximo chat/agente ja sabe
        try {
          Memoria.add({ tipo: 'decisao', escopo: 'global', de: 'enxame',
                        texto: 'conselho (' + (tarefa || 'geral') + ', ' + prop.propostas.length + ' IAs): '
                               + final.texto.replace(/\s+/g, ' ').slice(0, 300),
                        tags: [tarefa, 'enxame'] });
          await Memoria.sincronizar();
        } catch (e) {}
      }
      const resumo = { texto: final.texto, modelo: final.modelo, src: final.src, tarefa,
                       agentes: prop.propostas.length, falhas: prop.falhas.length, rodadas, extra, revisadas,
                       memoria: temMem ? { escopo, itens: Memoria.listar({ k: 999999 }).length } : null,
                       cota: cota ? { contas: cota.contas, livres: cota.livres } : null,
                       critica: { notas: critica.notas, escolhida: critica.escolhida, problema: critica.corrigir },
                       verificacao: verif ? { aprovado: verif.aprovado, texto: verif.texto.slice(0, 1500) } : null,
                       propostas: prop.propostas.map(p => ({ papel: p.papel, modelo: p.modelo, ms: p.ms,
                                                            ferramentas: p.ferramentas, tamanho: p.texto.length })),
                       ms: Date.now() - t0,
                       quem: this.melhorPara(tarefa, 3) };
      log('conselho concluido em ' + Math.round(resumo.ms / 1000) + 's · ' + resumo.agentes + ' propostas · '
        + (critica.corrigir ? 'critica: ' + critica.corrigir.slice(0, 80) : 'sem correcoes pedidas'));
      return resumo;
    },
  };

  function NEURAL_PREF() {
    return typeof Neural !== 'undefined' && Neural.cfg && Neural.cfg.preferencias !== false;
  }

  ENX.carregar();
  if (typeof window !== 'undefined') window.Enxame = ENX;
  if (typeof module !== 'undefined') module.exports = { Enxame: ENX };
})();
