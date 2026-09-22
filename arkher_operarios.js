/* ============================================================
   OPERÁRIOS — os modelos ociosos trabalhando sem parar

   O que você pediu: "todos os modelos não usados na hora pelo user
   estão buscando tudo que existe pela internet inteira, treinando sem
   parar". Aqui está o que disso é REAL, e é a parte que interessa:

   O QUE NÃO EXISTE (e por isso não está aqui):
     • treinar os modelos de API — não há canal de treino. Serviço é
       serviço: manda pergunta, recebe resposta. Ninguém do lado de fora
       escreve nos pesos deles. Não é falta de código nosso; é ausência
       de capacidade no provedor.
     • varrer a internet inteira — 100+ PB e, pior, texto bruto da web
       DESTRÓI qualidade de modelo. Quem faz isso filtra milhões de
       páginas antes.

   O QUE EXISTE, E É O QUE ESTE ARQUIVO FAZ:

     A COTA GRATUITA DIÁRIA É PERECÍVEL. Groq, Cerebras, Gemini e os
     outros dão N pedidos por dia e ZERAM à meia-noite. O que você não
     usar hoje, perdeu. Isso é, literalmente, capacidade ociosa.

     Os OPERÁRIOS pegam essa capacidade ociosa e colocam os modelos
     para trabalhar no SEU cofre: leem os blocos que ainda não foram
     digeridos, extraem o que é durável (fato, comando, regra) e
     gravam isso como REGRA no motor neural.

     E regra entra no prompt de TODOS. Ou seja: o trabalho dos modelos
     ociosos faz o próximo pedido — em qualquer modelo, inclusive o
     pago — já sair melhor. Sem treinar peso de ninguém.

   Garantias (testadas em teste_operarios.js):
     • só usa provedor GRATUITO — nunca a conta Puter do usuário;
     • não repete bloco já digerido (marca cada um);
     • se a cota secar, para e espera — não fica em loop de erro;
     • não inventa regra: o que não passar no filtro é descartado.
   ============================================================ */
'use strict';

