module.exports = (sequelize, DataTypes) => {
  const Analytics = sequelize.define(
    "Analytics",
    {
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      metrics: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      demographics: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      timestamps: true,
      indexes: [
        {
          fields: ["venueId", "date"],
          unique: true,
        },
      ],
    }
  );

  Analytics.associate = (models) => {
    Analytics.belongsTo(models.Venue, {
      foreignKey: "venueId",
    });
  };

  // Class Methods
  Analytics.getVenueAnalytics = async function (venueId) {
    // Weekly check-ins
    const weeklyCheckins = await sequelize.query(
      `
        SELECT 
          DATE_TRUNC('day', "checkedInAt") AS date,
          COUNT(*) AS checkins
        FROM "CheckIns"
        WHERE "venueId" = :venueId
        AND "checkedInAt" >= NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', "checkedInAt")
        ORDER BY date ASC
      `,
      {
        replacements: { venueId },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    // Hourly traffic
    const hourlyTraffic = await sequelize.query(
      `
        SELECT 
          EXTRACT(HOUR FROM "checkedInAt") AS hour,
          COUNT(*) AS users
        FROM "CheckIns"
        WHERE "venueId" = :venueId
        GROUP BY EXTRACT(HOUR FROM "checkedInAt")
        ORDER BY hour ASC
      `,
      {
        replacements: { venueId },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    // Current stats
    const venue = await sequelize.models.Venue.findByPk(venueId, {
      attributes: [
        "totalCheckins",
        "currentCheckins",
        "totalPhotos",
        "sceneScore",
      ],
    });

    // Promotions performance
    const promotions = await sequelize.models.Promotion.findAll({
      where: { venueId },
      attributes: ["id", "title", "redemptions", "startDate", "endDate"],
      order: [["createdAt", "DESC"]],
      limit: 5,
    });

    return {
      weeklyCheckins,
      hourlyTraffic,
      venueStats: venue,
      promotions,
    };
  };

  Analytics.recordDailyMetrics = async function (venueId) {
    const today = new Date().toISOString().split("T")[0];

    // Check if already recorded today
    const existing = await this.findOne({
      where: { venueId, date: today },
    });

    if (existing) return existing;

    // Get today's metrics
    const checkins = await sequelize.models.CheckIn.count({
      where: {
        venueId,
        checkedInAt: {
          [sequelize.Op.between]: [
            new Date(`${today}T00:00:00.000Z`),
            new Date(`${today}T23:59:59.999Z`),
          ],
        },
      },
    });

    const photos = await sequelize.models.Photo.count({
      where: {
        venueId,
        createdAt: {
          [sequelize.Op.between]: [
            new Date(`${today}T00:00:00.000Z`),
            new Date(`${today}T23:59:59.999Z`),
          ],
        },
      },
    });

    // Get demographics (simplified example)
    const demographics = await sequelize.query(
      `
        SELECT 
          EXTRACT(YEAR FROM AGE("Users"."createdAt")) AS age,
          COUNT(*) AS count
        FROM "CheckIns"
        JOIN "Users" ON "CheckIns"."userId" = "Users"."id"
        WHERE "CheckIns"."venueId" = :venueId
        AND "CheckIns"."checkedInAt" >= NOW() - INTERVAL '30 days'
        GROUP BY age
      `,
      {
        replacements: { venueId },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    return await this.create({
      venueId,
      date: today,
      metrics: { checkins, photos },
      demographics,
    });
  };

  return Analytics;
};
