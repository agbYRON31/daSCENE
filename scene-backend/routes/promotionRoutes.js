const express = require("express");
const router = express.Router();
const {
  authenticateToken,
  authorizeVenueManager,
} = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { promotionSchema } = require("../utils/validationSchemas");

const promotionController = require("../controllers/promotionController");

router.get("/", promotionController.getPromotions);
router.get("/:id", promotionController.getPromotionById);

router.post(
  "/",
  authenticateToken,
  authorizeVenueManager,
  validate(promotionSchema),
  promotionController.createPromotion
);

router.put(
  "/:id",
  authenticateToken,
  authorizeVenueManager,
  validate(promotionSchema),
  promotionController.updatePromotion
);

router.delete(
  "/:id",
  authenticateToken,
  authorizeVenueManager,
  promotionController.deletePromotion
);

module.exports = router;
