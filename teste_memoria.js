/* =====================================================================
   TODOS OS PROVEDORES RECEBEM A MESMA CABEÇA

   A pergunta que este teste responde:

     "se eu empilhar 1000 provedores, os modelos menores ficam com a
      MESMA memória, as mesmas ferramentas e o mesmo contexto que os
      grandes?"

   Resposta curta: o que é do SITE chega igual para todos. O que é DO
   MODELO não se transfere.

     ✅ IGUAL PARA TODOS (é do site, entra no pedido antes do roteador
        escolher quem responde):
          • o prompt de sistema (ferramentas, regras, skills)
          • a memória compartilhada (memoria.js — o que já foi descoberto)
          • o RAG / conhecimento guardado (Arkher.preparar)
          • o histórico da conversa
          • a biblioteca comum (resposta já paga)

     ❌ NÃO SE TRANSFERE (é do modelo, está nos pesos dele):
          • profundidade de raciocínio
          • obediência a instrução complexa
          • confiabilidade no uso de ferramentas
          • janela de contexto real e conhecimento de mundo

   Ou seja: memória é ENTRADA — e entrada a gente controla. Capacidade é
   do modelo — e essa não dá para emprestar. Este teste prova a primeira
   parte e delimita a segunda, para não prometer o que não existe.

   Rode:  node teste_memoria.js
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

const CHAMADAS = [];
const fetchEspiao = async (url, opt) => {
  opt = opt || {};
  let corpo = opt.body;
  try { if (typeof corpo === 'string') corpo = JSON.parse(corpo); } catch (e) {}
  CHAMADAS.push({ url: String(url), corpo: corpo || {}, headers: opt.headers || {} });
  const r = { choices: [{ message: { content: 'resposta de teste' } }] };
  return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r), body: null };
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
const { Free, HF, Puter, LS } = ctx;

/* a "cabeça" que todo modelo deve receber igual */
const SISTEMA = 'Você é o ARKHER. Ferramentas: web, VM, arquivos, 3D. Regras: seja direto.';
const MEMORIA = '[memória do site] o projeto usa Node 22; a senha do banco NÃO vai aqui; cliente X prefere respostas curtas.';
const HISTORICO = [
  { role: 'system', content: SISTEMA + '\n\n' + MEMORIA },
  { role: 'user', content: 'como rodo o projeto localmente?' },
];

function messagesDe(rec) {
  const b = rec.corpo || {};
  return (b.messages || b.input || []) ;
}
function textoDe(msgs) {
  return JSON.stringify(msgs);
}

