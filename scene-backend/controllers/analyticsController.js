const { Analytics } = require("../models");
const logger = require("../utils/logger");

// Get analytics for a venue
const getVenueAnalytics = async (req, res, next) => {
  try {
    const venueId = req.params.venueId;

    const data = await Analytics.getVenueAnalytics(venueId);
    res.json(data);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

module.exports = {
  getVenueAnalytics,
};
