const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const RSVP = require("../models/rsvp");

router.post("/", authenticateToken, async (req, res) => {
  try {
    const { eventId, ticketType, guestCount } = req.body;

    const rsvp = await RSVP.create({
      eventId,
      userId: req.user.id,
      ticketType,
      guestCount,
      status: "confirmed",
    });

    // Emit real-time update
    req.app.get("io").emit("newRSVP", rsvp);

    res.status(201).json(rsvp);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
