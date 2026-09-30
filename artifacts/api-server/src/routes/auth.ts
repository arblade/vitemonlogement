import { Router, type IRouter } from "express";
import { checkPassword, clearSessionCookie, issueSession, passwordConfigured, readSession, SESSION_COOKIE, setSessionCookie } from "../lib/auth";
import { isProduction } from "../lib/env";
import { clientIp, consume } from "../lib/quota";

const router: IRouter = Router();
const LOGIN_ATTEMPTS = 10; // par IP et par 15 minutes : freine la recherche du mot de passe par force brute
const LOGIN_WINDOW_MS = 15 * 60_000;

router.post("/auth/login", async (req, res): Promise<void> => {
  if (!passwordConfigured()) {
    if (isProduction()) { res.status(503).json({ error: "Accès non configuré : définissez APP_PASSWORD sur le serveur." }); return; }
    res.json({ authenticated: true, required: false });
    return;
  }
  const attempt = await consume(`login:${clientIp(req)}`, LOGIN_WINDOW_MS);
  if (attempt.count > LOGIN_ATTEMPTS) {
    res.setHeader("Retry-After", String(attempt.retryAfterSeconds));
    res.status(429).json({ error: "Trop de tentatives. Réessayez plus tard.", retryAfterSeconds: attempt.retryAfterSeconds });
    return;
  }
  if (!checkPassword((req.body as { password?: unknown } | undefined)?.password)) {
    res.status(401).json({ error: "Mot de passe incorrect." });
    return;
  }
  setSessionCookie(res, issueSession());
  res.json({ authenticated: true, required: true });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

// Indique au front s'il faut afficher l'écran de mot de passe.
router.get("/auth/me", (req, res) => {
  if (!passwordConfigured()) {
    if (isProduction()) { res.status(503).json({ error: "Accès non configuré : définissez APP_PASSWORD sur le serveur." }); return; }
    res.json({ authenticated: true, required: false });
    return;
  }
  if (!readSession(req.cookies?.[SESSION_COOKIE])) { res.status(401).json({ authenticated: false, required: true }); return; }
  res.json({ authenticated: true, required: true });
});

export default router;
