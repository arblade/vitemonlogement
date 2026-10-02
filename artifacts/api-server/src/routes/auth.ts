import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { checkInviteCode, clearSessionCookie, issueSession, passwordConfigured, readSession, SESSION_COOKIE, setSessionCookie, userIdFromVisitor, visitorIdForUser } from "../lib/auth";
import { isProduction } from "../lib/env";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "../lib/passwords";
import { clientIp, consume } from "../lib/quota";
import { createUser, findUserByEmail, getUser, isValidEmail, normalizeEmail } from "../lib/users";

const router: IRouter = Router();
const ATTEMPTS = 10; // par IP (et par e-mail pour la connexion) et par 15 minutes : freine la force brute, y compris sur le code d'invitation
const WINDOW_MS = 15 * 60_000;
const NOT_CONFIGURED = "Accès non configuré : définissez APP_PASSWORD sur le serveur.";

/** Compte une tentative ; répond 429 et renvoie false si la limite est dépassée. */
async function withinAttempts(req: Request, res: Response, ...keys: string[]) {
  for (const key of keys) {
    const attempt = await consume(key, WINDOW_MS);
    if (attempt.count > ATTEMPTS) {
      res.setHeader("Retry-After", String(attempt.retryAfterSeconds));
      res.status(429).json({ error: "Trop de tentatives. Réessayez plus tard.", retryAfterSeconds: attempt.retryAfterSeconds });
      return false;
    }
  }
  return true;
}

const field = (body: unknown, name: string) => {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : "";
};
const emailKey = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 32);

// Le lien d'invitation (/?invite=CODE) vérifie le code avant d'afficher le formulaire d'inscription.
router.get("/auth/invite", async (req, res): Promise<void> => {
  if (!passwordConfigured()) { res.status(isProduction() ? 503 : 200).json(isProduction() ? { error: NOT_CONFIGURED } : { valid: false }); return; }
  if (!await withinAttempts(req, res, `invite:${clientIp(req)}`)) return;
  res.json({ valid: checkInviteCode(req.query.code) });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  if (!passwordConfigured()) { res.status(503).json({ error: NOT_CONFIGURED }); return; }
  if (!await withinAttempts(req, res, `invite:${clientIp(req)}`)) return;
  if (!checkInviteCode(field(req.body, "code"))) { res.status(403).json({ error: "Code d’invitation invalide." }); return; }
  const email = normalizeEmail(field(req.body, "email"));
  const password = field(req.body, "password");
  if (!isValidEmail(email)) { res.status(400).json({ error: "Adresse e-mail invalide." }); return; }
  if (password.length < PASSWORD_MIN_LENGTH) { res.status(400).json({ error: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.` }); return; }
  if (password.length > PASSWORD_MAX_LENGTH) { res.status(400).json({ error: "Mot de passe trop long." }); return; }
  const user = await createUser(email, password);
  if (!user) { res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail." }); return; }
  setSessionCookie(res, issueSession(Date.now(), visitorIdForUser(user.id)));
  res.status(201).json({ authenticated: true, email: user.email });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  if (!passwordConfigured()) {
    if (isProduction()) { res.status(503).json({ error: NOT_CONFIGURED }); return; }
    res.json({ authenticated: true, required: false });
    return;
  }
  const email = normalizeEmail(field(req.body, "email"));
  if (!await withinAttempts(req, res, `login:${clientIp(req)}`, `login-email:${emailKey(email)}`)) return;
  const user = email ? await findUserByEmail(email) : undefined;
  // Même message et même travail (hachage) que l'e-mail existe ou non : on ne révèle pas quels comptes existent.
  const valid = user ? await verifyPassword(field(req.body, "password"), user.passwordHash) : (await verifyPassword("x", "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA"), false);
  if (!user || !valid) { res.status(401).json({ error: "E-mail ou mot de passe incorrect." }); return; }
  setSessionCookie(res, issueSession(Date.now(), visitorIdForUser(user.id)));
  res.json({ authenticated: true, required: true, email: user.email, mailAlerts: user.mailOptOutAt == null });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

// Indique au front s'il faut afficher l'écran de connexion, et qui est connecté.
router.get("/auth/me", async (req, res): Promise<void> => {
  if (!passwordConfigured()) {
    if (isProduction()) { res.status(503).json({ error: NOT_CONFIGURED }); return; }
    res.json({ authenticated: true, required: false });
    return;
  }
  const session = readSession(req.cookies?.[SESSION_COOKIE]);
  const userId = session ? userIdFromVisitor(session.visitorId) : null;
  const user = userId === null ? undefined : await getUser(userId);
  if (!user) { res.status(401).json({ authenticated: false, required: true }); return; }
  res.json({ authenticated: true, required: true, email: user.email, mailAlerts: user.mailOptOutAt == null });
});

export default router;
