// backend/routes/teacherProfileRoutes.js
import express from "express";
import {
  getMyProfile,
  updateMyProfile,
} from "../controllers/teacherProfileController.js";

const router = express.Router();

// No authRequired for now – single teacher / dev mode
router.get("/me", getMyProfile);
router.put("/me", updateMyProfile);
//router.get("/me", authRequired, getMyProfile);
//router.put("/me", authRequired, updateMyProfile);

export default router;
