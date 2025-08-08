const jwt = require("jsonwebtoken");
const { User } = require("../models");
const logger = require("../utils/logger");

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Access token required" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.userId);
    if (!user) return res.status(403).json({ error: "User not found" });

    req.user = user;
    next();
  } catch (error) {
    logger.error("JWT verification failed:", error);
    res.status(403).json({ error: "Invalid token" });
  }
};

const authorizeVenueManager = (req, res, next) => {
  if (req.user.role !== "venue_manager") {
    return res.status(403).json({ error: "Venue manager access required" });
  }
  next();
};

module.exports = {
  authenticateToken,
  authorizeVenueManager,
};
