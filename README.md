# O MODELO DEFINITIVO (a arquitetura fechada)

Se você quiser só uma página deste repositório para entender tudo, é esta.

## As cinco camadas

| # | Camada | O que faz | Custa cota? |
|---|---|---|---|
| 1 | **Biblioteca comum** (`respostas.js`) | pergunta já respondida volta **de graça**. Hash, não texto; dado pessoal nunca entra | **não** |
| 2 | **Worker de busca passiva** (`arkher_worker.js`) | CPU + RAM baixam, limpam e indexam. Script Python puro para Kaggle/Codespaces/PC | **não** |
| 3 | **Cofre Neural** (`neural.js` + `arkher_pack.js`) | RAG por significado + regras destiladas injetadas no prompt de **todos** os modelos | **não** |
| 4 | **Operários** (`arkher_operarios.js`) | a cota gratuita que **zera todo dia** é usada para destilar o cofre em regras | cota **grátis** (perecível) |
| 5 | **Ponta** (Puter + gateways) | o modelo forte, para o que realmente exige — **por último**, só quando 1–4 não bastam | sim (crédito) |

## As regras fixas (implementadas, não prometidas)

- **Trabalho de fundo nunca gasta a cota de ninguém.** `Arkher.ask(msgs, {fundo:true})` roda só em
  :free, provedores grátis do site, HF e GPU. Verificado: com o usuário logado no Puter, o pedido
  normal vai para a ponta; o **mesmo** pedido com `fundo:true` **não toca** no Puter.
- **Cada um paga o que usa** (UPG). Nenhum token de visitante entra no armazém.
- **O site só lê** o medidor das contas. Não soma, não transfere.
- **O time vê o APELIDO, nunca o e-mail.** O e-mail continua sendo a chave interna; a presença e o
  log carregam o apelido junto.
- **O que cresce sem parar é o cofre, não o modelo.**

## Kaggle: tem GPU? Tem — e é grátis

| Item | Valor |
|---|---|
| GPU | **Tesla P100 (16 GB)** ou **2× Tesla T4 (16 GB cada)** |
| Cota | **~30 horas de GPU por semana** |
| Sessão | até **12 horas** (depois precisa reiniciar) |
| Disco/RAM | ~20 GB de disco · ~13–30 GB de RAM |
| Custo | **R$ 0** |

Ou seja: dá para **treinar LoRA de um modelo seu** — um por vez, em sessão. Não é "todos ao mesmo
tempo, sem parar", mas é treino de peso **de verdade**, de graça. E o worker de busca passiva roda
lá o dia inteiro sem gastar a cota de GPU.

## APK resolve alguma coisa?

| Ganho real | Não muda |
|---|---|
| **Sem CORS**: o app baixa qualquer site direto, sem proxy | ❌ não deixa modelo de API mais barato |
| Roda em **segundo plano** (o worker trabalha com a tela apagada) | ❌ não dá treino sem GPU |
| **HUD nativo** para controlar Roblox Studio / Blender com o dedo | ❌ não cria canal de treino no Puter |
| Notificações, atalhos, menos overhead de navegador | ❌ não aumenta cota de ninguém |

Resumo: o APK vale a pena **pelo HUD, pelo segundo plano e pelo fim do CORS** — não pelo modelo de
cota. E boa parte disso um **PWA** já entrega hoje, sem loja e sem assinatura.

# ARKHER AI

Plataforma de IA com acesso restrito, VM Windows compartilhada, piloto autonomo
(a IA olha a tela e opera a maquina), DsOS (a tela da maquina remota no seu
navegador/celular) e geracao 3D (texto/imagem -> .glb) no no com GPU.

Site 100% estatico (sem build) e **instalavel como app** (PWA). Os backends sao
arquivos Python de stdlib. Tela e saida de comando vao por **WebSocket** (sem
polling); se o no for antigo ou nao tiver o `ws_min.py`, cai sozinho pro modo HTTP.

| Doc | Pra que serve |
|---|---|
| **RECURSOS.txt** | 3D (motores, tamanhos, honestidade), velocidade (WS x WebRTC) e o app (PWA) |
| COMO-USAR.txt | do zero ate o primeiro comando, em 2 min |
| PUBLICAR.txt | Supabase, host do site, VM e cofre de tokens |
| DSOS.txt | a tela remota em detalhe |
| ANDROID.txt | o celular (Termux) como terceiro no |

## O que tem

| Aba | O que faz | Precisa de |
|---|---|---|
| Chat | Cascata: **via grátis do Puter (:free) -> provedores grátis (chaves suas) -> Puter -> Hugging Face -> no com GPU**. O primeiro "low balance" troca a pista sozinho. Ferramentas (web, VM, piloto, 3D, GPU, memoria) que qualquer modelo pode chamar | login no Puter **ou** token HF (ou 1 chave grátis) |
| DsOS | Tela real do backend (Windows ou Kaggle) com toque/mouse/teclado | `dsos_core.py` rodando (porta 8766) |
| Sandbox | Terminal PowerShell/bash na VM, saida ao vivo por WebSocket | `agent.py` (porta 8765) |
| Capacidades | Lista das ferramentas + ranking de modelos do Hub por tarefa | — |
| 3D | Gera **.glb de verdade**: TripoSR (imagem->3D, GPU), Shap-E (texto->3D), preview e download | no Kaggle/VM com `gerar3d.py` |
| VM | Specs, equipe (VM compartilhada), Kaggle, Android, rclone | Supabase p/ equipe |
| Piloto | A IA ve a tela e opera mouse/teclado | VM + sessao grafica + modelo com visao |
| Integracoes | Atalhos de comandos pro Sandbox | — |
| **Cerebro** | **Memoria neural** (busca por significado), **Ensinar** (URL/texto), **Aprender sozinho** (destilar regras) e **Treinar LoRA** no no com GPU | nada (o vetor local funciona offline) |
| Config | Modelos, modo de gasto, **provedores grátis**, cofre de tokens, HF, agente, contas Puter, reset | — |

## Subir o site

Qualquer host estatico (GitHub Pages, Netlify, Cloudflare Pages) ou localmente:

```
python -m http.server 8080     # abra http://localhost:8080
```

### Instalar como app (PWA)

No Chrome/Edge aparece o botao de instalar no topo (ou menu -> *Instalar app*).
Android: menu -> *Adicionar a tela inicial*. iPhone: Compartilhar -> *Adicionar a
Tela de Inicio*. Depois disso abre em tela cheia, entra na lista de apps, tem
atalhos por aba e o casco abre offline. **Precisa de HTTPS** (GitHub Pages ja da;
em localhost o service worker fica desligado de proposito, pra nao servir cache
velho enquanto voce mexe no codigo). Detalhes e o porque em `RECURSOS.txt`.

> **HTTPS x HTTP:** se o site estiver em HTTPS (GitHub Pages) e o agente em HTTP
> (Tailscale), o Chrome bloqueia a chamada. Cadeado -> Configuracoes do site ->
> *Conteudo nao seguro: Permitir*. Ou abra o site localmente por HTTP.

## Antes de usar

1. **Modelos** — entre no Puter (Config > Entrar no Puter) **e/ou** cole um token
   do Hugging Face (Config). Sem nenhum dos dois o chat nao tem provedor.
2. **Login / equipe (opcional)** — crie um projeto no Supabase e rode o SQL de
   `PUBLICAR.txt`. Sem Supabase o site funciona em **modo local** (botao
   "Entrar sem login"): tudo fica so no seu navegador e a aba Equipe fica desligada.
3. **Secrets do Actions** (Settings -> Secrets -> Actions):
   - `TAILSCALE_AUTH_KEY` — chave **reutilizavel** do Tailscale (obrigatoria)
   - `PAT_TOKEN` — Personal Access Token com escopo `workflow` (sem ele a VM nao
     religa sozinha; o cron de 5 em 5 h e a rede de seguranca)
4. **Settings -> Actions -> General -> Workflow permissions: Read and write.**

## Low balance no Puter: como o ARKHER contorna

O Puter é grátis no discurso, mas tem cota/saldo **não documentado** — quando acaba, a
API devolve `low balance` / `insufficient_funds` (HTTP 402) e o chat pararia. O ARKHER
não deixa: ele tem **três camadas gratuitas** e troca de pista sozinho.

**1. A via grátis do próprio Puter (já vem ligada).** O catálogo dele traz os modelos
gratuitos do OpenRouter, com o id terminando em **`:free`**. Esses **não gastam saldo**:
respondem com a conta zerada. No primeiro `low balance` o ARKHER:

- marca a conta como *sem saldo* (ela **não** é banida — continua valendo na via grátis, e volta sozinha em 12 h);
- tenta outra conta do armazém que ainda tenha saldo (rotação);
- não tendo outra, **repete o seu pedido num modelo `:free`** — a resposta chega do mesmo jeito, sem erro na tela;
- da rodada seguinte em diante, já entra pela via grátis (economiza as tentativas perdidas).
- Se um modelo **pago** voltar a responder, ele entende que o saldo voltou e limpa a marca.
- Botões em Config: **Checar saldo** (quando o Puter expõe) e **Já coloquei crédito**.

