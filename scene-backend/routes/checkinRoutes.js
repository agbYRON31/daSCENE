const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const {
  checkIn,
  checkout,
  getCurrentCheckins,
} = require("../controllers/checkinController");

router.post("/", authenticateToken, checkIn);
router.post("/:id/checkout", authenticateToken, checkout);
router.get("/current", authenticateToken, getCurrentCheckins);

module.exports = router;