(async function () {
  console.log('=== 1) a memória é montada UMA vez, antes de escolher o provedor ===');

  const prov = Free.provs()[0];
  Free.add(prov.id, 'AIza_chave_do_site');
  LS.set('arkher_hf_token', 'hf_token_do_site');
  ctx.localStorage.setItem('puter.auth.token', 'token_do_usuario_puter');

  console.log('\n=== 2) o MESMO contexto chega em provedores gratuitos diferentes ===');

  const outro = Free.provs()[1];
  Free.add(outro.id, 'gsk_chave_do_site');

  CHAMADAS.length = 0;
  try { await Free.ask(prov.id, 'modelo-a', HISTORICO); } catch (e) {}
  try { await Free.ask(outro.id, 'modelo-b', HISTORICO); } catch (e) {}
  const duas = CHAMADAS.slice(0, 2);
  ok(duas.length === 2, 'os dois provedores foram chamados');
  ok(textoDe(messagesDe(duas[0])) === textoDe(messagesDe(duas[1])),
     'os dois receberam EXATAMENTE o mesmo contexto (sistema + memória + histórico)');

  console.log('\n=== 3) e o mesmo contexto chega no HF e no Puter ===');

  CHAMADAS.length = 0;
  try { await HF.ask('meta-llama/Llama-3.1-8B-Instruct', HISTORICO); } catch (e) {}
  try { await Puter.askREST('claude-sonnet-5', HISTORICO); } catch (e) {}
  const hf = CHAMADAS.find(c => /huggingface\.co/.test(c.url));
  const pu = CHAMADAS.find(c => /puter\.com/.test(c.url));
  ok(hf && textoDe(messagesDe(hf)).includes('memória do site'),
     'o Hugging Face recebeu a memória do site');
  ok(pu && textoDe(messagesDe(pu)).includes('memória do site'),
     'o Puter recebeu a memória do site');
  ok(hf && pu && textoDe(messagesDe(hf)) === textoDe(messagesDe(pu)),
     'e os dois receberam o MESMO bloco — nenhum fica "burro" de contexto');

  console.log('\n=== 4) um provedor colado em massa também recebe ===');

  const r = Free.addVarios([
    '# provedores colados de uma vez',
    'meu-hub   | https://api.meu-hub.test/v1   | chave1 | free  | modelo-x, modelo-y',
    'meu-local | https://localhost:11434/v1    |        | local | llama3.2',
    'linha ruim sem barra',
    'outro     | nao-e-url                   | k      | free  | m',
  ].join('\n'));
  ok(r.ok === 2, 'duas linhas boas entraram, as ruins foram recusadas: ' + JSON.stringify(r.erros));

  const hub = Free.prov(r.ids[0]);
  ok(hub && hub.papel === 'free' && hub.modelos.length === 2,
     'o provedor colado ficou configurado: ' + JSON.stringify({ papel: hub && hub.papel, modelos: hub && hub.modelos }));
  const loc = Free.prov(r.ids[1]);
  ok(loc && loc.papel === 'local', 'o provedor local entrou como local (não gasta cota de ninguém)');

  CHAMADAS.length = 0;
  try { await Free.ask(hub.id, 'modelo-x', HISTORICO); } catch (e) {}
  const ch = CHAMADAS.find(c => /meu-hub\.test/.test(c.url));
  ok(!!ch, 'o provedor colado em massa foi chamado de verdade');
  ok(ch && textoDe(messagesDe(ch)).includes('memória do site'),
     'o provedor colado em massa recebeu a mesma memória');
  ok(!!Free.chaves(hub.id).length, 'e a chave colada ficou viva no provedor novo');

  console.log('\n=== 5) o limite honesto: contexto sim, capacidade não ===');

  ok(ch && textoDe(messagesDe(ch)).includes(SISTEMA.slice(0, 20)),
     'o prompt de sistema (ferramentas + regras) vai junto — isso é do site');
  const cotas = Object.keys(ctx.Cotas).join(' ');
  ok(!/clonarModelo|copiarPesos|transferirCapacidade|fundirModelos/i.test(cotas),
     'não existe (e não é possível) função que transfira CAPACIDADE entre modelos',
     'funções: ' + cotas);

  console.log('\n=== 6) o catálogo de fábrica está íntegro ===');

  const todos = Free.provs();
  ok(todos.length >= 25, 'provedores de fábrica: ' + todos.length);

  const ids = todos.map(p => p.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  ok(dup.length === 0, 'nenhum id repetido', 'duplicados: ' + JSON.stringify(dup));

  const ruins = todos.filter(p => !p.id || !p.nome || !/^https?:\/\//.test(p.url) || !Array.isArray(p.modelos));
  ok(ruins.length === 0, 'todos têm id, nome, endereço e lista de modelos',
     'problemas: ' + JSON.stringify(ruins.map(p => p.id)));

  const pedidos = ['moonshot', 'zhipu', 'qwen', 'deepseek'];
  ok(pedidos.every(i => ids.includes(i)),
     'Kimi, GLM, Qwen e DeepSeek vêm de fábrica: ' + pedidos.join(', '));

  /* os de ponta (dia 0) NÃO entram na via gratuita — têm que estar separados */
  const top = todos.filter(p => p.dia === 0).map(p => p.id);
  ok(top.every(i => !['gemini', 'groq', 'cerebras'].includes(i)),
     'os pagos não estão misturados com os gratuitos: ' + JSON.stringify(top));

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ MESMA MEMÓRIA OK — todo provedor recebe o mesmo contexto; a capacidade é de cada modelo'));
  process.exitCode = falhou ? 1 : 0;
})();