**2. Provedores grátis com chave sua (recomendado).** `freeai.js` — nenhum cobra cartão,
cada um com cota diária própria. Duas ou três chaves aqui e o chat deixa de depender de saldo:

| Provedor | Cota gratuita | Nota |
|---|---|---|
| Google AI Studio (Gemini) | 1.500 req/dia | enxerga imagem (Piloto) |
| Groq | 1.000 req/dia | o mais rápido |
| Cerebras | ~1M tokens/dia | muito rápido |
| OpenRouter | 50 req/dia (`:free`) | só modelos `:free` |
| Mistral | ~1B tokens/mês | — |
| GitHub Models | 150–1.000 req/dia | usa o seu PAT do GitHub |
| NVIDIA NIM | ~1.000 req/dia | `nvapi-…` |
| Cloudflare Workers AI | 10.000 neurons/dia | chave no formato `conta:token` |
| Ollama / LM Studio | ilimitado | roda na sua máquina, offline |

Cole a chave em **Config > Provedores grátis** (aceita várias, uma por linha, e gira
quando uma esgota). Cada provedor tem seu *circuit breaker*: três falhas e ele sai da
rodada, sem travar o chat. As chaves ficam no seu navegador (e no Supabase, se o Sync
estiver ligado) — como são chamadas direto do navegador, **abra o site por http(s)**
(`python -m http.server 8080`, GitHub Pages, Netlify): por `file://` a origem é `null` e
alguns provedores recusam. Para o Ollama/LM Studio responder ao site, libere o CORS
deles (`OLLAMA_ORIGINS=* ollama serve`, ou *Developer > Start Server* no LM Studio).

**3. Mais contas no armazém.** Config > *Contas Puter que você já tem*: cada conta é uma
cota a mais, e o `pool.js` distribui as chamadas entre elas (marcando as que estão sem saldo).

**Dois ajustes que seguram o saldo por muito mais tempo:**

- **Teto de tokens por resposta** (Config > Modo de gasto): sem ele, o Puter usa o
  **máximo do modelo** em toda resposta — é o jeito mais rápido de evaporar o saldo. O
  padrão agora é 2048.
- **Modo de gasto**: `automático` (grátis primeiro; com saldo, qualidade primeiro),
  `só grátis` (nunca toca no que custa) e `completo` (usa tudo).

O enxame também aproveita: cada provedor grátis com chave conta como cota no
*armazém* (`enxame.js`), então o conselho cresce mesmo com o Puter zerado.

Prova disso tudo sem abrir o navegador:

```
node teste_cascata.js     # simula conta com e sem saldo, rotação de chave e modo só grátis
```

## "Deu low balance em todas as contas na mesma mensagem" — o que é

Se **todas** as contas caem juntas num pedido, quase nunca é a conta. São dois casos:

1. **O pedido estava caro.** O 402 do Puter (`low_balance`) é sobre o **custo estimado
   daquele pedido**, não sobre o saldo total: histórico longo + memória injetada + o
   `max_tokens` **no máximo do modelo** = estimativa acima do que a conta tem, mesmo com
   saldo sobrando. Sintoma típico: a **primeira** mensagem já estoura.
2. **O limite é do dispositivo/IP.** O Puter mede por conta **+ aparelho** (relatos da
   comunidade). Aí trocar de conta é inútil — 9 contas, 1 mensagem, 9 erros.

O ARKHER trata os dois:

- **Antes de desistir, repete barato**: corta o histórico (`enxugar`) e pede 512 tokens de
  saída em vez do teto. Se passar, guarda `limiteBaixo` e passa a mandar enxuto **desde a
  primeira tentativa** nas próximas mensagens (sem gastar uma chamada perdida por mensagem).
- **Rotação de verdade**: repete o pedido com o token de **cada** conta do armazém pelo
  endpoint REST — a única via em que a conta daquela chamada é realmente a escolhida (o
  `puter.js` não aceita trocar a conta por chamada, então a "rotação" antiga podia estar
  batendo sempre na mesma conta). Cada conta que devolve 402 num pedido pequeno é marcada,
  e as que respondem continuam no jogo.
- **Diagnóstico na tela**: Config > contas Puter > **Testar as contas (por que caíram?)** —
  manda um pedido de **8 tokens** por conta e diz qual dos dois casos é o seu:
  - *todas falham até num pedido minúsculo* → é dispositivo/IP: rotacionar não resolve,
    use a via grátis (`:free`), as chaves grátis e o nó com GPU;
  - *algumas respondem* → é a conta mesmo; o ARKHER passa a usar só as que respondem;
  - *todas respondem no teste* → era o **tamanho do pedido**; o teto de tokens resolve.

## Encher o armazém de cota (sem derrubar a sua conta)

O armazém é o que sustenta tudo: mais contas/chaves = mais cota no mesmo dia. O que dá
para fazer **sem risco** — e que já está ligado no código:

1. **As contas que você já tem.** Cada login no Puter vira uma conta no armazém
   (automático, `Pool.vigiar`). Config > *Contas Puter que você já tem* → entre com a
   próxima, *Capturar conta logada*. Agora tem **Exportar/Importar armazém**: leva o
   armazém inteiro de um navegador/celular para o outro sem repetir login. Use *Exportar
   sem tokens* quando quiser só conferir o inventário (não vaza token).
2. **Uma chave grátis por provedor** (Config > Provedores grátis) — Gemini, Groq,
   Cerebras, Mistral, GitHub, NVIDIA, Cloudflare, OpenRouter e os locais. O painel mostra
   a **capacidade do armazém**: `contas × cota/dia` de cada provedor, somado.
3. **O armazém compartilhado** (Supabase, em `PUBLICAR.txt`): cada pessoa que entra no
   site loga com a **própria** conta Puter e a cota dela entra no armazém. É o modelo do
   próprio Puter (*user-pays*) — 650 cotas aparecem aqui de forma legítima: 650 pessoas
   reais. E cada uma leva vantagem, porque usa o conjunto.
4. **Máquina sua = cota infinita em tokens.** O nó do Kaggle (~30 h de GPU/semana) e o
   Ollama/LM Studio no seu PC não têm limite de requisição: o custo é sua luz.

### Por que a "fazenda de contas" é mau negócio (mesmo ignorando a lei)

- A cota gratuita do Puter é **indocumentada** (~100 req/dia em relatos da comunidade) e
  o controle não é só por conta: é conta **+ IP + fingerprint**. As ~100 primeiras
  requisições de cada conta nova acabam, e o que sobra é a detecção.
- **Proxy grátis (lista pública) é o pior lugar possível**: são nós abertos, quase sempre
  desatualizados e muitos são honeypot. Todo tráfego passa legível — inclusive
  `puter.auth.token`, e-mail e senha. Uma lista dessas transforma seu `.txt` de contas em
  uma lista de alvos pronta.
- **O desfecho é em bloco**: cadastro em massa por ASN de datacenter costuma levar ban do
  *cohort* inteiro — foi o que a comunidade do Puter viu no episódio de `403` geral. E
  como você não tem conta principal separada, o risco cai na conta que você **precisa**.
- **A matemática não fecha**: ~4 h de execução, 650 captchas/verificações, senha repetida
  em 650 contas e um arquivo-texto com todas elas — para entregar ~100 requisições por
  conta, contando com o banimento. Duas chaves grátis (Gemini + Groq) já dão **2.500
  pedidos/dia**, legítimos, sem captcha, sem proxy e sem risco de perder a conta.

Ah, e o lado jurídico: isso **viola os Termos do Puter** (automação, proxy e burla de
limite), o que dá motivo para ele encerrar as contas e, dependendo do caso, gera
responsabilidade civil. Não é, por si só, "invasão de dispositivo" na acepção do art.
154-A do CP — quem sustenta essa leitura faz uma extensão discutível. O que derruba o
esquema é o fato de ele não compensar: o risco do ban em bloco é todo seu, e o ganho é
menor que o de duas chaves grátis.

## Quem paga a IA? O modelo user-pays (e o que o ARKHER recusa)

Esta é a diferença entre um site legítimo e um problema contratual, então vale ser exato:

| Desenho | O que acontece | Situação |
|---|---|---|
| **User-pays** (padrão) | cada visitante entra com a **própria** conta e gasta o crédito dele | ✅ o modelo que o `puter.js` foi feito para fazer |
| **Modo admin** (`eu pago por todos`) | as chamadas usam as contas do armazém, que são **do dono do site** | ⚠️ só com o interruptor ligado, e só com contas suas |
| **Conta de visitante no armazém** | o crédito de quem entra é consumido pelo site/por outro | ❌ removido do código |
| Várias contas no mesmo provedor para multiplicar cota | a mesma pessoa se multiplica | ❌ ban em bloco |

### O que foi removido, e por quê

A versão anterior tinha um furo — e ele é exatamente o mecanismo de "colher cota de
usuário":

1. **Captura automática** — `Pool.auto()` guardava o token de quem logasse. **Removido:**
   agora ele só informa qual conta está ativa; token de visitante não sobe.
