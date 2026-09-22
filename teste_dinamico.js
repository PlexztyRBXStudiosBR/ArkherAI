/* =====================================================================
   INGESTÃO CONTÍNUA — o teste

   O que tem que ser verdade:

     1. enfileirar link, baixar, limpar HTML e INDEXAR no cofre;
     2. "semear": de uma página saem os links dela, e eles entram na fila
        (respeitando profundidade e quantidade);
     3. não repete página já visitada (dedupe por URL);
     4. o teto da fila é respeitado — não vira crawler descontrolado;
     5. o modo contínuo liga, roda e desliga;
     6. CUSTO DE IA = ZERO: durante a ingestão, nenhuma chamada a
        provedor de IA acontece (é download + indexação);
     7. e o limite honesto: não existe função que treine modelo de API.

   Rode:  node teste_dinamico.js
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

/* ---- internet de mentira: toda URL devolve uma página com links ---- */
const IA_DE_API = [];    // qualquer chamada a provedor de IA cai aqui (tem que ficar vazia)
const PAGINAS = ['a', 'b', 'c', 'd', 'e'];

const fetchFalso = async (url) => {
  const u = String(url);
  // detecta chamada a provedor de IA (Puter, Groq, HF, OpenAI…)
  if (/api\.(puter|groq|cerebras|openai|deepseek|moonshot)|generativelanguage|huggingface\.co\/[^ ]*\/v1|api\.mistral/i.test(u)) {
    IA_DE_API.push(u);
  }
  const pagina = PAGINAS.find(p => u.includes('/' + p)) || 'a';
  const html = '<html><head><style>p{color:red}</style><script>var x=1;</script></head><body>'
    + '<h1>Página ' + pagina + '</h1>'
    + '<p>' + ('conteúdo real sobre a nave arkher e o cofre neural. ').repeat(20) + '</p>'
    + PAGINAS.map(p => '<a href="/' + p + '">link ' + p + '</a>').join('')
    + '<a href="mailto:x@y.com">mail</a>'
    + '</body></html>';
  return { ok: true, status: 200, text: async () => html, json: async () => ({}), body: null };
};

const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  TextDecoder, TextEncoder, localStorage: ls, fetch: fetchFalso,
  URL: URL, URLSearchParams: URLSearchParams,
  AbortController: globalThis.AbortController,
});
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.location = { origin: 'https://x.test', protocol: 'https:' };
ctx.navigator = { userAgent: 'teste' };

for (const f of ['core.js', 'neural.js', 'websearch.js', 'arkher_pack.js', 'arkher_dinamico.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { Dinamico, Neural, MegaPack } = ctx;

(async function () {
  Dinamico.ESPERA_MS = 1;                 // no teste, sem pausa entre páginas

  console.log('=== 1) enfileirar e processar uma página ===');

  const r1 = Dinamico.enfileirar(['https://exemplo.test/a']);
  ok(r1.ok === 1 && r1.fila === 1, 'a URL entrou na fila');

  const r2 = await Dinamico.rodar(1);
  ok(r2.baixadas === 1, 'uma página foi baixada');
  ok(r2.indexados >= 1, 'e o texto dela virou bloco indexado: ' + r2.indexados);
  ok(r2.links >= 3, 'e ela semeou os links dela: ' + r2.links);

  const txt = (Neural.itens || []).map(x => x.txt).join(' ');
  ok(/conteúdo real sobre a nave arkher/i.test(txt), 'o texto da página está no cofre');
  ok(!/<script|<style|color:red/i.test(txt), 'e o HTML/script/CSS foi jogado fora');

  console.log('\n=== 2) semear: de uma página saem os links dela ===');

  const antesFila = Dinamico.fila().length;
  ok(antesFila >= 3, 'os links da primeira página estão na fila (' + antesFila + ')');
  const r3 = await Dinamico.rodar(1);
  ok(r3.baixadas === 1, 'a segunda página também baixou (a fila anda sozinha)');
  ok(Dinamico.fila().every(x => /^https?:\/\//i.test(x.url)), 'só http(s) na fila (mailto ficou fora)');
  ok(!Dinamico.fila().some(x => /mailto|\.css|\.js$/i.test(x.url)), 'nenhum mailto/arquivo entrou');

  console.log('\n=== 3) não repete o que já visitou ===');

  const v = Object.keys(Dinamico.vistos()).length;
  Dinamico.enfileirar(['https://exemplo.test/a']);
  ok(!Dinamico.fila().some(x => x.url === 'https://exemplo.test/a'), 'página já visitada não volta para a fila');
  ok(Object.keys(Dinamico.vistos()).length === v, 'e a lista de visitadas não cresceu à toa');

  console.log('\n=== 4) o teto da fila é respeitado ===');

  const muitas = [];
  for (let i = 0; i < 900; i++) muitas.push('https://exemplo.test/' + i);
  Dinamico.enfileirar(muitas);
  ok(Dinamico.fila().length <= Dinamico.MAX_FILA,
     'fila limitada a ' + Dinamico.MAX_FILA + ' (tem ' + Dinamico.fila().length + ')');

  const rD = await Dinamico.rodar(2);
  ok(rD.baixadas === 2, 'processou só 2 páginas quando pedi 2 (não dispara tudo)');

  console.log('\n=== 5) modo contínuo: liga, roda e desliga ===');

  ok(Dinamico.ligado() === false, 'começa desligado');
  Dinamico.ligar(60);
  ok(Dinamico.ligado() === true, 'ligou');
  await new Promise(s => setTimeout(s, 60));
  Dinamico.desligar();
  ok(Dinamico.ligado() === false, 'desligou');
  ok(Dinamico.stats().visitadas > 0, 'e trabalhou enquanto estava ligado: ' + Dinamico.stats().visitadas + ' página(s)');

  console.log('\n=== 6) custo de IA: ZERO durante a ingestão ===');

  ok(IA_DE_API.length === 0,
     'nenhuma chamada a provedor de IA aconteceu (só download + indexação)',
     'chamou: ' + JSON.stringify(IA_DE_API.slice(0, 3)));

  console.log('\n=== 7) o limite honesto ===');

  const api = Object.keys(Dinamico).join(' ');
  ok(!/treinarModelos|treinarTodos|ensinarAPI|fineTuneTodos/i.test(api),
     'não existe função que treine os modelos de API (não existe esse canal)', 'funções: ' + api);

  const fonte = fs.readFileSync('arkher_dinamico.js', 'utf8');
  ok(/impossível\. Ninguém faz/i.test(fonte), 'o arquivo diz na cara que treinar modelo de API não existe');
  const plano = fonte.replace(/\s+/g, ' ').toLowerCase();
  ok(/o que cresce sem parar é o cofre, não o modelo/.test(plano),
     'e deixa claro o que cresce: o cofre');

  const s = Dinamico.stats();
  console.log('\n   estado final: ' + JSON.stringify(s));

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ DINÂMICO OK — fila contínua, links e links, indexando sem gastar cota de IA'));
  process.exitCode = falhou ? 1 : 0;
})();
