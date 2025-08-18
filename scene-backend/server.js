require("dotenv").config();
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const cors = require("cors"); // ✅ only once
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);

// Import rate limiter correctly
const { limiter } = require("./config/rateLimiter");
const io = require("./config/websocket")(server);
const routes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const { connectDB, sequelize } = require("./config");
const { setupSwagger } = require("./config/swagger");

// ===== CORS CONFIG =====
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without origin (e.g., mobile apps, curl)
      if (!origin) return callback(null, true);

      if (process.env.NODE_ENV === "development") {
        // Dev: allow localhost and LAN
        if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
          return callback(null, true);
        }
        const lanPattern = /^https?:\/\/(192\.168|10)\.\d+\.\d+(:\d+)?$/;
        if (lanPattern.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS (dev mode)"));
      } else {
        // Prod: allow only env CORS_ORIGIN
        if (origin === process.env.CORS_ORIGIN) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS (prod mode)"));
      }
    },
    credentials: true,
  })
);

// Security + parsing
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// Logging
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, "access.log"),
  { flags: "a" }
);
app.use(morgan("combined", { stream: accessLogStream }));

// Rate limiter
app.use(limiter);

// WebSocket
app.set("io", io);

app.get("/test", (req, res) => {
  res.json({ message: "Server is working!" });
});

// Routes
app.use("/api", routes);

// Swagger docs
setupSwagger(app);

// Error handler
app.use(errorHandler);

// Ensure uploads dir exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// ===== DATABASE SEED =====
const seedDatabase = async () => {
  if (process.env.NODE_ENV !== "production") {
    const { User, Venue, Event, CheckIn, Promotion } = require("./models");
    try {
      await CheckIn.destroy({ where: {} });
      await Promotion.destroy({ where: {} });
      await Event.destroy({ where: {} });
      await Venue.destroy({ where: {} });
      await User.destroy({ where: {} });

      const users = await User.bulkCreate([
        {
          email: "john@email.com",
          password: await bcrypt.hash("password123", 10),
          name: "John Doe",
          role: "customer",
          profile: { totalCheckins: 12, photosShared: 8, sceneScore: 4.8 },
        },
        {
          email: "sarah@email.com",
          password: await bcrypt.hash("password123", 10),
          name: "Sarah Johnson",
          role: "customer",
          profile: { totalCheckins: 5, photosShared: 3, sceneScore: 3.2 },
        },
        {
          email: "manager@venue.com",
          password: await bcrypt.hash("password123", 10),
          name: "Venue Manager",
          role: "venue_manager",
        },
      ]);

      const venues = await Venue.bulkCreate([
        {
          name: "Keys on Sunset",
          address: "8117 Sunset Blvd, West Hollywood, CA 90046",
          location: "Sunset Strip",
          type: "Nightclub",
          coordinates: sequelize.fn("ST_MakePoint", -118.3636, 34.0908),
          sceneScore: 8.5,
          totalCheckins: 156,
          currentCheckins: 42,
          totalPhotos: 87,
          verified: true,
          hours: {
            monday: { open: "20:00", close: "02:00" },
            friday: { open: "18:00", close: "02:00" },
            saturday: { open: "18:00", close: "02:00" },
          },
        },
        {
          name: "Poppy",
          address: "765 N La Cienega Blvd, West Hollywood, CA 90069",
          location: "West Hollywood",
          type: "Bar",
          coordinates: sequelize.fn("ST_MakePoint", -118.3769, 34.0836),
          sceneScore: 7.8,
          totalCheckins: 89,
          currentCheckins: 23,
          totalPhotos: 45,
          verified: true,
        },
      ]);

      await Event.bulkCreate([
        {
          title: "Saturday Night Fever",
          description:
            "The hottest party of the weekend featuring DJ Marcus and special guest performances",
          venueId: venues[0].id,
          date: new Date("2025-08-09T22:00:00Z"),
          capacity: 300,
          ticketTypes: [
            {
              name: "General Admission",
              price: 25,
              perks: ["Entry", "Welcome Drink"],
            },
            {
              name: "VIP Table",
              price: 150,
              perks: ["Reserved Table", "Bottle Service", "Skip Line"],
            },
          ],
          tags: ["Electronic", "Dance", "Weekend"],
        },
        {
          title: "VIP Launch Party",
          description:
            "Exclusive launch party for the new cocktail menu with celebrity guest DJs",
          venueId: venues[1].id,
          date: new Date("2025-08-15T20:00:00Z"),
          capacity: 100,
          ticketTypes: [
            {
              name: "VIP Access",
              price: 0,
              perks: ["Exclusive Access", "Complimentary Cocktails"],
            },
          ],
          tags: ["Cocktails", "VIP", "Launch"],
        },
      ]);

      await CheckIn.bulkCreate([
        { userId: users[0].id, venueId: venues[0].id, checkedInAt: new Date() },
        { userId: users[1].id, venueId: venues[0].id, checkedInAt: new Date() },
      ]);

      await Promotion.bulkCreate([
        {
          venueId: venues[0].id,
          title: "Happy Hour Special",
          description: "50% off all drinks from 5-7pm",
          type: "discount",
          startTime: "17:00",
          endTime: "19:00",
          validDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          createdBy: users[2].id,
        },
      ]);

      console.log("Database seeded successfully!");
    } catch (error) {
      console.error("Error seeding database:", error);
    }
  }
};

// Connect DB and seed
connectDB().then(seedDatabase);

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Network access: http://10.0.0.21:${PORT}`); // Your actual IP
  console.log(`Test endpoint: http://10.0.0.21:${PORT}/test`);
});