2. **"Primeiro login = dono"** — bastava um visitante entrar para virar dono do armazém.
   **Removido:** admin é escolha explícita (checkbox em Config, com confirmação), e sem ele
   o botão de capturar **recusa a operação**.
3. **"Emprestar minha conta"** — o opt-in que autorizava doar a conta para o site.
   **Removido:** cota de quem se autentica é gasta por quem se autentica.

O que sobra é deliberado e mínimo: `Pool.admin()` (ligado por você), `Pool.modo('dono')`
(opcional) e as contas que **você** captura manualmente. Ou seja: o armazém é das suas
contas, não das contas de quem visita. Se o site viralizar, o consumo de cada pessoa sai do
crédito dela — que é o desenho do Puter, e o único que não tem desfecho em ban.

## UPG — User Pays Geral (o que é, e o que não tem como ser)

**UPG** é o nome do modelo deste site: *user-pays geral*. Ele é o que está implementado.

O que ele é:

- site **público**: qualquer pessoa entra e usa;
- cada uma autentica com a **própria** conta Puter e gasta o **próprio** crédito;
- o dono do site **não paga** consumo de ninguém e não precisa de cota própria;
- ninguém usa a cota de ninguém: A usa a de A, B usa a de B.

O que ele **não** é — e aqui está a parte que não tem mecanismo nenhum:

- não existe forma de "a cota do site subir quando entra um usuário novo". No Puter, a
  permissão de uso é da conta autenticada; ela **não é transferível para o app**. Não há
  programa de indicação ou repasse documentado que credite o app a partir do cadastro de
  terceiros. Então "obter a cota do site via UPG" não descreve um fluxo que exista.
- o que **cada novo usuário acrescenta** ao site é **capacidade**: mais uma pessoa atendida
  ao mesmo tempo, com a cota dela. Não é crédito somado a um bolo comum.

Ou seja: UPG = **custo zero para o dono**, com cada um cobrindo a si. Isso é muito — um site
público com 1 ou 100 visitantes custa o mesmo (zero) e nunca te deixa no vermelho. Mas o
número de mensagens top tier que **você** consegue fazer continua sendo o crédito da **sua**
conta.

Se em algum momento o site precisar de cota **própria** (por exemplo, para visitante sem
conta usar a ponta), os únicos caminhos existentes são:

1. **o dono põe crédito** na conta do site (é o modo `admin` / "eu pago por todos" que já
   está no Config, com as contas que **você** captura); ou
2. **contribuição voluntária** de quem quiser apoiar — um fluxo de pagamento explícito,
   em que a pessoa decide pagar; nunca captura silenciosa de token.

## Convide e ganhe (versão honesta) e o painel do UPG

O convite está implementado — mas com o **único** prêmio que existe de verdade.

| Você pensa | O que acontece de fato |
|---|---|
| "cada novo usuário aumenta a minha cota" | ❌ não existe: cadastro em outro serviço não credita o seu saldo |
| "o site ganha capacidade" | ✅ **é isso**: mais uma pessoa usando a **conta dela** = mais um atendimento simultâneo, custo zero pra você |
| "a tela mostra 'x entrou, sua cota subiu'" | ❌ eu não escrevo isso: seria mentira na cara do usuário |
| "a tela mostra o movimento do site" | ✅ **é isso**: sessões e pedidos em número, **sem identidade** |

### Anonimato — o que o site guarda e o que não guarda

| Guardado | Nunca guardado |
|---|---|
| quantas sessões hoje (número) | token, e-mail, username |
| quantos pedidos, quantos grátis | id de conta Puter |
| qual conta **este navegador** está usando (fica no próprio navegador) | quem entrou, de onde veio |

As contas do armazém continuam sendo **somente as suas** (dono, com o modo admin ligado).
O contador do site é um doc com 4 inteiros — `{ dia, sessoes, pedidos, pagos }` — e nada mais.
Ele sobe quando alguém usa o site, não quando alguém se cadastra em outro lugar (o site não tem
como verificar cadastro no Puter, e nem tenta).

### O link de convite

`https://seusite/?ref=upg` — quem entra por ele conta como uma sessão anônima e a URL se limpa.
Não há rastreio de quem convidou quem: o prêmio é capacidade, e capacidade não precisa de nome.

## Armazém de quota — mantido do jeito que o Puter mantém

O painel tem o botão **"Armazém de quota › ver"**. Ele lê, uma por uma, o medidor de cada conta
direto do endpoint de metering do próprio Puter e mostra lado a lado:

```
• conta um        — 12.4k restante (em uso agora)
• conta dois      — 8.1k restante
• chave HF        — cota própria do Hugging Face
```

É **só leitura**. O código não soma, não transfere, não empresta e não gasta o crédito de ninguém
(verificado: depois de ler, o documento do armazém está byte a byte igual, e ele nem sequer guarda
número de saldo). Não existe "cota geral" para mover — cada linha é a cota **daquela** conta, do
mesmo jeito que o Puter mostra para você quando você entra lá.

O que o site faz com isso é o que ele pode fazer: **ler e mostrar**. O que ele não faz é o que não
existe — tirar crédito da conta de quem entrou e usar no lugar de outro.

## Worker de busca passiva — o trabalho pesado de graça (CPU + RAM)

Sua ideia, na parte que é real e boa: **enquanto ninguém está chamando os modelos, as suas máquinas
podem estar trabalhando** — baixando, limpando e indexando. Isso não precisa de GPU e **não gasta
cota nenhuma**, porque não chama modelo nenhum.

### O que NÃO existe (e é melhor saber agora)

> *"o modelo fica treinando de graça enquanto ninguém usa"* — **não existe.** Modelo de API não roda
> na sua máquina: ele não tem "modo ocioso". Ou você chama (e consome cota), ou não acontece nada.
> Não há trabalho gratuito escondido ali, e treinar peso sem GPU continua não existindo.

### O que existe: o worker (Config › Mega Pack › *Worker de busca passiva*)

Botão **baixar arkher_worker.py** — um script **Python puro** (só a stdlib: `urllib`, `re`, `html`).
Sem instalar nada, sem chave, sem cota. Roda no **Kaggle**, no **GitHub Codespaces** ou no **seu PC**:

```bash
python3 arkher_worker.py
# [1] ok  https://exemplo.com/pagina (9700 chars)
# pronto: 60 pagina(s), 480 bloco(s), 0 erro(s)
# arquivo: pack-worker.md
```

Você importa o `pack-worker.md` no Mega Pack e **pronto**: o que aquela máquina varreu entrou no
cofre e passou a valer para **todos** os modelos — Gemini, Kimi, GLM, o seu nó.

E o botão **rodar passivo aqui** faz o mesmo trabalho neste navegador, na hora, também sem gastar cota.

### A divisão de trabalho (é esta a arquitetura certa)

```
CPU + RAM   (grátis, ilimitado: Kaggle, Codespaces, seu PC, o navegador)
   └─ baixar · limpar · deduplicar · indexar · vetorizar        → arkher_worker.js

COTA GRÁTIS (perecível: zera todo dia)
   └─ destilar bloco em regra · responder pergunta              → arkher_operarios.js

GPU (só o seu nó)
   └─ treinar LoRA de um modelo SEU                            → neural.js › enviarParaNo
```

Repare como isso resolve o que você queria de verdade: **as máquinas que ficam ociosas trabalham
sem parar, de graça, e o resultado vai para todos** — só que o produto do trabalho é *conhecimento
indexado*, não peso de modelo. É o que existe, e é o que faz diferença no dia seguinte.

Teste: `node teste_worker.js` — gera o script, confere que **não tem chave nem chamada de IA**,
respeita limites, **compila e roda de verdade** (chega a baixar uma página e escrever o pack), e
confirma que a busca passiva no site também não chama modelo nenhum.

## Operários: a cota ociosa trabalhando sem parar

Isto é o mais perto que existe do que você pediu — *"os modelos que não estão sendo usados na hora
ficam trabalhando sem parar"* — e tem uma vantagem: **não custa nada.**

### O fato que faz isso funcionar

Toda cota gratuita (Groq, Cerebras, Gemini, SambaNova…) **zera todo dia**. O que você não usa hoje,
perdeu. São milhares de pedidos por dia virando fumaça.

### O que os operários fazem

Pegam essa capacidade ociosa e põem os modelos gratuitos para **ler o cofre e destilar regras**:

```
bloco bruto do cofre  →  modelo gratuito lê  →  fato/comando/regra  →  entra no prompt de TODOS
```

Uma regra extraída de uma página que você indexou ontem passa a valer para o Gemini, o Kimi, o GLM,
o Astra — **todos**, sem treinar peso de ninguém. O trabalho dos modelos ociosos faz o seu próximo
pedido já sair melhor.

- **Config › Mega Pack › Operários** → *uma rodada* ou *ligar contínuo* (roda de minuto em minuto);
- escolhe sozinho um provedor gratuito com chave viva — **nunca a sua conta Puter**;
- bloco digerido não é digerido de novo (marcado no cofre);
- cota secou? **para e espera o reset** em vez de ficar em loop de erro;
- lixo não vira regra: sai coisa curta, preâmbulo e frase genérica.

