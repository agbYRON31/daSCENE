const RSVP = require("../models/rsvp");
const logger = require("../utils/logger");

const createRSVP = async (req, res, next) => {
  try {
    const { eventId, ticketType, guestCount } = req.body;
    const rsvp = await RSVP.create({
      eventId,
      userId: req.user.id,
      ticketType,
      guestCount,
      status: "confirmed",
    });

    req.app.get("io").emit("newRSVP", rsvp);

    res.status(201).json(rsvp);
  } catch (error) {
    logger.error(error);
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createRSVP,
};
