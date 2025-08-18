// rateLimiter.js
const rateLimit = require("express-rate-limit");

// General API limiter (15-minute window, 100 requests)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // v6+ uses `limit` instead of `max`
  message: {
    status: 429,
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: "draft-7", // recommended in v6
  legacyHeaders: false,
});

// Auth-specific limiter (1-hour window, 10 attempts)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  message: {
    status: 429,
    error: "Too many login attempts, please try again later.",
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

module.exports = { limiter, authLimiter };
