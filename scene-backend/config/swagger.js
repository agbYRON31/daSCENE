const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const path = require("path");

function setupSwagger(app) {
  const swaggerDocument = YAML.load(path.join(__dirname, "swagger.yaml"));

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

module.exports = { setupSwagger };
