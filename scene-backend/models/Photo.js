module.exports = (sequelize, DataTypes) => {
  const Photo = sequelize.define(
    "Photo",
    {
      filename: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      thumbnailUrl: DataTypes.TEXT,
      caption: DataTypes.TEXT,
      views: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      featured: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
      },
      location: {
        type: DataTypes.GEOMETRY("POINT"),
      },
      metadata: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM("pending", "approved", "rejected"),
        defaultValue: "pending",
      },
    },
    {
      timestamps: true,
      indexes: [
        { fields: ["userId"] },
        { fields: ["venueId"] },
        { fields: ["createdAt"] },
      ],
    }
  );

  Photo.associate = (models) => {
    Photo.belongsTo(models.User, {
      foreignKey: "userId",
    });
    Photo.belongsTo(models.Venue, {
      foreignKey: "venueId",
    });
    Photo.hasMany(models.PhotoLike, {
      foreignKey: "photoId",
    });
  };
  // Class Methods
  Photo.createPhoto = async function ({
    userId,
    venueId,
    filename,
    url,
    caption,
    location,
  }) {
    return await this.create({
      userId,
      venueId,
      filename,
      url,
      thumbnailUrl: url, // In production, generate a thumbnail
      caption,
      location: location
        ? sequelize.fn("ST_MakePoint", location.lng, location.lat)
        : null,
      status: "approved", // In production, might be 'pending' for moderation
    });
  };

  Photo.getByVenue = async function (venueId, limit = 20, offset = 0) {
    return await this.findAll({
      where: { venueId, status: "approved" },
      limit,
      offset,
      include: [
        {
          model: sequelize.models.User,
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });
  };

  Photo.getByUser = async function (userId, limit = 20, offset = 0) {
    return await this.findAll({
      where: { userId },
      limit,
      offset,
      include: [
        {
          model: sequelize.models.Venue,
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });
  };

  Photo.getFeatured = async function (limit = 10) {
    return await this.findAll({
      where: { featured: true, status: "approved" },
      limit,
      include: [
        {
          model: sequelize.models.Venue,
          attributes: ["id", "name", "location"],
        },
        {
          model: sequelize.models.User,
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });
  };

  Photo.likePhoto = async function (photoId, userId) {
    const [like, created] = await sequelize.models.PhotoLike.findOrCreate({
      where: { photoId, userId },
      defaults: { photoId, userId },
    });

    if (created) {
      await this.increment("views", { where: { id: photoId } });
    }

    return like;
  };

  return Photo;
};
