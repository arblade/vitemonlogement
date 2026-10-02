import { logger } from "./logger";

/**
 * Envoi d'e-mails par Resend (API REST, sans dépendance). Seule RESEND_API_KEY est nécessaire ; sans elle, rien ne part
 * et l'e-mail est seulement noté dans les journaux (le site fonctionne pareil). Réglages facultatifs :
 *  - MAIL_FROM : expéditeur, « Vite mon logement <alertes@vitemonlogement.fr> » par défaut (domaine vérifié chez Resend) ;
 *  - MAIL_REPLY_TO : adresse de réponse ;
 *  - ALERT_EMAIL : reçoit les alertes d'exploitation (relèves en échec à répétition) ;
 *  - PUBLIC_URL : adresse du site dans les liens (sinon celle que Render fournit, RENDER_EXTERNAL_URL).
 */
export const DEFAULT_FROM = "Vite mon logement <alertes@vitemonlogement.fr>";

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Même clé, même e-mail : Resend ne l'envoie qu'une fois (24 h), même si on le redemande après une panne. */
  idempotencyKey: string;
};

export class MailError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Adresse publique du site, pour les liens des e-mails (sans « / » final). */
export function publicOrigin() {
  for (const value of [process.env.PUBLIC_URL, process.env.RENDER_EXTERNAL_URL]) {
    const origin = value?.trim().replace(/\/+$/, "");
    if (origin && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return origin;
  }
  return `http://localhost:${process.env.PORT ?? "8080"}`;
}

/** Envoie l'e-mail ; renvoie l'identifiant Resend, ou null si l'envoi n'est pas configuré. */
export async function sendMail(mail: Mail): Promise<string | null> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    logger.info({ to: mail.to, subject: mail.subject }, "E-mail not sent: RESEND_API_KEY is not set");
    return null;
  }
  const base = (process.env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/+$/, "");
  const response = await fetch(`${base}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": mail.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({
      from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(process.env.MAIL_REPLY_TO?.trim() ? { reply_to: process.env.MAIL_REPLY_TO.trim() } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as { id?: string; message?: string; name?: string } | null;
  if (!response.ok) throw new MailError(`Resend ${response.status}: ${body?.name ?? ""} ${body?.message ?? ""}`.trim(), response.status);
  return body?.id ?? "";
}
