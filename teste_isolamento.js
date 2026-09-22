/* =====================================================================
   ISOLAMENTO DE COTA — a prova que o UPG precisa passar

   A pergunta que este teste responde é só uma:

       "quando alguém conversa com as IAs neste site,
        a cota de QUEM é que está sendo gasta?"

   Aqui a gente cria DOIS navegadores de verdade (dois contextos vm, cada
   um com o seu proprio localStorage, como dois computadores diferentes),
   cada um logado numa conta Puter diferente. Depois:

     1. cada navegador responde com a SUA conta;
     2. o token de um NUNCA aparece no outro;
     3. o armazem compartilhado nao recebe token de visitante;
     4. ligando o modo admin, o dono pode usar as contas DELE (e so as dele).

   Rode com:   node teste_isolamento.js
   ===================================================================== */

const vm = require('vm');
const fs = require('fs');

let falhou = 0;
function ok(cond, texto, extra) {
  if (cond) { console.log('  ok  ' + texto); return true; }
  falhou++;
  console.log('  FALHOU: ' + texto + (extra ? '\n          → ' + extra : ''));
  return false;
}

const ARQUIVOS = ['core.js', 'freeai.js', 'pool.js', 'app.js'];

/* ---- um navegador completo, com memoria propria e um "fetch" espião ----
   O espião guarda o header Authorization de cada chamada ao Puter. É assim
   que a gente ve, sem adivinhar, QUAL token saiu do navegador.            */
function novoNavegador(nome) {
  const mem = {};
  const ls = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    clear: () => { for (const k in mem) delete mem[k]; },
  };

  const chamadas = [];   // { url, token }

  const fetchFalso = async (url, opt) => {
    const h = (opt && opt.headers) || {};
    const auth = h.Authorization || h.authorization || '';
    chamadas.push({ url: String(url), token: auth.replace(/^Bearer\s+/, '') });
    // resposta mínima, no formato que o resto do codigo entende
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'eco:' + auth.slice(7) } }] }),
      text: async () => 'eco:' + auth.slice(7),
      body: null,
    };
  };

  const ctx = vm.createContext({
    console, Math, Date, JSON, Promise, setTimeout, clearTimeout,
    TextDecoder, TextEncoder, localStorage: ls, fetch: fetchFalso,
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.location = { origin: 'https://' + nome.toLowerCase() + '.test', protocol: 'https:' };
  ctx.navigator = { userAgent: nome };

  for (const f of ARQUIVOS) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });

  return { nome, ctx, ls, mem, chamadas, LS: ctx.LS, Pool: ctx.Pool, Puter: ctx.Puter, Arkher: ctx.Arkher };
}

