const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");
const { authLimiter } = require("../config/rateLimiter");

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);

module.exports = router;
