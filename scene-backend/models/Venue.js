const { Op } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  const Venue = sequelize.define(
    "Venue",
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      location: DataTypes.STRING,
      type: {
        type: DataTypes.ENUM(
          "Nightclub",
          "Bar",
          "Lounge",
          "Restaurant",
          "Concert Hall"
        ),
        allowNull: false,
      },
      coordinates: {
        type: DataTypes.GEOMETRY("POINT"),
        allowNull: false,
      },
      sceneScore: {
        type: DataTypes.DECIMAL(3, 1),
        defaultValue: 0,
        validate: { min: 0, max: 10 },
      },
      totalCheckins: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      currentCheckins: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      totalPhotos: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      hours: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      contact: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      amenities: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
      },
      avgRating: {
        type: DataTypes.DECIMAL(3, 2),
        defaultValue: 0,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      timestamps: true,
      indexes: [
        {
          fields: ["coordinates"],
          using: "GIST",
        },
      ],
    }
  );

  Venue.associate = (models) => {
    Venue.belongsTo(models.User, {
      as: "manager",
      foreignKey: "managerId",
    });
    Venue.hasMany(models.CheckIn, {
      foreignKey: "venueId",
    });
    Venue.hasMany(models.Photo, {
      foreignKey: "venueId",
    });
    Venue.hasMany(models.Promotion, {
      foreignKey: "venueId",
    });
    Venue.hasMany(models.Analytics, {
      foreignKey: "venueId",
    });
  };

  // Class Methods
  Venue.createVenue = async function (venueData) {
    return await this.create(venueData);
  };

  Venue.findNearby = async function (lat, lng, radius = 10) {
    return await this.findAll({
      where: sequelize.where(
        sequelize.fn(
          "ST_DWithin",
          sequelize.col("coordinates"),
          sequelize.fn("ST_MakePoint", lng, lat),
          radius / 69 // miles to degrees approximation
        ),
        true
      ),
      order: [
        [
          sequelize.fn(
            "ST_Distance",
            sequelize.col("coordinates"),
            sequelize.fn("ST_MakePoint", lng, lat)
          ),
          "ASC",
        ],
      ],
      include: [
        {
          model: sequelize.models.Promotion,
          where: { active: true },
          required: false,
          attributes: ["id", "title", "description", "type", "value"],
        },
        {
          model: sequelize.models.User,
          as: "manager",
          attributes: ["id", "name", "email"],
        },
      ],
    });
  };

  Venue.getById = async function (id) {
    return await this.findByPk(id, {
      include: [
        {
          model: sequelize.models.User,
          as: "manager",
          attributes: ["id", "name", "email"],
        },
        {
          model: sequelize.models.Promotion,
          where: { active: true },
          required: false,
          attributes: ["id", "title", "description", "type", "value"],
        },
        {
          model: sequelize.models.Photo,
          limit: 10,
          order: [["createdAt", "DESC"]],
          attributes: ["id", "url", "thumbnailUrl", "caption", "createdAt"],
        },
      ],
    });
  };

  Venue.updateVenue = async function (id, updates, managerId) {
    const venue = await this.findByPk(id);
    if (!venue) return null;

    // Verify manager owns this venue
    if (managerId && venue.managerId !== managerId) {
      throw new Error("Unauthorized venue update");
    }

    const allowedUpdates = [
      "name",
      "address",
      "location",
      "type",
      "coordinates",
      "hours",
      "contact",
      "amenities",
      "verified",
      "isActive",
    ];

    allowedUpdates.forEach((update) => {
      if (updates[update] !== undefined) {
        venue[update] = updates[update];
      }
    });

    await venue.save();
    return venue;
  };

  Venue.incrementCheckins = async function (id) {
    const venue = await this.findByPk(id);
    if (!venue) return null;

    venue.totalCheckins += 1;
    venue.currentCheckins += 1;
    await venue.save();
    return venue;
  };

  Venue.decrementCheckins = async function (id) {
    const venue = await this.findByPk(id);
    if (!venue) return null;

    venue.currentCheckins = Math.max(0, venue.currentCheckins - 1);
    await venue.save();
    return venue;
  };

  Venue.incrementPhotos = async function (id) {
    const venue = await this.findByPk(id);
    if (!venue) return null;

    venue.totalPhotos += 1;
    await venue.save();
    return venue;
  };

  Venue.search = async function (query, limit = 10) {
    return await this.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${query}%` } },
          { location: { [Op.iLike]: `%${query}%` } },
          { type: { [Op.iLike]: `%${query}%` } },
        ],
        isActive: true,
      },
      limit,
      include: [
        {
          model: sequelize.models.Promotion,
          where: { active: true },
          required: false,
          attributes: ["id", "title"],
        },
      ],
    });
  };

  return Venue;
};
