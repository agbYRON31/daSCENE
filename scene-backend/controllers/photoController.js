const { Photo, Venue, User } = require("../models");
const logger = require("../utils/logger");
const { photoSchema } = require("../utils/validationSchemas");
const { cacheMiddleware } = require("../services/cacheService");

const uploadPhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No photo uploaded" });
    }

    const { error } = photoSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { venueId, caption } = req.body;
    const userId = req.user.id;

    const venue = await Venue.findByPk(venueId);
    if (!venue) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Venue not found" });
    }

    const newPhoto = await Photo.create({
      userId,
      venueId,
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      caption,
      metadata: {
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });

    await venue.increment("totalPhotos");

    if (req.user.role === "customer") {
      await req.user.update({
        profile: {
          ...req.user.profile,
          photosShared: (req.user.profile.photosShared || 0) + 1,
        },
      });
    }

    // Clear venue photos cache
    req.app.get("cache").del(`/api/venues/${venueId}/photos`);

    res.status(201).json(newPhoto);
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    logger.error(error);
    next(error);
  }
};

const getVenuePhotos = [
  cacheMiddleware(300),
  async (req, res, next) => {
    try {
      const venueId = parseInt(req.params.id);
      const photos = await Photo.findAll({
        where: { venueId },
        order: [["createdAt", "DESC"]],
        include: [
          {
            model: User,
            attributes: ["id", "name"],
          },
        ],
      });

      res.json(photos);
    } catch (error) {
      logger.error(error);
      next(error);
    }
  },
];

module.exports = {
  uploadPhoto,
  getVenuePhotos,
};
