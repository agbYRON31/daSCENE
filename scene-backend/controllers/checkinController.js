const { CheckIn, Venue, User } = require("../models");
const logger = require("../utils/logger");
const { checkinSchema } = require("../utils/validationSchemas");

const checkIn = async (req, res, next) => {
  try {
    const { error } = checkinSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { venueId, latitude, longitude } = req.body;
    const userId = req.user.id;

    const venue = await Venue.findByPk(venueId);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    const existingCheckin = await CheckIn.findOne({
      where: { userId, venueId, checkedOutAt: null },
    });
    if (existingCheckin) {
      return res
        .status(400)
        .json({ error: "Already checked in to this venue" });
    }

    const newCheckin = await CheckIn.create({
      userId,
      venueId,
      location: Sequelize.fn("ST_MakePoint", longitude, latitude),
    });

    await venue.update({
      currentCheckins: Sequelize.literal("currentCheckins + 1"),
      totalCheckins: Sequelize.literal("totalCheckins + 1"),
    });

    if (req.user.role === "customer") {
      await req.user.update({
        profile: {
          ...req.user.profile,
          totalCheckins: (req.user.profile.totalCheckins || 0) + 1,
        },
      });
    }

    // Emit real-time update via WebSocket
    req.app
      .get("io")
      .to(`venue_${venueId}`)
      .emit("checkin", {
        venueId,
        userId,
        currentCheckins: venue.currentCheckins + 1,
      });

    res.status(201).json(newCheckin);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

module.exports = {
  checkIn,
  // Other checkin methods...
};
