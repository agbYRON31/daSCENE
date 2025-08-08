module.exports = (sequelize, DataTypes) => {
  const PhotoLike = sequelize.define(
    "PhotoLike",
    {},
    {
      timestamps: true,
      indexes: [
        {
          fields: ["photoId", "userId"],
          unique: true,
        },
      ],
    }
  );

  PhotoLike.associate = (models) => {
    PhotoLike.belongsTo(models.Photo, {
      foreignKey: "photoId",
    });
    PhotoLike.belongsTo(models.User, {
      foreignKey: "userId",
    });
  };

  return PhotoLike;
};
