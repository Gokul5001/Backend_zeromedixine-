// Routes/salesAuth.js
const express = require('express');
const router = express.Router();
const LoginCredential = require('../Models/LoginCredential'); // reuse your existing model
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { loginRateLimiter } = require("../middleware/rateLimit");

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// helper to create token
function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// Sales login
router.post('/login',loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, message: 'username and password required' });

    const raw = String(username).trim();
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const query = {
      $or: [
        { username: { $regex: new RegExp(`^${esc}$`, 'i') } },
        { user: { $regex: new RegExp(`^${esc}$`, 'i') } },
        { user_name: { $regex: new RegExp(`^${esc}$`, 'i') } },
        { mobile_no: raw },
        { email: { $regex: new RegExp(`^${esc}$`, 'i') } },
      ],
      role: 'sales' // ensure only sales users authenticate here
    };

    const user = await LoginCredential.findOne(query).lean();
    if (!user) return res.status(401).json({ success: false, message: 'Invalid username or password' });

    const stored = user.password || '';
    let passwordMatches = false;

    if (/^\$2[ayb]\$/.test(stored)) {
      passwordMatches = await bcrypt.compare(password, stored);
    } else {
      passwordMatches = stored === password; // legacy fallback
      if (passwordMatches) {
        // migrate to bcrypt
        try {
          const newHash = await bcrypt.hash(password, 12);
          await LoginCredential.updateOne({ _id: user._id }, { $set: { password: newHash } });
          console.log('Migrated password to bcrypt for user:', user._id);
        } catch (e) {
          console.warn('Password migration failed for', user._id, e);
        }
      }
    }

    if (!passwordMatches) return res.status(401).json({ success: false, message: 'Invalid username or password' });

    // payload: keep minimal
    const payload = { id: user._id.toString(), role: user.role || 'sales', username: user.username || user.user || user.user_name || null };
    const token = createToken(payload);

    // set httpOnly cookie -- recommended
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true', // true in prod
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    };

    res.cookie('access_token', token, cookieOpts);

    const safeUser = {
      _id: user._id,
      username: payload.username,
      role: payload.role,
      email: user.email || null,
      mobile_no: user.mobile_no || null,
    };

    return res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('Sales login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// logout - clears cookie
router.post('/logout', (req, res) => {
  res.clearCookie('access_token', { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true });
});

module.exports = router;
