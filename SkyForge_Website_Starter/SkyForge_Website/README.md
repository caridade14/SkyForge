# SkyForge Website Starter

Primeira versão programada do site SkyForge em HTML/CSS/JS puro.

## Estrutura

```txt
SkyForge_Website/
  frontend/
    index.html
    css/
      style.css
    js/
      app.js
    assets/
      images/
```

## Como usar no teu projeto

Copia a pasta `frontend` para dentro do teu projeto principal:

```txt
SkyForge/
  frontend/
    index.html
    css/
      style.css
    js/
      app.js
  backend/
    server.js
```

Depois corre o backend:

```bash
node backend/server.js
```

Ou abre diretamente:

```txt
frontend/index.html
```

## O que já está funcional

- Landing page completa
- Navbar responsiva
- Menu mobile
- Logo correto: SF + Sky branco + Forge laranja
- Laranja uniforme: #f97316
- Demo interativa de moods
- Animações suaves ao scroll
- Formulário fake de beta list
- Secções de features, showcase, pipeline, download, pricing e FAQ

## Próximos passos recomendados

1. Ligar o formulário de beta list ao backend.
2. Criar `/api/newsletter`.
3. Criar páginas reais: download.html, docs.html, pricing.html.
4. Adicionar screenshots reais da UI.
5. Criar dashboard interno do SkyForge.
