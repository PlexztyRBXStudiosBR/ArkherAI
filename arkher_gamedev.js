/* ARKHER GAME DEV — o cerebro que cria jogo em QUALQUER motor
   ============================================================
   A diferenca entre "a IA escreveu um codigo bonito" e "o jogo roda":
   o LOOP VERIFICADO. Ele gera, roda de verdade, le o erro REAL que a
   maquina devolveu, conserta com o erro na frente, e roda de novo. Isso
   e o que um chat comum nao faz — e por isso este arquivo existe.

   O QUE TEM AQUI
     1. ADAPTADORES POR MOTOR — Roblox Studio (Luau), Godot, Unity,
        Unreal e Blender. Cada um sabe: com que comando se roda, onde
        esta o log, e como se le o erro do jeito que aquele motor
        escreve (o formato de cada um e DIFERENTE — e isso esta testado
        com saida de verdade de cada um).
     2. DIAGNOSTICO — separa tres coisas que nao sao a mesma:
        "rodou e deu erro" (problema no codigo) x "nem rodou" (falta o
        motor, falta tela, comando errado) x "rodou limpo". Sem isso, o
        loop tentaria consertar codigo quando o problema e a maquina.
     3. O LOOP VERIFICADO — gera -> escreve -> roda -> le -> conserta ->
        roda de novo, com regras de parada que economizam cota:
          - motor nao instalado / sem tela -> para na hora e diz o que falta;
          - o MESMO erro duas vezes -> para (nao queima cota repetindo);
          - teto de rodadas declarado.
     4. SKILLS — entram no catalogo do site, entao QUALQUER modelo da
        cascata ganha essas maos.

   REGRAS QUE ESTE ARQUIVO CUMPRE
     - O trabalho de fundo NUNCA gasta a cota do usuario: a IA padrao do
       loop chama com { fundo: true } (gratis / cota do site). Se voce
       quiser usar a ponta paga, e escolha sua, explicita.
     - Nada de "pronto" sem prova: o loop so termina ok quando UMA
       EXECUCAO LIMPA aconteceu. Falhou 2x no mesmo erro, ele para e
       conta que parou.
     - O log vai inteiro para o REGISTRO e cortado no prompt (custo), e
       o corte e declarado (quantos caracteres ficaram de fora).

   LIMITE HONESTO
     O loop verifica o que a maquina consegue rodar e reportar: erro de
     compilacao, erro de execucao, travamento. Ele NAO julga:
       - se ficou bonito (visual);
       - se e divertido (jogabilidade);
       - quantos fps deu (medicao de desempenho);
       - o que aconteceu dentro do jogo depois de abrir (isso e o olho do
         dono na tela, ou o Pilot olhando os quadros).
     E Roblox Studio pede login manual: o loop para e avisa em vez de
     tentar adivinhar a senha.
   ===================================================================== */
