/* ============================================================
   COTAS — os dois livros-caixa do site, e a direção entre eles.

   Existem DUAS cotas, e elas são coisas diferentes:

     ┌─ COTA DO SITE ────────────────────────────────────────────┐
     │ É o que o site tem por conta própria:                     │
     │   • chaves grátis (Gemini, Groq, Cerebras, OpenRouter…)   │
     │   • token do Hugging Face                                │
     │   • o nó com GPU da sua máquina                          │
     │   • a biblioteca comum (resposta já paga = custo zero)    │
     │ O site GASTA essa cota para atender quem está usando.     │
     │ Ela é do site e não sai dele.                             │
     └───────────────────────────────────────────────────────────┘

     ┌─ COTA DO PUTER ───────────────────────────────────────────┐
     │ São os créditos das contas Puter (a de cada pessoa).      │
     │ O site GASTA essa cota quando o pedido vai para os        │
     │ modelos que só existem lá — e gasta a cota da conta que   │
     │ fez o pedido, com o token dela.                           │
     └───────────────────────────────────────────────────────────┘

   A DIREÇÃO é um sentido único, e isso não é promessa: é arquitetura.

     site  ──gasta──▶  cota do Puter        (o site é cliente da API)
     Puter ──gasta──▶  cota do site         ✗ NÃO EXISTE

   O Puter nunca chama o site. Não existe callback, webhook nem endpoint
   nosso que ele possa acionar; logo não há como ele consumir a cota do
   site — nem as chaves grátis, nem o HF, nem a GPU. O único caminho que
   existe é o site pedindo ao Puter, com o token do usuário.

   Este arquivo só MEDE e MOSTRA isso. Ele não move cota nenhuma.
   ============================================================ */
'use strict';

const Cotas = {
  /* ---------- LIVRO A: o que é do site ---------- */
  site() {
    let gratis = [], gpu = [];
    try { gratis = (typeof Free !== 'undefined' && Free.prontos) ? Free.prontos() : []; } catch (e) {}
    let hf = false, hfQtd = 0;
    try {
      hf = (typeof HF !== 'undefined' && HF.token) ? !!HF.token() : false;
      const o = (typeof Pool !== 'undefined' && Pool.local) ? Pool.local() : {};
      hfQtd = (o.hf || []).length;
    } catch (e) {}
    try { gpu = (typeof GPU !== 'undefined' && GPU.nos) ? GPU.nos() : []; } catch (e) {}
    return { gratis: gratis.length, hf: hf, hfContas: hfQtd, gpu: (gpu || []).length };
  },

  /* ---------- LIVRO B: o que é do Puter ---------- */
  async puter() {
    const o = (typeof Pool !== 'undefined' && Pool.local) ? Pool.local() : {};
    const contas = (o.puter || []).length;
    let sessao = false;
    try { sessao = !!(typeof Pool !== 'undefined' && Pool.tokenAtualPuter && Pool.tokenAtualPuter()); } catch (e) {}
    return { contas: contas, sessaoAqui: sessao };
  },

  /* ---------- DIREÇÃO: quanto foi de um lado, e do outro ----------
     O lado "Puter → site" é zero por construção, e o teste prova por quê. */
  direcao() {
    let u = { free: 0, top: 0, puter: 0, cache: 0 };
    try { if (typeof Arkher !== 'undefined' && Arkher.uso) u = Arkher.uso(); } catch (e) {}
    let cache = 0;
    try { const o = LS.get('arkher_cache', {}); for (const k in o) cache += (o[k].n || 0); } catch (e) {}
    const doSite = (u.free || 0) + cache;                  // cota do site atendendo
    const paraPuter = (u.puter || 0) + (u.top || 0);        // site pedindo ao Puter
    return {
      site_atendeu: doSite,          // pedidos que o site resolveu sozinho
      site_pediu_puter: paraPuter,   // pedidos que foram para a cota do Puter
      puter_pediu_site: 0,           // não existe: o Puter não chama o site
      semCusto: cache,
    };
  },

  /* ---------- o painel ---------- */
  async painel() {
    const s = this.site();
    const p = await this.puter();
    const d = this.direcao();
    const total = d.site_atendeu + d.site_pediu_puter;
    return { site: s, puter: p, direcao: d, total: total,
             pctSite: total ? Math.round((d.site_atendeu / total) * 100) : 0 };
  },
};

if (typeof window !== 'undefined') window.Cotas = Cotas;
if (typeof module !== 'undefined' && module.exports) module.exports = { Cotas };
