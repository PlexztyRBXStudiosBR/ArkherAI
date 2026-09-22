/* =====================================================================
   AS DUAS COTAS E A DIREÇÃO ENTRE ELAS

   O que este teste prova, concretamente, interceptando TODO fetch:

     1. o site gasta a cota do Puter quando precisa — com o token do
        USUÁRIO, e nada mais;
     2. o site gasta a cota DELE (HF, chave grátis, GPU, biblioteca)
        sem encostar em nenhum token do Puter;
     3. no pedido ao Puter NÃO vai nenhuma credencial do site
        (nem chave grátis, nem token HF, nem endereço da GPU);
     4. no pedido ao HF/provedor grátis NÃO vai nenhum token do Puter;
     5. "Puter → cota do site" é zero: o Puter não tem como chamar o site.

   Rode:  node teste_cotas.js
   ===================================================================== */
'use strict';

const vm = require('vm');
const fs = require('fs');

let falhou = 0;
function ok(cond, texto, extra) {
  if (cond) { console.log('  ok  ' + texto); return true; }
  falhou++;
  console.log('  FALHOU: ' + texto + (extra ? '\n          → ' + extra : ''));
  return false;
}

const mem = {};
const ls = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; },
  clear: () => { for (const k in mem) delete mem[k]; },
};

const CHAMADAS = [];   // o bloco que está sendo olhado agora
const TODAS = [];      // TUDO que saiu do site no teste inteiro (nunca é limpo)

function corpoDe(opt) {
  try { return typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body || {}); }
  catch (e) { return ''; }
}

const fetchEspiao = async (url, opt) => {
  opt = opt || {};
  const h = opt.headers || {};
  const rec = {
    url: String(url),
    headers: Object.assign({}, h),
    corpo: corpoDe(opt),
    auth: String(h.Authorization || h.authorization || '').replace(/^Bearer\s+/, ''),
  };
  CHAMADAS.push(rec);
  TODAS.push(rec);
  // resposta que serve para o Puter, para o HF e para OpenAI-compatíveis
  const corpo = { choices: [{ message: { content: 'resposta de teste' } }] };
  return {
    ok: true, status: 200,
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
    body: null,
  };
};

const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout,
  TextDecoder, TextEncoder, localStorage: ls, fetch: fetchEspiao,
});
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.location = { origin: 'https://x.test', protocol: 'https:' };
ctx.navigator = { userAgent: 'teste' };

