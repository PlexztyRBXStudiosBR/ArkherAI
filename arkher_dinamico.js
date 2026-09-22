/* ============================================================
   INGESTÃO CONTÍNUA (o "sem parar" que existe de verdade)

   O que você pediu: os modelos que não estão em uso ficam varrendo a
   internet inteira, sem parar, aprendendo tudo, e ficam "extremamente
   poderosos" — sem mexer nos originais.

   O que eu construí aqui é a parte disso que EXISTE, e ela é boa:

     • uma FILA que trabalha sozinha, em segundo plano, sem parar;
     • baixa página → tira o HTML → corta em blocos → indexa no cofre
       neural (o mesmo motor do Mega Pack);
     • "semeia": de uma página, pega os links e enfileira os próximos
       (com limite de profundidade e de quantidade);
     • custo de IA: ZERO. É download e indexação — não chama modelo
       nenhum, então não gasta cota de ninguém, nem sua.

   Por que isso é poderoso: o que entra no cofre passa a ser injetado no
   prompt de QUALQUER modelo (Gemini, Kimi, GLM, o seu nó). Um modelo
   mediano com o cofre cheio do SEU assunto responde melhor que um top
   sem contexto nenhum. É o aprendizado que dá para fazer de verdade.

   AGORA O QUE NÃO EXISTE — e é melhor você saber pelo autor do que
   descobrir depois de gastar meses tentando:

   1) "TREINAR" OS MODELOS DE API. GPT, Claude, Gemini, Kimi, GLM... são
      serviços: você manda pergunta, recebe resposta. Não existe canal
      para enviar treino, e não existe acesso aos pesos. "Contínuo,
      pesado, sem parar" neles não é difícil — é impossível. Ninguém faz.

   2) VARRER A INTERNET INTEIRA. O archive.org sozinho passa de 100
      petabytes. Baixar isso é fisicamente impossível num site no
      navegador, e mesmo com um data center levaria décadas. Pior: treinar
      com texto bruto da web sem filtro faz o modelo ficar PIOR (é o
      "colapso de modelo", que a própria indústria já documentou).

   3) "TREINAR SEM GPU". Não existe. Treino de peso precisa de GPU. Sem
      GPU o que dá é EXATAMENTE isto que está aqui: indexar e recuperar
      (RAG) + destilar regras. É por isso que o cofre cresce sem GPU e o
      modelo não.

   4) CONTÍNUO DE VERDADE NO KAGGLE. O Kaggle dá GPU grátis, mas em
      sessões (não fica ligado para sempre) e com cota semanal. Dá para
      treinar LoRA — um modelo SEU, de cada vez — e mandar para o cofre.
      Não é "todos ao mesmo tempo, sem parar".

   Resumindo em uma frase: **o que cresce sem parar é o cofre, não o
   modelo.** O cofre é dinâmico, contínuo e não custa cota. É isso que
   faz o site ficar mais forte a cada dia.
   ============================================================ */
'use strict';

