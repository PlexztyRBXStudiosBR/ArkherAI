/* =====================================================================
   BIBLIOTECA COMUM — o teste do que sustenta o site

   Confere o que é verdade e o que NÃO pode ser verdade:

     1. a resposta que alguém já pagou é reaproveitada — custo zero para
        a próxima pessoa;
     2. a pergunta NÃO é guardada (só o hash dela);
     3. dado pessoal não entra na biblioteca (nem na pergunta, nem na
        resposta);
     4. só a primeira pergunta de uma conversa entra (o resto tem contexto
        pessoal);
     5. desligar funciona;
     6. e o que não existe: crédito juntando, saldo subindo.

   Rode:  node teste_cache.js
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
const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, localStorage: ls,
  TextDecoder, TextEncoder,
});
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.location = { origin: 'https://x.test', protocol: 'https:' };

for (const f of ['core.js', 'freeai.js', 'pool.js', 'respostas.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const { Resp, LS } = ctx;

(async function () {
  console.log('=== 1) a resposta já paga é reaproveitada (custo zero) ===');

  const pergunta = [{ role: 'user', content: 'Como faço um loop em JavaScript que percorre um array?' }];
  ok(Resp.posso(pergunta), 'uma pergunta normal de primeira vez pode usar a biblioteca');

  const k = Resp.chave(pergunta, 'chat');
  ok(!(await Resp.buscar(k)), 'ainda não tem nada na biblioteca');
  await Resp.guardar(k, 'Você pode usar for, for...of ou forEach.', 'claude-sonnet-5');
  const achou = await Resp.buscar(k);
  ok(achou && /for\.\.\.of/.test(achou.t), 'agora a resposta existe e é reaproveitável');

  const k2 = Resp.chave([{ role: 'user', content: '  COMO faço  um loop em javascript que percorre um   array?  ' }], 'chat');
  ok(k2 === k, 'a mesma pergunta escrita com espaços/maiúsculas diferentes dá a mesma chave');

  const e = await Resp.economia();
  ok(e.reaproveitamentos >= 1, 'a economia contou o reaproveitamento: ' + JSON.stringify(e));

  console.log('\n=== 2) a pergunta NÃO é guardada, só a impressão digital ===');

  const guardado = JSON.stringify(LS.get('arkher_cache', {}));
  ok(!guardado.includes('loop em JavaScript'), 'o texto da pergunta não está na biblioteca');
  ok(!guardado.includes('percorre um array'), 'nem pedaço dele');
  ok(/^\{"/.test(guardado) && /"t":/.test(guardado), 'só hash → resposta: ' + guardado.slice(0, 70) + '…');

  console.log('\n=== 3) dado pessoal não entra ===');

  const casos = [
    ['meu email é joao.silva@empresa.com, formata pra mim por favor', 'e-mail'],
    ['meu cpf é 123.456.789-00, confere o dígito pra mim agora', 'CPF'],
    ['a senha do banco de dados é senha123, escreve um script pra testar', 'senha'],
    ['meu token de acesso é sk-abc123def456, como uso ele no header', 'token'],
    ['meu telefone é (11) 98765-4321, manda um sms de teste pra mim', 'telefone'],
    ['meu endereço é rua das flores 123, acha a rota até lá pra mim', 'endereço'],
  ];
  for (const [txt, nome] of casos) {
    ok(Resp.posso([{ role: 'user', content: txt }]) === false,
       'pergunta com ' + nome + ' fica fora da biblioteca');
  }

  ok(await Resp.guardar('x:1', 'Claro, sua senha é senha123 e o token é sk-abc', 'm') === false,
     'resposta que contém dado pessoal também é recusada na entrada');

  console.log('\n=== 4) conversa com histórico fica fora ===');

  ok(Resp.posso([
    { role: 'user', content: 'me ajuda a organizar minha viagem de férias no litoral' },
    { role: 'assistant', content: 'claro, para onde você vai?' },
    { role: 'user', content: 'vou pra Florianópolis com minha esposa em janeiro' },
  ]) === false, 'só a PRIMEIRA pergunta entra (sem contexto pessoal atrás)');

  ok(Resp.posso([{ role: 'user', content: 'oi' }]) === false, 'pergunta curta demais não entra');
  ok(Resp.posso([{ role: 'user', content: 'x'.repeat(3000) }]) === false, 'pergunta gigante não entra');

  console.log('\n=== 5) desligar funciona ===');

  Resp.ON(false);
  ok(Resp.posso([{ role: 'user', content: 'uma pergunta qualquer de tamanho normal aqui' }]) === false,
     'desligada, nada entra');
  ok((await Resp.buscar(k)) === null, 'desligada, nada é usado');
  Resp.ON(true);
  ok((await Resp.buscar(k)) !== null, 'religada, volta a funcionar');

  console.log('\n=== 6) o limite da biblioteca é respeitado ===');

  for (let i = 0; i < 260; i++) {
    await Resp.guardar('bulk:' + i, 'resposta numero ' + i + ' para encher a biblioteca', 'm');
  }
  const s = await Resp.stats();
  ok(s.itens <= 200, 'a biblioteca fica com no máximo 200 respostas (tem ' + s.itens + ')');

  console.log('\n=== 7) o que NÃO existe (e por isso não está aqui) ===');

  const api = Object.keys(Resp).join(' ');
  ok(!/transferir|transfer|doar|doacao|somar|saldo|credito|cota|capturar/i.test(api),
     'a biblioteca não tem nenhuma função de transferir, somar ou capturar cota',
     'funções: ' + api);
  ok(typeof Resp.guardar === 'function' && typeof Resp.buscar === 'function',
     'as duas funções que existem: guardar/retornar RESPOSTA');
  const tudo = JSON.stringify(LS.get('arkher_cache', {}));
  ok(!/token|Bearer|access_token/i.test(tudo), 'a biblioteca não guarda token nenhum');

  console.log('\n' + (falhou ? '❌ ' + falhou + ' FALHA(S)' : '✅ BIBLIOTECA OK — o que sustenta o site é o trabalho já feito, não a cota de ninguém'));
  process.exitCode = falhou ? 1 : 0;
})();
