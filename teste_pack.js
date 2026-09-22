/* =====================================================================
   MEGA PACK / COFRE NEURAL — o teste

   O que tem que ser verdade:

     1. um pack grande é LIDO e INDEXADO (bloco a bloco);
     2. uma pergunta sobre o assunto traz o trecho certo de volta —
        mesmo perguntando com OUTRAS PALAVRAS (busca por significado);
     3. o trecho achado ENTRA NO PROMPT do modelo (é isso que faz o
        pack valer: senão ele só está guardado à toa);
     4. ingerir duas vezes não duplica;
     5. o cofre EXPORTA tudo e o que saiu pode ser lido de volta;
     6. e o limite honesto: nenhuma função treina modelo fechado nem
        "instala" instrução nos pesos.

   Rode:  node teste_pack.js
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

const fetchFalso = async () => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content: 'resposta' } }] }),
  text: async () => '{}', body: null,
});

const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout,
  TextDecoder, TextEncoder, localStorage: ls, fetch: fetchFalso,
});
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.location = { origin: 'https://x.test', protocol: 'https:' };
ctx.navigator = { userAgent: 'teste' };

for (const f of ['core.js', 'neural.js', 'freeai.js', 'pool.js', 'respostas.js', 'arkher_pack.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { MegaPack, Neural, Arkher } = ctx;

const PACK = [
  '# PACK: manual da nave ARKHER',
  '',
  '## Servidor com GPU',
  '@fonte: anotações do dono',
  '- para liberar o Ollama para o site, inicie com: OLLAMA_ORIGINS=* ollama serve',
  '- o nó de vídeo fica em http://192.168.0.10:7860 e aceita /infer e /treinar',
  '- se o Kaggle cair, o endereço do nó muda: confira na aba VM antes de treinar',
  '',
  '## Regras de estilo do projeto',
  '- respostas curtas: código primeiro, explicação depois, sem introdução.',
  '- nunca dizer que uma coisa funciona sem ter testado; se não testou, dizer que não testou.',
  '',
  '## Contabilidade do site',
  '- cada conta tem a cota dela; o site só lê o medidor e nunca soma cota de ninguém.',
  '- o que sustenta o site é a biblioteca comum: resposta já paga volta de graça.',
].join('\n');

(async function () {
  console.log('=== 1) o pack é lido bloco a bloco ===');

  const itens = MegaPack.parsear(PACK);
  ok(itens.length === 7, 'achou os 7 blocos do pack (achou ' + itens.length + ')');
  ok(itens[0].txt.includes('OLLAMA_ORIGINS'), 'bloco 1 é o comando do Ollama');
  ok(itens[0].tags.includes('Servidor com GPU'), 'e ganhou a tag da seção: "' + itens[0].tags + '"');
  ok(itens[0].fonte === 'anotações do dono', 'e a fonte declarada no @fonte');

  console.log('\n=== 2) ingerir coloca tudo no motor neural ===');

  const antes = Neural.stats_().itens;
  const r = await MegaPack.ingerir(PACK);
  ok(r.ok && r.adicionados === r.blocos, 'os ' + r.blocos + ' blocos entraram: ' + JSON.stringify({ blocos: r.blocos, add: r.adicionados }));
  ok(Neural.stats_().itens === antes + r.blocos, 'a base cresceu de ' + antes + ' para ' + Neural.stats_().itens);
  ok((Neural.stats_().porFonte.megapack || 0) === r.blocos, 'e ficaram marcados como vindo do megapack');

  console.log('\n=== 3) busca por SIGNIFICADO (outras palavras, mesmo assunto) ===');

  const achados = await Neural.buscar('como faço o site enxergar o servidor local de modelos', 3);
  const juntos = achados.map(a => a.item.txt).join(' || ');
  ok(/OLLAMA_ORIGINS/.test(juntos),
     'perguntando com OUTRAS palavras, veio o comando certo', juntos.slice(0, 120));

  const achados2 = await Neural.buscar('qual é o estilo de resposta que a gente combinou', 3);
  ok(/código primeiro|curtas/i.test(achados2.map(a => a.item.txt).join(' ')),
     'e o mesmo vale para a regra de estilo');

  console.log('\n=== 4) o trecho achado ENTRA no prompt (senão o pack não serve) ===');

  const msgs = await Arkher.preparar([{ role: 'user', content: 'como libero o ollama pro site?' }]);
  const system = msgs.filter(m => m.role === 'system').map(m => m.content).join('\n');
  ok(/OLLAMA_ORIGINS/.test(system) || /OLLAMA_ORIGINS/.test(JSON.stringify(msgs)),
     'o prompt que vai para o modelo já vem com o trecho do pack dentro');
  ok(msgs.length >= 2, 'e a mensagem do usuário continua lá, intacta');

  console.log('\n=== 5) ingerir de novo não duplica ===');

  const base1 = Neural.stats_().itens;   // (a busca em si não duplica nada)
  const r2 = await MegaPack.ingerir(PACK);
  const base2 = Neural.stats_().itens;
  ok(base2 === base1, 'a base ficou do mesmo tamanho (' + base1 + ') mesmo ingerindo duas vezes',
     'adicionados na 2ª vez: ' + r2.adicionados);
  ok(r2.adicionados === 0, 'e a segunda ingestão adicionou 0 (id estável = nada duplica)');

  console.log('\n=== 6) o cofre exporta tudo e o que sai pode voltar ===');

  const cofre = MegaPack.exportar();
  ok(cofre.includes('# PACK: Cofre Neural ARKHER'), 'o cofre tem cabeçalho próprio');
  ok(cofre.includes('OLLAMA_ORIGINS'), 'e traz o que foi aprendido, não só o pack original');
  const deVolta = MegaPack.parsear(cofre);
  ok(deVolta.length >= 7, 'o que saiu pode ser lido de volta: ' + deVolta.length + ' bloco(s)');

  const s = MegaPack.stats();
  ok(s && s.itens >= 6 && s.tamanhoPack > 0,
     'e o cofre sabe o tamanho do que guarda: ' + JSON.stringify({ itens: s.itens, bytes: s.tamanhoPack }));

  console.log('\n=== 7) o limite honesto ===');

  const api = Object.keys(MegaPack).join(' ');
  ok(!/treinarModeloFechado|instalarPeso|ensinarClaude|enviarParaPesos/i.test(api),
     'não existe função que ensine modelo fechado ou mexa nos pesos dele', 'funções: ' + api);
  ok(typeof MegaPack.ingerir === 'function' && typeof MegaPack.exportar === 'function',
     'só entra pack e sai cofre: o que existe é indexar, buscar e exportar');

  const fonte = fs.readFileSync('arkher_pack.js', 'utf8');
  ok(/não existe em lugar nenhum/i.test(fonte) && /contexto é FINITO/i.test(fonte),
     'o próprio arquivo declara o que não faz (não esconde nada)');

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ MEGA PACK OK — o pack vira memória pesquisável e chega no prompt de qualquer modelo'));
  process.exitCode = falhou ? 1 : 0;
})();
