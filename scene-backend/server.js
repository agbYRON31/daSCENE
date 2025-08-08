require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const app = express();
const server = http.createServer(app);
const io = require("./config/websocket")(server);
const routes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const limiter = require("./config/rateLimiter");
const { connectDB } = require("./config/database");
const { setupSwagger } = require("./config/swagger");

// // Database connection
// connectDB();

// Middleware
// app.use(cors());
// Update CORS middleware to:
app.use(
  cors({
    origin: ["http://localhost:19006", "exp://192.168.1.100:19000"], // Add your Expo URLs
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);
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

// Rate limiting
app.use(limiter);

// WebSocket setup
app.set("io", io);

// Routes
app.use("/api", routes);

// Swagger documentation
setupSwagger(app);

// Error handling
app.use(errorHandler);

// Create uploads directory if it doesn't exist
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Add this before server.listen()
const seedDatabase = async () => {
  if (process.env.NODE_ENV !== "production") {
    const { User, Venue, Event, CheckIn, Promotion } = require("./models");

    try {
      // Clear existing data
      await CheckIn.destroy({ where: {} });
      await Promotion.destroy({ where: {} });
      await Event.destroy({ where: {} });
      await Venue.destroy({ where: {} });
      await User.destroy({ where: {} });

      // Create users
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

      // Create venues
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

      // Create events
      const events = await Event.bulkCreate([
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

      // Create check-ins
      await CheckIn.bulkCreate([
        { userId: users[0].id, venueId: venues[0].id, checkedInAt: new Date() },
        { userId: users[1].id, venueId: venues[0].id, checkedInAt: new Date() },
      ]);

      // Create promotions
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

// Call the seed function after DB connection
connectDB().then(seedDatabase);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
