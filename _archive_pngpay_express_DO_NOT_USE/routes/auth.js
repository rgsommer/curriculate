const express = require('express');
const router = express.Router();
const { getDb } = require('../src/db');
const { verifyPassword } = require('../src/auth');

const BASE = process.env.BASE_PATH || '';

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(BASE + '/dashboard');
  res.render('login', { title: 'Sign in', error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const db = getDb();
    const u = await db.collection('users').findOne({
      email: (email || '').toLowerCase(),
      is_active: 1,
    });
    if (!u || !(await verifyPassword(password || '', u.password_hash))) {
      return res.status(401).render('login', { title: 'Sign in', error: 'Invalid email or password.' });
    }
    req.session.userId = u._id.toString();
    req.session.save(() => res.redirect(BASE + '/dashboard'));
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect(BASE + '/login'));
});

module.exports = router;
