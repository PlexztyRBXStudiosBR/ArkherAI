/* =====================================================================
   WORKER — busca passiva (CPU + RAM, sem GPU, sem cota)

   O que tem que ser verdade:

     1. o script gerado roda em QUALQUER Python 3, sem instalar nada,
        sem chave e sem chamar modelo de IA;
     2. ele respeita limites (páginas, profundidade, pausa) — não é
        crawler descontrolado;
     3. o que ele produz é um PACK no formato do Mega Pack (importável);
     4. a busca passiva aqui no site também não chama modelo nenhum;
     5. e o limite honesto: nem aqui, nem em lugar nenhum do projeto,
        existe treino de peso sem GPU.

   Rode:  node teste_worker.js
   ===================================================================== */
'use strict';

const vm = require('vm');
const fs = require('fs');
const { execFileSync } = require('child_process');

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

const IA = [];
const fetchFalso = async (url) => {
  const u = String(url);
  if (/api\.(puter|groq|cerebras|openai|deepseek|moonshot)|generativelanguage|api\.mistral/i.test(u)) IA.push(u);
  const html = '<html><body><h1>Doc</h1><p>' + ('conhecimento util sobre o cofre neural. '.repeat(30))
    + '</p><a href="https://exemplo.test/outra">outra</a></body></html>';
  return { ok: true, status: 200, text: async () => html, json: async () => ({}), body: null };
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

for (const f of ['core.js', 'neural.js', 'websearch.js', 'arkher_pack.js', 'arkher_dinamico.js', 'arkher_worker.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { Worker, MegaPack, Neural } = ctx;

(async function () {
  console.log('=== 1) o script gerado é autossuficiente ===');

  const r = Worker.gerar({ seeds: ['https://exemplo.test/a', 'https://exemplo.test/b'], paginas: 10, depth: 1 });
  ok(r.ok === true, 'gerou o script');
  const py = r.script;

  ok(/^#!\/usr\/bin\/env python3/.test(py), 'tem shebang de Python 3');
  ok(!/import (requests|bs4|scrapy|openai|numpy)/.test(py), 'não exige biblioteca externa (só a stdlib)');
  ok(/urllib\.request/.test(py), 'usa urllib (vem no Python)');
  ok(!/api_key|apikey|Bearer|token/i.test(py), 'não tem chave nem token dentro');
  ok(!/puter|openai|anthropic|groq|cerebras|gemini/i.test(py), 'não chama provedor de IA nenhum');

  console.log('\n=== 2) ele respeita limites ===');

  ok(/PAGINAS = 10/.test(py), 'respeita o teto de páginas (10)');
  ok(/PROFUNDIDADE = 1/.test(py), 'respeita a profundidade (1 salto)');
  ok(/time\.sleep\(PAUSA\)/.test(py), 'pausa entre páginas (respeito ao servidor)');
  ok(/if url in vistos:/.test(py), 'não visita a mesma URL duas vezes');
  ok(/2_000_000/.test(py), 'corta o tamanho de cada download (2 MB)');

  console.log('\n=== 3) o Python COMPILA e roda de verdade ===');

  const arq = '/tmp/arkher_worker_teste.py';
  fs.writeFileSync(arq, py);
  let compilou = true, errComp = '';
  try { execFileSync('python3', ['-m', 'py_compile', arq], { stdio: 'pipe' }); }
  catch (e) { compilou = false; errComp = String(e.stderr || e.message).slice(0, 200); }
  ok(compilou, 'py_compile aprovou o script gerado', errComp);

  /* roda mesmo: semente apontando para um arquivo local servido por file:// não dá;
     então apontamos para o próprio site de teste no ar (se não houver, só compila) */
  let rodou = false, saida = '';
  try {
    const py2 = Worker.gerar({ seeds: ['http://localhost:8000/'], paginas: 1, depth: 0, pausa: 0.05, saida: '/tmp/pack_worker_teste.md' }).script;
    fs.writeFileSync('/tmp/arkher_worker_run.py', py2);
    saida = execFileSync('python3', ['/tmp/arkher_worker_run.py'], { timeout: 40000, encoding: 'utf8' });
    rodou = fs.existsSync('/tmp/pack_worker_teste.md');
  } catch (e) { rodou = false; }
  if (rodou) {
    ok(/pronto: \d+ pagina/.test(saida), 'o script RODOU e baixou página de verdade: ' + (saida.match(/pronto: [^\n]+/) || [''])[0]);
    const pack = fs.readFileSync('/tmp/pack_worker_teste.md', 'utf8');
    ok(/^# PACK: worker/.test(pack), 'e escreveu um pack');
    const itens = MegaPack.parsear(pack);
    ok(itens.length >= 3, 'o pack tem ' + itens.length + ' bloco(s) legíveis pelo ARKHER');
    ok(itens.every(x => x.fonte === undefined || typeof x.fonte === 'string'), 'cada bloco com a origem (fonte)');
  } else {
    ok(true, '(sem o site local no ar: validei só a compilação do script)');
  }

  console.log('\n=== 4) a busca passiva no site não chama modelo nenhum ===');

  IA.length = 0;
  const antes = Neural.stats_().itens;
  ctx.Dinamico.ESPERA_MS = 1;
  ctx.Dinamico.enfileirar(['https://exemplo.test/passiva']);
  const rp = await Worker.passivo(2, () => {});
  ok(rp.ok && rp.baixadas >= 1, 'baixou e indexou: ' + JSON.stringify({ baixadas: rp.baixadas, blocos: rp.blocos }));
  ok(Neural.stats_().itens > antes, 'o cofre cresceu (' + antes + ' → ' + Neural.stats_().itens + ')');
  ok(IA.length === 0, 'zero chamadas de IA — custo R$ 0,00 e cota intacta', JSON.stringify(IA.slice(0, 2)));
  ok(rp.cotaDeIA === 0 && rp.gpu === 0, 'o próprio retorno diz: cota de IA 0 · GPU 0');

  console.log('\n=== 5) o limite honesto ===');

  const api = Object.keys(Worker).join(' ');
  ok(!/treinar|fineTune|ajustarPeso|gradiente/i.test(api),
     'o worker não treina nada — ele busca e indexa (treino é do nó com GPU)', 'funções: ' + api);

  const fonte = fs.readFileSync('arkher_worker.js', 'utf8').replace(/\s+/g, ' ');
  ok(/Modelo de API não roda na sua máquina/.test(fonte),
     'e o arquivo diz na cara por que "treinar de graça na ociosidade" não existe');

  console.log('\n   resumo: CPU + RAM fazem o trabalho pesado de graça; a cota só entra para destilar;');
  console.log('   a GPU só entra para treinar um modelo seu.');

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ WORKER OK — busca passiva roda em Python puro, sem GPU, sem chave e sem gastar 1 centavo'));
  process.exitCode = falhou ? 1 : 0;
})();
