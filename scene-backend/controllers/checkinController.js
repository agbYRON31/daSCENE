const { Sequelize } = require("sequelize");
const { CheckIn, Venue, User, sequelize } = require("../models");
const logger = require("../utils/logger");
const { checkinSchema } = require("../utils/validationSchemas");

const checkIn = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { error } = checkinSchema.validate(req.body);
    if (error) {
      await t.rollback();
      return res.status(400).json({ error: error.details[0].message });
    }

    const { venueId, latitude, longitude } = req.body;
    const userId = req.user.id;

    const venue = await Venue.findByPk(venueId, { transaction: t });
    if (!venue) {
      await t.rollback();
      return res.status(404).json({ error: "Venue not found" });
    }

    const existingCheckin = await CheckIn.findOne({
      where: { userId, venueId, checkedOutAt: null },
      transaction: t,
    });
    if (existingCheckin) {
      await t.rollback();
      return res
        .status(400)
        .json({ error: "Already checked in to this venue" });
    }

    const newCheckin = await CheckIn.create(
      {
        userId,
        venueId,
        location: Sequelize.fn("ST_MakePoint", longitude, latitude),
      },
      { transaction: t }
    );

    await venue.update(
      {
        currentCheckins: Sequelize.literal("currentCheckins + 1"),
        totalCheckins: Sequelize.literal("totalCheckins + 1"),
      },
      { transaction: t }
    );

    if (req.user.role === "customer") {
      await req.user.update(
        {
          profile: {
            ...req.user.profile,
            totalCheckins: (req.user.profile.totalCheckins || 0) + 1,
          },
        },
        { transaction: t }
      );
    }

    await t.commit();

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
    await t.rollback();
    logger.error(error);
    next(error);
  }
};

const checkout = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const checkinId = req.params.id;
    const userId = req.user.id;

    const checkin = await CheckIn.findOne({
      where: { id: checkinId, userId, checkedOutAt: null },
      include: [Venue],
      transaction: t,
    });

    if (!checkin) {
      await t.rollback();
      return res.status(404).json({ error: "Active check-in not found" });
    }

    await checkin.update({ checkedOutAt: new Date() }, { transaction: t });

    await checkin.Venue.update(
      {
        currentCheckins: Sequelize.literal("currentCheckins - 1"),
      },
      { transaction: t }
    );

    await t.commit();

    req.app
      .get("io")
      .to(`venue_${checkin.venueId}`)
      .emit("checkout", {
        venueId: checkin.venueId,
        userId,
        currentCheckins: checkin.Venue.currentCheckins - 1,
      });

    res.status(200).json({ message: "Checked out successfully" });
  } catch (error) {
    await t.rollback();
    logger.error(error);
    next(error);
  }
};

const getCurrentCheckins = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const checkins = await CheckIn.findAll({
      where: { userId, checkedOutAt: null },
      include: [Venue],
    });
    res.status(200).json(checkins);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

module.exports = {
  checkIn,
  checkout,
  getCurrentCheckins,
};
