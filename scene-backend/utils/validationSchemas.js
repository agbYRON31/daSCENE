const Joi = require("joi");

const venueSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  address: Joi.string().min(10).max(200).required(),
  location: Joi.string().max(50),
  type: Joi.string()
    .valid("Nightclub", "Bar", "Lounge", "Restaurant", "Concert Hall")
    .required(),
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  hours: Joi.object().pattern(
    Joi.string().valid(
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ),
    Joi.object({
      open: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
      close: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    })
  ),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().min(2).max(50).required(),
  role: Joi.string().valid("customer", "venue_manager").default("customer"),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const checkinSchema = Joi.object({
  venueId: Joi.number().integer().positive().required(),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

const photoSchema = Joi.object({
  venueId: Joi.number().integer().positive().required(),
  caption: Joi.string().max(500),
});

const promotionSchema = Joi.object({
  venueId: Joi.number().integer().positive().required(),
  title: Joi.string().min(3).max(100).required(),
  description: Joi.string().max(500),
  type: Joi.string().valid("discount", "free", "bogo", "happy_hour").required(),
  startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  validDays: Joi.array().items(
    Joi.string().valid(
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    )
  ),
});

module.exports = {
  venueSchema,
  registerSchema,
  loginSchema,
  checkinSchema,
  photoSchema,
  promotionSchema,
  // Add other schemas...
};
