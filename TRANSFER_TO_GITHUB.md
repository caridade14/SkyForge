# SkyForge - Transferencia para outro PC / GitHub

Este projeto esta preparado para ser movido para outro computador ou subido para GitHub.

## Ficheiros principais

- `SF30.html` - interface principal do SkyForge
- `server.js` - servidor local
- `package.json` - scripts/dependencias Node
- `assets/` - recursos do projeto
- `data/` - dados locais
- `start-skyforge-server.cmd` - arranque rapido no Windows

## Opcao 1 - Usar GitHub pelo browser

1. Entra em https://github.com
2. Cria um repositorio novo, por exemplo `SkyForge`
3. Escolhe `Private` se nao quiseres tornar o projeto publico
4. Usa `Add file > Upload files`
5. Faz upload dos ficheiros/pastas do projeto
6. No outro PC, faz download do repositorio em `Code > Download ZIP`

## Opcao 2 - Usar Git / GitHub Desktop

1. Instala GitHub Desktop ou Git for Windows
2. Cria um repositorio local nesta pasta
3. Faz commit dos ficheiros
4. Publica no GitHub como repositorio privado

Com Git instalado, os comandos seriam:

```powershell
git init
git add .
git commit -m "Initial SkyForge project"
git branch -M main
git remote add origin https://github.com/TEU-USUARIO/SkyForge.git
git push -u origin main
```

## No outro PC

1. Instala Node.js
2. Abre a pasta do projeto
3. Executa:

```powershell
npm install
node server.js
```

4. Abre:

```text
http://127.0.0.1:3000/SF30.html
```
