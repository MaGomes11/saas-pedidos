# 🍽️ Cardápio Buffet — Sistema de Gestão de Pedidos

Sistema web **responsivo** para buffet gerenciar **festas (eventos)**, cardápios,
mesas e pedidos — **sem nenhum controle financeiro** (não há preços, valores,
pagamentos ou caixa em lugar algum).

## ✨ Visão geral

- **Festa (evento)** é a entidade organizadora: cada festa tem cardápio próprio,
  pratos exclusivos do evento e suas mesas.
- **Lançamento de pedidos** por festa + mesa, com personalização de ingredientes
  (retirar/adicionar com observações).
- **Visão de pedidos (Kanban) em tempo real** (SSE com fallback de polling): Novo → Em preparo →
  Pronto → Entregue → Finalizado (com Cancelado opcional e justificativa).
- Controle de **acesso por perfis** (Administrador, Atendente, Cozinha, Entrega)
  com grade de permissões editável na interface.
- **Histórico completo**: trilha de auditoria, linha do tempo de cada pedido,
  snapshots de nomes (pratos/ingredientes inativados continuam visíveis no passado).
- **Dashboard** com contadores por status, tempo médio de preparo, mesas ocupadas
  e pedidos aguardando (destaque quando ultrapassam 15/30 min).
- Responsivo, botões grandes, navegação por teclado e foco visível.

## 🚀 Como executar

Requisitos: **Node.js 20+** (testado com Node 24).

```bash
npm install        # instala as dependências
npm start          # sobe o servidor em http://localhost:3000
```

O banco (`data/buffet.db`, SQLite) é criado e populado com dados de demonstração
automaticamente na primeira execução. Para recriar do zero com os dados de exemplo:

```bash
npm run seed       # apaga o banco e recria com dados de demonstração
```

> No Windows, se o `npm` estiver bloqueado pela política de execução do PowerShell,
> use o caminho completo: `& "$env:ProgramFiles\nodejs\npm.cmd" start`.

### 🔑 Usuários de demonstração

| Perfil        | E-mail                | Senha          |
|---------------|-----------------------|----------------|
| Administrador | `admin@buffet.local`  | `admin123`     |
| Atendente     | `atendente@buffet.local` | `atendente123` |
| Cozinha       | `cozinha@buffet.local`  | `cozinha123`   |
| Entrega       | `entrega@buffet.local`  | `entrega123`   |

## 🧪 Testes de aceite (smoke test E2E)

Cobertura automatizada da API cobrindo os critérios de aceite principais:

```bash
npm start          # em um terminal
node scripts/smoke.js   # em outro: 60 verificações
```

Verifica autenticação, CRUD de ingredientes/pratos/cardápios, festas, pratos
exclusivos com isolamento entre festas, mesas (duplicidade/regras), pedidos sem
valores, idempotência, fluxo completo da Visão de pedidos (Kanban), cancelamento com justificativa,
festa encerrada bloqueando pedidos, notificações, permissões por perfil, edição
de pedidos (bloqueio pós-finalização, exceção admin), preservação de histórico de
inativos, vínculos de cardápio, exclusão de mesas, dashboard filtrado e auditoria.

## 🧱 Arquitetura

```
server/
  index.js          Express (API + estáticos + SSE + erro)
  db.js             Schema SQLite + seed idempotente (npm run seed --reset)
  auth.js           Sessões (cookie httpOnly), permissões por perfil
  util.js           Helpers (código de pedido, stripFinancial...)
  audit.js          Auditoria
  realtime.js       Hub SSE + notificações
  routes/           Auth, users, ingredients, dishes, dishTypes,
                    parties (cardápio/mesas), orders, dashboard, history, notifications
public/
  index.html        SPA sem build (ES modules)
  css/app.css       Design system responsivo
  js/app.js         Roteador hash, menu por permissão, SSE, notificações
  js/api.js         Cliente HTTP (fetch) + sessão
  js/ui.js          Componentes (modais, toasts, badges, beep)
  js/views/         16 telas
scripts/
  smoke.js          Smoke test E2E (60 verificações)
data/
  buffet.db         Banco SQLite (WAL)
```

### Principais regras de negócio implementadas

- Pedido **sempre** vinculado a festa + mesa; mesa com status `bloqueada`/`encerrada`
  não aceita pedidos; festa `encerrada`/`cancelada` não aceita novos pedidos.
- Fluxo de status com permissões: `novo → em_preparo → pronto` (cozinha/admin),
  `pronto → entregue` (entrega/admin), `entregue → finalizado` (entrega/admin);
  cancelamento exige justificativa (atendente/admin).
- Edição de pedidos permitida em `novo`/`em_preparo`; após `finalizado` apenas
  admin com a permissão `pedidos_editar_finalizados`.
- Desativação (soft delete) em vez de exclusão para pratos/ingredientes/usuários;
  mesas com pedidos históricos não podem ser excluídas.
- Prevenção de envio duplicado via `client_request_id` (idempotência).
- Nenhum campo financeiro (defesa `stripFinancial` + smoke test).

## 📱 Telas (16)

Login, Dashboard, Festas, Festa (detalhe), Formulário de festa, Cardápio da festa,
Mesas, Tipos de cardápio, Pratos, Ingredientes, Lançar pedido, Detalhe do pedido,
Visão de pedidos, Pedidos, Histórico, Usuários (permissões).

## 📡 API (resumo)

`/api/auth` · `/api/users` (perfis/permissões) · `/api/ingredients` ·
`/api/dishes` · `/api/dish-types` · `/api/parties` (cardápio + mesas) ·
`/api/orders` · `/api/dashboard` · `/api/history` · `/api/notifications` ·
`/api/events` (SSE).

Todos os endpoints exigem sessão via cookie `sb_session` (24h).