(function () {
  const GD = {};
  const LSg = (k, d) => ((typeof LS !== 'undefined') ? LS.get(k, d) : d);

  GD.VERSAO = '1.0';

  /* ==================================================================
     1) ADAPTADORES POR MOTOR
     Cada um: como rodar, onde esta o log, e o leitor de erro DELE.
     ================================================================== */
  GD.motores = {};

  /* ---------------- Roblox Studio (Luau) ---------------- */
  GD.motores.roblox = {
    id: 'roblox', nome: 'Roblox Studio', ext: '.luau', lingua: 'Luau',
    precisa: { os: ['windows'], gui: true, nativo: true, ram_gb: 4 },
    nota: 'Studio e aplicacao Windows com sessao grafica. Publicar usa o Open Cloud.',
    /* o Studio nao roda "headless": quem roda de verdade e o Lune (runtime Luau
       fora do Roblox) ou o proprio Studio. O comando declara os dois. */
    cmdRodar: (p) => 'lune run ' + p + '/src 2>&1 || echo "LUNE_NAO_INSTALADO"',
    cmdLogin: 'O Studio pede login manual. O loop para aqui e avisa.',
    erros: function (texto) {
      const out = [];
      const linhas = String(texto || '').split(/\r?\n/);
      const tipoDe = (msg) => /expected|unexpected|near '|malformed|invalid (token|statement)|got 'end'/i.test(msg)
        ? 'compilacao' : 'execucao';
      for (let i = 0; i < linhas.length; i++) {
        /* O Studio escreve o erro em varios formatos: com o caminho no comeco
           ("ServerScriptService.Script:5: ..."), com "stack:" na frente, e
           ainda com o trecho de rastro. O leitor procura o padrao caminho:linha:
           em QUALQUER lugar da linha, tirando o enfeite da frente primeiro. */
        const limpa = linhas[i].replace(/^\s*(stack|Stack Begin|Stack End)\s*:?\s*/i, '')
                                 .replace(/^\s*-\s*/, '').trim();
        const m = /([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+):(\d+):\s*(.+)$/.exec(limpa);
        if (m) {
          const msg = m[3].trim();
          out.push({ arquivo: m[1], linha: +m[2], tipo: tipoDe(msg), msg: msg });
          continue;
        }
        /* "Script 'x', Line 5" (so a referencia, sem mensagem) */
        if (/^Script '.*', Line \d+$/i.test(limpa)) continue;
        const r = /([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+):(\d+)\s+in\s+(.+)$/.exec(limpa);
        if (r) out.push({ arquivo: r[1], linha: +r[2], tipo: 'execucao', msg: r[3].trim() });
      }
      return out;
    },
    avisos: function (texto) {
      return String(texto || '').split(/\r?\n/).filter(l => /^\s*(WARN|Warning:)/i.test(l)).map(l => l.trim());
    },
    logPath: (p) => p + '/saida.txt',
  };

  /* ---------------- Godot (GDScript) ---------------- */
  GD.motores.godot = {
    id: 'godot', nome: 'Godot', ext: '.gd', lingua: 'GDScript',
    precisa: { os: ['windows', 'linux'], gui: false, nativo: true, ram_gb: 2 },
    nota: 'Roda sem tela (--headless): da para verificar codigo sem sessao grafica.',
    cmdRodar: (p) => 'godot --headless --path ' + p + ' --quit-after 2 2>&1',
    cmdExportar: (p, saida) => 'godot --headless --path ' + p + ' --export-release "Android" ' + (saida || 'build/jogo.apk'),
    erros: function (texto) {
      const out = [];
      const linhas = String(texto || '').split(/\r?\n/);
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        /* res://scripts/player.gd:7 - Parse Error: Expected end of statement... */
        let m = /^(res:\/\/[^\s:]+):(\d+)\s*-\s*(Parse Error|Error|Handler error):\s*(.+)$/i.exec(l.trim());
        if (m) { out.push({ arquivo: m[1], linha: +m[2], tipo: 'compilacao', msg: m[4].trim(), codigo: m[3] }); continue; }
        /* SCRIPT ERROR: Invalid call... / at: _ready (res://scripts/player.gd:12) */
        m = /^(SCRIPT ERROR|ERROR):\s*(.+)$/i.exec(l.trim());
        if (m) {
          let arq = null, ln = null, onde = '';
          for (let k = 1; k <= 2; k++) {
            const prox = linhas[i + k] || '';
            const mm = /at:\s*[^(]*\((.+?):(\d+)\)/.exec(prox.trim());
            if (mm) { arq = mm[1]; ln = +mm[2]; onde = prox.trim(); i += k; break; }
          }
          const tipo = /parse error|expected|unexpected/i.test(m[2]) ? 'compilacao' : 'execucao';
          out.push({ arquivo: arq, linha: ln, tipo: tipo, msg: m[2].trim(), onde: onde || undefined });
        }
      }
      return out;
    },
    avisos: function (texto) {
      return String(texto || '').split(/\r?\n/).filter(l => /^\s*WARNING:/i.test(l)).map(l => l.trim());
    },
    logPath: (p) => p + '/.godot/saida.txt',
  };

  /* ---------------- Unity (C#) ---------------- */
  GD.motores.unity = {
    id: 'unity', nome: 'Unity', ext: '.cs', lingua: 'C#',
    precisa: { os: ['windows', 'linux'], gui: false, nativo: true, ram_gb: 8 },
    nota: 'Roda em lote (-batchmode -nographics): verifica compilacao sem tela.',
    cmdRodar: (p) => 'unity -batchmode -nographics -quit -projectPath ' + p +
      ' -logFile ' + p + '/Logs/saida.log -executeMethod Build.Testar 2>&1; tail -n 200 ' + p + '/Logs/saida.log 2>/dev/null',
    cmdExportar: (p) => 'unity -batchmode -quit -projectPath ' + p + ' -executeMethod Build.Android',
    erros: function (texto) {
      const out = [];
      const linhas = String(texto || '').split(/\r?\n/);
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        /* Assets/Scripts/Player.cs(23,17): error CS0103: The name 'x' does not exist */
        let m = /^([^(]+)\((\d+),(\d+)\):\s*error\s+([A-Z]+\d+):\s*(.+)$/.exec(l.trim());
        if (m) { out.push({ arquivo: m[1].trim(), linha: +m[2], coluna: +m[3], codigo: m[4], tipo: 'compilacao', msg: m[5].trim() }); continue; }
        /* NullReferenceException / at Player.Update () [0x00012] in Assets/Scripts/Player.cs:31 */
        m = /^([A-Za-z_.]+Exception):\s*(.*)$/.exec(l.trim());
        if (m) {
          let arq = null, ln = null;
          for (let j = i + 1; j < Math.min(i + 12, linhas.length); j++) {
            const mm = /in\s+([^:]*\.cs):(\d+)/.exec(linhas[j]);
            if (mm) { arq = mm[1].trim(); ln = +mm[2]; break; }
          }
          out.push({ arquivo: arq, linha: ln, tipo: 'execucao', codigo: m[1], msg: m[2].trim() });
        }
      }
      return out;
    },
    avisos: function (texto) {
      return String(texto || '').split(/\r?\n/).filter(l => /\):\s*warning\s+[A-Z]+\d+:/.test(l)).map(l => l.trim());
    },
    logPath: (p) => p + '/Logs/saida.log',
  };

  /* ---------------- Unreal (C++) ---------------- */
  GD.motores.unreal = {
    id: 'unreal', nome: 'Unreal Engine', ext: '.cpp', lingua: 'C++',
    precisa: { os: ['windows'], gui: false, nativo: true, gpu: true, ram_gb: 16, disco_gb: 100 },
    nota: 'Pesa; sem GPU e RAM de sobra, o loop avisa em vez de tentar.',
    cmdRodar: (p) => 'UnrealEditor-Cmd.exe ' + p + ' -game -nullrhi -log -stdout -ExecCmds="quit" 2>&1',
    erros: function (texto) {
      const out = [];
      const linhas = String(texto || '').split(/\r?\n/);
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        /* Player.cpp(12): error C2065: 'velocidade': undeclared identifier */
        let m = /^([^(]+)\((\d+)\)\s*:\s*(error|warning)\s+([A-Z]+\d+):\s*(.+)$/.exec(l.trim());
        if (m) { out.push({ arquivo: m[1].trim(), linha: +m[2], codigo: m[4], tipo: 'compilacao', msg: m[5].trim(), aviso: m[3] === 'warning' }); continue; }
        /* LogCompile: Error: ... / Fatal error: ... */
        m = /^(?:Log[A-Za-z]*:\s*)?(Error|Fatal error|Assertion failed):\s*(.+)$/.exec(l.trim());
        if (m) out.push({ arquivo: null, linha: null, tipo: 'execucao', msg: m[2].trim(), nivel: m[1] });
      }
      return out;
    },
    avisos: function (texto) {
      return String(texto || '').split(/\r?\n/).filter(l => /:\s*Warning:/.test(l)).map(l => l.trim());
    },
    logPath: (p) => p + '/Saved/Logs/Jogo.log',
  };

  /* ---------------- Blender (Python) ---------------- */
  GD.motores.blender = {
    id: 'blender', nome: 'Blender', ext: '.py', lingua: 'Python (bpy)',
    precisa: { os: ['windows', 'linux'], gui: false, nativo: true, ram_gb: 4 },
    nota: 'Roda em lote (-b). Render e o que mais pede: em CPU tambem roda, so demora.',
    cmdRodar: (p, arquivos) => 'blender -b --python ' + ((arquivos && arquivos[0]) || (p + '/scripts/cena.py')) + ' 2>&1',
    cmdRender: (p) => 'blender -b ' + p + '/cena.blend -o //quadro_ -f 1',
    erros: function (texto) {
      const out = [];
      const linhas = String(texto || '').split(/\r?\n/);
      let dentro = false;
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        if (/Traceback \(most recent call last\)/.test(l)) { dentro = true; continue; }
        if (dentro) {
          let m = /File "([^"]+)", line (\d+), in (.+)$/.exec(l.trim());
          if (m) { out.push({ arquivo: m[1], linha: +m[2], tipo: 'execucao', msg: 'em ' + m[3].trim() }); continue; }
          m = /^([A-Za-z_.]+Error|Exception|KeyError|AttributeError|TypeError):\s*(.*)$/.exec(l.trim());
          if (m) {
            out.push({ arquivo: null, linha: null, tipo: 'execucao', codigo: m[1], msg: m[2].trim() });
            dentro = false;
          }
          /* a linha de codigo entre o File e o erro: e ela que a IA precisa ver */
          if (/^\s{2,}\S/.test(linhas[i]) && /[=().]/.test(l)) {
            out.push({ arquivo: null, linha: null, tipo: 'contexto', msg: l.trim() });
          }
        }
        /* Error: ... (erro do proprio Blender, fora do Python) */
        const e = /^(Error|ERROR):\s*(.+)$/.exec(l.trim());
        if (e && !dentro) out.push({ arquivo: null, linha: null, tipo: 'execucao', msg: e[2].trim() });
      }
      return out;
    },
    avisos: function (texto) {
      return String(texto || '').split(/\r?\n/).filter(l => /^\s*(Warning|WARN):/i.test(l)).map(l => l.trim());
    },
    logPath: (p) => p + '/saida.txt',
  };

  GD.lista = () => Object.keys(GD.motores);
  GD.motor = (id) => GD.motores[String(id || '').toLowerCase()] || null;

  /* ==================================================================
     2) DIAGNOSTICO — o que aconteceu de verdade
     ================================================================== */
  const NAO_RODOU = [
    [/n[aã]o (?:é|e) reconhecido como um comando|command not found|not recognized as an internal/i, 'o programa do motor nao esta instalado (ou nao esta no PATH)'],
    [/LUNE_NAO_INSTALADO/, 'o runtime Luau (lune) nao esta instalado — sem ele o codigo fora do Studio nao roda'],
    [/cannot open display|no display|Xvfb|Unable to open X display/i, 'nao ha sessao grafica nessa maquina'],
    [/Unknown argument|invalid option|unrecognized option/i, 'o comando nao e o dessa versao do motor'],
    [/No such file or directory|nao foi possivel encontrar o caminho|The system cannot find/i, 'o caminho do projeto nao existe nessa maquina'],
    [/licen[cs]a|license|Please activate/i, 'o motor pede licenca/ativacao nessa maquina'],
    [/Permission denied/i, 'sem permissao para executar nessa maquina'],
  ];
  const ERRO_GENERICO = [
    [/Failed to (?:compile|build|open|load)/i, 'a maquina disse que nao conseguiu compilar/abrir'],
    [/Segmentation fault|core dumped/i, 'o programa caiu de vez (falha grave na maquina)'],
  ];

  GD.diagnosticar = function (motorId, saida, saidaCodigo) {
    const m = GD.motor(motorId);
    const texto = String(saida || '');
    const r = { motor: m ? m.id : null, estado: 'sem-saida', erros: [], avisos: [], naoRodou: null, codigoSaida: (saidaCodigo == null ? null : saidaCodigo) };
    if (!m) { r.estado = 'motor-desconhecido'; return r; }
    if (!texto.trim()) {
      /* saida vazia + codigo 0 = rodou limpo (varios motores nao escrevem nada quando esta tudo bem) */
      r.estado = (saidaCodigo === 0 || saidaCodigo == null) ? 'ok' : 'sem-saida';
      if (r.estado !== 'ok') r.naoRodou = 'sem saida nenhuma e codigo de erro — nao da para saber o que houve';
      return r;
    }
    for (let i = 0; i < NAO_RODOU.length; i++) {
      if (NAO_RODOU[i][0].test(texto)) {
        r.estado = 'nao-rodou';
        r.naoRodou = NAO_RODOU[i][1];
        return r;
      }
    }
    const erros = m.erros(texto) || [];
    r.avisos = (m.avisos ? m.avisos(texto) : []).slice(0, 20);
    /* o que e erro de verdade: descarta as linhas marcadas como aviso */
    r.erros = erros.filter(e => !e.aviso).slice(0, 40);
    r.contexto = erros.filter(e => e.tipo === 'contexto').slice(0, 6);
    if (r.erros.length) { r.estado = 'erro'; return r; }
    /* sem erro do motor: so vale "ok" se o codigo disser que foi bem */
    if (saidaCodigo === 0 || saidaCodigo == null) { r.estado = 'ok'; return r; }
    for (let i = 0; i < ERRO_GENERICO.length; i++) {
      if (ERRO_GENERICO[i][0].test(texto)) { r.estado = 'erro'; r.erros = [{ arquivo: null, linha: null, tipo: 'execucao', msg: ERRO_GENERICO[i][1] }]; return r; }
    }
    r.estado = 'erro';
    r.erros = [{ arquivo: null, linha: null, tipo: 'execucao', msg: 'o motor terminou com codigo ' + saidaCodigo + ' (nao disse o motivo; olhe o fim da saida)' }];
    return r;
  };

  /* assinatura estavel do primeiro erro: serve para ver "e o MESMO erro de novo" */
  GD.assinatura = function (diag) {
    if (!diag || !diag.erros || !diag.erros.length) return '';
    const e = diag.erros[0];
    const limpa = (t) => String(t || '').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 120);
    return [e.arquivo || '?', limpa(e.msg), e.codigo || ''].join('|');
  };

  /* texto curto e exato do erro, para por no prompt (sem mandar o log inteiro) */
  GD.textoErros = function (diag, limite) {
    if (!diag || !diag.erros || !diag.erros.length) return '';
    const l = [];
    diag.erros.slice(0, limite || 8).forEach(e => {
      const onde = (e.arquivo ? e.arquivo : '(sem arquivo)') + (e.linha ? ':' + e.linha : '') +
        (e.coluna ? ':' + e.coluna : '');
      l.push('[' + (e.tipo || 'erro') + '] ' + onde + ' — ' + e.msg + (e.codigo ? ' (' + e.codigo + ')' : ''));
    });
    if (diag.contexto && diag.contexto.length) l.push('linha do codigo: ' + diag.contexto.map(c => c.msg).join(' | '));
    return l.join('\n');
  };

  /* ==================================================================
     3) ESQUELETO — o ponto de partida de cada motor
     ================================================================== */
  GD.esqueleto = function (motorId, nome) {
    const m = GD.motor(motorId);
    if (!m) return null;
    const n = String(nome || 'jogo').replace(/[^\w.-]/g, '_');
    const A = {};
    if (m.id === 'roblox') {
      A[n + '/src/Principal.server.luau'] =
        '-- ARKHER: script de servidor (roda no Roblox com o pacote ARKHER)\n' +
        'local ARKHER = require(game.ReplicatedStorage.ARKHER)\n' +
        'local Jogo = ARKHER.novoJogo({ nome = "' + n + '", precos = {} })\n' +
        'Jogo:ligar({ ReplicatedStorage = game.ReplicatedStorage, Instance = Instance })\n' +
        'print("ARKHER: jogo iniciado")\n';
      A[n + '/LEIA-ME.md'] = '# ' + n + ' (Roblox)\n\n1. ReplicatedStorage: ModuleScript ARKHER (roblox/ARKHER.lua)\n' +
        '2. ServerScriptService: este src/Principal.server.luau\n3. Play no Studio.\n';
    } else if (m.id === 'godot') {
      A[n + '/project.godot'] = 'config_version=5\n\n[application]\nconfig/name="' + n + '"\nrun/main_scene="res://cenas/principal.tscn"\n\n[rendering]\nrenderer/rendering_method="mobile"\n';
      A[n + '/cenas/principal.tscn'] = '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scripts/principal.gd" id="1"]\n\n[node name="Principal" type="Node2D"]\nscript = ExtResource("1")\n';
      A[n + '/scripts/principal.gd'] = 'extends Node2D\n\nfunc _ready() -> void:\n\tprint("ARKHER: jogo iniciado")\n';
    } else if (m.id === 'unity') {
      A[n + '/Assets/Scripts/Principal.cs'] = 'using UnityEngine;\n\npublic class Principal : MonoBehaviour\n{\n    void Start()\n    {\n        Debug.Log("ARKHER: jogo iniciado");\n    }\n}\n';
      A[n + '/Assets/Editor/Build.cs'] = 'using UnityEditor;\n\npublic class Build\n{\n    public static void Testar() { Debug.Log("ARKHER: compilou"); }\n}\n';
    } else if (m.id === 'unreal') {
      A[n + '/Source/' + n + '/Principal.cpp'] = '#include "CoreMinimal.h"\n\nvoid Principal()\n{\n    UE_LOG(LogTemp, Log, TEXT("ARKHER: jogo iniciado"));\n}\n';
    } else if (m.id === 'blender') {
      A[n + '/scripts/cena.py'] = 'import bpy\n\ndef main():\n    bpy.ops.mesh.primitive_cube_add(size=1)\n    print("ARKHER: cena montada", len(bpy.data.objects))\n\nif __name__ == "__main__":\n    main()\n';
    }
    return { motor: m.id, pasta: n, arquivos: A, precisa: m.precisa, nota: m.nota };
  };

  /* ==================================================================
     4) O LOOP VERIFICADO
     ==================================================================
     cfg = {
       objetivo: 'o que o jogo deve fazer',
       motor: 'godot',
       projeto: '/caminho',            (ou derivado)
       esqueleto: true|false           (comeca do esqueleto?)
       maxRodadas: 4,
       vm: { escrever(caminho, texto), rodar(cmd, ms) -> {out, code}, ler(caminho) },
       ia: async (mensagens) -> { text, model, gastouSaldo },
       onPasso: (p) => {}              (para a tela mostrar ao vivo)
     }
     Devolve: { ok, rodadas, registro[], errosFinais[], custo, motivo }
     ================================================================== */
  GD.SYS = 'Voce e um programador de jogos. Responda SOMENTE com um JSON, nada de texto fora dele:\n' +
    '{"explica":"1 frase do que fez","arquivos":[{"caminho":"caminho/completo","conteudo":"codigo inteiro"}]}\n' +
    'Regras:\n' +
    ' - Mande o arquivo INTEIRO (nao mande pedaco nem diff).\n' +
    ' - Corrija o que o log apontou, sem trocar o resto por capricho.\n' +
    ' - Se o log nao bastar, mude UMA coisa e explique na "explica".\n' +
    ' - Sem comentario longo, sem enfeite: codigo que roda.';

  function extrairJson(texto) {
    const t = String(texto || '').trim();
    const i = t.indexOf('{');
    if (i < 0) return null;
    let nivel = 0, dentro = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { dentro = !dentro; continue; }
      if (dentro) continue;
      if (c === '{') nivel++;
      else if (c === '}') {
        nivel--;
        if (nivel === 0) {
          try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }
  GD.extrairJson = extrairJson;

  GD.prompt = function (cfg, diagAnterior, rodada) {
    const m = GD.motor(cfg.motor);
    const pedacos = [];
    pedacos.push('MOTOR: ' + (m ? (m.nome + ' (' + m.lingua + ')') : cfg.motor));
    pedacos.push('PROJETO: ' + cfg.projeto);
    pedacos.push('OBJETIVO: ' + cfg.objetivo);
    if (cfg.arquivos && cfg.arquivos.length) pedacos.push('ARQUIVOS QUE JA EXISTEM: ' + cfg.arquivos.join(', '));
    if (m && m.nota) pedacos.push('NOTA DO MOTOR: ' + m.nota);
    if (rodada === 1) {
      pedacos.push('Escreva o minimo que faz o objetivo funcionar e RODA sem erro. Nao invente sistema que nao foi pedido.');
    } else if (diagAnterior) {
      pedacos.push('');
      pedacos.push('=== O QUE A MAQUINA RESPONDEU NA ULTIMA TENTATIVA (rodada ' + (rodada - 1) + ') ===');
      pedacos.push('estado: ' + diagAnterior.estado);
      pedacos.push(GD.textoErros(diagAnterior) || '(sem erro do motor)');
      if (diagAnterior.saida_corte) pedacos.push('(saida cortada: ' + diagAnterior.saida_corte + ')');
      pedacos.push('=== FIM DO QUE A MAQUINA RESPONDEU ===');
      pedacos.push('Conserte exatamente isso. Nao repita a mesma solucao que falhou.');
    }
    return pedacos.join('\n');
  };

  GD.loop = async function (cfg) {
    const c = Object.assign({
      motor: 'godot', maxRodadas: 4, maxLog: 6000, onPasso: () => {},
      esqueleto: false, projeto: '', arquivos: [],
    }, cfg || {});
    const m = GD.motor(c.motor);
    const reg = { ok: false, rodadas: 0, registro: [], errosFinais: [], arquivos: [],
      custo: { chamadas: 0, gastouSaldo: false, modelos: [], modelosDeFundo: true },
      motivo: '', ia: 'fundo (gratis)' };
    const passo = (t, extra) => { try { c.onPasso(Object.assign({ tipo: t }, extra || {})); } catch (e) {} };

    if (!m) { reg.motivo = 'motor desconhecido: ' + c.motor + ' (tem: ' + GD.lista().join(', ') + ')'; return reg; }
    if (!c.objetivo) { reg.motivo = 'sem objetivo: o que o jogo deve fazer?'; return reg; }
    if (!c.vm || typeof c.vm.escrever !== 'function' || typeof c.vm.rodar !== 'function') {
      reg.motivo = 'sem maquina para rodar: configure a VM (aba Config > Ligar tudo) — sem maquina eu escrevo codigo que nao posso verificar';
      reg.oQueFazer = 'ligue a VM/no e tente de novo; verificar e o que separa isto de um chat comum';
      return reg;
    }
    const iaPadrao = async (mensagens) => {
      const r = await Arkher.ask(mensagens, { fundo: true, stage: 'codigo', maxTries: 3 });
      return (r && typeof r === 'object') ? r : { text: String(r || '') };
    };
    const ia = c.ia || iaPadrao;
    if (c.ia) reg.ia = 'escolhida pelo chamador';

    /* esqueleto: se pedido, escreve os arquivos-base antes de comecar */
    if (c.esqueleto) {
      const esq = GD.esqueleto(m.id, c.nome);
      if (esq) {
        for (const caminho in esq.arquivos) {
          try { await c.vm.escrever(c.projeto + '/' + caminho, esq.arquivos[caminho]); }
          catch (e) { passo('aviso', { txt: 'nao escrevi ' + caminho + ': ' + e.message }); }
          reg.arquivos.push(c.projeto + '/' + caminho);
        }
        passo('esqueleto', { motor: m.id, pasta: esq.pasta, arquivos: reg.arquivos.slice() });
      }
    }

    let diagAnterior = null, assinaturaAnterior = '', pedidoAnterior = '';
    for (let r = 1; r <= c.maxRodadas; r++) {
      reg.rodadas = r;
      passo('rodada', { n: r, de: c.maxRodadas });

      /* 1. PEDIR O CODIGO (com o erro exato da rodada passada, se houve) */
      const mensagens = [
        { role: 'system', content: GD.SYS },
        { role: 'user', content: GD.prompt(c, diagAnterior, r) },
      ];
      pedidoAnterior = mensagens[1].content;
      let resp;
      try {
        resp = await ia(mensagens);
      } catch (e) {
        reg.motivo = 'a IA falhou na rodada ' + r + ': ' + (e.message || e);
        reg.registro.push({ rodada: r, ato: 'pedido', estado: 'falha', detalhe: reg.motivo });
        return reg;
      }
      reg.custo.chamadas++;
      if (resp && resp.model) reg.custo.modelos.push(resp.model);
      if (resp && resp.gastouSaldo) { reg.custo.gastouSaldo = true; reg.custo.modelosDeFundo = false; }
      const texto = (resp && (resp.text || resp.content)) || '';
      const d = extrairJson(texto);
      if (!d || !Array.isArray(d.arquivos) || !d.arquivos.length) {
        reg.registro.push({ rodada: r, ato: 'pedido', estado: 'ilegivel',
          detalhe: 'a IA nao respondeu no formato (nao escrevi nada)' });
        passo('aviso', { txt: 'resposta fora do formato na rodada ' + r });
        if (r > 1) { reg.motivo = 'a IA nao respondeu no formato duas vezes — parando para nao queimar cota'; return reg; }
        continue;
      }
      reg.registro.push({ rodada: r, ato: 'pedido', estado: 'ok', explica: String(d.explica || '').slice(0, 200),
        arquivos: d.arquivos.map(a => a.caminho) });
      passo('codigo', { n: r, explica: d.explica || '', arquivos: d.arquivos.map(a => a.caminho) });

      /* 2. ESCREVER NA MAQUINA */
      const escritos = [];
      for (const a of d.arquivos) {
        if (!a || !a.caminho || typeof a.conteudo !== 'string') continue;
        const alvo = /^[A-Za-z]:|^\//.test(a.caminho) ? a.caminho : (c.projeto + '/' + a.caminho);
        try { await c.vm.escrever(alvo, a.conteudo); escritos.push(alvo); }
        catch (e) {
          reg.registro.push({ rodada: r, ato: 'escrever', estado: 'falha', detalhe: alvo + ': ' + (e.message || e) });
          reg.motivo = 'nao consegui escrever o arquivo na maquina (' + alvo + '): ' + (e.message || e);
          return reg;
        }
      }
      reg.arquivos = escritos.slice();
      passo('escrito', { n: r, arquivos: escritos });

      /* 3. RODAR DE VERDADE */
      const cmd = (typeof c.cmdRodar === 'function') ? c.cmdRodar(c.projeto, escritos)
        : m.cmdRodar(c.projeto, escritos);
      let saida = '', code = null;
      try {
        const rr = await c.vm.rodar(cmd, c.timeoutMs || 180000);
        if (rr && typeof rr === 'object') { saida = String(rr.out || '') + (rr.err ? '\n' + rr.err : ''); code = (rr.code == null ? null : rr.code); }
        else saida = String(rr || '');
      } catch (e) {
        reg.registro.push({ rodada: r, ato: 'rodar', estado: 'falha', cmd: cmd, detalhe: (e.message || String(e)) });
        reg.motivo = 'nao consegui rodar o comando na maquina: ' + (e.message || e);
        reg.oQueFazer = 'confira se o motor esta instalado nessa maquina e se o caminho do projeto existe';
        return reg;
      }
      passo('rodou', { n: r, cmd: cmd });

      /* 4. LER O LOG (stdout + arquivo do motor, se houver) */
      let doLog = '';
      if (m.logPath && c.vm.ler) {
        try { doLog = String(await c.vm.ler(m.logPath(c.projeto)) || ''); } catch (e) { doLog = ''; }
      }
      const saidaToda = [saida, doLog].filter(Boolean).join('\n');
      const corte = saidaToda.length > c.maxLog ? (saidaToda.length - c.maxLog) : 0;
      const diag = GD.diagnosticar(m.id, saidaToda.slice(0, c.maxLog), code);
      diag.saida_corte = corte ? (corte + ' caracteres ficaram de fora do prompt (o log inteiro esta no registro)') : null;
      diag.saida_bruta = saidaToda;                 /* registro guarda tudo */
      reg.registro.push({ rodada: r, ato: 'rodar', cmd: cmd, estado: diag.estado, code: code,
        erros: diag.erros, avisos: diag.avisos, naoRodou: diag.naoRodou, saida: saidaToda.slice(0, 4000) });
      passo('diagnostico', { n: r, estado: diag.estado, erros: diag.erros, naoRodou: diag.naoRodou });

      /* 5. DECIDIR */
      if (diag.estado === 'ok') {
        reg.ok = true;
        reg.motivo = 'rodou limpo na rodada ' + r;
        reg.errosFinais = [];
        passo('fim', { ok: true, rodadas: r });
        return reg;
      }
      if (diag.estado === 'nao-rodou') {
        reg.errosFinais = [diag.naoRodou];
        reg.motivo = 'nem chegou a rodar: ' + diag.naoRodou;
        reg.oQueFazer = 'resolva isso na maquina (nao e problema no codigo) e rode de novo';
        reg.registro.push({ rodada: r, ato: 'fim', estado: 'nao-rodou', detalhe: reg.motivo });
        return reg;
      }
      if (diag.estado === 'sem-saida' || diag.estado === 'motor-desconhecido') {
        reg.errosFinais = [diag.naoRodou || 'sem saida'];
        reg.motivo = 'nada para consertar: ' + (diag.naoRodou || 'a maquina nao devolveu nada');
        return reg;
      }
      /* erro de codigo: e o MESMO de novo? entao parar (cota) */
      const ass = GD.assinatura(diag);
      if (ass && ass === assinaturaAnterior) {
        reg.errosFinais = diag.erros;
        reg.motivo = 'o MESMO erro voltou na rodada ' + r + ' — paro aqui em vez de queimar cota repetindo:\n' +
          GD.textoErros(diag, 3);
        reg.oQueFazer = 'o conserto precisa de outra informacao (documentacao, uma versao do motor, ou a mao do dono)';
        reg.registro.push({ rodada: r, ato: 'fim', estado: 'mesmo-erro', assinatura: ass });
        passo('fim', { ok: false, motivo: reg.motivo });
        return reg;
      }
      assinaturaAnterior = ass;
      diagAnterior = diag;
      reg.errosFinais = diag.erros;
    }
    reg.motivo = 'cheguei no teto de ' + c.maxRodadas + ' rodadas sem rodar limpo';
    reg.oQueFazer = 'da para subir maxRodadas, ou olhar o registro: as ' + c.maxRodadas + ' tentativas estao la com o erro de cada uma';
    return reg;
  };

  /* ==================================================================
     5) AS MAOS DA IA (skills) — entram no catalogo do site
     ================================================================== */
  /* a VM de verdade: o mesmo agente/DsOS que o resto do site usa */
  GD.vmReal = function (base) {
    const u = String(base || LSg('arkher_agent', '') || LSg('arkher_kaggle', '') || '').replace(/\/+$/, '');
    const post = async (rota, corpo, ms) => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), ms || 120000);
      try {
        const r = await fetch(u + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo), signal: ac.signal });
        return await r.json();
      } finally { clearTimeout(t); }
    };
    return {
      base: u,
      async escrever(caminho, texto) {
        if (!u) throw new Error('sem maquina configurada');
        const r = await post('/write', { path: caminho, content: texto });
        if (!r.ok) throw new Error(r.err || 'write falhou');
        return r.path || caminho;
      },
      async ler(caminho) {
        if (!u) return '';
        const r = await fetch(u + '/cat?path=' + encodeURIComponent(caminho));
        if (!r.ok) return '';
        const j = await r.json().catch(() => ({}));
        return j.text || '';
      },
      async rodar(cmd, ms) {
        if (!u) throw new Error('sem maquina configurada');
        const seg = Math.min(900, Math.round((ms || 180000) / 1000));
        const j = await post('/exec', { cmd: cmd, timeout: seg }, (seg + 20) * 1000);
        return { out: (j.out || '') + (j.err ? '\n' + j.err : ''), code: (j.code == null ? null : j.code) };
      },
    };
  };

  GD.skills = function () {
    return {
      gd_loop: {
        nome: 'Criar e verificar codigo de jogo (loop)',
        desc: 'Escreve o codigo no motor, RODA de verdade na maquina, le o erro real e conserta sozinho ' +
          'ate rodar limpo. E o que separa "codigo bonito" de "jogo que roda". Motores: ' + GD.lista().join(', ') + '.',
        args: { objetivo: 'o que o jogo deve fazer', motor: 'roblox|godot|unity|unreal|blender', projeto: 'pasta do projeto na maquina' },
      },
      gd_erros: {
        nome: 'Ler erro de motor de jogo',
        desc: 'Le a saida/log de um motor e diz o arquivo, a linha e o que quebrou (e se nem chegou a rodar). ' +
          'Use antes de pedir conserto: o erro exato muda tudo.',
        args: { motor: 'roblox|godot|unity|unreal|blender', log: 'a saida ou o conteudo do arquivo de log' },
      },
      gd_esqueleto: {
        nome: 'Esqueleto de projeto',
        desc: 'Devolve os arquivos iniciais de um projeto para o motor escolhido (o ponto de partida certo).',
        args: { motor: 'roblox|godot|unity|unreal|blender', nome: 'nome do jogo' },
      },
    };
  };

  /* executa as ferramentas gd_* (chamado pelo runTool do skills.js) */
  GD.ferramenta = async function (tool, args, log) {
    log = log || (() => {});
    if (tool === 'gd_erros') {
      const d = GD.diagnosticar(args.motor, args.log || args.saida || '', args.code == null ? null : +args.code);
      return { ok: d.estado === 'ok', estado: d.estado, out: GD.textoErros(d) || (d.estado === 'ok' ? 'rodou limpo' : (d.naoRodou || 'sem erro identificado')),
        erros: d.erros, avisos: d.avisos, naoRodou: d.naoRodou };
    }
    if (tool === 'gd_esqueleto') {
      const e = GD.esqueleto(args.motor, args.nome);
      if (!e) return { ok: false, err: 'motor desconhecido (tem: ' + GD.lista().join(', ') + ')' };
      return { ok: true, out: 'esqueleto de ' + e.motor + ' com ' + Object.keys(e.arquivos).length + ' arquivo(s)',
        pasta: e.pasta, arquivos: e.arquivos };
    }
    if (tool === 'gd_loop') {
      const base = args.base || LSg('arkher_agent', '') || LSg('arkher_kaggle', '');
      if (!base) return { ok: false, err: 'sem maquina configurada (aba Config > Ligar tudo)' };
      const r = await GD.loop({
        objetivo: args.objetivo, motor: args.motor || 'godot',
        projeto: args.projeto || ('/tmp/arkher-' + (args.nome || 'jogo')),
        esqueleto: args.esqueleto !== false, nome: args.nome, vm: GD.vmReal(base),
        onPasso: (p) => { try { log(p.tipo + (p.n ? (' ' + p.n) : '') + (p.txt ? (': ' + p.txt) : '') + (p.estado ? (': ' + p.estado) : '')); } catch (e) {} },
      });
      const linhas = (r.registro || []).map(x => 'rodada ' + x.rodada + ' ' + x.ato + ' → ' + (x.estado || '') +
        (x.explica ? (' — ' + x.explica) : '')).join('\n');
      return { ok: !!r.ok, out: (r.ok ? 'rodou limpo em ' + r.rodadas + ' rodada(s)' : ('nao rodou limpo: ' + r.motivo)) +
        (r.custo ? ('\nchamadas de IA: ' + r.custo.chamadas + ' · cota de usuario gasta: ' + (r.custo.gastouSaldo ? 'sim' : 'nao')) : '') +
        (linhas ? ('\n' + linhas) : ''),
        rodadas: r.rodadas, erros: r.errosFinais, registro: r.registro, custo: r.custo, oQueFazer: r.oQueFazer };
    }
    return null;   /* nao e ferramenta daqui */
  };

  /* registra no catalogo do site (se o skills.js ja carregou) */
  try { if (typeof SKILLS !== 'undefined' && SKILLS) Object.assign(SKILLS, GD.skills()); } catch (e) {}

  if (typeof window !== 'undefined') window.GD = GD;
  if (typeof module !== 'undefined' && module.exports) module.exports = GD;
})();
