const { Promotion, Venue } = require("../models");
const logger = require("../utils/logger");
const { promotionSchema } = require("../utils/validationSchemas");

const createPromotion = async (req, res, next) => {
  try {
    const { error } = promotionSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { venueId, title, description, type, startTime, endTime, validDays } =
      req.body;

    const venue = await Venue.findOne({
      where: { id: venueId, managerId: req.user.id },
    });
    if (!venue) return res.status(403).json({ error: "Access denied" });

    const promotion = await Promotion.create({
      venueId,
      title,
      description,
      type,
      startTime,
      endTime,
      validDays,
      createdBy: req.user.id,
    });

    // // Emit new promotion via WebSocket
    // req.app.get("io").to(`venue_${venueId}`).emit("newPromotion", promotion);

    req.app.get("io").emitToVenue(venueId, "newPromotion", {
      id: promotion.id,
      title: promotion.title,
      description: promotion.description,
    });

    res.status(201).json(promotion);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

module.exports = {
  createPromotion,
};
