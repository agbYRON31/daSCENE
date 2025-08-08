const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);

  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ error: "Invalid token" });
  }

  res.status(500).json({ error: "Something went wrong!" });
};

const notFound = (req, res) => {
  res.status(404).json({ error: "Route not found" });
};

module.exports = {
  errorHandler,
  notFound,
};
