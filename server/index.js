'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const db = require('./db');
const { attachUser, requireAuth } = require('./auth');
const { sseHandler } = require('./realtime');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const ingredientRoutes = require('./routes/ingredients');
const categoryRoutes = require('./routes/categories');
const dishRoutes = require('./routes/dishes');
const dishTypeRoutes = require('./routes/dishTypes');
const partyRoutes = require('./routes/parties');
const orderRoutes = require('./routes/orders');
const orderStatusRoutes = require('./routes/orderStatuses');
const settingsRoutes = require('./routes/settings');
const dashboardRoutes = require('./routes/dashboard');
const historyRoutes = require('./routes/history');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(attachUser);

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/dishes', dishRoutes);
app.use('/api/dish-types', dishTypeRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/order-statuses', orderStatusRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/notifications', notificationRoutes);

// Tempo real (SSE)
app.get('/api/events', requireAuth, sseHandler);

// Healthcheck (usado pelo Render e útil no Vercel)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    serverless: process.env.VERCEL === '1',
    driver: db.IS_LIBSQL ? 'libsql' : 'sqlite',
  });
});

// Frontend estático
app.use(express.static(path.join(__dirname, '..', 'public')));

// API 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor.' : err.message });
});

// No Vercel a inicialização fica por conta da função serverless (api/index.js).
if (!process.env.VERCEL && require.main === module) {
  db.init()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`🚀 Sistema de buffet rodando em http://localhost:${PORT}`);
      });
    })
    .catch((e) => {
      console.error('Falha ao inicializar o banco de dados:', e);
      process.exit(1);
    });
}

module.exports = app;