# Deploy no Vercel (versão com banco hospedado)

Esta é a versão **serverless** do Saas Pedidos: a mesma aplicação, mas com o
banco de dados hospedado no **Turso (libSQL)** — SQLite no formato original,
então **todo o SQL/schema é idêntico** ao da versão local/Render.

- Local / Render: `better-sqlite3` (arquivo SQLite) — nada muda.
- Vercel: `@libsql/client` + Turso — ativado apenas quando as variáveis
  `TURSO_URL` e `TURSO_AUTH_TOKEN` existem.
- O modo é escolhido automaticamente no boot (não há flag manual).

## Como funciona

| | Local / Render | Vercel (serverless) |
|---|---|---|
| Driver | `better-sqlite3` | `@libsql/client` (Turso) |
| Banco | arquivo `data/buffet.db` | banco remoto libSQL |
| Acesso | `db.get/all/run/tx` (async) | mesma API (async) |
| Tempo real | SSE | **Polling** (o frontend detecta e cai para polling de 30s) |
| Migrations legadas | sim | não (bancos novos) |

O `server/db.js` expõe um adapter async único (`get`, `all`, `run`, `exec`,
`tx`). As rotas usam `await db.get(...)` em ambos os modos. Transações usam
`db.tx(async fn)` — BEGIN/COMMIT no local, `client.transaction('write')` no Turso.

> ⚠️ `admin@buffet.local/admin123` **não** vale no Vercel: o seed do primeiro
> boot usa `ADMIN_EMAIL` / `ADMIN_PASSWORD` (mesma regra do Render).

## 1. Criar o banco no Turso (grátis)

1. Crie uma conta em https://turso.tech e instale a CLI:
   ```bash
   npm i -g @tursodatabase/turso-cli
   turso auth login
   ```
2. Crie o banco e gere o token:
   ```bash
   turso db create saas-pedidos
   turso db show saas-pedidos        # copie a URL (libsql://...)
   turso db tokens create saas-pedidos  # copie o token
   ```
3. Anote: `TURSO_URL` (ex.: `libsql://saas-pedidos-<org>.turso.io`) e
   `TURSO_AUTH_TOKEN` (string longa do token).

## 2. Configurar no Vercel

Opção A — Dashboard:

1. Importe o repositório `https://github.com/MaGomes11/saas-pedidos` no
   Vercel (Framework Preset: **Other**; Build: nada especial — `vercel.json`
   já existe; Install: `npm install`).
2. Em **Settings → Environment Variables**, adicione (Vercel as disponibiliza
   só no deploy após o primeiro envio):
   - `ADMIN_EMAIL` = e-mail do administrador (ex.: `matheus.pgomes23@gmail.com`)
   - `ADMIN_PASSWORD` = senha forte (mín. 8 caracteres)
   - `TURSO_URL` e `TURSO_AUTH_TOKEN` (do passo 1)
3. Faça o deploy. No primeiro boot o banco é criado + seed de exemplo.

Opção B — CLI:

```bash
npx vercel login
npx vercel env add ADMIN_EMAIL production
npx vercel env add ADMIN_PASSWORD production
npx vercel env add TURSO_URL production
npx vercel env add TURSO_AUTH_TOKEN production
npx vercel --prod
```

Rodar localmente contra o Turso (substituindo o better-sqlite3):

```bash
$env:TURSO_URL="libsql://..."
$env:TURSO_AUTH_TOKEN="..."
node server/index.js   # agora usa o banco remoto
```

## 3. Arquitetura do deploy

- `api/index.js` — entry serverless: inicializa `db.init()` no cold start e
  empacota o Express inteiro via `serverless-http`.
- `vercel.json` — rota tudo (API + estáticos) para essa função única.
- `server/index.js` — exporta o `app`; o `listen` só roda localmente
  (`require.main === module` e sem `VERCEL`).
- `GET /api/events` — no Vercel responde `200 text/plain` imediatamente; o
  `EventSource` do frontend falha e o app cai para polling (30s) de
  notificações + re-render de Kanban/Dashboard/Pedidos.

## Limites do plano grátis (Turso)

- ~500 MB de armazenamento (farto para este app).
- 1 milhão de rows / 5 bilhões de reads por mês (mais que suficiente).
- Multipla instância: se precisar de mais, crie réplica de leitura.

## Resolução de problemas

- **Login 401 no Vercel**: o seed só roda quando `users` está vazio. Se o
  primeiro boot usou credenciais erradas, apague a tabela de usuários no Turso
  (Studio ou `turso db shell`) e refaça o deploy, ou edite a senha do usuário
  diretamente no banco.
- **Slow first request**: esperado — é o cold start + seed inicial do banco.
- **SSE parado**: normal no Vercel; o app usa polling automaticamente.