(async function () {
  console.log('=== 1) dois navegadores, duas contas Puter diferentes ===');

  const A = novoNavegador('NavegadorA');
  const B = novoNavegador('NavegadorB');

  // o puter.js grava o token cru no localStorage — os dois fazem igual
  A.ls.setItem('puter.auth.token', 'TOKEN_DA_ANA');
  B.ls.setItem('puter.auth.token', 'TOKEN_DO_BRUNO');

  // armazem vazio nos dois casos: ninguem doou conta pra ninguem
  A.LS.set('arkher_pool', { puter: [], hf: [] });
  B.LS.set('arkher_pool', { puter: [], hf: [] });

  const deA = A.Puter.tokenDe();
  const deB = B.Puter.tokenDe();
  ok(deA === 'TOKEN_DA_ANA', 'navegador da Ana usa a conta da Ana', 'veio: ' + deA);
  ok(deB === 'TOKEN_DO_BRUNO', 'navegador do Bruno usa a conta do Bruno', 'veio: ' + deB);
  ok(deA !== deB, 'os dois NAO compartilham conta nenhuma');

  console.log('\n=== 2) o pedido sai com o token DESTE navegador ===');

  await A.Puter.askREST('claude-fable-5-1', [{ role: 'user', content: 'oi' }]);
  await B.Puter.askREST('claude-fable-5-1', [{ role: 'user', content: 'oi' }]);

  const tokA = A.chamadas.filter(c => /puter\.com/.test(c.url)).map(c => c.token);
  const tokB = B.chamadas.filter(c => /puter\.com/.test(c.url)).map(c => c.token);
  ok(tokA.length > 0 && tokA.every(t => t === 'TOKEN_DA_ANA'),
     'toda chamada do navegador da Ana levou o token da Ana', 'tokens: ' + JSON.stringify(tokA));
  ok(tokB.length > 0 && tokB.every(t => t === 'TOKEN_DO_BRUNO'),
     'toda chamada do navegador do Bruno levou o token do Bruno', 'tokens: ' + JSON.stringify(tokB));

  console.log('\n=== 3) nada de token vazando de um lado pro outro ===');

  const memoriaA = JSON.stringify(A.mem);
  const memoriaB = JSON.stringify(B.mem);
  ok(!memoriaA.includes('TOKEN_DO_BRUNO'), 'o navegador da Ana nao tem rastro do Bruno');
  ok(!memoriaB.includes('TOKEN_DA_ANA'), 'o navegador do Bruno nao tem rastro da Ana');
  ok(!A.ls.getItem('arkher_pool') || !A.ls.getItem('arkher_pool').includes('BRUNO'),
     'nem se o armazem estiver ligado, o token alheio aparece');

  console.log('\n=== 4) o armazem compartilhado nao recebe conta de visitante ===');

  const antesArm = JSON.stringify(await A.Pool.ler());
  await A.Pool.auto();
  await B.Pool.auto();
  const depoisArmA = JSON.stringify(await A.Pool.ler());
  ok(antesArm === depoisArmA, 'Pool.auto() NAO gravou a conta de visitante no armazem');

  const captura = await A.Pool.capturarPuter();
  ok(captura.ok === false, 'capturar conta de visitante é recusado', String(captura.err || '').slice(0, 70));

  console.log('\n=== 5) o dono (admin ligado) usa as contas DELE, e só as dele ===');

  A.Pool.admin(true);
  const cap = await A.Pool.capturarPuter();
  ok(cap.ok === true, 'com admin ligado, o dono captura a conta que ele mesmo logou');
  const armA = await A.Pool.ler();
  ok((armA.puter || []).length === 1 && armA.puter[0].t === 'TOKEN_DA_ANA',
     'no armazem do dono ficou só a conta dele');

  A.LS.set('arkher_pool_modo', 'dono');
  A.ls.removeItem('puter.auth.token');       // o dono saiu do puter.js
  ok(A.Puter.tokenDe() === 'TOKEN_DA_ANA', 'modo "eu pago": usa a conta do armazem (a dele)');
  ok(A.Puter.deQuem() === 'sem conta' || A.Puter.deQuem() === 'cota do dono do site',
     'a tela sabe dizer de quem é a cota: ' + A.Puter.deQuem());

  console.log('\n=== 6) o Bruno (visitante) nunca alcança a conta do dono ===');

  B.LS.set('arkher_pool', { puter: [], hf: [] });   // o armazem nem chega no navegador dele
  ok(B.Puter.tokenDe() === 'TOKEN_DO_BRUNO', 'o Bruno continua na conta dele, mesmo se o dono ligar "eu pago"');
  B.ls.removeItem('puter.auth.token');
  B.LS.set('arkher_pool_modo', 'dono');             // tentando forçar
  ok(B.Puter.tokenDe() === '', 'sem admin ligado no navegador dele, nao existe cota de outro pra usar',
     'veio: "' + B.Puter.tokenDe() + '"');

  console.log('\n=== 7) contador do site é número, não identidade ===');

  await A.Arkher.metricaSessao();
  await A.Arkher.metricaPedido(true);
  const doc = JSON.stringify(A.LS.get('arkher_metrics', {}));
  ok(!/TOKEN_DA_ANA|TOKEN_DO_BRUNO/.test(doc), 'o contador nao guarda token nenhum');
  ok(!/@/.test(doc), 'o contador nao guarda e-mail nenhum');
  ok(/^\{"dia":"[0-9-]+","sessoes":[0-9]+,"pedidos":[0-9]+\}$/.test(doc),
     'o contador é exatamente dia + dois inteiros', doc);

  const hist = JSON.stringify(A.Arkher.histLer());
  ok(!/TOKEN|token|email|@/.test(hist), 'o histórico também só tem números: ' + hist);

  console.log('\n' + (falhou ? '❌ ' + falhou + ' FALHA(S)' : '✅ ISOLAMENTO OK — a cota gasta é sempre a de quem está usando'));
  process.exitCode = falhou ? 1 : 0;
})();
