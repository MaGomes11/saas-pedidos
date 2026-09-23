# Deploy — Saas Pedidos (Node + SQLite)

Este projeto roda em qualquer host **always-on com disco persistente**.
O **Vercel não é compatível** (SQLite em arquivo + SSE em tempo real não funcionam em serverless).

## Antes de começar

1. Coloque o projeto em um repositório Git e suba para o **GitHub** (o Render e o Railway fazem deploy a partir dele):
   ```bash
   git init
   git add .
   git commit -m "Saas Pedidos"
   git remote add origin https://github.com/SEU_USUARIO/saas-pedidos.git
   git push -u origin main
   ```
2. O repositório deve conter `server/`, `public/`, `package.json` e **não** a pasta `data/` (já está no `.gitignore`).

> 🔒 No primeiro boot (banco vazio) são criados o admin e os usuários demo.
> Defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mín. 8 caracteres) para não usar as credenciais padrão.

---

## Opção A — Render (recomendado, tem plano grátis)

### Rápido (Blueprint — 1 clique)
1. Crie conta em https://render.com (grátis).
2. Dashboard → **New → Blueprint** → conecte o repositório do GitHub.
3. O Render lê o `render.yaml` já pronto e cria o serviço com disco persistente.
4. No serviço criado, em **Environment**: preencha `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
5. Espere o deploy terminar e abra o link `https://saas-pedidos.onrender.com`.

### Manual (Web Service)
1. **New → Web Service** → conecte o repositório.
2. Configurações:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (ou Starter)
3. **Disks** (aba do serviço): adicione um disco persistente:
   - Name: `data` | Mount Path: `/var/data` | Size: 1 GB
4. **Environment** (variáveis):
   - `DB_PATH` = `/var/data/buffet.db`
   - `ADMIN_EMAIL` = seu e-mail
   - `ADMIN_PASSWORD` = sua senha (mín. 8)
5. **Deploy** → aguarde → abra o link `https://<serviço>.onrender.com`.

---

## Opção B — Railway

1. Crie conta em https://railway.app (grátis).
2. **New Project → Deploy from GitHub repo** → selecione o repositório.
3. **Add a volume** ao serviço e monte em **`/data`** (Railway injeta um disco persistente aí).
4. Variáveis de ambiente do serviço:
   - `DB_PATH` = `/data/buffet.db`
   - `ADMIN_EMAIL` = seu e-mail
   - `ADMIN_PASSWORD` = sua senha
5. A porta é injetada automaticamente (`PORT`) — o servidor já a lê. Abra o domínio gerado pelo Railway.

---

## Pós-deploy

- **Troque a senha/email do admin** em **Administração → Usuários** depois de criar os demais usuários reais.
- Os usuários `atendente/cozinha/entrega@buffet.local` (senha `<papel>123`) só são criados no primeiro boot — troque ou exclua-os.
- **Backup:** como o banco é um arquivo SQLite no disco persistente, o backup é baixar/apontar para `buffet.db` (Render: aba Disks; Railway: volume). Considere um job agendado copiando esse arquivo.
- **Atualização:** a cada `git push` na branch principal, Render/Railway fazem redeploy automático (com `autoDeploy: true` no Render).

## Scripts úteis

```bash
npm start        # sobe o servidor (porta via PORT ou 3000)
npm run seed     # RECRIA o banco do zero — CUIDADO: apaga os dados atuais
```