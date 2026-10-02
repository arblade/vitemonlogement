// Mot de passe oublié : un lien signé, valable 1 heure et utilisable une seule fois. Rien n'est stocké : la signature
// couvre le compte, l'échéance et l'empreinte du mot de passe actuel ; dès que le mot de passe change (le lien a servi),
// la signature ne correspond plus.
import { checkSignature, signFor } from "./auth";
import { getUser } from "./users";

export const RESET_VALIDITY_MS = 60 * 60_000;

type Account = { id: number; passwordHash: string };

export function issueResetToken(user: Account, now = Date.now()) {
  const expires = Math.floor((now + RESET_VALIDITY_MS) / 1000);
  return `${user.id}.${expires}.${signFor("password-reset", `${user.id}.${expires}.${user.passwordHash}`)}`;
}

/** Le compte du lien, s'il est authentique, pas expiré et pas encore utilisé ; sinon null. */
export async function readResetToken(token: unknown, now = Date.now()) {
  if (typeof token !== "string") return null;
  const match = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(token);
  if (!match) return null;
  const [, id, expires, signature] = match;
  if (Number(expires) * 1000 < now) return null;
  const user = await getUser(Number(id));
  if (!user || !checkSignature("password-reset", `${id}.${expires}.${user.passwordHash}`, signature)) return null;
  return user;
}
