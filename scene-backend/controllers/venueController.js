const { Venue, Promotion, Photo } = require("../models");
const { Op, Sequelize } = require("sequelize");

// Get venues with optional geospatial filtering and pagination
const getVenues = async (req, res, next) => {
  try {
    const { lat, lng, radius = 10, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    let where = {};

    if (lat && lng) {
      where = {
        coordinates: {
          [Op.and]: [
            Sequelize.where(
              Sequelize.fn(
                "ST_DWithin",
                Sequelize.col("coordinates"),
                Sequelize.fn("ST_MakePoint", parseFloat(lng), parseFloat(lat)),
                radius * 1609.34 // miles to meters
              ),
              true
            ),
          ],
        },
      };
    }

    const venues = await Venue.findAll({
      where,
      include: [
        {
          model: Promotion,
          where: { active: true },
          required: false,
        },
        {
          model: Photo,
          limit: 5,
          order: [["createdAt", "DESC"]],
          required: false,
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    const totalCount = await Venue.count({ where });

    res.json({
      data: venues,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get a single venue by ID with related data
const getVenueById = async (req, res, next) => {
  try {
    const id = req.params.id;
    const venue = await Venue.getById(id);
    if (!venue) return res.status(404).json({ error: "Venue not found" });
    res.json(venue);
  } catch (error) {
    next(error);
  }
};

// Create a new venue
const createVenue = async (req, res, next) => {
  try {
    const venueData = req.body;
    // Optional: associate managerId from authenticated user if needed
    if (req.user) venueData.managerId = req.user.id;

    const venue = await Venue.createVenue(venueData);
    res.status(201).json(venue);
  } catch (error) {
    next(error);
  }
};

// Update an existing venue
const updateVenue = async (req, res, next) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    const managerId = req.user ? req.user.id : null;

    const venue = await Venue.updateVenue(id, updates, managerId);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    res.json(venue);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getVenues,
  getVenueById,
  createVenue,
  updateVenue,
};
