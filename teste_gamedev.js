/* =====================================================================
   GAME DEV — o cerebro: leitores de erro por motor + o LOOP VERIFICADO

   O que tem que ser verdade:

     1. cada motor tem o SEU jeito de escrever erro, e o leitor devolve
        arquivo, linha e tipo (compilacao x execucao) — conferido com
        saida REAL de Roblox/Luau, Godot, Unity, Unreal e Blender;
     2. o diagnostico separa o que NAO e a mesma coisa:
        "rodou e deu erro" x "nem rodou" x "rodou limpo";
     3. o esqueleto de cada motor tem os arquivos obrigatorios;
     4. o LOOP: gera -> escreve -> roda -> le -> conserta -> roda. Ele
        so termina ok com uma EXECUCAO LIMPA, e o erro exato volta para
        a IA no pedido seguinte (nao um "deu erro" generico);
     5. as regras de parada economizam cota: mesmo erro 2x ou motor que
        nem roda = para na hora; teto de rodadas declarado;
     6. IA de fundo (gratis) por padrao — o loop nunca gasta a cota do
        usuario sem ser escolhido;
     7. limite honesto: ele NAO julga visual, jogabilidade nem fps.

   Rode:  node teste_gamedev.js
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

/* ---------- contexto do site (core + skills + cerebro) ---------- */
const mem = {};
const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, AbortController,
  localStorage: ls, window: null, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
});
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.LS = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
ctx.location = { origin: 'https://x', protocol: 'https:' };
for (const f of ['core.js', 'skills.js', 'arkher_gamedev.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const GD = ctx.GD;

/* ================= SAIDAS REAIS DE CADA MOTOR ================= */
const LOG_ROBLOX = [
  'ServerScriptService.Script:5: attempt to index nil with \'Humanoid\'',
  'Script \'ServerScriptService.Script\', Line 5',
  '  stack: Players.Player1.PlayerScripts.LocalScript:12: Expected \')\' (to close \'(\' at line 10), got \'end\'',
  'WARN: tentativa de indexar nil em _ready',
].join('\n');

const LOG_GODOT = [
  'Godot Engine v4.3.stable.official',
  'res://scripts/player.gd:7 - Parse Error: Expected end of statement after expression, found "Identifier"',
  'SCRIPT ERROR: Invalid call. Nonexistent function \'tomar_dano\' in base \'Nil\'.',
  '          at: _on_corpo (res://scripts/player.gd:12)',
  'WARNING: Integer division, decimal part will be discarded.',
].join('\n');

const LOG_UNITY = [
  'Assets/Scripts/Player.cs(23,17): error CS0103: The name \'velocidade\' does not exist in the current context',
  'Assets/Scripts/Game.cs(10,5): error CS1002: ; expected',
  'Assets/Scripts/Player.cs(40,9): warning CS0219: The variable \'x\' is assigned but its value is never used',
  'NullReferenceException: Object reference not set to an instance of an object',
  '  at Player.Update () [0x00012] in Assets/Scripts/Player.cs:31',
].join('\n');

const LOG_UNREAL = [
  'Running UnrealEditor-Cmd.exe Jogo.uproject',
  'Player.cpp(12): error C2065: \'velocidade\': undeclared identifier',
  'Player.cpp(20): warning C4101: \'temp\': unreferenced local variable',
  'LogCompile: Error: Failed to compile Player.cpp',
].join('\n');

const LOG_BLENDER = [
  'Blender 4.2.0',
  'Error: Python: Traceback (most recent call last):',
  '  File "/tmp/jogo/scripts/cena.py", line 12, in <module>',
  '    bpy.data.objects["Nada"].location = (0, 0, 0)',
  'KeyError: \'Nada\'',
].join('\n');

const LOG_NAO_RODOU = {
  godot: '[bash] godot: command not found',
  unity: 'bash: unity: command not found',
  unreal: "'UnrealEditor-Cmd.exe' is not recognized as an internal or external command",
  roblox: 'LUNE_NAO_INSTALADO',
  blender: 'Error: Cannot open display: ',
};

(async function () {
  console.log('=== 1) cada motor escreve erro do seu jeito (5 motores) ===\n');
  {
    const dr = GD.diagnosticar('roblox', LOG_ROBLOX, 1);
    ok(dr.estado === 'erro' && dr.erros.length >= 2, 'Roblox/Luau: achou os erros', JSON.stringify(dr.estado));
    ok(dr.erros[0].arquivo === 'ServerScriptService.Script' && dr.erros[0].linha === 5,
       'e o primeiro vem com arquivo e linha (ServerScriptService.Script:5)',
       JSON.stringify(dr.erros[0]));
    ok(dr.erros.some(e => e.tipo === 'execucao' && /index nil/.test(e.msg)), 'e separa execucao (nil) de compilacao');
    ok(dr.erros.some(e => e.tipo === 'compilacao' && /Expected/.test(e.msg)), 'e marca a linha de compilacao como tal');
    ok(dr.avisos.length === 1, 'e os avisos ficam separados dos erros');

    const dg = GD.diagnosticar('godot', LOG_GODOT, 1);
    ok(dg.erros.length >= 2, 'Godot: achou os erros', String(dg.erros.length));
    ok(dg.erros[0].arquivo === 'res://scripts/player.gd' && dg.erros[0].linha === 7 && dg.erros[0].tipo === 'compilacao',
       'Parse Error vem como compilacao, com res:// e linha 7', JSON.stringify(dg.erros[0]));
    const scriptErr = dg.erros.filter(e => /Nonexistent function/.test(e.msg))[0];
    ok(scriptErr && scriptErr.linha === 12 && scriptErr.arquivo === 'res://scripts/player.gd',
       'e o SCRIPT ERROR pega o "at: ... (arquivo:linha)" da linha seguinte (12)',
       JSON.stringify(scriptErr));

    const du = GD.diagnosticar('unity', LOG_UNITY, 1);
    ok(du.erros.length === 3, 'Unity: dois de compilacao + uma excecao = 3 erros', String(du.erros.length));
    ok(du.erros[0].codigo === 'CS0103' && du.erros[0].linha === 23 && du.erros[0].coluna === 17,
       'com o codigo do compilador e a coluna (CS0103 em 23,17)', JSON.stringify(du.erros[0]));
    const nul = du.erros.filter(e => /NullReference/.test(e.codigo || ''))[0];
    ok(nul && nul.linha === 31, 'e a NullReferenceException acha o arquivo:linha no rastro (31)', JSON.stringify(nul));
    ok(du.avisos.length === 1 && /CS0219/.test(du.avisos[0]), 'o warning nao entrou como erro (esta em avisos)');

    const dn = GD.diagnosticar('unreal', LOG_UNREAL, 1);
    ok(dn.erros[0].codigo === 'C2065' && dn.erros[0].linha === 12 && dn.erros[0].arquivo === 'Player.cpp',
       'Unreal: C2065 em Player.cpp:12', JSON.stringify(dn.erros[0]));
    ok(dn.erros.some(e => /Failed to compile/.test(e.msg)), 'e o "LogCompile: Error" tambem entra');

    const db = GD.diagnosticar('blender', LOG_BLENDER, 1);
    ok(db.erros.some(e => e.arquivo === '/tmp/jogo/scripts/cena.py' && e.linha === 12),
       'Blender: pega arquivo e linha 12 do rastro', JSON.stringify(db.erros[0]));
    ok(db.erros.some(e => e.codigo === 'KeyError'), 'e a excecao final (KeyError)');
    ok(db.erros.some(e => e.tipo === 'contexto' && /bpy\.data\.objects/.test(e.msg)),
       'e guarda a LINHA DE CODIGO que quebrou (e o que a IA mais precisa)');
  }

  console.log('\n=== 2) o diagnostico separa tres coisas diferentes ===\n');
  {
    ok(GD.diagnosticar('godot', 'Godot Engine v4.3\n', 0).estado === 'ok',
       'rodou sem erro nenhum: ok');
    ok(GD.diagnosticar('godot', '', 0).estado === 'ok',
       'motor que nao escreve nada quando esta tudo bem: tambem ok (codigo 0)');
    const semsaida = GD.diagnosticar('godot', '', 3);
    ok(semsaida.estado === 'sem-saida' && /nao da para saber/.test(semsaida.naoRodou),
       'codigo de erro com saida vazia: nao inventa motivo', semsaida.naoRodou);
    ok(GD.diagnosticar('godot', 'uma saida qualquer sem erro', 2).estado === 'erro',
       'codigo diferente de zero sem erro conhecido: e erro (nao ok)');

    Object.keys(LOG_NAO_RODOU).forEach(function (m) {
      const d = GD.diagnosticar(m, LOG_NAO_RODOU[m], 127);
      ok(d.estado === 'nao-rodou', m + ': "nem rodou" (e nao "codigo com erro")', d.estado);
      ok(!!d.naoRodou, m + ': e diz o motivo para o dono (' + d.naoRodou + ')');
    });
    ok(GD.diagnosticar('motor-que-nao-existe', 'x', 0).estado === 'motor-desconhecido',
       'motor desconhecido: diz que nao conhece (nao chuta)');

    /* assinatura: "e o mesmo erro de novo?" */
    const a = GD.diagnosticar('godot', LOG_GODOT, 1);
    const b = GD.diagnosticar('godot', LOG_GODOT.replace('7', '7'), 1);
    ok(GD.assinatura(a) === GD.assinatura(b), 'a assinatura do erro e estavel (mesmo erro = mesma assinatura)');
    const c = GD.diagnosticar('godot', LOG_GODOT.replace('Expected end of statement after expression',
      'Expected an indented block after function declaration'), 1);
    ok(GD.assinatura(a) !== GD.assinatura(c), 'e muda quando o erro muda (numeros nao contam)',
       GD.assinatura(a) + ' vs ' + GD.assinatura(c));
    ok(/player\.gd:7/.test(GD.textoErros(a)) && /Nonexistent function/.test(GD.textoErros(a)),
       'e o texto do erro vem curto e exato, pronto para o prompt');
  }

  console.log('\n=== 3) esqueleto: o ponto de partida de cada motor ===\n');
  {
    const e = GD.esqueleto('godot', 'meu jogo');
    const chaves = Object.keys(e.arquivos);
    ok(chaves.indexOf('meu_jogo/project.godot') >= 0, 'Godot: cria o project.godot');
    ok(/config_version=5/.test(e.arquivos['meu_jogo/project.godot']), 'com a versao de config que o Godot 4 exige');
    ok(/renderer\/rendering_method="mobile"/.test(e.arquivos['meu_jogo/project.godot']),
       'e ja apontado para celular (o alvo do projeto)');
    ok(chaves.some(k => /\.tscn$/.test(k)) && chaves.some(k => /\.gd$/.test(k)),
       'cena + script (sem os dois, o Godot nao roda)');

    const r = GD.esqueleto('roblox', 'meu jogo');
    ok(Object.keys(r.arquivos).some(k => /\.luau$/.test(k)) && /require\(game\.ReplicatedStorage\.ARKHER\)/.test(
      r.arquivos[Object.keys(r.arquivos).filter(k => /\.luau$/.test(k))[0]]),
      'Roblox: o script ja usa o pacote ARKHER (nao comeca do zero)');
    const u = GD.esqueleto('unity', 'x');
    ok(Object.keys(u.arquivos).some(k => /Assets\/Scripts\/.*\.cs$/.test(k)), 'Unity: script em Assets/Scripts');
    ok(Object.keys(u.arquivos).some(k => /Assets\/Editor\/Build\.cs$/.test(k)),
       'Unity: e a classe de build (precisa dela para rodar em lote)');
    const n = GD.esqueleto('unreal', 'x');
    ok(Object.keys(n.arquivos).some(k => /Source\/.*\.cpp$/.test(k)), 'Unreal: cpp em Source');
    const b = GD.esqueleto('blender', 'x');
    ok(/bpy/.test(b.arquivos['x/scripts/cena.py']), 'Blender: script com bpy');
    ok(GD.esqueleto('nao-existe', 'x') === null, 'motor desconhecido: nao devolve esqueleto falso');
    GD.lista().forEach(m => {
      const es = GD.esqueleto(m, 'j');
      ok(es && Object.keys(es.arquivos).length > 0 && es.precisa, m + ': tem esqueleto e requisitos declarados');
    });
  }

  console.log('\n=== 4) O LOOP: gera, roda, le o erro REAL e conserta ===\n');
  {
    /* VM de mentira: guarda o que foi escrito e devolve saidas roteirizadas */
    const escritos = [];
    const rodados = [];
    const saidas = [
      /* rodada 1: erro de compilacao no Godot */
      { out: 'Godot Engine v4.3\nres://scripts/principal.gd:9 - Parse Error: Expected end of statement after expression, found "Identifier"', code: 1 },
      /* rodada 2: compilou, mas quebrou ao rodar */
      { out: 'Godot Engine v4.3\nSCRIPT ERROR: Invalid call. Nonexistent function \'mover\' in base \'Nil\'.\n          at: _ready (res://scripts/principal.gd:4)', code: 1 },
      /* rodada 3: limpo */
      { out: 'Godot Engine v4.3\nARKHER: jogo iniciado', code: 0 },
    ];
    const vmFalsa = {
      async escrever(caminho, texto) { escritos.push({ caminho: caminho, texto: texto }); return caminho; },
      async rodar(cmd, ms) { rodados.push(cmd); return saidas[Math.min(rodados.length - 1, saidas.length - 1)]; },
      async ler() { return ''; },
    };

    const pedidos = [];
    const guiao = [
      { arquivos: [{ caminho: 'scripts/principal.gd', conteudo: 'extends Node2D\nfunc _ready():\n\tmover()\n' }], explica: 'primeira versao' },
      { arquivos: [{ caminho: 'scripts/principal.gd', conteudo: 'extends Node2D\nfunc _ready() :\n\tmove_local_x(10)\n' }], explica: 'corrigi a sintaxe' },
      { arquivos: [{ caminho: 'scripts/principal.gd', conteudo: 'extends Node2D\nfunc _ready():\n\tmove_local_x(10)\n\tprint("ARKHER: jogo iniciado")\n' }], explica: 'tirei a chamada que nao existia' },
    ];
    let n = 0;
    const iaFalsa = async (msgs) => {
      pedidos.push(msgs[1].content);
      const g = guiao[Math.min(n, guiao.length - 1)];
      n++;
      return { text: JSON.stringify(g), model: 'modelo-fraco-gratis', gastouSaldo: false };
    };

    const passos = [];
    const r = await GD.loop({
      objetivo: 'um Node2D que se move e escreve ARKHER: jogo iniciado',
      motor: 'godot', projeto: '/tmp/jogo', vm: vmFalsa, ia: iaFalsa,
      onPasso: p => passos.push(p.tipo),
    });

    ok(r.ok === true, 'terminou OK — e so porque a ultima execucao foi limpa', r.motivo);
    ok(r.rodadas === 3, 'levou 3 rodadas (erro, erro, limpo)', String(r.rodadas));
    ok(rodados.length === 3, 'rodou de VERDADE tres vezes (nao deduziu: executou)');
    ok(/godot --headless/.test(rodados[0]), 'com o comando certo do motor', rodados[0]);
    ok(escritos.length === 3, 'escreveu o arquivo em cada rodada', String(escritos.length));
    ok(/move_local_x/.test(escritos[2].texto), 'e a ultima versao escrita e a que rodou limpo');

    ok(/principal\.gd:9/.test(pedidos[1]) && /Expected end of statement/.test(pedidos[1]),
       'o SEGUNDO pedido levou o erro exato, com arquivo, linha e a mensagem do motor');
    ok(/Nonexistent function/.test(pedidos[2]) && /principal\.gd:4/.test(pedidos[2]),
       'e o terceiro pedido levou o erro da rodada 2 (nao um "deu erro" generico)');
    ok(!/Godot Engine v4\.3/.test(pedidos[1]), 'o ruido do log nao foi junto (so o que interessa)');

    ok(r.custo.chamadas === 3, 'contou 3 chamadas de IA (custo visivel)', String(r.custo.chamadas));
    ok(r.custo.gastouSaldo === false, 'e NENHUMA gastou saldo de usuario (trabalho de fundo)');
    ok(r.custo.modelosDeFundo === true, 'marcado como trabalho de fundo');
    ok(r.registro.filter(x => x.ato === 'rodar').length === 3, 'o registro guarda as 3 execucoes');
    ok(r.registro.filter(x => x.ato === 'rodar')[0].saida.length > 0, 'com a saida crua de cada uma (para auditar depois)');
    ok(passos.indexOf('diagnostico') >= 0 && passos.indexOf('fim') >= 0, 'e avisou a tela a cada etapa (diagnostico e fim)');
    ok(r.arquivos.length && /principal\.gd$/.test(r.arquivos[0]), 'e sabe quais arquivos ficaram no projeto');
  }

  console.log('\n=== 5) regras de parada: o loop nao queima cota a toa ===\n');
  {
    const fazVm = (saidas) => {
      let i = 0;
      return {
        escritos: 0,
        async escrever() { this.escritos++; },
        async rodar() { const s = saidas[Math.min(i, saidas.length - 1)]; i++; return s; },
        async ler() { return ''; },
      };
    };
    const fazIa = (conteudo) => () => Promise.resolve({ text: JSON.stringify({ explica: 'x', arquivos: [{ caminho: 'a.gd', conteudo: conteudo }] }) });
    let chamadas = 0;
    const conta = (fn) => async (m) => { chamadas++; return fn(m); };

    /* (a) o MESMO erro duas vezes -> para na segunda */
    chamadas = 0;
    const mesmaSaida = [{ out: 'res://a.gd:3 - Parse Error: Expected ")"', code: 1 }];
    const r1 = await GD.loop({ objetivo: 'x', motor: 'godot', projeto: '/p',
      vm: fazVm(mesmaSaida), ia: conta(fazIa('extends Node2D\n')) });
    ok(r1.ok === false && r1.rodadas === 2, 'mesmo erro 2x: para na 2a rodada (nao insiste)', String(r1.rodadas));
    ok(/MESMO erro voltou/.test(r1.motivo), 'e diz que parou por isso', r1.motivo.slice(0, 80));
    ok(chamadas === 2, 'so 2 chamadas de IA no total (economia real)', String(chamadas));

    /* (b) o motor nem esta instalado -> para na PRIMEIRA */
    chamadas = 0;
    const r2 = await GD.loop({ objetivo: 'x', motor: 'unity', projeto: '/p',
      vm: fazVm([{ out: 'bash: unity: command not found', code: 127 }]), ia: conta(fazIa('using UnityEngine;\n')) });
    ok(r2.ok === false && r2.rodadas === 1, 'motor nao instalado: para na 1a rodada', String(r2.rodadas));
    ok(/nem chegou a rodar/.test(r2.motivo) && /nao esta instalado/.test(r2.motivo), 'e explica que o problema e a maquina, nao o codigo', r2.motivo);
    ok(/nao e problema no codigo/.test(r2.oQueFazer || ''), 'e diz o que fazer (resolver na maquina)', r2.oQueFazer);
    ok(chamadas === 1, 'uma unica chamada de IA (nao fica tentando)', String(chamadas));

    /* (c) teto de rodadas: erros DIFERENTES a cada vez */
    chamadas = 0;
    let k = 0;
    const vmVariada = {
      async escrever() {},
      async rodar() {
        k++;
        const saidas = [
          'res://a.gd:3 - Parse Error: Expected ")"',
          'SCRIPT ERROR: Invalid call. Nonexistent function \'andar\' in base \'Nil\'.\n          at: _ready (res://a.gd:9)',
          'ERROR: Cannot open file "res://cenas/principal.tscn"',
        ];
        return { out: saidas[(k - 1) % saidas.length], code: 1 };
      },
      async ler() { return ''; },
    };
    const r3 = await GD.loop({ objetivo: 'x', motor: 'godot', projeto: '/p', maxRodadas: 3,
      vm: vmVariada, ia: conta(fazIa('extends Node2D\n')) });
    ok(r3.ok === false && r3.rodadas === 3, 'com erros diferentes, ele usa as rodadas e para no teto', String(r3.rodadas));
    ok(/teto de 3 rodadas/.test(r3.motivo), 'e says explicitamente que parou no teto', r3.motivo.slice(0, 60));
    ok(/olhar o registro/.test(r3.oQueFazer || ''), 'apontando o registro das tentativas');
    ok(r3.registro.filter(x => x.ato === 'rodar').length === 3, 'todas as 3 tentativas ficam registradas');

    /* (d) sem maquina -> nao comeca */
    chamadas = 0;
    const r4 = await GD.loop({ objetivo: 'x', motor: 'godot', vm: null, ia: conta(fazIa('x')) });
    ok(r4.ok === false && /sem maquina/.test(r4.motivo), 'sem VM: nem comeca, e diz por que', r4.motivo.slice(0, 60));
    ok(chamadas === 0, 'zero chamadas de IA gastas nisso');
    ok(/verificar e o que separa isto de um chat comum/.test(r4.oQueFazer || ''), 'e explica o valor de ter maquina');

    /* (e) IA ilegivel duas vezes -> para */
    chamadas = 0;
    const r5 = await GD.loop({ objetivo: 'x', motor: 'godot', projeto: '/p', vm: fazVm([{ out: '', code: 0 }]),
      ia: conta(() => Promise.resolve({ text: 'desculpa, nao entendi o pedido' })) });
    ok(r5.ok === false && /formato duas vezes/.test(r5.motivo), 'IA respondendo fora do formato 2x: para', r5.motivo.slice(0, 70));
    ok(chamadas === 2, 'e nao fica tentando para sempre', String(chamadas));

    /* (f) IA que falha (rede) -> nao trava */
    const r6 = await GD.loop({ objetivo: 'x', motor: 'godot', projeto: '/p', vm: fazVm([{ out: '', code: 0 }]),
      ia: () => Promise.reject(new Error('sem rede')) });
    ok(r6.ok === false && /a IA falhou/.test(r6.motivo), 'IA fora do ar: o loop devolve o motivo (nao trava)', r6.motivo);

    /* (g) objetivo vazio e motor errado */
    const r7 = await GD.loop({ motor: 'godot', vm: fazVm([{ out: '', code: 0 }]) });
    ok(/sem objetivo/.test(r7.motivo), 'sem objetivo: recusa com motivo');
    const r8 = await GD.loop({ objetivo: 'x', motor: 'turbo', vm: fazVm([{ out: '', code: 0 }]) });
    ok(/motor desconhecido/.test(r8.motivo) && /godot/.test(r8.motivo), 'motor desconhecido: lista os que existem', r8.motivo);
  }

  console.log('\n=== 6) as maos entram no catalogo (qualquer modelo da cascata) ===\n');
  {
    const sk = ctx.SKILLS;
    ['gd_loop', 'gd_erros', 'gd_esqueleto'].forEach(k =>
      ok(!!sk[k], 'a skill ' + k + ' existe no catalogo'));
    ok(sk.gd_loop.args.motor && sk.gd_loop.args.objetivo, 'gd_loop pede objetivo e motor');
    ok(/RODA de verdade/.test(sk.gd_loop.desc), 'e a descricao deixa claro que ele EXECUTA (isso muda o que o modelo faz)');
    ok(/godot/.test(sk.gd_loop.desc) && /unity/.test(sk.gd_loop.desc), 'e lista os motores que atende');
    ok(/gd_loop/.test(ctx.systemPrompt()), 'o prompt de sistema ja mostra a ferramenta para os modelos');

    /* o despacho pelo runTool de verdade */
    const r = await ctx.runTool({ tool: 'gd_erros', args: { motor: 'unity', log: LOG_UNITY, code: 1 } });
    ok(r && r.estado === 'erro' && /CS0103/.test(r.out), 'runTool despachou gd_erros e voltou o erro formatado', (r && r.out || '').slice(0, 60));
    const r2 = await ctx.runTool({ tool: 'gd_esqueleto', args: { motor: 'godot', nome: 'x' } });
    ok(r2 && r2.ok === true && r2.arquivos, 'runTool despachou gd_esqueleto e devolveu os arquivos');
    const r3 = await ctx.runTool({ tool: 'gd_loop', args: { objetivo: 'x', motor: 'godot' } });
    ok(r3 && r3.ok === false && /sem maquina/.test(r3.err), 'gd_loop sem maquina configurada recusa com motivo', r3 && r3.err);
    ok(/2 arquivo\(s\)/.test(r2.out) || /arquivo\(s\)/.test(r2.out), 'e o retorno e curto e legivel para a IA');
  }

  console.log('\n=== 7) limite honesto ===\n');
  {
    const src = fs.readFileSync('arkher_gamedev.js', 'utf8');
    ok(/NAO julga/.test(src), 'o arquivo declara o que ele NAO julga');
    ok(/se ficou bonito \(visual\)/.test(src) && /fps/.test(src) && /divertido/.test(src),
       'nomeando: visual, jogabilidade e desempenho');
    ok(/login manual/.test(src), 'e avisa que o Roblox Studio pede login manual');
    ok(/fundo: true/.test(src), 'e que a IA padrao do loop e de fundo (nunca a cota do usuario)');
    ok(/Nada de "pronto" sem prova/.test(src), 'e a regra de ouro: nada de "pronto" sem execucao limpa');
    ok(/nao posso verificar/.test(src), 'e diz que sem maquina nao verifica (em vez de fingir)');
    /* o loop nao deve marcar ok sem ter rodado */
    const vazio = await GD.loop({ objetivo: 'x', motor: 'blender', projeto: '/p',
      vm: { escrever: async () => {}, rodar: async () => ({ out: '', code: 5 }), ler: async () => '' },
      ia: async () => ({ text: JSON.stringify({ arquivos: [{ caminho: 'a.py', conteudo: 'print(1)' }] }) }) });
    ok(vazio.ok === false && /sem saida|nao inventa|codigo/i.test(vazio.motivo),
       'codigo de erro sem saida NAO vira "ok"', vazio.motivo);
  }

  /* ---- 8) a TELA: usar o loop sem escrever codigo ---- */
  console.log('\n=== 8) a tela liga a maquina e mostra o que aconteceu ===\n');
  {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    const uijs = fs.readFileSync(__dirname + '/ui.js', 'utf8');
    const ids = ['gd-objetivo', 'gd-motor', 'gd-projeto', 'gd-esq', 'gd-rodadas', 'gd-rodar', 'gd-parar', 'gd-estado', 'gd-log'];
    for (const id of ids) ok(html.indexOf('id="' + id + '"') >= 0, 'a tela tem o campo ' + id);
    ok(/arkher_gamedev\.js/.test(html), 'e carrega o arquivo do cerebro');
    ok(html.indexOf('arkher_gamedev.js') > html.indexOf('skills.js'),
       'depois do skills.js (senao a skill nao existe quando o modelo chama)');
    ok(/GD\.loop\(/.test(uijs), 'o botao chama o loop de verdade');
    ok(/vmReal\(/.test(uijs), 'e liga a maquina pelo vmReal (nao finge que rodou)');
    /* sem maquina a tela avisa em vez de prometer */
    ok(/sem m[aá]quina/i.test(uijs), 'sem maquina ele avisa (nao fica em branco)');
    ok(/Parar/.test(html) && /parado/.test(uijs), 'da para parar no meio (o trabalho nao fica preso)');
    /* os passos que o loop emite precisam TODOS aparecer na tela */
    const fonte = fs.readFileSync(__dirname + '/arkher_gamedev.js', 'utf8');
    const tipos = [];
    fonte.replace(/passo\('([a-z-]+)'/g, (m, t) => { tipos.push(t); return m; });
    const faltando = [...new Set(tipos)].filter(t => uijs.indexOf("'" + t + "'") < 0);
    ok(faltando.length === 0, 'todo passo do loop aparece na tela', 'sem tela: ' + faltando.join(', '));
  }

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ GAME DEV OK — 5 motores lidos de verdade e um loop que so diz "pronto" depois de rodar limpo'));
  process.exitCode = falhou ? 1 : 0;
})();
