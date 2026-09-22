/* ============================================================
   teste_cascata.js — prova que o ARKHER sobrevive ao "low balance".
   Roda no Node (sem navegador): simula o Puter com saldo zerado,
   um provedor gratis (Groq) e confere a ordem da cascata.

       node teste_cascata.js
   ============================================================ */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const raiz = __dirname;

/* localStorage de mentira, mas com o mesmo comportamento do navegador:
   sem ele o modo user-pays (que le a sessao do puter.js) nao teria como
   funcionar no teste. */
const _mem = {};
const _ls = {
  getItem: k => (k in _mem ? _mem[k] : null),
  setItem: (k, v) => { _mem[k] = String(v); },
  removeItem: k => { delete _mem[k]; },
  clear: () => { for (const k in _mem) delete _mem[k]; },
};
const ctx = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, TextEncoder, Math, Date, JSON, Promise, localStorage: _ls });
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.location = { origin: 'https://exemplo.test', protocol: 'https:' };

let chamadas = [];
let saldoZerado = true;      // o "low balance" que estamos contornando
ctx.fetch = async (url, opt) => {
  opt = opt || {};
  const u = String(url);
  let modelo = '';
  try { if (opt.body) modelo = JSON.parse(opt.body).model || ''; } catch (e) {}
  chamadas.push(u + ' ' + (opt.method || 'GET') + (modelo ? ' ' + modelo : ''));
  const json = (obj, status) => ({
    ok: (status || 200) < 400, status: status || 200,
    json: async () => obj, text: async () => JSON.stringify(obj),
  });
  if (u.includes('puterai/chat/models')) {
    return json({ models: ['gpt-5.2', 'claude-sonnet-5', 'openrouter:xiaomi/mimo-v2-flash:free',
                           'openrouter:qwen/qwen3-coder:free', 'deepseek-r1:batch'] });
  }
  if (u.includes('api.puter.com/puterai/openai')) {
    const b = JSON.parse(opt.body);
    if (/:free$/.test(b.model)) return json({ choices: [{ message: { content: 'VIA GRATIS DO PUTER (' + b.model + ')' } }] });
    if (!saldoZerado) return json({ choices: [{ message: { content: 'RESPOSTA PAGA (' + b.model + ')' } }] });
    return json({ error: { message: 'low_balance: Available funding is insufficient for this request.' } }, 402);
  }
  if (u.includes('api.groq.com')) {
    if (u.includes('/models')) return json({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] });
    return json({ choices: [{ message: { content: 'RESPOSTA DO GROQ GRATIS' } }] });
  }
  throw new Error('url nao esperada: ' + u);
};

