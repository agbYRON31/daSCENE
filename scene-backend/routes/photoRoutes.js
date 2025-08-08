const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticateToken } = require("../middleware/auth");
const {
  uploadPhoto,
  getVenuePhotos,
} = require("../controllers/photoController");

const upload = multer({ dest: "uploads/" });

router.post("/", authenticateToken, upload.single("photo"), uploadPhoto);
router.get("/venues/:id/photos", getVenuePhotos);

module.exports = router;