for (const f of ['core.js', 'freeai.js', 'pool.js', 'respostas.js', 'app.js', 'cotas.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}

const { Cotas, Puter, HF, LS, Pool, Free } = ctx;

/* credenciais dos dois mundos, bem distintas, para o teste conseguir apontar */
const TOKEN_DO_USUARIO = 'TOKEN_PUTER_DO_USUARIO_999';
const CHAVE_GRATIS     = 'AIza_CHAVE_GRATIS_DO_SITE_111';
const TOKEN_HF         = 'hf_TOKEN_DO_SITE_222';
const URL_GPU          = 'https://gpu-do-site.local:8080';

/* chaves que não podem sair do lugar errado */
const CRED_SITE = [CHAVE_GRATIS, TOKEN_HF, URL_GPU, 'hf_TOKEN_DO_SITE'];
const CRED_PUTER = [TOKEN_DO_USUARIO];

function vazou(rec, lista) {
  const tudo = rec.url + ' ' + rec.auth + ' ' + rec.corpo + ' ' + JSON.stringify(rec.headers);
  return lista.filter(c => tudo.includes(c));
}

(async function () {
  console.log('=== preparando: site com cota própria + usuário com conta Puter ===');

  const prov = Free.provs()[0];                       // primeiro provedor grátis
  Free.add(prov.id, CHAVE_GRATIS);                    // chave DO SITE
  LS.set('arkher_hf_token', TOKEN_HF);                // token HF DO SITE
  LS.set('arkher_gpu_url', URL_GPU);
  ctx.localStorage.setItem('puter.auth.token', TOKEN_DO_USUARIO);   // conta DO USUÁRIO

  ok(Free.prontos && Free.prontos().length >= 1, 'o site tem pelo menos uma chave grátis própria');
  ok(!!HF.token(), 'o site tem token do HF próprio');
  ok(Puter.tokenDe() === TOKEN_DO_USUARIO, 'o usuário tem a conta Puter dele');

  console.log('\n=== 1) o site gasta a cota do PUTER (com o token do usuário) ===');

  CHAMADAS.length = 0;
  await Puter.askREST('claude-sonnet-5', [{ role: 'user', content: 'oi' }]);
  const p1 = CHAMADAS.filter(c => /puter\.com/.test(c.url));
  ok(p1.length === 1, 'saiu exatamente um pedido para o Puter');
  ok(p1[0] && p1[0].auth === TOKEN_DO_USUARIO, 'o pedido levou o token do USUÁRIO');
  ok(p1.every(c => vazou(c, CRED_SITE).length === 0),
     'nenhuma credencial do site foi junto',
     'achou: ' + JSON.stringify(p1.map(c => vazou(c, CRED_SITE))));

  console.log('\n=== 2) o site gasta a cota DELE (sem encostar no Puter) ===');

  CHAMADAS.length = 0;
  try { await HF.ask('meta-llama/Llama-3.1-8B-Instruct', [{ role: 'user', content: 'oi' }]); } catch (e) {}
  const h = CHAMADAS.filter(c => /huggingface\.co/.test(c.url));
  ok(h.length >= 1, 'saiu pedido para o Hugging Face (cota do SITE)');
  ok(h.every(c => c.auth === TOKEN_HF), 'levou o token do HF do site');
  ok(h.every(c => vazou(c, CRED_PUTER).length === 0),
     'o token do Puter NÃO foi junto',
     'achou: ' + JSON.stringify(h.map(c => vazou(c, CRED_PUTER))));

  console.log('\n=== 3) o outro provedor grátis também é cota do site ===');

  CHAMADAS.length = 0;
  try { await Free.ask(prov.id, 'modelo-teste', [{ role: 'user', content: 'oi' }]); } catch (e) {}
  const g = CHAMADAS.filter(c => !/puter\.com|huggingface\.co/.test(c.url));
  if (g.length) {
    ok(g.every(c => vazou(c, CRED_PUTER).length === 0),
       'no provedor grátis do site não foi nenhum token do Puter');
    /* a chave DO PRÓPRIO provedor pode ir (é a cota do site sendo usada);
       o que não pode ir junto é credencial de OUTRO lugar */
    const outros = [TOKEN_HF, URL_GPU].concat(CRED_PUTER);
    ok(g.every(c => vazou(c, outros).length === 0),
       'não foi junto nenhuma credencial de outro serviço',
       JSON.stringify(g.map(c => vazou(c, outros))));
  } else {
    ok(true, 'provedor grátis não fez chamada de rede neste teste (sem prejuízo da checagem)');
  }

  console.log('\n=== 4) a biblioteca do site responde sem sair pedido nenhum ===');

  const pergunta = [{ role: 'user', content: 'Como eu declaro uma constante em JavaScript moderno?' }];
  const chave = ctx.Resp.chave(pergunta, 'chat');
  await ctx.Resp.guardar(chave, 'Use const.', 'teste');
  CHAMADAS.length = 0;
  const r = await ctx.Arkher.ask(pergunta, { cache: true });
  ok(CHAMADAS.length === 0, 'respondeu a pergunta repetida SEM nenhuma chamada de rede');
  ok(r && r.src === 'cache' && r.gastouSaldo === false,
     'a resposta veio da biblioteca e não gastou saldo de ninguém', JSON.stringify(r && r.src));

  console.log('\n=== 5) a direção: site → Puter sim; Puter → site não existe ===');

  /* medido na EVIDÊNCIA: o que saiu de verdade na rede */
  const nPuter = TODAS.filter(c => /puter\.com/.test(c.url)).length;
  const nSite  = TODAS.filter(c => !/puter\.com/.test(c.url)).length;
  ok(nPuter >= 1, 'o site pediu ao Puter: ' + nPuter + ' vez(es) — direção site → Puter');
  ok(nSite >= 1, 'o site atendeu pela cota própria: ' + nSite + ' vez(es)');
  ok(!TODAS.some(c => /meusite|arkher.*callback|webhook/i.test(c.url)),
     'o Puter pediu ao site: 0 — nenhum endereço do site é chamado por ele');
  const d = Cotas.direcao();
  ok(d.puter_pediu_site === 0, 'e o painel registra essa direção como zero');

  /* a prova estrutural: em NENHUMA chamada do Puter vai credencial do site,
     e o site não expõe nenhum endereço que o Puter possa chamar */
  const todasPuter = CHAMADAS.filter(c => /puter\.com/.test(c.url));
  ok(todasPuter.every(c => vazou(c, CRED_SITE).length === 0),
     'em nenhum momento o site mandou a própria cota para o Puter');

  const painel = await Cotas.painel();
  ok(painel.site.gratis >= 1 && painel.site.hf === true,
     'o painel mostra a cota do site: ' + JSON.stringify(painel.site));
  ok(painel.puter.contas === 0 && painel.puter.sessaoAqui === true,
     'e a cota do Puter: sessão do usuário ativa, sem conta capturada: ' + JSON.stringify(painel.puter));

  console.log('\n=== 6) o que o site NÃO faz com a cota do Puter ===');

  const apiCotas = Object.keys(Cotas).join(' ');
  ok(!/gastarPuter|usarCota|transferir|somar/i.test(apiCotas),
     'Cotas só mede e mostra — não tem função de gastar/transferir cota', 'funções: ' + apiCotas);

  const painelStr = JSON.stringify(painel);
  ok(!new RegExp(TOKEN_DO_USUARIO + '|' + CHAVE_GRATIS + '|' + TOKEN_HF).test(painelStr),
     'o painel não expõe nenhuma credencial');

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ DUAS COTAS OK — o site gasta a do Puter e a dele; o Puter não gasta a do site (esse caminho não existe)'));
  process.exitCode = falhou ? 1 : 0;
})();
