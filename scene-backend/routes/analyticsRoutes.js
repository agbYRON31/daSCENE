const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const analyticsController = require("../controllers/analyticsController");

// Example: GET /analytics/venue/123
router.get(
  "/venue/:venueId",
  authenticateToken,
  analyticsController.getVenueAnalytics
);

module.exports = router;