const Operarios = {
  LOTE: 12,             // blocos por rodada (pedido pequeno = cabe na cota)
  MAX_REGRA: 300,       // tamanho máximo de uma regra aceita
  MIN_REGRA: 20,        // abaixo disso é ruído
  ESPERA: 20,           // segundos entre rodadas

  _timer: null,
  _log: null,
  _rodando: false,
  estado: { rodadas: 0, digeridos: 0, regras: 0, ultimo: '', seca: 0 },

  /* ---------- qual modelo gratuito vai trabalhar agora ---------- */
  escolher() {
    try {
      if (typeof Free === 'undefined') return null;
      const prontos = (Free.prontos ? Free.prontos() : []);
      for (const p of prontos) {
        const prov = Free.prov(p.id || p);
        if (!prov || prov.local) continue;
        const modelos = (prov.modelos || []).filter(m => !/whisper|tts|embed|image|video|audio|rerank/i.test(m));
        if (!modelos.length) continue;
        const chaves = Free.livres ? Free.livres(prov.id) : [];
        if (!chaves.length) continue;
        return { prov: prov.id, nome: prov.nome, modelo: modelos[0] };
      }
    } catch (e) {}
    return null;
  },

  /* ---------- blocos que ainda não foram digeridos ---------- */
  _lote(n) {
    if (typeof Neural === 'undefined') return [];
    return (Neural.itens || []).filter(x => !x.digerido).slice(0, n);
  },

  /* ---------- aceitar ou recusar o que o modelo devolveu ---------- */
  _aceitar(txt) {
    const limpo = String(txt || '').split('\n')
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length >= this.MIN_REGRA && l.length <= this.MAX_REGRA);
    const out = [];
    for (const l of limpo) {
      if (/^(claro|com certeza|aqui est[áa]|segue|espero ter|se precisar)/i.test(l)) continue;
      if (/^\[?\s*(regra|fato|comando|nota)\s*\]?$/i.test(l)) continue;
      if (typeof Neural !== 'undefined' && Neural.eGenerica && Neural.eGenerica(l)) continue;
      out.push(l);
    }
    return out;
  },

  /* grava as regras no motor neural (é isto que muda o próximo pedido de todos) */
  _gravar(regras) {
    if (typeof Neural === 'undefined' || !regras.length) return 0;
    const N = Neural;
    const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h.toString(36); };
    let add = 0;
    for (const txt of regras) {
      const chave = fnv(N.tokens(txt).slice(0, 6).join(' '));
      const ja = (N.regras || []).find(x => x.chave === chave);
      if (ja) { ja.peso = (ja.peso || 1) + 1; ja.t = Date.now(); continue; }
      N.regras.push({ chave: chave, txt: txt, peso: 1, t: Date.now(), fonte: 'operario' });
      add++;
    }
    N.regras.sort((a, b) => (b.peso || 1) - (a.peso || 1));
    if (N.regras.length > 60) N.regras.splice(60);
    try { N.salvar(true); } catch (e) {}
    return add;
  },

  /* ---------- uma rodada de trabalho ---------- */
  async rodada(onLog) {
    const log = onLog || this._log || (() => {});
    if (typeof Neural === 'undefined' || typeof Free === 'undefined') {
      return { ok: false, err: 'módulos não carregados' };
    }
    if (!Neural.pronto) { try { await Neural.init(log); } catch (e) {} }

    const quem = this.escolher();
    if (!quem) {
      this.estado.seca = (this.estado.seca || 0) + 1;
      log('nenhum provedor gratuito com chave viva agora (a cota volta no reset diário) — esperando');
      return { ok: false, semCota: true };
    }

    const lote = this._lote(this.LOTE);
    if (!lote.length) { log('nada novo para digerir — o cofre está em dia'); return { ok: true, vazio: true }; }

    const texto = lote.map((x, i) => (i + 1) + ') ' + String(x.txt).slice(0, 700)).join('\n\n');
    log('operário ' + quem.nome + ' (' + quem.modelo + ') lendo ' + lote.length + ' bloco(s)…');

    let saida = '';
    try {
      /* usa Free.ask direto: é garantidamente um provedor GRATUITO do site.
         (Com Arkher.ask seria {fundo:true} — a mesma regra: trabalho de fundo
         nunca toca a cota do Puter do usuário.) */
      saida = await Free.ask(quem.prov, quem.modelo, [
        { role: 'system', content:
            'Você extrai CONHECIMENTO DURÁVEL de material bruto. Devolva no máximo 8 linhas, uma por linha, ' +
            'cada uma sendo um fato, comando, definição ou regra que valha para sempre — não resuma o texto, ' +
            'não explique, não numere. Escreva em português, direto, sem preâmbulo. Se o material não tiver ' +
            'nada durável, devolva a palavra NADA.' },
        { role: 'user', content: texto },
      ]);
    } catch (e) {
      this.estado.seca = (this.estado.seca || 0) + 1;
      log('o operário parou: ' + String(e.message || e).slice(0, 90));
      return { ok: false, erro: String(e.message || e).slice(0, 160) };
    }

    if (/^\s*NADA\s*$/i.test(saida)) {
      this._marcar(lote);
      log('o modelo disse NADA (material sem fato durável) — blocos marcados');
      return { ok: true, nada: true, blocos: lote.length };
    }

    const regras = this._aceitar(saida);
    const add = this._gravar(regras);
    this._marcar(lote);
    this.estado.rodadas++;
    this.estado.digeridos += lote.length;
    this.estado.regras += add;
    this.estado.ultimo = new Date().toISOString();
    this.estado.seca = 0;
    log('+' + add + ' regra(s) nova(s) · ' + lote.length + ' bloco(s) digeridos · total de regras: ' +
        (Neural.regras || []).length);
    return { ok: true, regras: add, blocos: lote.length, total: (Neural.regras || []).length, modelo: quem.modelo };
  },

  _marcar(lote) {
    for (const x of lote) x.digerido = Date.now();
    try { if (Neural && Neural.salvar) Neural.salvar(true); } catch (e) {}
  },

  /* ---------- modo contínuo: trabalha até a cota secar ---------- */
  ligar(segundos, onLog) {
    const s = Math.max(15, Number(segundos) || this.ESPERA);
    if (this._timer) clearInterval(this._timer);
    this._log = onLog || null;
    const passo = async () => {
      if (this._rodando) return;                 // uma rodada por vez
      this._rodando = true;
      try { await this.rodada(onLog); }
      catch (e) { if (onLog) onLog('erro: ' + (e.message || e)); }
      finally { this._rodando = false; }
    };
    this._timer = setInterval(passo, s * 1000);
    passo();
    return { ok: true, intervalo: s };
  },
  desligar() { if (this._timer) { clearInterval(this._timer); this._timer = null; } return { ok: true }; },
  ligado() { return !!this._timer; },

  stats() {
    let regras = 0, pendentes = 0, itens = 0;
    try {
      regras = (Neural.regras || []).length;
      itens = (Neural.itens || []).length;
      pendentes = (Neural.itens || []).filter(x => !x.digerido).length;
    } catch (e) {}
    const quem = this.escolher();
    return Object.assign({}, this.estado, {
      ligado: this.ligado(), regras: regras, pendentes: pendentes, cofre: itens,
      trabalhando: quem ? (quem.nome + ' · ' + quem.modelo) : 'nenhum (sem cota grátis agora)',
    });
  },
};

if (typeof window !== 'undefined') window.Operarios = Operarios;
if (typeof module !== 'undefined' && module.exports) module.exports = { Operarios };
