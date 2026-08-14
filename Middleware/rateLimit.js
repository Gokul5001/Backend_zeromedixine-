const rateLimit = require("express-rate-limit");

// Protect login endpoints
const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // ✅ 5 minutes
  max: 7, // allow only 5 tries
  message: {
    success: false,
    message: "Too many login attempts. Try again after 5 minutes."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Generic API limiter (optional)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 100 requests / minute per IP
});

module.exports = {
  loginRateLimiter,
  apiLimiter
};




