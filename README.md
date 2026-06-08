# SkyForge Backend

Backend local para o prototipo SkyForge. A persistencia principal usa SQLite em `data/skyforge.db`.

## Como rodar

```powershell
cd "D:\CARY PC\SF"
npm run dev
```

Depois abre:

```text
http://localhost:3000/SF30.html
```

## Endpoints principais

- `GET /api/health` verifica se a API esta online.
- `GET /api/stats` mostra contadores gerais da aplicacao.
- `GET /api/activity` mostra atividade recente de renders e versoes.
- `GET /api/settings` carrega preferencias da aplicacao.
- `PUT /api/settings` salva preferencias da aplicacao.
- `POST /api/preview` gera um preview PNG da cena atual sem criar job de render.
- `POST /api/scene/analyze` analisa sol/nuvens/output e devolve sugestoes para a UI.
- `GET /api/projects` lista projetos salvos.
- `POST /api/projects` cria um projeto.
- `POST /api/projects/import` importa um bundle `.skyforge.json`.
- `GET /api/projects/:id` carrega um projeto.
- `PUT /api/projects/:id` salva/substitui a cena de um projeto.
- `DELETE /api/projects/:id` apaga um projeto, exceto `default`.
- `POST /api/projects/:id/duplicate` duplica um projeto.
- `GET /api/projects/:id/export` exporta um bundle JSON do projeto.
- `GET /api/projects/:id/versions` lista versoes/checkpoints do projeto.
- `POST /api/projects/:id/versions` cria uma versao/checkpoint manual.
- `POST /api/projects/:id/versions/:version/restore` restaura uma versao.
- `GET /api/renders` lista a fila de render. Aceita `projectId` e `status` como query params.
- `GET /api/renders/:id` carrega um job especifico.
- `GET /api/renders/:id/artifacts` lista artefatos gerados.
- `GET /api/renders/:id/logs` lista logs do worker para o job.
- `POST /api/renders` cria um job de render.
- `PATCH /api/renders/:id` atualiza status/progresso do job.
- `POST /api/renders/:id/retry` recria um render com os mesmos settings.
- `DELETE /api/renders/:id` remove um job da fila/historico.
- `POST /api/renders/:id/cancel` cancela um job.
- `GET /api/worker` mostra o estado do render worker local.
- `GET /api/assets` lista assets.
- `POST /api/assets` cria um asset.
- `GET /api/assets/:id` carrega um asset.
- `PUT /api/assets/:id` atualiza um asset.
- `DELETE /api/assets/:id` apaga um asset.
- `GET /api/users` lista usuarios locais.
- `POST /api/users` cria um usuario local.

## Dados locais

Os dados principais ficam em:

- `data/skyforge.db`
- `data/outputs/*`

Os JSON antigos em `data/projects/*.json` e `data/renders.json` sao migrados automaticamente para SQLite na primeira inicializacao do novo backend.

## Render worker

O backend tem um worker local simples que processa jobs `queued` automaticamente, atualiza progresso em SQLite e escreve um artefato/manifesto em `data/outputs`.

Para cada render concluido ele grava:

- `*.png` quando o formato pedido e PNG Preview.
- `*.exr`, `*.hdr` ou `*.tiff` como artefato de prototipo quando estes formatos sao pedidos.
- `*.render.json` manifesto com cena, settings e caminhos.
- `*.preview.png` preview raster procedural do ceu.

Nesta fase o arquivo `.exr` ainda e um artefato de prototipo, nao um EXR/HDRI real. A ideia e validar a fila e o pipeline end-to-end antes de ligar o renderer de imagem.
