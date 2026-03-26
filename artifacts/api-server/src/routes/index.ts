import { Router, type IRouter } from "express";
import healthRouter from "./health";
import avatarsRouter from "./avatars";
import videosRouter from "./videos";
import settingsRouter from "./settings";
import previewAudioRouter from "./preview-audio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(avatarsRouter);
router.use(videosRouter);
router.use(settingsRouter);
router.use(previewAudioRouter);

export default router;
