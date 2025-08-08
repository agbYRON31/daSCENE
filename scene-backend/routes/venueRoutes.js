const express = require("express");
const router = express.Router();
const venueController = require("../controllers/venueController");
const { cacheMiddleware } = require("../services/cacheService");
const {
  authenticateToken,
  authorizeVenueManager,
} = require("../middleware/auth");
const { venueSchema } = require("../utils/validationSchemas");
const { validate } = require("../middleware/validation");

router.get("/", cacheMiddleware(300), venueController.getVenues);
router.get("/:id", venueController.getVenueById);

router.post(
  "/",
  authenticateToken,
  authorizeVenueManager,
  validate(venueSchema),
  venueController.createVenue
);

router.put(
  "/:id",
  authenticateToken,
  authorizeVenueManager,
  validate(venueSchema),
  venueController.updateVenue
);

module.exports = router;
