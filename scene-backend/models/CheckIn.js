module.exports = (sequelize, DataTypes) => {
  const CheckIn = sequelize.define(
    "CheckIn",
    {
      checkedInAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      checkedOutAt: DataTypes.DATE,
      location: {
        type: DataTypes.GEOMETRY("POINT"),
      },
      duration: DataTypes.INTEGER, // in minutes
      rating: {
        type: DataTypes.INTEGER,
        validate: { min: 1, max: 5 },
      },
      review: DataTypes.TEXT,
      private: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      timestamps: true,
      indexes: [
        { fields: ["userId"] },
        { fields: ["venueId"] },
        { fields: ["checkedInAt"] },
      ],
    }
  );

  CheckIn.associate = (models) => {
    CheckIn.belongsTo(models.User, {
      foreignKey: "userId",
    });
    CheckIn.belongsTo(models.Venue, {
      foreignKey: "venueId",
    });
  };

  // Calculate duration before update if checking out
  CheckIn.beforeUpdate(async (checkin) => {
    if (checkin.checkedOutAt && !checkin.duration) {
      const duration = Math.floor(
        (checkin.checkedOutAt - checkin.checkedInAt) / (1000 * 60)
      );
      checkin.duration = duration;
    }
  });

  // Move these methods here from Venue.js:
  CheckIn.checkIn = async function (userId, venueId, location) {
    const existing = await this.findOne({
      where: { userId, venueId, checkedOutAt: null },
    });
    if (existing) throw new Error("User already checked in to this venue");

    return await this.create({
      userId,
      venueId,
      location: location
        ? sequelize.fn("ST_MakePoint", location.lng, location.lat)
        : null,
    });
  };

  CheckIn.checkOut = async function (checkinId, userId) {
    const checkin = await this.findByPk(checkinId);
    if (!checkin) throw new Error("Check-in not found");
    if (checkin.userId !== userId) throw new Error("Unauthorized check-out");
    if (checkin.checkedOutAt) throw new Error("Already checked out");

    checkin.checkedOutAt = new Date();
    await checkin.save();
    return checkin;
  };

  CheckIn.getCurrentCheckins = async function (userId) {
    return await this.findAll({
      where: { userId, checkedOutAt: null },
      include: [
        {
          model: sequelize.models.Venue,
          attributes: ["id", "name", "location", "type", "sceneScore"],
        },
      ],
      order: [["checkedInAt", "DESC"]],
    });
  };

  CheckIn.getVenueCheckins = async function (venueId, limit = 20) {
    return await this.findAll({
      where: { venueId, checkedOutAt: null },
      limit,
      include: [{ model: sequelize.models.User, attributes: ["id", "name"] }],
      order: [["checkedInAt", "DESC"]],
    });
  };

  CheckIn.getUserHistory = async function (userId, limit = 20) {
    return await this.findAll({
      where: { userId },
      limit,
      include: [
        {
          model: sequelize.models.Venue,
          attributes: ["id", "name", "location", "type"],
        },
      ],
      order: [["checkedInAt", "DESC"]],
    });
  };

  return CheckIn;
};
