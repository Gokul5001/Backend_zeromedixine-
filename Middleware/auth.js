// middleware/auth.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_prod';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.warn('JWT verify error:', err);
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    req.user = decoded; // { id, role, username, iat, exp }
    next();
  });
}

// role guard
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (req.user.role !== role) return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
    next();
  };
}

module.exports = { authenticateToken, requireRole };
