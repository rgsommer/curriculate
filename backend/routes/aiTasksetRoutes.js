// routes/aiTasksetRoutes.js
const express = require('express');
const router = express.Router();
const { generateTaskset } = require('../controllers/aiTasksetController');
const { authRequired } = require('../middleware/authRequired');
const { checkFeature } = require('../middleware/checkFeature');

router.post(
  '/',
  authRequired,
  checkFeature('aiGenerateTaskset'),
  generateTaskset
);

module.exports = router;
