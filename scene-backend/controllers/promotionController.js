const { Promotion, Venue, sequelize } = require("../models");
const logger = require("../utils/logger");
const { promotionSchema } = require("../utils/validationSchemas");

const createPromotion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { error } = promotionSchema.validate(req.body);
    if (error) {
      await t.rollback();
      return res.status(400).json({ error: error.details[0].message });
    }

    const { venueId, title, description, type, startTime, endTime, validDays } =
      req.body;

    const venue = await Venue.findOne({
      where: { id: venueId, managerId: req.user.id },
      transaction: t,
    });
    if (!venue) {
      await t.rollback();
      return res.status(403).json({ error: "Access denied" });
    }

    const promotion = await Promotion.create(
      {
        venueId,
        title,
        description,
        type,
        startTime,
        endTime,
        validDays,
        createdBy: req.user.id,
      },
      { transaction: t }
    );

    await t.commit();

    req.app.get("io").emitToVenue(venueId, "newPromotion", {
      id: promotion.id,
      title: promotion.title,
      description: promotion.description,
    });

    res.status(201).json(promotion);
  } catch (error) {
    await t.rollback();
    logger.error(error);
    next(error);
  }
};

const updatePromotion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const promotionId = req.params.id;
    const updates = req.body;

    const promotion = await Promotion.findByPk(promotionId, { transaction: t });
    if (!promotion) {
      await t.rollback();
      return res.status(404).json({ error: "Promotion not found" });
    }

    // Verify venue manager owns the venue linked to this promotion
    const venue = await Venue.findOne({
      where: { id: promotion.venueId, managerId: req.user.id },
      transaction: t,
    });
    if (!venue) {
      await t.rollback();
      return res.status(403).json({ error: "Access denied" });
    }

    const { error } = promotionSchema.validate(updates, {
      presence: "optional",
    });
    if (error) {
      await t.rollback();
      return res.status(400).json({ error: error.details[0].message });
    }

    await promotion.update(updates, { transaction: t });
    await t.commit();

    req.app.get("io").emitToVenue(venue.id, "updatePromotion", promotion);

    res.json(promotion);
  } catch (error) {
    await t.rollback();
    logger.error(error);
    next(error);
  }
};

const deletePromotion = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const promotionId = req.params.id;
    const promotion = await Promotion.findByPk(promotionId, { transaction: t });
    if (!promotion) {
      await t.rollback();
      return res.status(404).json({ error: "Promotion not found" });
    }

    // Verify venue manager owns the venue linked to this promotion
    const venue = await Venue.findOne({
      where: { id: promotion.venueId, managerId: req.user.id },
      transaction: t,
    });
    if (!venue) {
      await t.rollback();
      return res.status(403).json({ error: "Access denied" });
    }

    await promotion.destroy({ transaction: t });
    await t.commit();

    req.app
      .get("io")
      .emitToVenue(venue.id, "deletePromotion", { id: promotionId });

    res.status(204).end();
  } catch (error) {
    await t.rollback();
    logger.error(error);
    next(error);
  }
};

const getPromotions = async (req, res, next) => {
  try {
    // You can add filters here if needed, like active promotions or by venueId
    const promotions = await Promotion.findAll({
      where: {}, // add conditions as needed
      order: [["createdAt", "DESC"]],
    });
    res.json(promotions);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

const getPromotionById = async (req, res, next) => {
  try {
    const promotion = await Promotion.findByPk(req.params.id);
    if (!promotion)
      return res.status(404).json({ error: "Promotion not found" });
    res.json(promotion);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

module.exports = {
  createPromotion,
  updatePromotion,
  deletePromotion,
  getPromotions,
  getPromotionById,
};
