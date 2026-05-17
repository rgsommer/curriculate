#!/usr/bin/env node
// Wraps import_history.js with an in-memory MongoDB for sandbox testing.
// Usage:  node scripts/import_history_local.js /path/to/PNGPayOnline
(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri();
  process.env.MONGODB_DB = 'pngpay-import-local';
  process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'test@example.com';
  process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD = 'pw';

  // Force the import_history main() to use our sys.argv[2] as the archive path.
  // (require('./import_history') doesn't auto-run main() unless main module.)
  process.argv[1] = require('path').resolve(__dirname, 'import_history.js');
  await require('./import_history.js'); // exports nothing relevant; we need its main()
})().catch(e => { console.error(e); process.exit(1); });
