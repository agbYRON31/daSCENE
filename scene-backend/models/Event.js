module.exports = (sequelize, DataTypes) => {
  const Event = sequelize.define(
    "Event",
    {
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: DataTypes.TEXT,
      date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      capacity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ticketTypes: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
      },
      imageUrl: DataTypes.STRING,
    },
    {
      timestamps: true,
    }
  );

  Event.associate = (models) => {
    Event.belongsTo(models.Venue, {
      foreignKey: "venueId",
    });
    Event.hasMany(models.CheckIn, {
      foreignKey: "eventId",
    });
  };

  return Event;
};
