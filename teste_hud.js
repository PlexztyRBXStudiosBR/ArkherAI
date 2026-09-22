/* =====================================================================
   HUD — os controles virtuais prontos para Roblox Studio e Blender

   O que tem que ser verdade:

     1. existem conjuntos prontos (navegar, Roblox Studio, Blender,
        desktop) — o usuario nao precisa descobrir que playtest e F5;
     2. CADA TECLA de CADA conjunto funciona nos DOIS backends. Isso e
        conferido contra o mapa de teclas de verdade do dsos_core.py:
        o teste roda a funcao _win_key() do proprio nucleo (Windows) e a
        regra de nome valido que o Linux usa. Botao que nao faz nada e
        pior do que botao que nao existe;
     3. aplicar um conjunto grava na MESMA chave do editor de HUD, entao o
        usuario ajusta depois do jeito dele;
     4. o d-pad continua sendo o d-pad (setas), e nao vira botao de jogo;
     5. limite honesto: o HUD manda tecla, nao faz magica — o que o
        programa remoto nao aceitar continua nao funcionando.

   Rode:  node teste_hud.js
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
const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const criados = [];
const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, window: null,
  document: {
    createElement: () => ({ style: {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; },
      appendChild() {}, querySelector: () => null, innerHTML: '' }),
    getElementById: () => null,
  },
});
ctx.window = ctx;
ctx.window.LS = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
vm.runInContext(fs.readFileSync('arkher_hud.js', 'utf8'), ctx, { filename: 'arkher_hud.js' });
const HUD = ctx.HUD;

/* ---------- as teclas de verdade do nucleo ---------- */
const core = fs.readFileSync('dsos_core.py', 'utf8');

/* o mesmo portao que o Linux/xdotool usa: so nome de tecla valido passa */
function linuxAceita(k) {
  return /^[\w+\-]+$/.test(k) && k.length <= 60;
}
/* o portao do Windows e a funcao _win_key() do proprio nucleo: rodar de verdade */
function windowsAceita(chaves) {
  const py = `
import importlib.util, json
spec = importlib.util.spec_from_file_location('d', 'dsos_core.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ks = json.loads('''${JSON.stringify(chaves)}''')
print(json.dumps({k: m._win_key(k) for k in ks}))
`;
  return JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
}

