import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import configRouter from "./config";
import housingRouter from "./housing";
import placesRouter from "./places";
import favoritesRouter from "./favorites";
import { mailPreferencesRouter, unsubscribeRouter } from "./mail";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(unsubscribeRouter); // lien des e-mails : sans connexion, protégé par sa signature
router.use(requireAuth); // tout ce qui suit exige la session ; /healthz et /auth/* restent publics
router.use(configRouter);
router.use(placesRouter);
router.use(favoritesRouter);
router.use(housingRouter);
router.use(mailPreferencesRouter);

export default router;
