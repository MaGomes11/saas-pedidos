'use strict';

// Entry serverless para Vercel: empacota o Express inteiro como uma única
// função. O banco (libSQL/Turso) é inicializado uma vez no cold start.
const db = require('./server/db');
const app = require('./server/index');
const serverless = require('serverless-http');

let handler = null;

module.exports = async function vercelHandler(req, res) {
  if (!handler) {
    await db.init();
    handler = serverless(app);
  }
  return handler(req, res);
};