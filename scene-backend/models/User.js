const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config");

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    "User",
    {
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM("customer", "venue_manager"),
        defaultValue: "customer",
      },
      profile: {
        type: DataTypes.JSONB,
        defaultValue: {
          totalCheckins: 0,
          photosShared: 0,
          sceneScore: 0,
        },
      },
      venueId: DataTypes.INTEGER,
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      lastLogin: DataTypes.DATE,
      deviceTokens: DataTypes.ARRAY(DataTypes.STRING),
      preferences: {
        type: DataTypes.JSONB,
        defaultValue: {
          notifications: {
            checkins: true,
            promotions: true,
            photos: true,
          },
          privacy: {
            shareLocation: true,
            shareCheckins: true,
          },
        },
      },
    },
    {
      timestamps: true,
    }
  );

  User.associate = (models) => {
    User.belongsTo(models.Venue, { foreignKey: "venueId" });
    User.hasMany(models.CheckIn, { foreignKey: "userId" });
    User.hasMany(models.Photo, { foreignKey: "userId" });
    User.hasMany(models.Promotion, { foreignKey: "createdBy" });
  };

  User.findByEmail = async function (email) {
    return await this.findOne({ where: { email } });
  };

  User.register = async function ({
    email,
    password,
    name,
    role = "customer",
  }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return await this.create({
      email,
      password: hashedPassword,
      name,
      role,
      profile:
        role === "customer"
          ? {
              totalCheckins: 0,
              photosShared: 0,
              sceneScore: 0,
            }
          : null,
    });
  };

  User.prototype.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  User.prototype.generateAuthToken = function () {
    return jwt.sign(
      { userId: this.id, email: this.email, role: this.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
  };

  User.prototype.getPublicProfile = function () {
    const values = Object.assign({}, this.get());
    delete values.password;
    return values;
  };

  // Instance Methods
  User.prototype.incrementCheckins = async function () {
    if (this.role === "customer" && this.profile) {
      this.profile.totalCheckins += 1;
      await this.save();
    }
  };

  User.prototype.incrementPhotos = async function () {
    if (this.role === "customer" && this.profile) {
      this.profile.photosShared += 1;
      await this.save();
    }
  };

  // Query Methods
  User.getAll = async function () {
    return await this.findAll({
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
    });
  };

  User.getById = async function (id) {
    return await this.findByPk(id, {
      attributes: { exclude: ["password"] },
      include: [
        {
          model: sequelize.models.Venue,
          as: "Venue",
          attributes: ["id", "name"],
        },
      ],
    });
  };

  User.updateProfile = async function (id, updates) {
    const user = await this.findByPk(id);
    if (!user) return null;

    const allowedUpdates = ["name", "email", "profile", "preferences"];
    allowedUpdates.forEach((update) => {
      if (updates[update] !== undefined) {
        user[update] = updates[update];
      }
    });

    await user.save();
    return user.getPublicProfile();
  };

  User.getVenueManagers = async function () {
    return await this.findAll({
      where: { role: "venue_manager" },
      attributes: ["id", "name", "email", "venueId"],
      include: [
        {
          model: sequelize.models.Venue,
          as: "Venue",
          attributes: ["id", "name"],
        },
      ],
    });
  };

  return User;
};