Teste: `node teste_operarios.js` — confere tudo isso, inclusive que **nenhuma chamada foi para o Puter**.

### E o treino de verdade?

Fica onde tem GPU: **o seu nó** (aba VM › Exportar dataset → `/treinar`) treina um LoRA de um modelo
**seu**. É o único treino que existe — e ele muda um modelo seu, não os dos outros.

## Treino contínuo pesado em todos os modelos — a resposta definitiva

Você pediu: os modelos que não estão em uso varrendo a internet inteira, sem parar, aprendendo tudo,
ficando extremamente poderosos, sem mexer nos originais. Aqui está a resposta em quatro linhas, sem
enrolação:

| O que você pediu | Existe? |
|---|---|
| Treinar os modelos de API (GPT, Claude, Gemini, Kimi, GLM) | ❌ **não existe canal.** São serviços: mandam pergunta, devolvem resposta. Não há como enviar treino, e os pesos não são acessíveis. "Sem parar" neles não é difícil — é **impossível**, para você e para qualquer um. |
| Treinar **os seus** modelos (open source, no nó com GPU) | ✅ sim: LoRA, via Kaggle/VM. Mas é **um de cada vez**, em sessão com tempo e cota — não "todos ao mesmo tempo, sem parar". |
| Treinar **sem GPU** | ❌ não existe treino de peso sem GPU. Sem GPU o que dá é **indexar e recuperar** (RAG) + destilar regras — que é o que este projeto faz. |
| Varrer a internet inteira (archive.org = +100 petabytes) | ❌ fisicamente impossível, e **contraproducente**: treinar com texto bruto da web **piora** o modelo (colapso de modelo — a própria indústria documentou). |
| **Crescer sem parar, sem GPU, sem gastar cota de IA, e fazer todos os modelos responderem melhor** | ✅ **é isto — e está implementado.** |

### O que ficou no lugar: ingestão contínua (Config › Mega Pack › *Ingestão contínua*)

Uma fila que trabalha sozinha, em segundo plano:

- você manda um link (ou vários) → ela **baixa, limpa o HTML, corta em blocos e indexa no cofre**;
- **semeia**: de cada página pega os links dela e enfileira os próximos (profundidade **2**, **25** links por página);
- **contínuo**: o botão *ligar contínuo* roda uma rodada a cada 30 s, sem parar, até você desligar;
- **custo de IA: ZERO** — é download e indexação. Não chama modelo nenhum, não gasta cota de ninguém;
- limites propositais: fila de **400**, pausa de ~2,5 s entre páginas, corte de 60 mil caracteres por página.

O que entra ali é injetado no prompt de **qualquer** modelo. Um Kimi ou um GLM com o cofre cheio do
seu assunto responde melhor que um modelo top sem contexto — e o cofre não tem limite de "cota",
porque não é cota: é conhecimento guardado.

**A frase que resume tudo:** *o que cresce sem parar é o cofre, não o modelo.* O cofre é dinâmico,
contínuo e não custa nada. O modelo é do outro, e o jeito de fazê-lo render é dar contexto a ele.

Teste: `node teste_dinamico.js` — enfileira, baixa, limpa, indexa, semeia links, não repete página,
respeita o teto, liga/desliga o contínuo, e confirma que **nenhuma chamada de IA** aconteceu.

## Mega Pack + Cofre Neural ARKHER (o "aprendizado dinâmico", de verdade)

Você pediu um mega pack de milhões/bilhões de instruções e uma rede neural que aprende sozinha e
guarda tudo. Aqui está o que **existe** — e o que não existe, dito na cara:

| O que dá | O que não dá |
|---|---|
| ✅ **Indexar um pack gigante** e achar o trecho certo na hora da pergunta | ❌ "fazer o Claude/GPT/Kimi aprender X": modelo fechado não recebe treino de fora |
| ✅ **O trecho relevante entra no prompt** de qualquer modelo (RAG) | ❌ "bilhões de instruções dentro do modelo": o contexto é **finito** — só entra o que couber |
| ✅ **Aprender com o uso**: cada resposta boa vira lição; as lições viram **regras** que entram fixas no prompt | ❌ treinar peso no navegador |
| ✅ **Treinar um modelo SEU**: exporta o dataset e manda pro **nó com GPU** (LoRA) | ❌ mexer nos pesos de um modelo **dos outros** |

### Como se usa

**Config › Mega Pack + Cofre Neural.** Formato do pack:

```
# PACK: manual da nave ARKHER
## Servidor com GPU
@fonte: anotações do dono
- para liberar o Ollama para o site: OLLAMA_ORIGINS=* ollama serve
- o nó fica em http://192.168.0.10:7860 e aceita /infer e /treinar

## Estilo do projeto
- respostas curtas; código primeiro, explicação depois.
```

Cada `## ` vira tag, cada `- ` vira um bloco pesquisável, e também dá para **subir um arquivo
`.txt`/`.md`**. O botão **Exportar cofre** despeja tudo o que o site aprendeu num arquivo só —
backup e transporte do Cofre Neural.

### Por que "dinâmico" é a palavra certa aqui

O cofre não é estático: ele **cresce com o uso**. Cada resposta boa entra como lição, o destilar
comprime lições em regras, e as regras passam a valer para **todos** os modelos do hub. Quanto mais
você usa, mais o site sabe — e o mesmo pack vale para o Gemini, o Kimi, o GLM ou o modelo do seu nó.

A diferença importante: **o que cresce é o contexto, não o modelo.** É por isso que funciona com
qualquer provedor, inclusive os gratuitos — e é por isso que não faz prosa: o que a IA sabe de fábrica
vem do treino dela; o que ela sabe do **seu** projeto vem do cofre, e isso a gente controla.

Teste: `node teste_pack.js` — lê o pack, indexa, busca com outras palavras, confirma que o trecho
**entra no prompt**, que ingerir duas vezes não duplica, e que o cofre exporta e volta.

## Empilhar 1000 provedores: o que isso dá — e o que não dá

A pergunta: *"se eu juntar centenas de sites com cota diária grátis, e der a todos a MESMA memória,
ferramentas e potência, não fica mais poderoso que o modelo top?"*

Resposta honesta, em duas linhas:

| | |
|---|---|
| **Contexto, memória, ferramentas, histórico, biblioteca** | ✅ **é do site** — entra no pedido **antes** do roteador escolher quem responde. Todo provedor, do maior ao menor, recebe **igual**. |
| **Profundidade de raciocínio, obediência a instrução complexa, confiabilidade em ferramentas, conhecimento de mundo** | ❌ **é do modelo** — está nos pesos dele e **não se transfere**. |

Provado em `teste_memoria.js`: o mesmo bloco (prompt de sistema + memória + histórico) chega
**idêntico** em dois provedores grátis diferentes, no Hugging Face e no Puter — e num provedor
colado em massa também. O teste também confirma o limite: **não existe** função de clonar modelo,
copiar pesos ou transferir capacidade (porque isso não existe mesmo).

### Então vale a pena empilhar? Vale — muito

1. **Volume**: uma cota que zera todo dia é uma cota nova amanhã. 30 provedores com 200 req/dia = 
   6.000 pedidos/dia que **não tocam em crédito nenhum**. O roteador distribui sozinho.
2. **Diversidade**: modelos diferentes erram de formas diferentes. Para tarefa difícil, dá para
   pedir para **três** modelos e comparar/verificar — isso costuma bater um único modelo grande.
3. **Peso onde importa**: o crédito caro fica reservado para o que realmente precisa. O resto do
   trabalho acontece no grátis, com a mesma memória e as mesmas ferramentas.
4. **Massa crítica**: um modelo médio com **memória boa + ferramentas + verificação** resolve muita
   coisa que um modelo top sem nada disso erra. É por isso que o "mesmo contexto para todos" importa.

### O que NÃO vale — e é o erro fácil de cometer

- **Usar as interfaces de chat como API.** ChatGPT web, Gemini app, Claude app, Monica, Sider e
  afins são sites, não APIs: automatizar aquilo é *scraping*, quebra os termos de uso e cai no
  primeiro bloqueio anti-bot. **Não faça** — e não tem suporte no ARKHER.
- **Contar com "cota infinita" que não existe.** Cota gratuita é generosa, não infinita: ela reseta,
  mas tem teto diário e limite por minuto. O roteador respeita isso (uma chave que estoura sai da
  fila e volta depois).
- **Esperar que a soma dos fracos vire um forte.** Empilhar cinco modelos médios te dá cobertura,
  redundância e um bom comitê — não te dá o teto de raciocínio de um modelo de ponta. Para o que é
  muito difícil, o top ainda é o top.

### Os que já vêm de fábrica (não precisa colar nada)

Desde agora o ARKHER traz **30 provedores** prontos, incluindo os que você citou pelo nome:

