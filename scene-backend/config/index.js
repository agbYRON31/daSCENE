const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: (msg) => logger.debug(msg),
    dialectOptions: {
      ssl: process.env.NODE_ENV === "production" ? { require: true } : false,
    },
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    logger.info("Database connection established");
  } catch (error) {
    logger.error("Unable to connect to the database:", error);
    process.exit(1);
  }
};

module.exports = {
  sequelize,
  connectDB,
};
