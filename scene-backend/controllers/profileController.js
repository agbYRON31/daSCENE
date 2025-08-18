const { User } = require("../models");
const logger = require("../utils/logger");

// Get current user's profile
const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.getById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

// Update current user's profile
const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // We expect the body to contain updates to allowed fields only (name, email, profile, preferences)
    const updates = req.body;

    const updatedUser = await User.updateProfile(userId, updates);
    if (!updatedUser) return res.status(404).json({ error: "User not found" });

    res.json(updatedUser);
  } catch (error) {
    logger.error(error);
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
};
