#!/usr/bin/env node
// Connect to MongoDB and ensure indexes / bootstrap super_admin.
require('dotenv').config();
const { initDb } = require('../src/db');
(async () => {
  await initDb();
  console.log('Database initialised / indexed.');
  process.exit(0);
})();
