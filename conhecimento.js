/* ============================================================
   ARKHER — CONHECIMENTO (o "estudo" do agente)
   ============================================================

   Isto NAO e uma lista de links bonitos: e o conteudo que entra no
   armazenamento neural (neural.js) e volta na resposta quando o
   assunto e aquele. Cada item vira um trecho indexado, com tag.

   Regras que eu segui ao escrever:
   1. Comando que eu tenho certeza -> entra como comando.
   2. Comando que eu nao tenho certeza -> entra MARCADO ("confira"),
      nunca inventado. Prefiro parecer incompleto do que te fazer
      perder 3 horas com um flag que nao existe.
   3. Nada de "baixe o melhor modelo": entra o caminho concreto.

   Como isso cresce depois (sem eu estar aqui):
     - aba Cerebro > "Estudar uma documentacao" (cola a URL: a gente
       baixa pelos proxies de CORS, corta em pedacos, vetoriza e guarda)
     - a propria IA chama a skill `estudar` quando o assunto e novo
     - toda resposta boa vira licao (aprendizado automatico)
   ============================================================ */
'use strict';
(function () {
  const C = [];

  const add = (t, tags, txt, fonte) => C.push({ t, tags, txt, fonte });

  /* ------------------------------------------------------------
     1. ROBLOX STUDIO / LUAU — o alvo principal
     ------------------------------------------------------------ */
  add('Roblox: rodar o Studio pela linha de comando',
    'roblox studio cli comando abrir place automacao',
    `RobloxStudioBeta.exe aceita -task. Os que eu conheco e confio:
  -task EditFile -localPlaceFile "C:\\caminho\\jogo.rbxl"   -> abre o lugar
  -task StartServer / -task StartClient                     -> sobe servidor/cliente de teste
  -task PublishPlaceToRoblox? -> NAO confie sem testar; publique pela Open Cloud API.
Dica: rode "RobloxStudioBeta.exe -help" na propria maquina e me mande a saida
que eu gravo aqui. No Windows o caminho costuma ser
%LOCALAPPDATA%\\Roblox\\Versions\\<hash>\\RobloxStudioBeta.exe
(no nosso agente: POST /app {"nome":"roblox"} resolve isso sozinho).`,
    'create.roblox.com/docs (Studio) + teste local'),

  add('Roblox: Rojo (codigo no disco -> Studio)',
    'roblox rojo sincronizacao luau projeto',
    `Rojo e o jeito serio de versionar codigo Roblox em arquivo .lua/.luau.
  rojo init                      -> cria default.project.json
  rojo build -o jogo.rbxlx       -> gera o place (roda no CI, sem Studio)
  rojo serve                     -> o plugin do Studio conecta e sincroniza ao vivo
  rojo sourcemap default.project.json -o sourcemap.json   -> pro autocomplete
default.project.json aponta o que vai pra ServerScriptService, ReplicatedStorage, etc.
Wally cuida das dependencias: wally init / wally install (wally.toml).`),

  add('Roblox: Luau — padroes que eu uso sempre',
    'roblox luau lua script servico serverscriptservice remote datastore',
    `Servicos: game:GetService("RunService"|"TweenService"|"Players"|"DataStoreService"
  |"ReplicatedStorage"|"ServerStorage"|"CollectionService"|"PhysicsService"
  |"PathfindingService"|"HttpService"|"MemoryStoreService"|"MessagingService")
Ciclo: task.wait(n) (nunca wait()), RunService.Heartbeat/PreSimulation/PostSimulation,
  RunService.RenderStepped (cliente), TweenService:Create(...):Play().
Cliente<->servidor: RemoteEvent/RemoteFunction em ReplicatedStorage, SEMPRE com
  validacao no servidor (nunca confie no cliente). Rate-limit por jogador.
Dados: DataStoreService:GetDataStore("x"):UpdateAsync(chave, function(antigo) ... end)
  — UpdateAsync e nao SetAsync, pra nao sobrescrever compra de outro servidor.
  Sessao: ProfileService/ProfileStore (biblioteca da comunidade) resolve o resto.
Raycast: workspace:Raycast(origem, direcao, params) -> instancia/posicao/normal.
Tocar/coletar: CollectionService:AddTag(inst, "Moeda") + GetInstanceAddedSignal.
Pathfinding: PathfindingService:CreatePath({AgentRadius=2, AgentHeight=5}):ComputeAsync(a,b).
UI: ScreenGui no PlayerGui; animacao: TweenService ou AnimationTrack:Play().
Performance: StreamingEnabled no lugar, PreloadAsync, evitar while true do sem wait,
  parte por parte no servidor (use uma vez, replicado), occlude/desliga o que nao se ve.`),

  add('Roblox: publicar e mexer por API (Open Cloud)',
    'roblox open cloud api datastore mensageria asset upload universo',
    `Open Cloud usa API key (Creator Hub > Open Cloud) ou OAuth2. Cabecalho:
  x-api-key: <chave>        (ou Authorization: Bearer <token OAuth>)
Publicar lugar novo (envia .rbxl/.rbxlx):
  POST https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published
       corpo: bytes do arquivo, Content-Type: application/octet-stream
DataStore pela API:
  https://apis.roblox.com/datastores/v1/universes/{universeId}/standard-datastores
  .../standard-datastores/datastore/entries/entry?datastoreName=&entryKey=
  (a rota de listagem/versoes fica em .../entries)
Mensageria (servidor -> servidor):
  POST https://apis.roblox.com/messaging-service/v1/universes/{u}/topics/{t}
Asset (upload de modelo/imagem):
  POST https://apis.roblox.com/assets/v1/assets  (+ polling em /assets/v1/operations/{id})
Place/asset info: https://apis.roblox.com/universes/v1/{u}/places/{p} ...`),

  add('Roblox: MCP do Studio (a IA dirige o Studio)',
    'roblox studio mcp ia automacao agente',
    `A Roblox publicou um servidor MCP pro Studio (repositorio oficial
github.com/Roblox/studio-rust-mcp-server). Ideia: ligar o Studio ao agente
por MCP em vez de clicar na tela.
O que eu SEI: o projeto existe e e oficial-ish; o plugin roda dentro do Studio.
O que CONFERIR na sua maquina antes de eu montar o fluxo: nome do executavel,
porta padrao e se a versao do seu Studio ja traz o plugin. Me manda a saida de
"cd <repo> && cargo run -- --help" (ou o README da sua versao) que eu ajusto aqui.
Por que vale a pena: com MCP a IA cria Part/UI/script por API (rapido e exato),
e o Piloto (print+clique) fica so pro que nao tem API.`),

  /* ------------------------------------------------------------
     2. UNITY
     ------------------------------------------------------------ */
  add('Unity: batchmode (rodar sem abrir a janela)',
    'unity cli batchmode build executeMethod automacao ci',
    `Build:  Unity -batchmode -quit -nographics -projectPath "C:\\jogo" \\
           -executeMethod BuildScript.BuildWindows -logFile -
  -quit fecha ao terminar; -batchmode nao abre UI; -nographics sem GPU
  -buildTarget Win64 | Android | WebGL | StandaloneOSX
  -logFile - manda o log pro stdout (o agente le ao vivo)
  -createManualActivationFile / licenca: -serial + -username + -password OU
  -returnlicense ao terminar. Licenca pessoal ativa uma vez e fica no ULF.
Editor script (Assets/Editor/BuildScript.cs):
  [MenuItem("ARKHER/Build")] public static void BuildWindows() {
    BuildPipeline.BuildPlayer(new[]{ "Assets/Cenas/Main.unity" },
      "Builds/jogo.exe", BuildTarget.StandaloneWindows64, BuildOptions.None); }
Componentes uteis: AssetDatabase, EditorUtility, ScriptableObject, SerializedObject.
Pacotes: Packages/manifest.json; a versao do editor fica em ProjectSettings/ProjectVersion.txt.`),

  add('Unity: runtime e performance',
    'unity monobehaviour ciclo update fisica navmesh pooling profiler',
    `Ciclo: Awake -> OnEnable -> Start -> FixedUpdate(fisica) -> Update(frame) ->
  LateUpdate(camera) -> OnDisable -> OnDestroy. Time.deltaTime / fixedDeltaTime.
Fisica: Rigidbody + Collider (nunca mova transform com Rigidbody, use MovePosition);
  Physics.Raycast / SphereCast; Camadas + LayerMask pra filtrar.
IA: NavMeshAgent (bake do NavMesh) ou A* proprio; StateMachine/Behavior Tree.
Animacao: Animator + Blend Tree; root motion; Avatar Mask pra upper body.
Input: novo Input System (InputAction) ou Input.GetAxis (antigo).
Performance: object pooling, batches/GPU Instancer, LOD + occlusion culling,
  Profiler + Frame Debugger, evitar GetComponent em Update, Addressables pra asset.
Mobile: qualidade por tier, compressao de textura (ASTC), sem post-processing pesado.`),

  /* ------------------------------------------------------------
     3. UNREAL
     ------------------------------------------------------------ */
  add('Unreal: linha de comando (editor, build, cook)',
    'unreal ue5 cli cmd buildcookrun pak headless python automation',
    `Editor sem UI:
  UnrealEditor-Cmd.exe "C:\\Jogo\\Jogo.uproject" -run=pythonscript -script="C:/s.py"
  -ExecCmds="stat fps,quit"     (roda console command e sai)
  -game / -server / -nullrhi / -nosound / -windowed -ResX=1280 -ResY=720
  -unattended -nopause -nosplash     (obrigatorio em CI)
Testes automatizados:
  -run=Automation -ExecCmds="Automation RunTests Meu.Teste;Quit" -testexit="Automation Test Queue Empty"
Empacotar (RunUAT):
  RunUAT BuildCookRun -project="C:/Jogo/Jogo.uproject" -noP4 -platform=Win64
    -clientconfig=Shipping -cook -build -stage -pak -archive -archivedirectory="C:/out"
Android: -platform=Android -cookflavor=ASTC. Mac: -platform=Mac.
AutomationTool no Linux/Docker e via "RunUAT.sh".`),

  add('Unreal: Python e C++ do dia a dia',
    'unreal python ue5 asset actor blueprint subsystem gas niagara',
    `Python (editor): ativar plugin "Python Editor Script Plugin" e "Editor Scripting Utilities".
  import unreal
  unreal.EditorAssetLibrary.does_asset_exist("/Game/X")
  subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  ator = subsys.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0,0,0))
  (EditorLevelLibrary e antigo: o certo hoje sao os subsystems)
C++: AActor/APawn/AGameModeBase/APlayerController/AHUD/UUserWidget;
  UPROPERTY(EditAnywhere) e UFUNCTION(BlueprintCallable) expoem pro Blueprint;
  UCLASS/UMG; GAS (GameplayAbilitySystem) pra habilidade/cooldown/dano;
  Niagara pra VFX; Nanite+Lumen (UE5) pro visual; World Partition em mapa grande;
  MetaSounds pra audio reativo. Build: Build.cs/Target.cs; Live Coding pra iterar.`),

  /* ------------------------------------------------------------
     4. GODOT
     ------------------------------------------------------------ */
  add('Godot: headless e export pela linha de comando',
    'godot cli headless export release template gdscript automacao',
    `godot --headless --path /projeto --script res://ferramenta.gd   (roda script isolado)
godot --headless --import            (importa recursos; rode no CI antes do export)
godot --headless --export-release "Windows Desktop" saida/jogo.exe
godot --headless --export-debug   "Linux/X11" saida/jogo.x86_64
godot --headless --quit-after 60      (roda 60 frames e sai: teste rapido de boot)
Precisa dos export templates da MESMA versao (Godot > Manage Export Templates,
ou baixar o .tpz). Export presets: export_presets.cfg na raiz do projeto.
Plugin em C#/.NET: use a build .NET do Godot e o projeto .csproj.
GDExtension pra codigo nativo (C/C++/Rust) sem recompilar a engine.`),

  add('Godot: GDScript que eu escrevo sem pensar duas vezes',
    'godot gdscript node scene signal tween characterbody resource',
    `extends CharacterBody3D
@export var velocidade := 6.0
@onready var camera: Camera3D = $Camera3D
signal morreu(motivo: String)
func _ready() -> void: pass
func _physics_process(delta: float) -> void:
    var dir := Input.get_vector("esq","dir","frente","tras")
    velocity = Vector3(dir.x, 0, dir.y) * velocidade
    if not is_on_floor(): velocity.y -= 9.8 * delta
    move_and_slide()
func _unhandled_input(e: InputEvent) -> void:
    if e.is_action_pressed("pular") and is_on_floor(): velocity.y = 5.0
Cena: preload("res://x.tscn").instantiate(); add_child(); get_tree().change_scene_to_file()
Sinal: morreu.emit("buraco") / morreu.connect(_on_morte)
Tween: create_tween().tween_property(node,"position",alvo,0.3)
Dados: Resource customizado (@export) pra item/arma; salvar com ResourceSaver.
Grupos: add_to_group("inimigo"); get_tree().get_nodes_in_group("inimigo").`),

  /* ------------------------------------------------------------
     5. BLENDER
     ------------------------------------------------------------ */
  add('Blender: rodar script sem abrir a interface',
    'blender cli python bpy headless render exportar glb',
    `blender -b modelo.blend -P script.py -- argumentos   (-b = background)
blender -b --factory-startup -P script.py            (ignora addons/preferencias)
blender --python-expr "import bpy; print(bpy.app.version_string)"
blender -b cena.blend -o //render/frame_ -F PNG -a     (renderiza a animacao toda)
blender -b --render-output /tmp/f -f 1                 (1 frame)
TRUQUE que salva o dia: -- factory-startup evita addon quebrado do seu perfil
travando o CI.
Dentro do script, os argumentos vem depois de "--": sys.argv[sys.argv.index("--")+1:]`),

  add('Blender: bpy — receitas que uso',
    'blender bpy mesh material uv exportar gltf rig importar',
    `import bpy, bmesh, sys
bpy.ops.wm.read_factory_settings(use_empty=True)     # cena limpa
bpy.ops.mesh.primitive_cube_add(size=1)
obj = bpy.context.active_object
# editar malha com bmesh (mais seguro que ops em lote):
me = obj.data; bm = bmesh.new(); bm.from_mesh(me); bm.to_mesh(me); bm.free()
# material simples PBR:
mat = bpy.data.materials.new("M"); mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]; bsdf.inputs["Base Color"].default_value = (1,0,0,1)
obj.data.materials.append(mat)
bpy.ops.object.modifier_add(type='SUBSURF')          # subdivisao
bpy.ops.uv.smart_project()                            # UV automatica (precisa modo edit)
# importar/exportar:
bpy.ops.import_scene.gltf(filepath="/tmp/x.glb")
bpy.ops.export_scene.gltf(filepath="/tmp/saida.glb", export_format='GLB',
    export_apply=True, export_yup=True)                # export_apply aplica modificadores
Render: bpy.context.scene.render.engine='CYCLES'|'BLENDER_EEVEE_NEXT'; .filepath=...
Obs: nome do engine EEVEE mudou na 4.2 (BLENDER_EEVEE_NEXT). Confira bpy.app.version
antes de fixar.`),

  /* ------------------------------------------------------------
     6. FIGMA / CASCADEUR / conceito
     ------------------------------------------------------------ */
  add('Figma: API REST (UI do jogo direto do design)',
    'figma api rest design ui importar token',
    `Token pessoal: Figma > Settings > Security > Personal access tokens.
Cabecalho em tudo: X-Figma-Token: <token>
  GET https://api.figma.com/v1/me
  GET https://api.figma.com/v1/files/{key}                 (doc inteiro)
  GET https://api.figma.com/v1/files/{key}/nodes?ids=1:2,3:4
  GET https://api.figma.com/v1/files/{key}/components
  GET https://api.figma.com/v1/images/{key}?ids=1:2&format=png&scale=2  (exporta imagem)
  GET https://api.figma.com/v1/files/{key}/variables/local   (variaveis/design tokens)
O {key} e o pedaco da URL do arquivo: figma.com/file/<key>/...
Plugin (roda dentro do Figma): manifest.json + figma.showUI(__html__),
  figma.createFrame(), figma.ui.postMessage(), figma.currentPage.selection.
Fluxo pratico pra jogo: exporte o frame em PNG pelo /v1/images e jogue no
gerar3d/imagem; pegue as cores das variables pra manter HUD consistente.`),

  add('Cascadeur: automacao (sem inventar comando)',
    'cascadeur animacao fisica cli python csc',
    `O que eu SEI: Cascadeur tem API Python (modulo csc) e o app aceita um arquivo
de cena na linha de comando. O QUE EU NAO SEI: os nomes exatos das funcoes da
sua versao. Entao: dentro do Cascadeur, Help > Python API mostra a lista da sua
build. Me cola um trecho dessa tela (ou o help da CLI) e eu gravo aqui.
Enquanto isso, o caminho que funciona sem chutar: exporte FBX/BVH do Cascadeur,
processe com Blender (bpy) ou com o proprio agente, e reimporte.
Pra rig/animacao procedural: Blender (rigify), Rigify->FBX->Unity/UE, ou
Blender + Python pra gerar curvas.`),

  /* ------------------------------------------------------------
     7. MUNDOS / PROCEDURAL
     ------------------------------------------------------------ */
  add('Geracao de mundo: os algoritmos que importam',
    'mundo procedural perlin simplex wfc poisson erosao bioma chunk lod',
    `Altura: Perlin/Simplex + fBm (somar oitavas com frequencia x2 e amplitude /2),
  domain warping (usar ruido pra deslocar a entrada do proprio ruido).
Bioma: temperatura + umidade (2 ruidos diferentes) -> tabela de bioma -> splat map
  (textura RGBA onde cada canal e um material do terreno).
Objetos: Poisson disk sampling (distancia minima) pra arvore/pedra sem amontooar.
Estruturas: WFC (Wave Function Collapse) pra interior/esgoto/tileset coerente;
  BSP ou sala-corredor pra dungeon classica.
Erosao: hidraulica (cava vale, deposita sedimento) e termica (desmorona encosta);
  sem isso a montanha parece plastico.
Malha: quadtree/ROAM + LOD por distancia; marching cubes se o terreno for volumetrico.
Chunks: gere em thread, suba na GPU aos poucos; nunca tudo no mesmo frame.
Computar na GPU: compute shader -> RenderTexture -> leitura pro mesh (mais rapido que CPU).
Ferramentas pagas que fazem isso em vez de codigo: Gaea, World Machine, Houdini
(HDAs via Houdini Engine dentro do Unity/Unreal). CLI exato de cada uma: confira
na sua versao antes de automatizar.`),

  add('Game dev: o essencial que se aplica em qualquer engine',
    'game loop fisica netcode save estado maquina ia arquitetura',
    `Loop: passo fixo pra fisica (60Hz) + delta pra render; nunca amarre dano a FPS.
Fisica: swept AABB (evita atravessar parede em alta velocidade), raycast pra tiro,
  camadas de colisao, continuous collision detection em projetil rapido.
Estado/IA: maquina de estados finita, behavior tree (decorator->selector->sequence),
  utility AI, GOAP; pathfinding A* em grade/node, navmesh pra espaco aberto.
Netcode: servidor autoritativo, interpolacao (suaviza o outro), predicao do cliente
  + reconciliacao, lag compensation (rewind do hitbox), rollback pra lutinha;
  delta compression e snapshot a 20-30Hz basta pra maioria.
Save: versao no arquivo (v1,v2...) e migracao; nunca serializar cena inteira.
Dinheiro/tempo: prototipo sem arte -> vertical slice -> conteudo; build em CI desde
  o primeiro dia (rojo build / unity batchmode / godot --export / RunUAT).
Qualidade: acessibilidade (remap, cor+forma, subtitulo, escala de UI), telemetria
  anonima de onde o jogador morre, playtest curto e frequente.`),

  /* ------------------------------------------------------------
     8. FORMATOS E ASSETS
     ------------------------------------------------------------ */
  add('glTF/GLB, FBX e o que o jogo realmente come',
    'gltf glb fbx obj usd formato pbr normal map draco ktx2',
    `glTF 2.0 = JSON + binario; GLB = os dois num arquivo so (cabecalho de 12 bytes,
  chunk JSON, chunk BIN). E o formato que web/engine moderna le direto.
PBR metallic-roughness: baseColor (albedo, sRGB) + metallicRoughness (linear) +
  normal (tangente) + emissive + occlusion. Normal map e dado, nao enfeite:
  exporte em OpenGL (+Y) pro Godot/Unity e DirectX (-Y) pro Unreal se pedir.
Otimizacao: Draco (geometria) e KTX2/Basis (textura) pra web/mobile;
  mipmaps, power-of-two no mobile, atlas em vez de 200 texturas soltas.
USD/USDZ: pipeline de filme e Apple; bom pra cena gigante, pesado pra jogo.
FBX continua sendo o idioma do rig/animacao (Unity/UE importam bem).
Regras de asset: nome sem acento/espaco, escala real (1 unidade = 1 m no UE/Godot,
  Unity tambem), origem no chao, colisor separado do visual, LOD por distancia,
  texel density igual entre objetos parecidos.`,
    'glTF 2.0 spec (Khronos)'),

  /* ------------------------------------------------------------
     9. ESTE REPO — pra IA saber mexer em casa
     ------------------------------------------------------------ */
  add('ARKHER: mapa do proprio sistema',
    'arkher arquitetura agente rotas site no kaggle windows android',
    `Site (index.html + *.js): chat, terminal, 3D, VM, Piloto, Capacidades, DsOS, Cerebro.
Nos (rodam agent.py, porta 8765):
  - Windows do GitHub Actions (RDP ligado, Tailscale) — 6h por sessao, religa sozinho
  - Kaggle (T4 x2 ou P100, 30h/semana de GPU, sessao de 12h) — o no forte
  - Android/Termux — fica ligado 24/7
  - seu PC — localhost
Rotas do agente: /health /exec /spawn /job /screen /input /app /history /snapshot
  /ls /cat /write /file /gerar3d /gerar3d/instalar /infer /treinar /node /ws
Portas: 8765 agente | 8766 DsOS (tela do Linux) | 3389 RDP (Windows)
Arquivos-chave: agent.py (no), gerar3d.py (malha 3D), hf_hub.py (modelos de ponta +
  treino LoRA), dsos_core.py (tela/entrada Linux), ws_min.py (WebSocket), neural.js
  (memoria), conhecimento.js (este arquivo), skills.js (ferramentas da IA).
Estado entre sessoes: arkher_state/ (work/, history.jsonl, SNAPSHOT.json, 3d/, hf/).`,
    'o proprio repo');

  const Conhecimento = {
    itens: C,
    /** texto unico pro prompt de sistema quando o assunto e game dev */
    resumo(limite) {
      return C.slice(0, limite || 12).map(x => '- ' + x.t).join('\n');
    },
    tags() {
      const s = new Set();
      C.forEach(x => String(x.tags || '').split(/\s+/).forEach(t => t && s.add(t)));
      return [...s].sort();
    },
    /** fontes oficiais pra aba Cerebro > "Estudar documentacao" */
    fontes: [
      ['Roblox', 'https://create.roblox.com/docs'],
      ['Rojo', 'https://rojo.space/docs/'],
      ['Wally', 'https://wally.run/'],
      ['Luau', 'https://luau.org/'],
      ['Roblox Open Cloud', 'https://create.roblox.com/docs/cloud/reference'],
      ['Studio MCP', 'https://github.com/Roblox/studio-rust-mcp-server'],
      ['Unity Manual', 'https://docs.unity3d.com/Manual/index.html'],
      ['Unity Scripting', 'https://docs.unity3d.com/ScriptReference/index.html'],
      ['Unreal (docs)', 'https://dev.epicgames.com/documentation/en-us/unreal-engine'],
      ['Unreal Python', 'https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api'],
      ['Godot', 'https://docs.godotengine.org/en/stable/'],
      ['GDScript', 'https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/'],
      ['Blender Python', 'https://docs.blender.org/api/current/'],
      ['Figma REST API', 'https://www.figma.com/developers/api'],
      ['Figma Plugin API', 'https://www.figma.com/plugin-docs/'],
      ['glTF 2.0', 'https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html'],
      ['Hugging Face (modelos)', 'https://huggingface.co/models'],
      ['HF Inference Providers', 'https://huggingface.co/docs/inference-providers/index'],
      ['Diffusers', 'https://huggingface.co/docs/diffusers/index'],
      ['Transformers', 'https://huggingface.co/docs/transformers/index'],
      ['TRL (treino)', 'https://huggingface.co/docs/trl/index'],
      ['PEFT / LoRA', 'https://huggingface.co/docs/peft/index'],
    ],
  };

  if (typeof window !== 'undefined') window.Conhecimento = Conhecimento;
  if (typeof module !== 'undefined') module.exports = { Conhecimento };
})();
