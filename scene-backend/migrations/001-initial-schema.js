"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Enable PostGIS extension first
    try {
      await queryInterface.sequelize.query(
        "CREATE EXTENSION IF NOT EXISTS postgis"
      );
      console.log("PostGIS extension enabled");
    } catch (error) {
      console.warn("PostGIS extension not available, using standard columns");
    }

    // 1. Venues (no managerId FK yet)
    await queryInterface.createTable("Venues", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      address: { type: Sequelize.TEXT, allowNull: false },
      location: Sequelize.STRING,
      type: {
        type: Sequelize.ENUM(
          "Nightclub",
          "Bar",
          "Lounge",
          "Restaurant",
          "Concert Hall"
        ),
        allowNull: false,
      },
      coordinates: { type: Sequelize.GEOMETRY("POINT"), allowNull: false },
      sceneScore: {
        type: Sequelize.DECIMAL(3, 1),
        defaultValue: 0,
        validate: { min: 0, max: 10 },
      },
      totalCheckins: { type: Sequelize.INTEGER, defaultValue: 0 },
      currentCheckins: { type: Sequelize.INTEGER, defaultValue: 0 },
      totalPhotos: { type: Sequelize.INTEGER, defaultValue: 0 },
      verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      // managerId FK removed for now
      managerId: { type: Sequelize.INTEGER, allowNull: true },
      hours: { type: Sequelize.JSONB, defaultValue: {} },
      contact: { type: Sequelize.JSONB, defaultValue: {} },
      amenities: { type: Sequelize.ARRAY(Sequelize.STRING), defaultValue: [] },
      avgRating: { type: Sequelize.DECIMAL(3, 2), defaultValue: 0 },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 2. Users (no venueId FK yet)
    await queryInterface.createTable("Users", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      password: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      role: {
        type: Sequelize.ENUM("customer", "venue_manager"),
        defaultValue: "customer",
      },
      profile: {
        type: Sequelize.JSONB,
        defaultValue: {
          totalCheckins: 0,
          photosShared: 0,
          sceneScore: 0,
        },
      },
      // venueId FK removed for now
      venueId: { type: Sequelize.INTEGER, allowNull: true },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      lastLogin: Sequelize.DATE,
      deviceTokens: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: [],
      },
      preferences: {
        type: Sequelize.JSONB,
        defaultValue: {
          notifications: { checkins: true, promotions: true, photos: true },
          privacy: { shareLocation: true, shareCheckins: true },
        },
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 3. Events (no venueId FK yet)
    await queryInterface.createTable("Events", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: Sequelize.STRING, allowNull: false },
      description: Sequelize.TEXT,
      date: { type: Sequelize.DATE, allowNull: false },
      capacity: { type: Sequelize.INTEGER, allowNull: false },
      ticketTypes: {
        type: Sequelize.JSONB,
        defaultValue: [],
      },
      tags: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: [],
      },
      imageUrl: Sequelize.STRING,
      // venueId FK removed for now
      venueId: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 4. CheckIns (no FK for userId, venueId, eventId)
    await queryInterface.createTable("CheckIns", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      venueId: { type: Sequelize.INTEGER, allowNull: false },
      eventId: { type: Sequelize.INTEGER, allowNull: true },
      checkedInAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      checkedOutAt: Sequelize.DATE,
      location: { type: Sequelize.GEOMETRY("POINT") },
      duration: Sequelize.INTEGER,
      rating: {
        type: Sequelize.INTEGER,
        validate: { min: 1, max: 5 },
      },
      review: Sequelize.TEXT,
      private: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 5. Photos (no FK venueId, userId)
    await queryInterface.createTable("Photos", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      venueId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      filename: { type: Sequelize.STRING, allowNull: false },
      url: { type: Sequelize.TEXT, allowNull: false },
      thumbnailUrl: Sequelize.TEXT,
      caption: Sequelize.TEXT,
      views: { type: Sequelize.INTEGER, defaultValue: 0 },
      featured: { type: Sequelize.BOOLEAN, defaultValue: false },
      tags: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: [],
      },
      location: { type: Sequelize.GEOMETRY("POINT") },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      status: {
        type: Sequelize.ENUM("pending", "approved", "rejected"),
        defaultValue: "pending",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 6. PhotoLikes (no FK photoId, userId)
    await queryInterface.createTable("PhotoLikes", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      photoId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 7. Promotions (no FK venueId, createdBy)
    await queryInterface.createTable("Promotions", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      venueId: { type: Sequelize.INTEGER, allowNull: false },
      createdBy: { type: Sequelize.INTEGER, allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false },
      description: Sequelize.TEXT,
      type: {
        type: Sequelize.ENUM("discount", "free", "bogo", "happy_hour"),
        allowNull: false,
      },
      value: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      startTime: Sequelize.TIME,
      endTime: Sequelize.TIME,
      validDays: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: [],
      },
      startDate: Sequelize.DATEONLY,
      endDate: Sequelize.DATEONLY,
      active: { type: Sequelize.BOOLEAN, defaultValue: true },
      maxRedemptions: Sequelize.INTEGER,
      redemptions: { type: Sequelize.INTEGER, defaultValue: 0 },
      targetAudience: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 8. PromotionRedemptions (no FK promotionId, userId)
    await queryInterface.createTable("PromotionRedemptions", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      promotionId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      location: { type: Sequelize.GEOMETRY("POINT") },
      redeemedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 9. Analytics (no FK venueId)
    await queryInterface.createTable("Analytics", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      venueId: { type: Sequelize.INTEGER, allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      metrics: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      demographics: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Add all foreign key constraints now

    // Users.venueId -> Venues.id
    await queryInterface.addConstraint("Users", {
      fields: ["venueId"],
      type: "foreign key",
      name: "fk_users_venueId",
      references: { table: "Venues", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Venues.managerId -> Users.id
    await queryInterface.addConstraint("Venues", {
      fields: ["managerId"],
      type: "foreign key",
      name: "fk_venues_managerId",
      references: { table: "Users", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Events.venueId -> Venues.id
    await queryInterface.addConstraint("Events", {
      fields: ["venueId"],
      type: "foreign key",
      name: "fk_events_venueId",
      references: { table: "Venues", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // CheckIns.userId -> Users.id
    await queryInterface.addConstraint("CheckIns", {
      fields: ["userId"],
      type: "foreign key",
      name: "fk_checkins_userId",
      references: { table: "Users", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // CheckIns.venueId -> Venues.id
    await queryInterface.addConstraint("CheckIns", {
      fields: ["venueId"],
      type: "foreign key",
      name: "fk_checkins_venueId",
      references: { table: "Venues", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // CheckIns.eventId -> Events.id
    await queryInterface.addConstraint("CheckIns", {
      fields: ["eventId"],
      type: "foreign key",
      name: "fk_checkins_eventId",
      references: { table: "Events", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Photos.venueId -> Venues.id
    await queryInterface.addConstraint("Photos", {
      fields: ["venueId"],
      type: "foreign key",
      name: "fk_photos_venueId",
      references: { table: "Venues", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Photos.userId -> Users.id
    await queryInterface.addConstraint("Photos", {
      fields: ["userId"],
      type: "foreign key",
      name: "fk_photos_userId",
      references: { table: "Users", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // PhotoLikes.photoId -> Photos.id
    await queryInterface.addConstraint("PhotoLikes", {
      fields: ["photoId"],
      type: "foreign key",
      name: "fk_photolikes_photoId",
      references: { table: "Photos", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // PhotoLikes.userId -> Users.id
    await queryInterface.addConstraint("PhotoLikes", {
      fields: ["userId"],
      type: "foreign key",
      name: "fk_photolikes_userId",
      references: { table: "Users", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Promotions.venueId -> Venues.id
    await queryInterface.addConstraint("Promotions", {
      fields: ["venueId"],
      type: "foreign key",
      name: "fk_promotions_venueId",
      references: { table: "Venues", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Promotions.createdBy -> Users.id
    await queryInterface.addConstraint("Promotions", {
      fields: ["createdBy"],
      type: "foreign key",
      name: "fk_promotions_createdBy",
      references: { table: "Users", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // PromotionRedemptions.promotionId -> Promotions.id
    await queryInterface.addConstraint("PromotionRedemptions", {
      fields: ["promotionId"],
      type: "foreign key",
      name: "fk_promotionredemptions_promotionId",
      references: { table: "Promotions", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // PromotionRedemptions.userId -> Users.id
    await queryInterface.addConstraint("PromotionRedemptions", {
      fields: ["userId"],
      type: "foreign key",
      name: "fk_promotionredemptions_userId",
      references: { table: "Users", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Analytics.venueId -> Venues.id
    await queryInterface.addConstraint("Analytics", {
      fields: ["venueId"],
      type: "foreign key",
      name: "fk_analytics_venueId",
      references: { table: "Venues", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Add indexes (unchanged from your original migration)

    await queryInterface.addIndex("Venues", ["coordinates"], {
      using: "GIST",
      name: "venues_coordinates_gist_index",
    });

    await queryInterface.addIndex("CheckIns", ["userId"], {
      name: "checkins_user_index",
    });

    await queryInterface.addIndex("CheckIns", ["venueId"], {
      name: "checkins_venue_index",
    });

    await queryInterface.addIndex("CheckIns", ["checkedInAt"], {
      name: "checkins_checked_in_index",
    });

    await queryInterface.addIndex("Photos", ["userId"], {
      name: "photos_user_index",
    });

    await queryInterface.addIndex("Photos", ["venueId"], {
      name: "photos_venue_index",
    });

    await queryInterface.addIndex("Photos", ["createdAt"], {
      name: "photos_created_index",
    });

    await queryInterface.addIndex("PhotoLikes", ["photoId", "userId"], {
      unique: true,
      name: "photo_likes_unique_index",
    });

    await queryInterface.addIndex("Analytics", ["venueId", "date"], {
      unique: true,
      name: "analytics_venue_date_unique_index",
    });
  },

  down: async (queryInterface) => {
    // Drop tables in reverse order
    await queryInterface.dropTable("Analytics");
    await queryInterface.dropTable("PromotionRedemptions");
    await queryInterface.dropTable("Promotions");
    await queryInterface.dropTable("PhotoLikes");
    await queryInterface.dropTable("Photos");
    await queryInterface.dropTable("CheckIns");
    await queryInterface.dropTable("Events");
    await queryInterface.dropTable("Users");
    await queryInterface.dropTable("Venues");
  },
};
