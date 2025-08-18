module.exports = (sequelize, DataTypes) => {
  const RSVP = sequelize.define(
    "RSVP",
    {
      eventId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Events", // Make sure this matches your actual Event model/table name
          key: "id",
        },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      ticketType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      guestCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: {
          min: 0,
        },
      },
      status: {
        type: DataTypes.ENUM("confirmed", "cancelled", "pending"),
        defaultValue: "confirmed",
        allowNull: false,
      },
    },
    {
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["eventId", "userId"],
        },
      ],
    }
  );

  RSVP.associate = (models) => {
    RSVP.belongsTo(models.User, { foreignKey: "userId" });
    RSVP.belongsTo(models.Event, { foreignKey: "eventId" });
  };

  return RSVP;
};
