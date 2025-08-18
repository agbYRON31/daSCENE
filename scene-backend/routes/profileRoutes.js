const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const profileController = require("../controllers/profileController");
const { validate } = require("../middleware/validation");
const { profileUpdateSchema } = require("../utils/validationSchemas");

router.get("/", authenticateToken, profileController.getProfile);
router.put(
  "/",
  authenticateToken,
  express.json(),
  validate(profileUpdateSchema),
  profileController.updateProfile
);

module.exports = router;