const Dinamico = {
  MAX_FILA: 400,          // teto da fila (não vira crawler descontrolado)
  MAX_POR_RODADA: 4,      // quantas páginas por vez
  MAX_DEPTH: 2,           // quantos "saltos" a semeadura pode dar
  MAX_LINKS_PAGINA: 25,   // quantos links cada página semeia
  MAX_TEXTO: 60000,       // corte do texto de cada página
  ESPERA_MS: 2500,        // pausa entre páginas (respeito ao servidor)

  _timer: null,
  ultimo: '',

  fila() { return LS.get('arkher_fila', []) || []; },
  _salvarFila(f) { LS.set('arkher_fila', f.slice(0, this.MAX_FILA)); },
  vistos() { return LS.get('arkher_vistos', {}) || {}; },

  /* ---------- enfileirar ---------- */
  enfileirar(urls, opts) {
    opts = opts || {};
    const f = this.fila();
    const v = this.vistos();
    const novos = [];
    const lista = (Array.isArray(urls) ? urls : [urls]).map(u => String(u || '').trim()).filter(Boolean);
    for (const u of lista) {
      if (!/^https?:\/\//i.test(u)) continue;
      if (v[u]) continue;                                  // já visitada
      if (f.some(x => x.url === u)) continue;              // já na fila
      f.push({ url: u, depth: Number(opts.depth) || 0, t: Date.now() });
      novos.push(u);
    }
    this._salvarFila(f);
    return { ok: novos.length, fila: this.fila().length, novos: novos };
  },

  /* ---------- baixar + limpar ---------- */
  _limpar(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
  },

  _links(html, base) {
    const out = [];
    const re = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
    let m;
    while ((m = re.exec(html)) && out.length < this.MAX_LINKS_PAGINA) {
      let h = m[1].trim();
      if (/^(mailto:|javascript:|tel:|data:)/i.test(h)) continue;
      try { h = new URL(h, base).href.split('#')[0]; } catch (e) { continue; }
      if (!/^https?:\/\//i.test(h)) continue;
      if (/\.(png|jpe?g|gif|svg|css|js|pdf|zip|mp4|mp3|webp|ico)$/i.test(h)) continue;
      if (!out.includes(h)) out.push(h);
    }
    return out;
  },

  /* ---------- trabalhar a fila ---------- */
  async rodar(quantas, onLog) {
    const log = onLog || (() => {});
    if (typeof Neural === 'undefined') return { ok: false, err: 'motor neural não carregado' };
    if (!Neural.pronto) { try { await Neural.init(log); } catch (e) {} }
    if (typeof Web === 'undefined' || !Web.baixar) return { ok: false, err: 'módulo de download (websearch.js) não carregado' };

    const max = Math.max(1, Math.min(quantas || this.MAX_POR_RODADA, this.MAX_FILA));
    let baixadas = 0, indexados = 0, links = 0, erros = [];

    for (let i = 0; i < max; i++) {
      const f = this.fila();
      if (!f.length) break;
      const item = f.shift();
      this._salvarFila(f);

      const v = this.vistos();
      v[item.url] = Date.now();
      LS.set('arkher_vistos', v);

      try {
        log('baixando ' + item.url.slice(0, 70) + '…');
        const html = await Web.baixar(item.url);
        baixadas++;
        const texto = this._limpar(html).slice(0, this.MAX_TEXTO);
        if (texto.length > 400) {
          const n = await Neural.add(texto, { src: 'web', fonte: item.url, peso: 1, max: 1000 }, log);
          indexados += n;
        }
        if (item.depth < this.MAX_DEPTH) {
          const achados = this._links(html, item.url);
          const r = this.enfileirar(achados, { depth: item.depth + 1 });
          links += r.ok;
        }
        log('ok: ' + item.url.slice(0, 50) + ' → ' + item.url.slice(0, 0) + ' ' + (texto.length) + ' caracteres');
      } catch (e) {
        erros.push({ url: item.url, erro: String(e.message || e).slice(0, 120) });
        log('falhou: ' + item.url.slice(0, 60) + ' (' + String(e.message || e).slice(0, 60) + ')');
      }
      if (i < max - 1) await new Promise(s => setTimeout(s, this.ESPERA_MS));
    }

    this.ultimo = new Date().toISOString();
    return { ok: true, baixadas: baixadas, indexados: indexados, links: links,
             fila: this.fila().length, erros: erros.slice(0, 5) };
  },

  /* ---------- semear: de uma página, os links dela ---------- */
  async semear(url, opts) {
    opts = opts || {};
    const r = this.enfileirar([url], { depth: 0 });
    if (!opts.soEnfileirar) return this.rodar(opts.quantas || 3, opts.onLog);
    return r;
  },

  /* ---------- modo contínuo (o "sem parar" honesto) ---------- */
  ligar(segundos, onLog) {
    const s = Math.max(10, Number(segundos) || 30);
    if (this._timer) clearInterval(this._timer);
    this.ultimo = '';
    const passo = async () => {
      try {
        const r = await this.rodar(this.MAX_POR_RODADA, onLog);
        if (onLog) onLog('rodada: ' + (r.baixadas || 0) + ' baixada(s) · fila: ' + (r.fila || 0));
        if (!r.fila) { if (onLog) onLog('fila vazia — enfileire mais links ou desligue'); this.desligar(); }
      } catch (e) { if (onLog) onLog('erro na rodada: ' + (e.message || e)); }
    };
    this._timer = setInterval(passo, s * 1000);
    passo();
    return { ok: true, intervalo: s };
  },
  desligar() { if (this._timer) { clearInterval(this._timer); this._timer = null; } return { ok: true, ligado: false }; },
  ligado() { return !!this._timer; },

  stats() {
    const f = this.fila();
    const v = this.vistos();
    let itens = 0, web = 0;
    try { const s = Neural.stats_(); itens = s.itens; web = s.porFonte.web || 0; } catch (e) {}
    return { fila: f.length, visitadas: Object.keys(v).length, indexadas: itens,
             blocosWeb: web, ligado: this.ligado(), ultimo: this.ultimo };
  },

  limpar() {
    this.desligar();
    LS.set('arkher_fila', []);
    LS.set('arkher_vistos', {});
    return this.stats();
  },
};

if (typeof window !== 'undefined') window.Dinamico = Dinamico;
if (typeof module !== 'undefined' && module.exports) module.exports = { Dinamico };