(async function () {
  console.log('=== 1) chegou pronto: Roblox Studio, Blender, desktop e navegar ===\n');
  {
    HUD.nomes().forEach(n => ok(!!HUD.presets[n], 'existe o conjunto "' + n + '"'));
    ['roblox', 'blender', 'desktop', 'navegar'].forEach(n =>
      ok(HUD.nomes().indexOf(n) >= 0, 'tem o conjunto "' + n + '"'));
    ok(HUD.presets.roblox.botoes.some(b => b.k === 'F5'),
       'Roblox Studio já vem com playtest (F5) — o que ninguém adivinha');
    ok(HUD.presets.roblox.botoes.some(b => b.k === 'shift+F5'), 'e com parar (shift+F5)');
    ok(HUD.presets.blender.botoes.some(b => b.k === 'F12'),
       'Blender já vem com renderizar (F12)');
    ok(HUD.presets.blender.botoes.some(b => b.k === 'Home'),
       'e com enquadrar (Home) — em vez do teclado numérico, que muitos celulares não têm');
    Object.keys(HUD.presets).forEach(n =>
      ok(!!HUD.presets[n].dica && HUD.presets[n].dica.length > 20,
        'o conjunto "' + n + '" explica como usar (dica na tela)'));
    ok(HUD.presets.roblox.botoes.every(b => b.r && b.k), 'todo botão tem rótulo e tecla');
    ok(/olhar em volta/.test(HUD.presets.roblox.dica), 'e diz que o Mouse serve para olhar em volta no Studio');
  }

  console.log('\n=== 2) toda tecla funciona nos DOIS backends (Linux e Windows) ===\n');
  {
    const usadas = Object.keys(HUD.teclasUsadas());
    ok(usadas.length >= 20, 'o HUD usa ' + usadas.length + ' teclas diferentes');

    const semLinux = usadas.filter(k => !linuxAceita(k));
    ok(semLinux.length === 0, 'no Linux (xdotool), todas passam no portão do núcleo',
       semLinux.join(', '));

    const noWin = windowsAceita(usadas);
    const semWin = usadas.filter(k => !noWin[k]);
    ok(semWin.length === 0,
       'no Windows (SendKeys), o _win_key() do próprio núcleo converte TODAS',
       semWin.map(k => k + ' (sem conversão)').join(', '));

    /* e algumas conversões certas, olhando o resultado */
    ok(noWin['F5'] === '{F5}' && noWin['F12'] === '{F12}', 'F5/F12 viram {F5}/{F12}');
    ok(noWin['ctrl+s'] === '^s' && noWin['ctrl+z'] === '^z', 'ctrl+s/z viram ^s/^z');
    ok(noWin['shift+F5'] === '+{F5}', 'shift+F5 vira +{F5}');
    ok(noWin['shift+A'] === '+a', 'shift+A vira +a');
    ok(noWin['alt+Tab'] === '%{TAB}', 'alt+Tab vira %{TAB}');
    ok(noWin['Home'] === '{HOME}' && noWin['Page_Up'] === '{PGUP}', 'Home/Page_Up têm nome no mapa');
    ok(noWin['space'] === ' ' && noWin['BackSpace'] === '{BACKSPACE}', 'espaço e backspace também');

    /* o que NÃO entra: tecla que só existe num lado (numérico do Blender) */
    ok(HUD.presets.blender.botoes.every(b => b.k.indexOf('KP') < 0 && b.k.indexOf('Numpad') < 0),
       'nenhum botão usa teclado numérico — que o backend Windows não tem como enviar');
  }

  console.log('\n=== 3) aplicar grava na mesma chave do editor ===\n');
  {
    ok(mem.dsos_hud === undefined, 'nada gravado antes de escolher');
    ok(HUD.aplicar('roblox') === true, 'aplicou o conjunto do Roblox Studio');
    const l = mem.dsos_hud;
    ok(Array.isArray(l) && l.length > 8, 'gravou a lista de botões em dsos_hud (a chave do editor)',
       l.length + ' botões');
    ok(l.filter(x => ['Up', 'Down', 'Left', 'Right'].indexOf(x.k) >= 0).length === 4,
       'as quatro setas continuam no d-pad');
    ok(l.some(x => x.k === 'F5' && x.r === '▶ Play'), 'e o F5 está lá com o rótulo que o usuário entende',
       JSON.stringify(l.filter(x => x.k === 'F5')[0]));
    ok(mem.dsos_hud_preset === 'roblox', 'e guarda qual conjunto foi escolhido');

    HUD.aplicar('blender');
    ok(mem.dsos_hud_preset === 'blender' && mem.dsos_hud.some(x => x.k === 'F12'),
       'trocar de conjunto troca os botões de verdade');
    ok(HUD.aplicar('nao-existe') === false, 'conjunto que não existe não aplica nada (não inventa)');
    ok(mem.dsos_hud_preset === 'blender', 'e não estraga o que estava escolhido');

    ok(HUD.atual() === 'blender', 'o HUD sabe qual conjunto está ativo');
    ok(HUD.montarSelect && typeof HUD.montarSelect === 'function', 'existe como montar a lista na tela');
  }

  console.log('\n=== 4) a interface liga isso de verdade ===\n');
  {
    const ui = fs.readFileSync('ui.js', 'utf8');
    const html = fs.readFileSync('index.html', 'utf8');
    ok(/HUD\.montarSelect\(selPreset\)/.test(ui), 'a interface monta o seletor de conjuntos');
    ok(/HUD\.aplicar\(n\)/.test(ui), 'e aplica o conjunto escolhido');
    ok(/montarHud\(\);/.test(ui), 'e repinta o HUD com os botões novos');
    ok(/id="hud-preset"/.test(html), 'o seletor existe no HUD');
    ok(/id="hud-mouse"/.test(html) && /id="hud-tela"/.test(html),
       'e o HUD tem os botões Mouse e Tela cheia (para não sair do HUD)');
    ok(/hudMouse\.onclick/.test(ui) && /DsC\.setCursorModo/.test(ui),
       'o botão Mouse do HUD liga o cursor de mouse de verdade');
    ok(/hudTela\.onclick/.test(ui) && /DsC\.telaCheia/.test(ui),
       'e o botão Tela cheia chama a tela cheia de verdade');
    ok(/#hud-x/.test(ui), 'e dá para fechar o HUD sem sair do DsOS');
  }

  console.log('\n=== 5) o limite honesto ===\n');
  {
    const fonte = fs.readFileSync('arkher_hud.js', 'utf8');
    ok(/funcionar nos DOIS backends/i.test(fonte),
       'o arquivo diz por que cada tecla tem que valer nos dois backends');
    ok(!/precisa de programa instalado|magic|instant/.test(fonte), 'e não promete o que não faz');
    ok(core.indexOf('tecla nao mapeada') >= 0,
       'quando o programa remoto recusa a tecla, o núcleo continua avisando em vez de fingir');
    const presets = JSON.stringify(HUD.presets);
    ok(!/super/.test(presets), 'nenhum botão usa a tecla Windows (super), que o SendKeys do núcleo recusa');
    console.log('\n   resumo: o HUD chega pronto para Studio e Blender, e cada botão foi conferido');
    console.log('   contra o mapa de teclas real dos dois backends.');
  }

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ HUD OK — Roblox Studio e Blender controlados pelo celular, com botão que faz o que promete'));
  process.exitCode = falhou ? 1 : 0;
})();
