const fs = require("fs");
const path = require("path");
const Sequelize = require("sequelize");
const { sequelize } = require("../config");
const logger = require("../utils/logger");

const db = {};

// Import all model files
fs.readdirSync(__dirname)
  .filter((file) => file !== "index.js" && file.endsWith(".js"))
  .forEach((file) => {
    const model = require(path.join(__dirname, file))(
      sequelize,
      Sequelize.DataTypes
    );
    db[model.name] = model;
  });

// Set up associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Add Sequelize and sequelize instances
db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Add custom methods
db.syncDB = async () => {
  try {
    await sequelize.sync({ alter: process.env.NODE_ENV !== "production" });
    logger.info("Database synced");
  } catch (error) {
    logger.error("Failed to sync database:", error);
  }
};

module.exports = db;
