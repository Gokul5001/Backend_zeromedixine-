// routes/googleAuth.js
const express = require('express');
const router = express.Router();
const Integration = require('../models/Integration');
const { revokeRefreshToken, rotateRefreshToken } = require('../utils/googleTokens');

router.post('/revoke', async (req, res) => {
  try {
    const integration = await Integration.findOne({ key: 'google_calendar' });
    if (!integration || !integration.refreshToken) return res.status(400).json({ success: false, message: 'No token stored' });

    const ok = await revokeRefreshToken(integration.refreshToken);
    // remove locally
    integration.refreshToken = null;
    integration.status = 'missing';
    integration.lastError = 'Revoked by admin';
    await integration.save();

    return res.json({ success: ok });
  } catch (err) {
    console.error('Revoke route error', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

// Admin rotate endpoint: POST { refreshToken: "..." }
router.post('/rotate', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'refreshToken required' });
    await rotateRefreshToken({ newToken: refreshToken, revokeOld: true });
    return res.json({ success: true });
  } catch (err) {
    console.error('Rotate failed', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

module.exports = router;
