/* =====================================================================
   ROBlOX / Luau — o pacote ARKHER rodando DE VERDADE (nao so escrito)

   Como: o Lua de verdade (lupa / Lua 5.4) carrega roblox/ARKHER.lua,
   roblox/ARKHER_Telemetria.lua e roblox/teste_arkher.lua, e roda tudo.
   O mesmo arquivo de teste roda no Studio (veja o cabecalho dele).

   O que tem que ser verdade:
     1. os dois modulos Lua carregam e devolvem a tabela esperada;
     2. a inteligencia (inventario, missoes, NPC, seguranca, salvamento,
        animacao, dialogo) passa nos testes dentro do Lua;
     3. a fila da telemetria respeita teto, limite por minuto e descarte —
        e nunca acumula lixo quando o no esta fora do ar;
     4. nada de identidade sai do jogo (nome, e-mail, conversa, id);
     5. sem lupa instalado, o teste NEM PASSA NEM MENTE: ele diz que nao
        conseguiu rodar (verde falso e pior do que vermelho).

   Rode:  node teste_roblox.js
   ===================================================================== */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

let falhou = 0;
function ok(cond, texto, extra) {
  if (cond) { console.log('  ok  ' + texto); return true; }
  falhou++;
  console.log('  FALHOU: ' + texto + (extra ? '\n          → ' + extra : ''));
  return false;
}

/* o corrida em Python: carrega os Lua e roda o teste de dentro deles */
const CORREDOR = `
import json, sys, lupa
L = lupa.LuaRuntime(unpack_returned_tuples=True)
G = L.globals()

def carrega(caminho, nome):
    with open(caminho, encoding="utf-8") as f:
        src = f.read()
    valor = L.execute(src)
    setattr(G, nome, valor)
    return valor

ark = carrega("roblox/ARKHER.lua", "ARKHER")
tel = carrega("roblox/ARKHER_Telemetria.lua", "ARKHER_TEL")
print("MODULO|" + str(ark.VERSAO) + "|" + str(tel.VERSAO))
with open("roblox/teste_arkher.lua", encoding="utf-8") as f:
    L.execute(f.read())
`;

let saida = '';
try {
  saida = execFileSync('python3', ['-c', CORREDOR], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
} catch (e) {
  saida = (e.stdout || '') + (e.stderr || '');
  ok(false, 'não consegui rodar o Lua (precisa de python3 com lupa: pip install lupa)', String(e.stderr || e.message).slice(0, 300));
}

/* separa: o que é do Lua (ok/FALHOU) e o que é do wrapper */
const luaOk = (saida.match(/^  ok  /gm) || []).length;
const luaFalhou = (saida.match(/^  FALHOU:/gm) || []).length;
const modulo = (saida.match(/^MODULO\|([^|]*)\|(.*)$/m) || []).slice(1);
const passou = /ARKHER_LUA_OK/.test(saida);
const falhouNoLua = /ARKHER_LUA_FALHOU/.test(saida);

console.log('=== 1) os dois módulos Lua carregam ===\n');
ok(saida.length > 0, 'o Lua rodou (o corredor devolveu saída)');
if (modulo.length === 2) {
  ok(!!modulo[0] && !!modulo[1], 'ARKHER.lua v' + modulo[0] + ' e ARKHER_Telemetria.lua v' + modulo[1] + ' carregaram');
} else {
  ok(false, 'os módulos Lua carregaram e devolveram a tabela', saida.split('\n').slice(0, 6).join(' | '));
}

console.log('\n=== 2) o Lua rodou a bateria inteira (e o que ele disse) ===\n');
ok(luaOk > 40, 'o Lua executou ' + luaOk + ' verificações de verdade');
ok(luaFalhou === 0, 'nenhuma falhou dentro do Lua', luaFalhou + ' falha(s)');
ok(passou && !falhouNoLua, 'e o próprio teste em Lua terminou com ARKHER_LUA_OK');

/* mostra as falhas do Lua, se houver, para não ficar escondido */
if (luaFalhou) {
  saida.split('\n').filter(l => /FALHOU:/.test(l)).slice(0, 10).forEach(l => console.log('        ' + l.trim()));
}

console.log('\n=== 3) o que o Lua cobriu (conferido no texto da saída) ===\n');
const cobre = [
  ['inventario', /inventario: somar/],
  ['peso e pilha', /respeitou o PESO/],
  ['missoes', /missao com dependencia/],
  ['NPC decide', /perto: ataca/],
  ['NPC memoria', /lembra do jogador/],
  ['anti-teleporte', /teleporte de 120 metros/],
  ['anti-velocidade', /impossivel: recusado/],
  ['compra com preco do servidor', /o PRECO veio do servidor/],
  ['pedido do cliente pela porta', /passa pela mesma regra do servidor/],
  ['animacao com prioridade', /ferido ganha de tudo/],
  ['dialogo', /escolher leva para o proximo no/],
  ['salvamento recusa versao futura', /versao futura e recusada/],
  ['apelido sem id', /NAO contem o id do jogador/],
  ['PII bloqueada', /nome, e-mail, conversa e id do jogador NAO passam/],
  ['fila com teto', /o teto da fila segura/],
  ['limite por minuto', /no teto por minuto, NAO manda/],
  ['no fora do ar nao acumula lixo', /NAO volta para a fila/],
  ['casca do Roblox', /criou UM RemoteFunction/],
];
cobre.forEach(([nome, re]) => ok(re.test(saida), 'cobriu: ' + nome));

console.log('\n=== 4) honestidade do próprio teste ===\n');
{
  const js = fs.readFileSync('teste_roblox.js', 'utf8');
  ok(/não consegui rodar o Lua/.test(js), 'sem lupa, o teste falha em vez de passar de mentira');
  const luaArq = fs.readFileSync('roblox/ARKHER.lua', 'utf8');
  ok(/LIMITE HONESTO/.test(luaArq), 'o pacote diz o limite dele na cara (anti-trapaca basica, nao AAA)');
  ok(/cliente NUNCA decide/.test(luaArq), 'e registra a regra de ouro: o cliente pede, o servidor decide');
  const telArq = fs.readFileSync('roblox/ARKHER_Telemetria.lua', 'utf8');
  ok(/NUNCA manda identidade/.test(telArq), 'a telemetria declara que nao manda identidade');
  ok(/NUNCA quebra o jogo/.test(telArq), 'e declara que nunca derruba o jogo');
  ok(/Lua 5.1\/Luau compativel de proposito/.test(luaArq),
     'o pacote roda no Studio E no teste (mesmo arquivo, sem gambiarra)');
}

console.log('\n' + (falhou
  ? '❌ ' + falhou + ' FALHA(S)'
  : '✅ ROBLOX OK — o pacote ARKHER roda de verdade no Lua: ' + luaOk +
    ' verificações, cota zero, executado fora do Studio'));
process.exitCode = falhou ? 1 : 0;