| Provedor | O que é | Endereço |
|---|---|---|
| **Moonshot (Kimi)** | o Kimi, API oficial | `api.moonshot.ai/v1` |
| **Zhipu (GLM)** | o GLM-4.6 | `open.bigmodel.cn/api/paas/v4` |
| **Alibaba Qwen** | Qwen3 / Qwen Max | `dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| **DeepSeek** | DeepSeek V3 / Reasoner | `api.deepseek.com/v1` |
| **SiliconFlow** | muitos open-source | `api.siliconflow.cn/v1` |
| **Together / Hyperbolic / Novita / Fireworks / DeepInfra / Chutes / Nebius / OVH** | camadas gratuitas e créditos de entrada | (ver Config) |
| **Cohere** (modo compatível) | Command R+ | `api.cohere.ai/compatibility/v1` |

Mais os que já estavam: Gemini, Groq, Cerebras, OpenRouter, Mistral, GitHub Models, NVIDIA NIM,
Cloudflare Workers AI, SambaNova, xAI, Vercel AI Gateway, AIgateway, Ollama e LM Studio.
Cada um pede a chave da **sua** conta (link direto no próprio cartão do provedor).

**É aqui que a sua ideia se realiza**: um Kimi, um GLM, um Qwen e um DeepSeek — todos com a
**mesma memória, as mesmas ferramentas e o mesmo histórico** — trabalhando na mesma tarefa. Isso
não é "o Astra 6 de graça"; é um **comitê** de modelos bons com contexto completo, que resolve
muita coisa que um único modelo sem contexto erraria. E o crédito caro só entra quando o comitê
não basta.

### E se você tiver mais (API de verdade, cota grátis, sem cartão)

Cole no formulário **Config › Adicionar provedor próprio › "Colar vários de uma vez"**
(uma linha por provedor: `nome | url | chave | papel | modelos`):

```
groq-quente   | https://api.groq.com/openai/v1       | gsk_...   | free  | llama-3.3-70b-versatile, qwen-2.5-32b
cerebras      | https://api.cerebras.ai/v1           | csk-...   | free  | llama3.1-8b, qwen-3-32b
nvidia-nim    | https://integrate.api.nvidia.com/v1  | nvapi-... | free  | meta/llama-3.3-70b-instruct
sambanova     | https://api.sambanova.ai/v1          | sn-...    | free  | Meta-Llama-3.3-70B-Instruct
openrouter    | https://openrouter.ai/api/v1         | sk-or-... | free  | deepseek/deepseek-chat-v3-0324:free
mistral       | https://api.mistral.ai/v1            | xxxxx     | free  | mistral-large-latest, open-mixtral-8x22b
cloudflare    | https://api.cloudflare.com/client/v4/accounts/SEU_ID/ai/v1 | TOKEN | free | @cf/meta/llama-3.1-8b-instruct
together      | https://api.together.xyz/v1          | t-...     | free  | meta-llama/Llama-3.3-70B-Instruct-Turbo
hyperbolic    | https://api.hyperbolic.xyz/v1        | eyJ...    | free  | meta-llama/Meta-Llama-3.1-70B-Instruct
novita        | https://api.novita.ai/v3/openai      | sk_...    | free  | deepseek/deepseek-v3
fireworks     | https://api.fireworks.ai/inference/v1| fw_...    | free  | accounts/fireworks/models/llama-v3p3-70b-instruct
deepinfra     | https://api.deepinfra.com/v1/openai  | di_...    | free  | meta-llama/Meta-Llama-3.1-70B-Instruct
chutes        | https://llm.chutes.ai/v1             | cpk_...   | free  | deepseek-ai/DeepSeek-V3
cohere        | https://api.cohere.ai/compatibility/v1 | ...     | free  | command-r-plus-08-2024
seu-servidor  | http://192.168.0.10:11434/v1         |           | local | llama3.2, qwen2.5-coder
```

Todas essas são **API oficial** com camada gratuita: você cria a chave na sua conta, cola aqui, e o
roteador trata como mais uma via gratuita. As que já vêm de fábrica no ARKHER aparecem no bloco
"Provedores grátis".

## As duas cotas — e a direção entre elas

Existem **duas cotas**, e elas não se misturam:

```
┌─ COTA DO SITE ──────────────────────────────────────────┐
│ chaves grátis (Gemini, Groq, Cerebras, OpenRouter…)     │
│ token do Hugging Face   ·   nó com GPU   ·   biblioteca │
│ É sua, fica no site. O site gasta para atender quem usa.│
└─────────────────────────────────────────────────────────┘

┌─ COTA DO PUTER ─────────────────────────────────────────┐
│ os créditos das contas Puter (a de cada pessoa)         │
│ O site gasta quando o pedido vai aos modelos de lá —    │
│ com o token da conta que fez o pedido.                  │
└─────────────────────────────────────────────────────────┘
```

E a direção é **um sentido só** — não por promessa, por arquitetura:

| Direção | Existe? |
|---|---|
| **site → cota do Puter** | ✅ sim: o site é **cliente** da API do Puter, pede com o token do usuário |
| **Puter → cota do site** | ❌ **não existe**: o Puter não chama o site. Não há callback, webhook nem endpoint nosso que ele possa acionar |

Prova em `teste_cotas.js`, interceptando **todo** `fetch`:

- o pedido ao Puter leva o token do **usuário** — e **nenhuma** credencial do site (nem chave grátis, nem HF, nem endereço da GPU);
- o pedido ao HF/grátis leva a credencial **do site** — e **nenhum** token do Puter;
- a biblioteca responde pergunta repetida **sem sair pedido nenhum**;
- `Cotas` só **mede** — não existe função nela de gastar, transferir ou somar cota.

Painel: **Config › "As duas cotas e a direção" › ver** mostra os dois livros lado a lado e a
contagem da direção (`site → Puter: N pedidos · Puter → site: 0`).

## O que sustenta o site é o TRABALHO, não a cota

Esta é a correção mais importante do projeto, e ela é de física, não de contrato:

> **Crédito, quando alguém usa, acaba.** Ele compra uma inferência e é consumido ali — não sobra
> resíduo, não vira saldo, não vira bônus, não volta como cota para o site. Não existe "o que ele já
> gastou" para redirecionar: gasto é passado, e o que ficou foi só a **resposta**.

O que **sobra** e continua valendo é o trabalho: a resposta que já foi paga. É isso que o site
reaproveita — e é a tradução honesta de *"usar o que ele já usou para sustentar todo o site"*.

**Biblioteca comum (`respostas.js`)** — implementada e testada:

| | |
|---|---|
| Antes de gastar | o site procura a pergunta na biblioteca. Achou → responde **de graça**, na hora |
| Depois de responder | a resposta entra na biblioteca e fica para a próxima pessoa |
| O que é guardado | **hash** da pergunta → resposta. A pergunta **nunca** é guardada, só a impressão digital |
| O que nunca entra | senha, token, CPF/CNPJ, cartão, e-mail, telefone, endereço, CEP, OTP — filtro duplo (palavra + formato), na entrada da pergunta e na saída da resposta |
| Contexto pessoal | só a **primeira** pergunta de uma conversa entra (sem histórico atrás) |
| Desligar | botão no painel UPG, a qualquer momento |

Efeito real: **cada uso deixa o site mais barato para todos.** Quanto mais gente usa, maior a
biblioteca comum, mais perguntas saem de graça, e menos crédito do próximo é consumido. O site
cresce em valor sem que ninguém pague por ninguém — porque o que se acumula é a biblioteca, não a
cota.

Isso é o que o "UPG" pode ser de verdade: **user-pays no consumo, commons no conhecimento.**
Cada um paga o que consome; o que foi produzido fica para todos.

## Login do site: fácil — e o que ele NÃO faz

Duas contas diferentes, e vale não confundir:

| Conta | Para que serve | Como entra |
|---|---|---|
| **Conta ARKHER** (a do seu site) | identifica a pessoa, guarda os dados dela, dá acesso ao app | e-mail + senha, ou **Google** (Supabase Auth) |
| **Conta Puter** | é ela que tem a cota das IAs | botão “Entrar no Puter”, dentro do app — **um clique**, autorização na tela do próprio Puter |

O botão do Google (`Entrar com Google`) faz o fluxo de OAuth pelo Supabase: gera um segredo local,
manda só o *desafio* (PKCE S256), a pessoa autoriza, e a volta traz os tokens — que são lidos da URL
e a URL é limpa. Nada de senha: a senha nunca passa pelo site, e o site nunca guarda credencial.

### O que este login NÃO faz (e por que)

- **não cria conta no Puter pela pessoa.** Criar conta em nome de alguém, programaticamente, é
  cadastro automatizado — e a conta ficaria sob o controle do site. É o desenho que este projeto
  recusa: cota de quem entra sendo gasta por outro.
- **não recebe a cota do usuário para “manter o site”.** Isso é coletar cota de terceiros. Quando o
  crédito de alguém acaba, quem fica sem usar são *outras* pessoas — o site passa a depender do saldo
  alheio, que é pior tecnicamente e errado do mesmo jeito.
- **não guarda senha, token de Puter de visitante, nem perfil de quem entrou.** O contador do site
  continua sendo `{dia, sessoes, pedidos}`.

O login do seu site ficou fácil: e-mail/senha ou Google, uma vez. O Puter continua sendo um clique
separado — porque é a conta **da pessoa**, com o crédito **dela**.

## Prova ao vivo (para abrir no navegador, sem terminal)

Abra **`http://localhost:8000/prova.html`** (ou o endereço do seu site + `/prova.html`).

