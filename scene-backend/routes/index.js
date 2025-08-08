const express = require("express");
const router = express.Router();

const authRoutes = require("./authRoutes");
const venueRoutes = require("./venueRoutes");
const checkinRoutes = require("./checkinRoutes");
const photoRoutes = require("./photoRoutes");
const promotionRoutes = require("./promotionRoutes");
const analyticsRoutes = require("./analyticsRoutes");
const profileRoutes = require("./profileRoutes");

router.use("/auth", authRoutes);
router.use("/venues", venueRoutes);
router.use("/checkins", checkinRoutes);
router.use("/photos", photoRoutes);
router.use("/promotions", promotionRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/profile", profileRoutes);

module.exports = router;
