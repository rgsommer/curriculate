// PNGPay — main entry point.
// Mount under any BASE_PATH (e.g. /pngpay) by setting it in .env.

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const { initDb, dbMiddleware } = require('./src/db');
const { attachUser, requireAuth } = require('./src/auth');

const BASE_PATH = process.env.BASE_PATH || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

(async () => {
  await initDb();

  const app = express();
  const router = express.Router();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  router.use(express.urlencoded({ extended: true, limit: '5mb' }));
  router.use(express.json({ limit: '5mb' }));
  router.use('/static', express.static(path.join(__dirname, 'public')));

  router.use(session({
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI || process.env.MONGODB_URI,
      dbName: process.env.MONGO_DB || process.env.MONGODB_DB || 'pngpay',
      collectionName: 'pngpay_sessions',
      ttl: 60 * 60 * 8, // 8h
    }),
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
      path: BASE_PATH || '/',
    },
  }));

  router.use((req, res, next) => {
    res.locals.BASE_PATH = BASE_PATH;
    res.locals.user = null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
  });
  router.use(dbMiddleware);
  router.use(attachUser);

  router.use('/', require('./routes/auth'));
  // Employee CRUD: bookkeeper+ (clearance ≥ 2)
  router.use('/employees', requireAuth({ minLevel: 2 }), require('./routes/employees'));
  // Payroll entry: site_payroll+ (clearance ≥ 1)
  router.use('/payroll',   requireAuth({ minLevel: 1 }), require('./routes/payroll'));
  // Reports: bookkeeper+
  router.use('/reports',   requireAuth({ minLevel: 2 }), require('./routes/reports'));
  // Tax rules: principal+ (changing tax bands is sensitive)
  router.use('/taxrules',  requireAuth({ minLevel: 3 }), require('./routes/taxrules'));
  // Admin (companies, users, importer, service fees): principal+, but the
  // service-fee subpage inside admin is further gated to system_owner only.
  router.use('/admin',     requireAuth({ minLevel: 3 }), require('./routes/admin'));

  router.get('/', (req, res) => {
    if (!req.user) return res.redirect(BASE_PATH + '/login');
    res.redirect(BASE_PATH + '/dashboard');
  });

  router.get('/dashboard', requireAuth(), (req, res) => {
    res.render('dashboard', { title: 'Dashboard' });
  });

  router.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));

  router.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: err.message });
  });

  app.use(BASE_PATH || '/', router);

  app.listen(PORT, () => {
    console.log(`PNGPay listening on :${PORT}  (mount path: "${BASE_PATH || '/'}")`);
  });
})().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
