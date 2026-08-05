# SkyForge Core v11

SkyForge é uma workstation local para criação de céus físicos, atmosfera, HDRI, animação de iluminação e integração com aplicações 3D. O projeto utiliza Node.js sem frameworks externos e mantém a persistência principal em SQLite (`data/skyforge.db`).

## O que mudou no Core v11

A build v11 preserva a UI SF30, mas adiciona uma camada modular e não destrutiva carregada pelo gateway Natural Light:

- estado central único para projeto, Sol, atmosfera, nuvens, câmara, cor, render, timeline, nodes e bridges;
- Undo/Redo com histórico de alterações;
- autosave e recuperação local;
- ficheiro `.skyforge` versão 3 com checksum;
- timeline com keyframes, interpolação, play, pause, loop e scrub;
- node graph tipado com Sun, Atmosphere, Clouds, Sky Scene, Color Grade e Output;
- sincronização automática da UI com o motor físico Natural Light;
- Command Center profissional, aberto com `Ctrl+Shift+H`;
- splash screen antigo desativado por padrão;
- render preview e render queue integrados ao estado central;
- Blender Bridge real por localhost, com fallback para payload em disco;
- testes de sintaxe e comportamento dos módulos principais.

## Executar no Windows com Node.js portátil

No CMD:

```cmd
set "PATH=C:\Users\c.tango\nodejs;%PATH%"
cd /d "C:\Users\c.tango\SkyForge\SkyForge-feature-natural-light-engine"
npm install
npm start
```

Abre:

```text
http://localhost:3000
```

O `npm start` executa `server-natural-light.js`, que inicia o backend principal numa porta interna e serve a aplicação pública na porta 3000.

## Atalhos do Core v11

- `Ctrl+Shift+H`: abrir o Command Center;
- `Ctrl+S`: exportar o projeto `.skyforge`;
- `Ctrl+O`: abrir um projeto;
- `Ctrl+N`: criar um projeto vazio;
- `Ctrl+Z`: Undo;
- `Ctrl+Shift+Z`: Redo;
- `Space`: Play/Pause da timeline, quando o foco não está num campo de texto.

## Blender Bridge

O addon está em:

```text
integrations/blender/skyforge_bridge_addon.py
```

Instala no Blender 4+ em **Edit > Preferences > Add-ons > Install from Disk**. Depois abre **World Properties > SkyForge Bridge** e pressiona **Start Bridge**.

O addon escuta apenas em `127.0.0.1:8765`. O SkyForge envia:

- HDRI e rotação do Environment;
- força do World;
- elevação, azimute, intensidade, temperatura e diâmetro do Sol;
- metadados ACEScg e exposição;
- nome e estado do projeto.

Se o Blender estiver fechado, o payload mais recente fica em:

```text
data/bridge/blender-world-latest.json
```

## Endpoints do Core v11

- `GET /api/core/health` — estado do Core v11;
- `GET /api/lighting/health` — estado do motor Natural Light;
- `POST /api/lighting/evaluate` — avaliação física;
- `POST /api/lighting/preview` — preview com LUTs;
- `GET /api/bridge/blender/health` — testa o addon Blender;
- `POST /api/bridge/blender/send` — envia ou guarda o World payload.

Os endpoints antigos de projetos, versões, assets, render queue e worker continuam disponíveis através do backend principal.

## Testes

```cmd
npm test
```

Apenas os testes do Core v11:

```cmd
npm run test:core
```

## Estrutura adicionada

```text
src/client/core/
├── bootstrap.js
├── state-store.js
├── timeline-engine.js
├── node-graph.js
├── project-service.js
├── render-service.js
├── lighting-sync.js
├── blender-bridge.js
├── ui-bridge.js
└── skyforge-core-v11.css

integrations/blender/
├── skyforge_bridge_addon.py
└── README.md
```

## Estado do render

O pipeline atual valida projetos, fila, preview, worker, artefatos e bridge end-to-end. A geração EXR/HDR física definitiva ainda deve ser ligada a um renderer panorâmico de alta precisão; os artefatos EXR/HDR existentes continuam protótipos de pipeline.
