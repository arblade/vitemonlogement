// Réglages d'exploitation, tous surchargeables par variables d'environnement.
export function intEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const isProduction = () => process.env.NODE_ENV === "production";