A página abre **dois "navegadores"** de verdade (dois `iframe`, cada um com o `localStorage`
trocado por uma memória privada antes do código carregar), um logado como **Ana** e outro como
**Bruno**, roda o `pool.js` e o `app.js` reais dentro de cada um e mostra lado a lado:

- o token que cada navegador usa na chamada — o da própria pessoa;
- que a memória de um não tem rastro do outro;
- que o armazém não recebeu conta de visitante (captura recusada, com o motivo na tela).

No fim aparece o veredito: **"nada se move: a cota gasta é sempre a de quem está usando"**.
A mesma página diz, embaixo, o que ela **não** prova — que nenhum mecanismo faz a cota de uma conta
subir quando alguém se cadastra em outro lugar.

## Como provar que a cota gasta é sempre a de quem está usando

Duas suítes, ambas verdes:

| Comando | O que prova |
|---|---|
| `node teste_isolamento.js` | **dois navegadores de verdade** (contextos separados, `localStorage` próprio, `fetch` espião). Confere o header `Authorization` de cada chamada e mostra que o pedido da Ana leva o token da Ana e o do Bruno leva o do Bruno — e que nenhum dos dois enxerga o token do outro. Também prova que visitante não entra no armazém, que o contador do site é só `{dia, sessoes, pedidos}` e que o histórico é número puro. |
| `node teste_cascata.js` | o roteador: mensagem pequena → via grátis; mensagem grande/código → ponta; cascata de contas; diagnóstico de dispositivo/IP; e as seis regras do UPG. |

O que `teste_isolamento.js` **não** faz (e não tem como fazer): provar que a cota de uma
conta "sobe" quando alguém se cadastra em outro lugar. Esse fluxo não existe no Puter — a
permissão de uso é da conta autenticada e não é transferível para um app.

## "Subir as IAs pra vários provedores" — o que é possível e o que não é

A analogia do repo privado → Termux → repo público funciona para **arquivos**. Modelo de IA
não é arquivo, e isso muda tudo:

- **O Puter não hospeda modelo nenhum — é um roteador.** Ele recebe o seu pedido, cobra do
  seu crédito e repassa para Anthropic/OpenAI/xAI/Google. Não existe "baixar o Fable 5 do
  Puter": os pesos nunca saem de quem os fez.
- **O ID do modelo é um nome de rota, não um artefato.** Saber que existe
  `claude-fable-5-1` não dá a nenhum provedor a capacidade de servi-lo. Só o dono serve.
- **Nada disso depende do seu app.** É por isso que não existe cota gratuita de Astra/Fable/
  Grok 6: essa camada é o produto deles.

O que **é** possível (e está no hub):

1. **A mesma tomada, por vários gateways.** Os modelos de ponta são servidos por vários
   gateways independentes, todos OpenAI-compatíveis. Cada gateway = uma conta sua = uma cota
   própria. É a multiplicação real de capacidade top tier:
   - **Puter** (`api.puter.com/puterai/openai/v1`) — sua conta, crédito de cortesia;
   - **OpenRouter pago** (`openrouter.ai/api/v1`) — modelos de ponta no catálogo pago;
   - **Vercel AI Gateway** (`ai-gateway.vercel.sh/v1`) — `anthropic/…`, `openai/…`, `xai/…`;
   - **AIgateway.sh** (`api.aigateway.sh/v1`) — 1.050+ modelos, pass-through + 5%;
   - **xAI direto** — `grok-4`, `grok-4-1-fast` (crédito de boas-vindas);
   - mais qualquer endpoint no botão **Adicionar provedor próprio**.
   Somando crédito em dois ou três desses, você tem o mesmo modelo por caminhos diferentes —
   e a cascata usa o que ainda tem saldo. **Nada de conta fake: uma conta sua por gateway.**
2. **O que multiplica de verdade, de graça:** o catálogo de pesos abertos (HF, Groq,
   Cerebras, SambaNova 405B, nó com GPU) e o **roteador** — mensagem pequena não vai na
   ponta, então o crédito top tier dura muito mais.
3. **A parte "público" da analogia tem um caminho legítimo:** se o objetivo é o site servir
   IA para outras pessoas, o modelo do Puter é *user-pays* — cada visitante entra com a
   **própria** conta e a cota dele entra no armazém (é o que `Pool.auto` já faz). Aí sim
   surgem dezenas de cotas, todas de donos reais, sem ninguém arriscar conta.

O que **não** funciona, e continuo não fazendo: replicar a mesma conta para multiplicar cota
no mesmo gateway. Isso não é "provedores diferentes" — é a fazenda de contas de novo, e o
desfecho conhecido é o ban em bloco levar a conta principal junto.

## Modelos de ponta: o que existe de graça (e o que não existe)

Resposta direta: **não existe serviço gratuito legítimo com GPT-6 Astra, Claude Fable 5/5.1
ou Grok 6.** Esses modelos custam centavos por mil tokens e são o produto principal de quem
os faz — ninguém subsidia isso de forma permanente. O Puter *aparenta* dar esse acesso
porque é um gateway pago que distribui **crédito de cortesia**; quando a cortesia acaba, vem
o `low balance`. Não é falha de configuração: é o modelo de negócio dele.

Onde cada classe realmente aparece grátis:

| Você quer | Free legítimo mais próximo | Limite | É API? |
|---|---|---|---|
| Classe GPT (Astra/GPT-5) | **GitHub Models** — GPT-4.1, o3, GPT-4o | 10-15 RPM, 50-150/dia, 8K in / 4K out | sim |
| Classe Claude (Fable 5.1) | **Antigravity** (Google, $0) — Claude Sonnet/Opus 4.6 | limites semanais, dentro do produto | não (é IDE) |
| Classe Grok 6 | **xAI** — $25 de crédito de boas-vindas (`grok-4`, `grok-4-1-fast`) | uma vez, depois é pago | sim |
| Classe Gemini 3 Pro | **Google AI Studio** — Gemini 3 Flash / 3.1 Pro | 1.500/dia Flash, 50/dia Pro | sim |
| Pesos abertos grandes | **SambaNova** — Llama 3.1 **405B**, DeepSeek-R1 | 30 RPM | sim |
| Pesos abertos rápidos | **Groq / Cerebras** — gpt-oss-120b, Qwen3, Llama 4 | 1.000/dia · 1M tokens/dia | sim |
| Sem limite nenhum | **Ollama / LM Studio** no seu PC, e o nó com GPU | só a sua máquina | local |

O que isso significa na prática para o ARKHER: com **Gemini 3.1 Pro + GPT-4.1/o3 (GitHub) +
Llama 405B (SambaNova)** você tem, de graça e legalmente, a classe logo abaixo da linha
Astra/Fable/Grok — e nenhuma dessas rotas dá `low balance`, porque cada uma tem cota
publicada. É o que está ligado em `freeai.js`; os catálogos vivos (`/models`) vêm primeiro,
as listas curadas acima são só plano B quando o provedor muda de nome de modelo.

Se a linha top for indispensável (não só preferível), o caminho honesto é pagar — no Puter
ou em aggregator do gênero — e usar a cascata gratuita como volume de apoio, que é
exatamente o desenho que o `app.js` já faz: qualidade primeiro quando há saldo, grátis
quando não há, sem parar o chat.

## Modelos de ponta do Hugging Face (no no com GPU)

O HF acabou com o serverless gratuito (`api-inference.huggingface.co` nao resolve mais) e o que
sobrou e um router que **cobra por token**. Entao os modelos de ponta rodam **na GPU que voce ja tem**:
o Kaggle (T4x2/P100, ~30 h por semana) ou o PC da VM. Quem faz isso e o `hf_hub.py`, chamado pelo
agente como job:

```bash
curl http://NO:8765/infer                                   # catalogo + o que ESTE no pode rodar
curl -X POST http://NO:8765/infer -d '{"tarefa":"imagem","prompt":"textura de grama seamless"}'
curl -X POST http://NO:8765/infer -d '{"tarefa":"chat","modelo":"Qwen/Qwen2.5-Coder-7B-Instruct",
      "messages":[{"role":"user","content":"escreva um script Luau de pulo duplo"}]}'
curl -X POST http://NO:8765/treinar -d '{"jsonl":"{\"messages\":[...]}","base":"Qwen/Qwen2.5-Coder-7B-Instruct","passos":60}'
curl http://NO:8765/node                                    # IP Tailscale, porta, usuario/estado do RDP
```

Tarefas: `chat`, `imagem` (textura/concept/sprite), `embed`, `asr` (audio→texto), `depth`,
`fundo` (remove fundo), `upscale` x4 e `treinar` (LoRA). Sem a lib instalada a resposta e
honesta: diz exatamente qual `pip install` falta (nunca um "ok" mentiroso).

