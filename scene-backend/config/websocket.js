// config/websocket.js
const socketio = require("socket.io");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config");
const { Op } = require("sequelize");

module.exports = function (server) {
  const io = socketio(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await socket.request.sequelize.models.User.findByPk(
        decoded.userId,
        {
          attributes: ["id", "email", "role", "venueId"],
        }
      );

      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      socket.user = user.get({ plain: true });
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    console.log(
      `New client connected: ${socket.id} (User: ${socket.user.email})`
    );

    // Join user-specific room for private messages
    socket.join(`user_${socket.user.id}`);

    // If user is a venue manager, join their venue room
    if (socket.user.role === "venue_manager" && socket.user.venueId) {
      socket.join(`venue_${socket.user.venueId}`);
      console.log(
        `Manager ${socket.user.id} joined venue room ${socket.user.venueId}`
      );
    }

    // Real-time check-in events
    socket.on("checkIn", async (data, callback) => {
      try {
        const { venueId, location } = data;

        // Verify venue exists
        const venue = await socket.request.sequelize.models.Venue.findByPk(
          venueId
        );
        if (!venue) {
          return callback({ error: "Venue not found" });
        }

        // Create check-in record
        const checkin = await socket.request.sequelize.models.CheckIn.checkIn(
          socket.user.id,
          venueId,
          location
        );

        // Update venue counts
        await venue.incrementCheckins();
        await socket.request.sequelize.models.User.incrementCheckins(
          socket.user.id
        );

        // Broadcast to venue room
        io.to(`venue_${venueId}`).emit("newCheckin", {
          userId: socket.user.id,
          venueId,
          checkinId: checkin.id,
          checkedInAt: checkin.checkedInAt,
          userName: socket.user.name, // You might want to fetch this from DB
        });

        // Send success response
        callback({ success: true, checkin });
      } catch (error) {
        console.error("Check-in error:", error);
        callback({ error: error.message });
      }
    });

    // Real-time check-out events
    socket.on("checkOut", async (checkinId, callback) => {
      try {
        const checkin = await socket.request.sequelize.models.CheckIn.checkOut(
          checkinId,
          socket.user.id
        );

        // Update venue counts
        await socket.request.sequelize.models.Venue.decrementCheckins(
          checkin.venueId
        );

        // Broadcast to venue room
        io.to(`venue_${checkin.venueId}`).emit("checkOut", {
          userId: socket.user.id,
          venueId: checkin.venueId,
          checkinId: checkin.id,
        });

        callback({ success: true });
      } catch (error) {
        console.error("Check-out error:", error);
        callback({ error: error.message });
      }
    });

    // Photo upload notifications
    socket.on("photoUploaded", async (data, callback) => {
      try {
        const { venueId, photoId } = data;

        // Verify photo and venue
        const photo = await socket.request.sequelize.models.Photo.findByPk(
          photoId,
          {
            include: [
              {
                model: socket.request.sequelize.models.Venue,
                where: { id: venueId },
              },
            ],
          }
        );

        if (!photo) {
          return callback({ error: "Photo not found" });
        }

        // Update venue photo count
        await photo.Venue.incrementPhotos();

        // Update user photo count if customer
        if (socket.user.role === "customer") {
          await socket.request.sequelize.models.User.incrementPhotos(
            socket.user.id
          );
        }

        // Broadcast to venue room
        io.to(`venue_${venueId}`).emit("newPhoto", {
          photoId: photo.id,
          userId: socket.user.id,
          url: photo.url,
          thumbnailUrl: photo.thumbnailUrl,
          caption: photo.caption,
          createdAt: photo.createdAt,
        });

        callback({ success: true });
      } catch (error) {
        console.error("Photo upload error:", error);
        callback({ error: error.message });
      }
    });

    // Promotion updates (venue managers only)
    socket.on("updatePromotion", async (data, callback) => {
      try {
        if (socket.user.role !== "venue_manager") {
          throw new Error("Only venue managers can update promotions");
        }

        const { promotionId, updates } = data;

        // Verify promotion belongs to manager's venue
        const promotion =
          await socket.request.sequelize.models.Promotion.findOne({
            where: {
              id: promotionId,
              venueId: socket.user.venueId,
              createdBy: socket.user.id,
            },
          });

        if (!promotion) {
          throw new Error("Promotion not found or unauthorized");
        }

        // Update promotion
        const updatedPromo =
          await socket.request.sequelize.models.Promotion.updatePromotion(
            promotionId,
            updates,
            socket.user.id
          );

        // Broadcast to venue room
        io.to(`venue_${socket.user.venueId}`).emit("promotionUpdated", {
          promotionId: updatedPromo.id,
          title: updatedPromo.title,
          active: updatedPromo.active,
          updatedAt: updatedPromo.updatedAt,
        });

        callback({ success: true, promotion: updatedPromo });
      } catch (error) {
        console.error("Promotion update error:", error);
        callback({ error: error.message });
      }
    });

    // Live analytics updates
    socket.on("subscribeToAnalytics", async (venueId, callback) => {
      try {
        if (
          socket.user.role !== "venue_manager" ||
          socket.user.venueId !== parseInt(venueId)
        ) {
          throw new Error("Unauthorized analytics access");
        }

        socket.join(`analytics_${venueId}`);
        console.log(
          `User ${socket.user.id} subscribed to analytics for venue ${venueId}`
        );

        // Send initial analytics data
        const analytics =
          await socket.request.sequelize.models.Analytics.getVenueAnalytics(
            venueId
          );
        socket.emit("analyticsData", analytics);

        callback({ success: true });
      } catch (error) {
        console.error("Analytics subscription error:", error);
        callback({ error: error.message });
      }
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(
        `Client disconnected: ${socket.id} (User: ${socket.user.email}, Reason: ${reason})`
      );

      // In a production app, you might handle automatic check-out here
      // if the user was checked in somewhere
    });

    // Error handling
    socket.on("error", (err) => {
      console.error(`Socket error for user ${socket.user.email}:`, err);
    });
  });

  // Helper function to emit events to specific venues from controllers
  io.emitToVenue = (venueId, event, data) => {
    io.to(`venue_${venueId}`).emit(event, data);
  };

  // Helper function to update analytics for all subscribers
  io.updateAnalytics = async (venueId) => {
    const analytics =
      await io.request.sequelize.models.Analytics.getVenueAnalytics(venueId);
    io.to(`analytics_${venueId}`).emit("analyticsUpdate", analytics);
  };

  return io;
};
