/* =====================================================================
   OPERÁRIOS — o teste

   O que tem que ser verdade:

     1. o operário pega a COTA GRATUITA ociosa e põe o modelo para
        trabalhar no cofre (blocos ainda não digeridos);
     2. o que ele extrai vira REGRA — e regra entra no prompt de todos;
     3. bloco digerido não é digerido de novo;
     4. só usa provedor GRATUITO: em nenhum momento toca a conta Puter
        do usuário (cota de ninguém é gasta por isso);
     5. cota seca → para e espera, em vez de ficar em loop de erro;
     6. lixo não vira regra (filtro de saída).

   Rode:  node teste_operarios.js
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

/* ---- rede: chamadas ao provedor gratuito devolvem regras; Puter é proibido ---- */
const FOI_NO_PUTER = [];
let respostas = 0;

const fetchFalso = async (url, opt) => {
  const u = String(url);
  if (/api\.puter\.com/i.test(u)) FOI_NO_PUTER.push(u);

  let conteudo = 'O operário nunca deve falar isso: claro, aqui está o resumo do texto todo.';
  if (respostas === 0) {
    conteudo = 'O OLLAMA_ORIGINS=* libera o servidor local para o navegador.\n'
             + 'A porta padrão do Ollama é 11434.\n'
             + 'claro, aqui está o resumo do que você pediu\n'          // ruído: tem que cair fora
             + 'ok\n'                                                    // curto demais: cai fora
             + 'O nó com GPU expõe /infer e /treinar na porta 7860.';
  } else {
    conteudo = 'NADA';
  }
  respostas++;

  const corpo = { choices: [{ message: { content: conteudo } }] };
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo), body: null };
};

const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  TextDecoder, TextEncoder, localStorage: ls, fetch: fetchFalso,
  URL, URLSearchParams, AbortController: globalThis.AbortController,
});
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.location = { origin: 'https://x.test', protocol: 'https:' };
ctx.navigator = { userAgent: 'teste' };

for (const f of ['core.js', 'neural.js', 'freeai.js', 'pool.js', 'arkher_pack.js', 'arkher_operarios.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { Operarios, Neural, Free } = ctx;

const PACK = [
  '# PACK: infra do projeto',
  '## Servidor local',
  '- para liberar o Ollama para o site: OLLAMA_ORIGINS=* ollama serve, na porta 11434',
  '- o nó com GPU expõe /infer e /treinar na porta 7860 e aceita job assíncrono',
  '## Rede',
  '- se o Kaggle cair, o endereço do nó muda: conferir na aba VM antes de treinar',
].join('\n');

(async function () {
  console.log('=== 1) o operário pega a cota gratuita ociosa ===');

  const prov = Free.provs()[0];
  Free.add(prov.id, 'chave_gratuita_do_site');
  ctx.localStorage.setItem('puter.auth.token', 'TOKEN_PUTER_DO_USUARIO');   // existe, mas não deve ser usado

  await ctx.MegaPack.ingerir(PACK);
  ok(Neural.itens.length >= 3, 'o cofre tem material para digerir: ' + Neural.itens.length + ' bloco(s)');

  const quem = Operarios.escolher();
  ok(quem && quem.prov === prov.id, 'o operário escolheu um provedor GRATUITO: ' + (quem && quem.nome));
  ok(quem && quem.modelo, 'e um modelo dele: ' + (quem && quem.modelo));

  console.log('\n=== 2) trabalha e o resultado vira REGRA ===');

  const r1 = await Operarios.rodada(t => console.log('     · ' + t));
  ok(r1.ok && r1.regras >= 2, 'extraiu regras do material: ' + (r1 && r1.regras));
  ok((Neural.regras || []).length >= 2, 'elas estão no motor neural: ' + (Neural.regras || []).length);

  const textoRegras = Neural.regrasTexto();
  ok(/OLLAMA_ORIGINS/.test(textoRegras), 'a regra do Ollama entrou: "' + textoRegras.slice(0, 70) + '…"');
  ok(/11434|7860/.test(textoRegras), 'e as portas também');

  console.log('\n=== 3) lixo não vira regra ===');

  ok(!/claro, aqui está/i.test(textoRegras), 'a linha "claro, aqui está…" foi descartada');
  ok(!(Neural.regras || []).some(r => r.txt.trim().length < 20), 'nenhuma regra curta demais entrou');

  console.log('\n=== 4) bloco digerido não é digerido de novo ===');

  const pendentes1 = Neural.itens.filter(x => !x.digerido).length;
  await Operarios.rodada();
  const pendentes2 = Neural.itens.filter(x => !x.digerido).length;
  ok(pendentes2 === 0, 'na segunda rodada não há mais nada pendente (' + pendentes2 + ')');

  const r3 = await Operarios.rodada();
  ok(r3.ok && r3.vazio, 'e o operário diz "cofre em dia" em vez de repetir trabalho');

  console.log('\n=== 5) a conta Puter do usuário nunca é tocada ===');

  ok(FOI_NO_PUTER.length === 0, 'nenhuma chamada foi para o Puter — a cota do usuário está intacta',
     'chamou: ' + JSON.stringify(FOI_NO_PUTER.slice(0, 2)));

  console.log('\n=== 6) cota seca: para e espera ===');

  Neural.itens.push({ id: 'x1', txt: 'material novo para forçar outra rodada com o provedor que já disse NADA', tags: '', t: Date.now(), src: 'teste' });
  const r4 = await Operarios.rodada();
  ok(r4.ok && r4.nada, 'quando o modelo devolve NADA, os blocos são marcados (não fica reprocessando)');

  const chavesAntes = Free.chaves(prov.id).length;
  /* esgota a cota do jeito que o próprio motor faz (429/quota) */
  Free.chaves(prov.id).forEach(k => Free.falhou(prov.id, k, 'HTTP 429 quota'));
  const vivas = Free.livres ? Free.livres(prov.id).length : 0;
  ok(vivas === 0, 'simulamos a cota esgotada: nenhuma chave viva agora');
  const r5 = await Operarios.rodada();
  ok(r5.ok === false && r5.semCota, 'sem chave viva, o operário para e avisa (não entra em loop de erro)');
  ok(Operarios.stats().trabalhando.indexOf('nenhum') >= 0, 'e o painel mostra que não há cota agora');
  Free.chaves(prov.id).forEach(k => { k.ate = 0; });
  ok(Free.chaves(prov.id).length === chavesAntes, 'nada foi perdido: ao voltar a cota, as chaves continuam lá');

  console.log('\n=== 7) o limite honesto ===');

  const api = Object.keys(Operarios).join(' ');
  ok(!/treinarModelo|ajustarPeso|fineTune|gradient/i.test(api),
     'não existe função de treino de peso aqui — o trabalho é LER e DESTILAR', 'funções: ' + api);

  const s = Operarios.stats();
  console.log('\n   estado: ' + JSON.stringify({ rodadas: s.rodadas, digeridos: s.digeridos, regras: s.regras }));

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ OPERÁRIOS OK — a cota gratuita ociosa vira regra, e regra entra no prompt de todos'));
  process.exitCode = falhou ? 1 : 0;
})();
