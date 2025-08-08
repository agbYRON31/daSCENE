module.exports = (sequelize, DataTypes) => {
  const Promotion = sequelize.define(
    "Promotion",
    {
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: DataTypes.TEXT,
      type: {
        type: DataTypes.ENUM("discount", "free", "bogo", "happy_hour"),
        allowNull: false,
      },
      value: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      startTime: DataTypes.TIME,
      endTime: DataTypes.TIME,
      validDays: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
      },
      startDate: DataTypes.DATEONLY,
      endDate: DataTypes.DATEONLY,
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      maxRedemptions: DataTypes.INTEGER,
      targetAudience: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      timestamps: true,
      indexes: [
        { fields: ["venueId"] },
        { fields: ["active"] },
        { fields: ["startDate", "endDate"] },
      ],
    }
  );

  Promotion.associate = (models) => {
    Promotion.belongsTo(models.Venue, {
      foreignKey: "venueId",
    });
    Promotion.belongsTo(models.User, {
      as: "creator",
      foreignKey: "createdBy",
    });
    Promotion.hasMany(models.PromotionRedemption, {
      foreignKey: "promotionId",
    });
  };

  // Class Methods
  Promotion.createPromotion = async function (promotionData) {
    return await this.create(promotionData);
  };

  Promotion.getByVenue = async function (venueId, activeOnly = true) {
    const where = { venueId };
    if (activeOnly) {
      where.active = true;
      where.startDate = { [sequelize.Op.lte]: new Date() };
      where.endDate = { [sequelize.Op.gte]: new Date() };
    }

    return await this.findAll({
      where,
      include: [
        {
          model: sequelize.models.User,
          as: "creator",
          attributes: ["id", "name"],
        },
      ],
      order: [["startDate", "ASC"]],
    });
  };

  Promotion.updatePromotion = async function (id, updates, userId) {
    const promotion = await this.findByPk(id);
    if (!promotion) return null;

    // Verify user created this promotion
    if (promotion.createdBy !== userId) {
      throw new Error("Unauthorized promotion update");
    }

    const allowedUpdates = [
      "title",
      "description",
      "type",
      "value",
      "startTime",
      "endTime",
      "validDays",
      "startDate",
      "endDate",
      "active",
      "maxRedemptions",
      "targetAudience",
    ];

    allowedUpdates.forEach((update) => {
      if (updates[update] !== undefined) {
        promotion[update] = updates[update];
      }
    });

    await promotion.save();
    return promotion;
  };

  Promotion.redeem = async function (promotionId, userId, location) {
    const promotion = await this.findByPk(promotionId);
    if (!promotion || !promotion.active) {
      throw new Error("Promotion not available");
    }

    // Check date validity
    const today = new Date();
    if (promotion.startDate > today || promotion.endDate < today) {
      throw new Error("Promotion not valid today");
    }

    // Check if user already redeemed
    const existing = await sequelize.models.PromotionRedemption.findOne({
      where: { promotionId, userId },
    });

    if (existing) {
      throw new Error("Promotion already redeemed");
    }

    // Create redemption record
    await sequelize.models.PromotionRedemption.create({
      promotionId,
      userId,
      location: location
        ? sequelize.fn("ST_MakePoint", location.lng, location.lat)
        : null,
    });

    // Increment redemption count
    promotion.redemptions = (promotion.redemptions || 0) + 1;
    await promotion.save();

    return promotion;
  };

  return Promotion;
};