for (const f of ['core.js', 'freeai.js', 'pool.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f });
}
const { Free, Arkher, Puter, Pool, LS } = ctx;

function ok(cond, msg) { if (!cond) { console.error('  FALHOU: ' + msg); process.exitCode = 1; } else console.log('  ok  ' + msg); }

(async () => {
  /* uma conta Puter no armazem (sem saldo) */
  LS.set('arkher_pool', { puter: [{ id: 'k1', t: 'tok1', nome: 'conta 1', falhas: 0, ate: 0 }], hf: [] });
  ctx.localStorage.setItem('puter.auth.token', 'tok1');   // a conta logada neste navegador (user-pays)

  console.log('\n0a) mensagem que MERECE a ponta (longa/codigo) + saldo: top tier primeiro');
  saldoZerado = false;
  const rp = await Arkher.ask([{ role: 'user', content: 'preciso refatorar esta funcao e entender o erro de concorrencia:\n'
    + '```js\nfunction soma(a,b){ return a+b }\n```\nQuero uma analise passo a passo da arquitetura, '
    + 'comparando as duas abordagens possiveis e apontando o trade-off de cada uma para eu decidir.' }], {
    onTry: (it, n) => console.log('   tentativa ' + n + ' → ' + it.src + ' :: ' + it.id),
  });
  console.log('   resposta:', JSON.stringify(rp.text));
  ok(/RESPOSTA PAGA/.test(rp.text), 'pedido grande vai na top tier (qualidade onde importa)');
  ok(Puter.livre === false, 'nao marcou via gratis sem motivo');

  console.log('\n0b) mensagem curta nao queima saldo: roteia pro gratis');
  const rc = await Arkher.ask([{ role: 'user', content: 'oi, tudo bem?' }]);
  console.log('   resposta:', JSON.stringify(rc.text));
  ok(/VIA GRATIS/.test(rc.text), 'o roteador economizou o credito num "oi"');
  saldoZerado = true;

  console.log('\n1) o catalogo se separa em pista livre x paga');
  const livres = await Puter.listLivre();
  console.log('   via gratis:', livres.join(', '));
  ok(livres.length === 2, 'achou os modelos :free do catalogo do Puter');

  console.log('\n2) pior caso: modelo PAGO fixado + saldo zerado');
  const r0 = await Arkher.ask([{ role: 'user', content: 'oi' }], {
    model: 'gpt-5.2', onTry: (it, n) => console.log('   tentativa ' + n + ' → ' + it.src + ' :: ' + it.id),
  });
  console.log('   resposta:', JSON.stringify(r0.text));
  ok(/VIA GRATIS DO PUTER/.test(r0.text), 'respondeu pela via gratis em vez de falhar');
  ok(Puter.livre === true, 'marcou a pista livre (persistida)');
  ok(Pool.temSaldo() === false, 'conta marcada como sem saldo — e continua util na via gratis');

  console.log('\n3) chat normal segue funcionando (modo auto)');
  const r1 = await Arkher.ask([{ role: 'user', content: 'oi' }]);
  ok(/VIA GRATIS DO PUTER/.test(r1.text), 'sem gastar saldo');

  console.log('\n4) chave gratis do Groq entra na cascata (modo gratis)');
  Free.add('groq', 'gsk_teste_1\ngsk_teste_2');
  console.log('   provedores prontos:', Free.prontos().join(', '));
  console.log('   modelos do Groq:', (await Free.listar('groq')).join(', '));
  chamadas = [];
  const r2 = await Arkher.ask([{ role: 'user', content: 'oi' }], { modo: 'gratis' });
  console.log('   resposta:', JSON.stringify(r2.text), '| fonte:', r2.src, r2.prov || '');
  const pagos = chamadas.filter(c => c.includes('puterai/openai') && c.includes('POST') && !/:free\b/.test(c));
  ok(pagos.length === 0, 'modo "so gratis" nao pediu nenhum modelo pago' + (pagos.length ? ' → ' + pagos.join(' | ') : ''));

  console.log('\n5) uma chave estoura (429) -> gira para a proxima');
  let n = 0;
  ctx.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'openai/gpt-oss-120b' }] }) };
    n++;
    if (n === 1) return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limit reached' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok na segunda chave' } }] }) };
  };
  const t1 = await Free.ask('groq', 'openai/gpt-oss-120b', [{ role: 'user', content: 'x' }]).then(() => 'respondeu', e => 'erro: ' + e.message);
  await Free.listar('groq', true);
  const t2 = await Free.ask('groq', 'openai/gpt-oss-120b', [{ role: 'user', content: 'x' }]).catch(e => 'erro: ' + e.message);
  console.log('   1a tentativa:', t1, '| depois de girar:', t2);
  ok(t1.startsWith('erro'), 'chave sem cota avisa o erro');
  ok(t2 === 'ok na segunda chave', 'a segunda chave respondeu (rotacao automatica)');


  console.log('\n6) exportar/importar o armazem (levar de um dispositivo pro outro)');
  const dump = JSON.stringify(Pool.exportar(true));
  const antes = (await Pool.stats()).puter.total;
  LS.set('arkher_pool', { puter: [], hf: [] });          // "outro navegador", vazio
  const imp = await Pool.importar(dump);
  const depois = (await Pool.stats()).puter.total;
  console.log('   contas antes:', antes, '| exportadas → importadas:', imp.novos, '| agora:', depois);
  ok(imp.ok && depois === antes, 'o armazem viaja entre dispositivos');
  const inv = Pool.exportar(false);
  ok(inv.comTokens === false && !JSON.stringify(inv).includes('"t"'),
     'a versao "sem tokens" nao vaza token nenhum');


  console.log('\n7) "low balance" em TODAS as contas na mesma mensagem: o que o ARKHER faz');
  /* conta 1 sem saldo, conta 2 com pouco saldo (so passa pedido pequeno) */
  LS.set('arkher_pool', { puter: [
    { id: 'k1', t: 'tok1', nome: 'conta 1', falhas: 0, ate: 0 },
    { id: 'k2', t: 'tok2', nome: 'conta 2', falhas: 0, ate: 0 }], hf: [] });
  LS.set('puter.auth.token', 'tok1');
  LS.set('arkher_puter_livre', false); LS.set('arkher_limite_baixo', 0);
  ctx.fetch = async (url, opt) => {
    const u = String(url); opt = opt || {};
    if (u.includes('puterai/chat/models')) return { ok: true, status: 200, json: async () => ({ models: ['gpt-5.2', 'openrouter:xiaomi/mimo-v2-flash:free'] }) };
    if (u.includes('puterai/openai')) {
      const b = JSON.parse(opt.body);
      const tok = (opt.headers.Authorization || '').replace('Bearer ', '');
      const little = (b.max_tokens || 999) <= 512;
      if (/:free$/.test(b.model)) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'VIA GRATIS' } }] }) };
      if (tok === 'tok2' && little) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'PASSOU BARATO NA CONTA 2' } }] }) };
      return { ok: false, status: 402, json: async () => ({ error: { message: 'low_balance: Available funding is insufficient for this request.' } }) };
    }
    throw new Error('url nao esperada: ' + u);
  };
  const r7 = await Arkher.ask([{ role: 'user', content:
    'analise este erro de concorrencia no codigo abaixo e explique passo a passo:\n'
    + '```\nthrow new Error("race condition")\n```\nPreciso de um plano de debug detalhado.' }], {
    onTry: (it, n) => console.log('   tentativa ' + n + ' → ' + it.src + ' :: ' + it.id) });
  console.log('   resposta:', JSON.stringify(r7.text));
  ok(/PASSOU BARATO/.test(r7.text), 'pedido caro falhou → repetiu barato → a outra conta atendeu');
  ok(Puter.limiteBaixo === 512, 'aprendeu o orcamento enxuto (nao repete o pedido caro)');

  console.log('\n8) teste das contas (diagnostico quando TODAS caem)');
  ctx.fetch = async (url, opt) => {
    const u = String(url);
    if (u.includes('puterai/chat/models')) return { ok: true, status: 200, json: async () => ({ models: ['gpt-5.2'] }) };
    if (u.includes('puterai/openai')) return { ok: false, status: 402, json: async () => ({ error: { message: 'low_balance' } }) };
    throw new Error('url nao esperada: ' + u);
  };
  const d = await Pool.testarContas();
  console.log('   ' + d.diagnostico);
  ok(/NAO responde|NENHUMA responde/.test(d.diagnostico), 'sabe dizer que o problema NAO e a conta e sim o dispositivo/IP');

  console.log('\n9) quem paga: user-pays (padrao) x cota do dono');
  ctx.localStorage.setItem('puter.auth.token', 'TOKEN_DO_VISITANTE');   // cru, como o puter.js grava
  LS.set('arkher_pool', { puter: [{ id: 'k1', t: 'TOKEN_DO_DONO', nome: 'dono', falhas: 0, ate: 0 }], hf: [] });
  LS.set('arkher_pool_modo', 'visitante');
  ok(Puter.tokenDe() === 'TOKEN_DO_VISITANTE', 'visitante usa a PROPRIA conta (user-pays)');
  ok(Pool.admin() === false, 'admin começa DESLIGADO (nao existe "primeiro login = dono")');
  const semAdmin = await Pool.capturarPuter();
  ok(semAdmin.ok === false, 'sem admin, capturar conta é recusado: ' + String(semAdmin.err).slice(0, 60));
  Pool.admin(true); LS.set('arkher_pool_modo', 'dono');
  ctx.localStorage.removeItem('puter.auth.token');
  ok(Puter.tokenDe() === 'TOKEN_DO_DONO', 'com admin ligado, o dono usa a cota do armazem');
  Pool.admin(false); ctx.localStorage.removeItem('puter.auth.token');
  ok(Puter.tokenDe() === '', 'visitante NUNCA gasta a cota do dono');
  /* visitante nao poe a conta dele no armazem: nem com opt-in existe esse
     caminho (cota de quem entrou e gasta por quem entrou). */
  ctx.localStorage.setItem('puter.auth.token', 'TOKEN_DO_VISITANTE');
  const nAntes = (await Pool.stats()).puter.total;
  await Pool.auto();
  const nDepois = (await Pool.stats()).puter.total;
  ok(nDepois === nAntes, 'a conta do visitante NAO sobe pro armazem (nem com opt-in)');

  console.log('\n' + (process.exitCode ? 'ALGO FALHOU' : 'TUDO OK'));
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
