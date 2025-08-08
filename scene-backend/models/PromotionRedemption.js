module.exports = (sequelize, DataTypes) => {
  const PromotionRedemption = sequelize.define(
    "PromotionRedemption",
    {
      location: {
        type: DataTypes.GEOMETRY("POINT"),
      },
    },
    {
      timestamps: true,
    }
  );

  PromotionRedemption.associate = (models) => {
    PromotionRedemption.belongsTo(models.Promotion, {
      foreignKey: "promotionId",
    });
    PromotionRedemption.belongsTo(models.User, {
      foreignKey: "userId",
    });
  };

  return PromotionRedemption;
};