## Cérebro (memoria neural + treino)

Aba **Cérebro** do site:

- **Memória**: tudo que ele sabe vira trecho indexado — o pacote de game dev que vem no repo
  (`conhecimento.js`), o que voce colar, as documentações que ele estudar e as lições das conversas.
  A busca é por **significado** (vetor) + palavra-chave, e funciona **offline** (o vetor local é o piso
  que nunca falha; com nó GPU ou token HF ele fica melhor).
- **Aprender sozinho**: cada resposta boa vira dado de treino. "Destilar" transforma lições em **regras**
  que entram fixas no prompt (aprendizado contínuo sem GPU).
- **Treinar com GPU**: "Exportar dataset" gera JSONL e "Treinar no nó" manda pro `/treinar` — isso treina
  **peso de verdade** (LoRA em Qwen2.5-Coder). Quando termina, o modelo aparece como `gpu:local:<nome>`
  no chat.

## Memória compartilhada (IAs, chats, abas e VMs)

`memoria.js` — um quadro só, que todo mundo lê e escreve:

| Quem escreve | O que entra |
|---|---|
| **Chat** | a pergunta e a resposta boa (escopo `sessao:<id>`) |
| **Ferramentas** (automático) | o que rodou, onde deu certo e o que falhou (`vm:<nó>`, `sessao:<id>`) — comando com senha/token **não entra** |
| **Enxame** | cada agente publica o que descobriu no quadro do conselho (`conselho:<id>`) e o conselho grava a decisão final (`global`) |
| **Você / a IA** | pela ferramenta `memoria` (`buscar` / `anotar`) e pelo painel da aba Cérebro (busca **por significado**, indexar, destilar em regras) |

Como ela circula:

- **Durante o conselho**: cada agente recebe o quadro antes de responder e publica o que achou — o próximo
  agente já sabe. Depois vem a **revisão cruzada**: cada um lê as propostas dos colegas e reescreve a sua.
- **Entre chats**: sessão nova não recomeça do zero — não repete a conversa velha, mas continua lendo o
  `global` e o da VM (decisões e descobertas). Botão "Nova sessão de chat" no painel.
- **Com as VMs**: `POST /memoria` no `agent.py` grava em `$STATE/memoria.jsonl` — **sobrevive à sessão morrer**
  (testado reiniciando o nó no meio). O site puxa (`GET /memoria`) e empurra nas ações.
- **Entre aparelhos**: sincroniza pelo Supabase (chave `memoria`), se você usa login.
- **Sigilo**: item marcado `sigilo:true` (senha, token, chave) **nunca** vai pro nó nem pro Supabase, e não
  entra no prompt. A auto-captura já descarta o que cheira a segredo.

Dedupe por identidade (`tipo|texto|escopo`), teto configurável (padrão 1500 itens) e poda que preserva
`decisao`/`erro` — o que tem valor depois.

### Busca por significado (não por palavra exata)

O quadro guarda um **vetor** de cada item (`Neural.vetorizar`, 256 dimensões; sem rede, sem nó, sem token —
o vetor é calculado local). Quando o chat pergunta, o quadro **escolhe o que entra no prompt por
relevância** (`0.52·cosseno + 0.34·palavras em comum + peso do tipo + uso + idade`), não só pelo mais novo:

- pega **sinônimo próximo e erro de digitação** ("triposr" acha "TripoSR quebrou no Kaggle");
- conversa solta de **outro chat** não entra no prompt (escopo `sessao:`/`chat:` é por sessão);
- no painel da aba Cérebro: botão **"Buscar (por significado)"** e **"Indexar agora"**.

### Destilar o quadro em regras (memória vira aprendizado, sem GPU)

Botão **"Destilar em regras"** no painel (ou o checkbox que roda sozinho a cada 10 min, quando juntam
`destilarMin` itens novos): o que sobrou no quadro vira **regras curtas** que entram **sempre** no prompt
(`Neural.regras`, teto 60 — `regrasTexto`). Regra genérica ("seja claro e objetivo") é descartada. O que a
IA aprendeu fica aprendido entre sessões, sem treino nenhum.

## Política de resposta (responde tudo que é legal)

O prompt de sistema carrega uma **POLITICA DE RESPOSTA** explícita (`skills.js`):

- **Responde** qualquer pedido legal, mesmo sensível: sangue e violência em jogo, exploit/cheat no **seu**
  jogo, engenharia reversa do que é seu, segurança ofensiva em laboratório, mods, scripts, temas polêmicos.
- **Recusa só dano real**: crime real, arma/explosivo/droga de verdade, material de abuso infantil,
  malware contra sistemas/contas de terceiros, fraude, perseguição. E recusa em **uma linha**, sem sermão.
- **Proibido**: sermão, aviso moralizante, "como IA eu não posso", recusa por precaução, pedir confirmação
  para o óbvio.

E não é só texto de prompt — tem **anti-recusa automático** (`app.js`): se a resposta inteira for uma recusa
de pedido legal, a ARKHER (1) reforça o pedido com a política, (2) se o modelo insistir, troca de modelo,
(3) grava quem recusa o quê (`arkher_recusas`) e **joga esse modelo para o fim da fila** por 10 minutos.
Limite honesto: se o provedor (Puter/HF) barrar por política dele, ninguém fura o filtro — o que dá pra fazer
é trocar de modelo/provedor, e é o que ele faz.

## Enxame (várias IAs na mesma pergunta)

Liga na aba **Cérebro → Enxame** (ou deixa desligado e usa no botão do chat). O que ele faz:

1. **Classifica** o pedido (Luau/Roblox, Unity, Unreal, Godot, Blender, arte, 3D, mundo, código, geral).
2. **Monta o time**: cada IA recebe o papel em que é melhor (arquiteto, programador, artista, pesquisador,
   crítico, agregador, verificador) — e o papel que já ganhou naquele tipo de pedido vai na frente,
   porque isso fica **aprendido** (`Enxame.tabela()` mostra quem manda bem no quê).
3. **Todas têm as mesmas mãos**: cada agente pode usar **as mesmas ferramentas** do chat — gerar 3D,
   rodar comando na VM, ler/escrever arquivo, buscar na web, consultar a memória. O que muda é o papel,
   não o poder: quem é "artista" também pode chamar o 3D, quem é "programador" também pode buscar doc.
4. **Crítica**: os textos voltam e um crítico dá nota, aponta a melhor e o que corrigir.
5. **Agregação**: um agregador junta o melhor de todas numa resposta só (não é votação — é fusão).
6. **Verificação** (opcional): um verificador confere com ferramentas antes de entregar.
7. **Aprendizado**: nota de cada modelo, quem venceu, e o par escolhido/rejeitado vira **DPO**
   (`Neural.preferencia`) — quer dizer, o enxame melhora a si mesmo com o que ele mesmo julgou.

Escala: `n` de **1 a 100 IAs** (padrão 4, paralelo 6, teto de tempo por proposta e total).
Cada IA é **uma chamada de modelo** — e é aí que entra o **armazém de cota** (`pool.js`): com as suas contas
logadas, o conselho **cresce até as cotas livres** (até `nMax`, padrão 12), o paralelismo sobe junto, **cada IA
sai por uma conta diferente** (rodízio antes de começar), e quando uma conta estoura (429) ele gira para a
próxima enquanto o agente **tenta de novo** (até 3 vezes) em vez de morrer. Sem armazém, ele fica no padrão 4.

Dois poderes que entram sozinhos:

- **Escalada**: se o crítico reprova (nota média < 6.5 ou nenhuma melhor), entram mais IAs, nova crítica e
  nova agregação — o conselho cresce justamente quando precisa.
- **Modo profundo**: tarefa grande (jogo/projeto/sistema, ou texto longo) é dividida por um planejador em até
  4 subtarefas; **cada subtarefa roda o próprio conselho** e o agregador final junta tudo num projeto só.

## Cérebro no nó (dataset + treino automático)

O nó com GPU (Kaggle/PC) acumula o que o site aprendeu e **treina sozinho**:

- `POST /dataset` guarda as lições e os pares de preferência (sem repetir — dedupe por hash).
- `GET /dataset` mostra total, quantos são de conversa, quantos de preferência e os modelos treinados.
- `POST /dataset/auto {ligado, min_novos, min_total, passos}` liga o **treino automático**: quando junta
  amostra nova suficiente, ele treina (LoRA se for maioria conversa, **DPO** se for maioria preferência)
  e o resultado aparece como `gpu:local:<nome>` no chat.
- O botão **"Enviar cérebro pro nó"** (aba Cérebro) faz o envio; **"Treinar sozinho no nó"** liga/desliga;
  **"Ver o que o nó sabe"** mostra o estado real.
- A célula `2d` do notebook do Kaggle liga isso e roda um **vigia**: pinga o nó a cada 3 min (o Kaggle
  mata a sessão com 20 min parado) e **religa o agente** se ele cair.

## RDP (a tela rápida no Windows)

Duas formas de ter a máquina com RDP, e o site sabe ligar as duas:

