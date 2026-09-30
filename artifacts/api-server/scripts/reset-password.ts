// Réinitialisation manuelle d'un mot de passe (pas de récupération par e-mail).
// Usage : DATABASE_URL=... pnpm --filter @workspace/api-server run user:reset-password <email> <nouveau-mot-de-passe>
import { eq } from "drizzle-orm";
import { openDatabase, users } from "@workspace/db";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/passwords";
import { normalizeEmail } from "../src/lib/users";

const [emailArg, password] = process.argv.slice(2);
if (!emailArg || !password) { console.error("Usage : user:reset-password <email> <nouveau-mot-de-passe>"); process.exit(1); }
if (password.length < PASSWORD_MIN_LENGTH) { console.error(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`); process.exit(1); }

const handle = await openDatabase();
await handle.migrate();
const updated = await handle.db.update(users).set({ passwordHash: await hashPassword(password) })
  .where(eq(users.email, normalizeEmail(emailArg))).returning({ id: users.id });
await handle.close();
if (!updated.length) { console.error(`Aucun compte pour ${emailArg}.`); process.exit(1); }
console.log(`Mot de passe de ${normalizeEmail(emailArg)} réinitialisé.`);