| Caminho | O que sobe | Quando usar |
|---|---|---|
| **ARKHER** (`arkher.yml`) | RDP **+ agente (8765) + DsOS (8766)** na mesma máquina | é o normal: você vê a tela e as ferramentas funcionam |
| **Só RDP** (`NewRdpKAKAKAKAKA/main.yml`) | Windows com RDP + Tailscale, sem agente | quando quer só a tela (ou o agente do ARKHER já está em outro nó) |

Aba **VM → cartão RDP**: preencha `dono/repo` + `workflow` + um PAT (**Actions: write**) e clique em
**Ligar a VM agora** — o site dispara o workflow, espera o runner subir e lê endereço/usuário/senha
do log, já preenchendo tudo. "Baixar .rdp" gera o arquivo pro app do Windows. Se o navegador não
conseguir ler o log (CORS), cole o trecho no campo abaixo: o leitor é offline e entende os dois
formatos de log (`RDP_CREDS=User: ... | Password: ...` e `usuario: ... senha: ...`).

O PAT fica **só no seu navegador**. E a senha do RDP **não** é mascarada de propósito: com
`::add-mask::` o GitHub trocaria a senha por `***` em todo o log, inclusive no `COMO ACESSAR`,
e você nunca conseguiria ler.


O step **Liberar RDP** liga o RDP (regra 3389, `SecurityLayer=0`, NLA desligado como no seu workflow),
o step **Usuario do RDP** cria o usuário `nexus` com senha aleatória (mascarada no log, mostrada só no
`COMO ACESSAR`). No site, aba **VM → cartão RDP**: "Descobrir no nó" preenche endereço/usuário pelo
`/node` e "Baixar .rdp" gera o arquivo pronto pro app do Windows (ou do celular).

## Ligar a VM

1. Secrets: `TAILSCALE_AUTH_KEY` (obrigatório), `PAT_TOKEN` (religa o Windows), e opcionalmente
   `KAGGLE_USERNAME` + `KAGGLE_KEY` (o `religa_kaggle.py` mantém o nó do Kaggle vivo).
2. Actions → **ARKHER Sandbox** → Run workflow.
3. No step `COMO ACESSAR` estão os dois endereços + credenciais do RDP.

## Ligar a VM

Actions -> *ARKHER Sandbox* -> **Run workflow**. Em ~5 min o step **COMO ACESSAR** imprime:

```
Site > Config > URL do agente:   http://100.x.y.z:8765
Site > aba DsOS > Conectar:      http://100.x.y.z:8766
RDP: 100.x.y.z   usuario: nexus   senha: ...
```

Cole no site. Na aba VM clique **Publicar minha VM** — quem estiver logado na mesma
equipe (Supabase) recebe o endereco automaticamente.

> Na primeira sessao conecte por RDP uma vez (app *Windows App* / Remote Desktop).
> Isso garante a sessao grafica — sem ela o Piloto e o DsOS tiram print preto.
> Se ainda sair preto: no RDP, rode `tscon 1 /dest:console`.

## No Kaggle (GPU)

Aba VM -> **Baixar notebook** -> suba no Kaggle -> GPU on, Internet on, secret
`TS_KEY` -> Run All. O notebook baixa `agent.py`, `dsos_core.py`, `gerar3d.py` e
`ws_min.py` direto deste repo, sobe os dois nos, **instala o motor 3D** (celula 5)
e **gera um modelo de teste com render na tela** (celula 6). Depois e so escolher
"Kaggle (GPU)" na aba 3D do site.

## 3D em linha de comando (dentro do no)

```
python gerar3d.py --lista                 # o que este no tem
python gerar3d.py --prompt "uma espada"   # texto -> .glb
python gerar3d.py --imagem foto.png --engine triposr
python gerar3d.py --instalar triposr      # pip + repo oficial + torchmcubes
python gerar3d.py --selftest              # testa o encanamento sem GPU/internet
```

Saidas em `arkher_state/work/3d/`: o `.glb`, um `_preview.png` (render proprio,
sem OpenGL) e um `.json` com o que foi feito. Detalhes, tamanhos de download e
honestidade sobre o que foi testado: `RECURSOS.txt`.

## Arquivos

```
index.html      UI (icones SVG, zero emoji)
core.js         storage + utilitarios (normUrl, errText)
vault.js        cofre de tokens com rotacao e cooldown
auth.js         login Supabase (email + senha) com renovacao de sessao
sync.js         VM compartilhada: presenca, log, trava anticolisao
pool.js         armazem de contas Puter/HF compartilhado (rotacao e marca de "sem saldo")
freeai.js       provedores GRATIS com chave sua (Gemini, Groq, Cerebras, OpenRouter, Mistral, GitHub, NVIDIA, Cloudflare, Ollama, LM Studio)
teste_cascata.js  teste no Node: prova que o chat sobrevive ao "low balance"
skills.js       catalogo de ferramentas + executor
websearch.js    busca web (DuckDuckGo via proxies CORS ou via seus nos)
pilot.js        loop autonomo: ve a tela -> decide -> clica
dsos.js         roteador: qual backend atende cada app
dsos_client.js  cliente da tela remota (frames + toque/teclado)
compute.js      gerenciador de computacao (sonda /capacidades)
kaggle.js       cliente do no Kaggle
enxame.js       conselho de IAs: papeis, critica, agregacao, verificacao e aprendizado (DPO)
neural.js       memoria neural: vetor local + HF, licoes, DPO, exportar/importar dataset
conhecimento.js pacote de game dev (Luau/Roblox, Unity, Unreal, Godot, Blender, 3D) que entra no prompt
memoria.js      memória compartilhada: IAs, chats, abas e VMs no mesmo quadro (com sigilo)
cerebro_ui.js   a aba Cerebro (memoria, treino, enxame, RDP)
app.js          cascata Puter -> HF -> no com GPU, ranking de modelos, quarentena
ui.js           toda a interface
agent.py        agente HTTP que roda NA maquina (Windows/Linux/Termux), porta 8765
dsos_core.py    DsOS Core: tela + entrada + sistema, porta 8766
gerar3d.py      3D: texto/imagem -> .glb (Shap-E, TripoSR, procedural)
ws_min.py       WebSocket minimo (stdlib) usado pelo agente e pelo DsOS
realtime.js     cliente WebSocket com queda automatica pro polling
pwa.js          registro do service worker, botao instalar, aviso offline
sw.js           service worker (casco offline; nada de cache em coisa viva)
manifest.webmanifest  o site como app instalavel
icons/          icones do app (gerados sem dependencia externa)
arkher_kaggle.ipynb            sobe os dois no Kaggle com GPU
.github/workflows/arkher.yml   sobe a VM Windows e religa sozinha
```

## Limites reais

- Sessao da VM dura ~6 h e religa sozinha (com `PAT_TOKEN`); o **IP muda** a cada sessao.
- Repo privado: 2.000 min/mes de Actions. Uso 24/7 nao e o previsto.
- Roblox Studio instala, mas o **login na conta Roblox e manual** (via RDP).
- Piloto leva ~4-8 s por passo. E autonomo, nao e instantaneo.
- DsOS transmite JPEG pelo WebSocket (8-25 fps conforme a rede). Serve pra
  trabalhar, nao pra jogar em 60 fps. Video H.264 exigiria WebRTC com servidor
  de sinalizacao sempre no ar (o rtc.io esta parado desde 2019) — ver RECURSOS.txt.
- 3D sem GPU e lento (5-20 min por objeto com o Shap-E na CPU) e a forma sai
  "bolhuda". Com GPU (Kaggle/PC) o TripoSR entrega malha limpa.
- Eu nao pude rodar Shap-E/TripoSR neste ambiente (sem GPU, e o huggingface.co
  e bloqueado aqui): o encanamento esta testado, os modelos nao. O log do job
  diz exatamente o que faltou, sem mensagem generica.
- Enxame gasta uma chamada por IA, e o modo profundo multiplica (subtarefas × conselho): o armazém de
  contas é o que sustenta isso — sem ele, use 4 IAs.
- Puter: a cota gratuita existe mas **não é documentada** (~100 req/dia em relatos da comunidade) e o
  erro vem como `low balance`/`insufficient_funds` (HTTP 402). Por isso a via grátis (`:free`) e os
  provedores de `freeai.js` não são enfeite: são o que mantém o chat de pé quando o saldo some.
  Os catálogos `:free` e as cotas dos provedores mudam com o tempo — se um dia um deles sumir, a
  cascata simplesmente pula para o próximo (nada fica fixo no código).
- Treino no Kaggle: ~30 h de GPU por semana, sessao de ~12 h, arquivo em `/kaggle/working` (20 GB) e
  kill por 20 min parado — o religador (`religa_kaggle.py`) respeita a cota e para quando ela acaba.
- A VM do GitHub Actions (incluindo a do repo so-RDP) **não tem GPU**: ela serve pra tela, Windows e
  ferramentas. Quem treina e faz 3D pesado é o nó do Kaggle (P100/T4) ou o seu PC.
- Virtualizacao Android: nao existe (o no Android e Termux/Linux).
