import { summarize } from "./engine";
import type { CaseResult, CheckStatus } from "./types";

export type Baseline = Record<string, CheckStatus>;

const ICON: Record<CheckStatus, string> = { ok: "✅", "échec": "❌", incertain: "❔" };

/** Contrôles qui passaient dans la référence et ne passent plus ; et l'inverse. */
export function compareWithBaseline(results: CaseResult[], baseline: Baseline) {
  const checks = results.flatMap(result => result.checks);
  return {
    regressions: checks.filter(check => baseline[check.id] === "ok" && check.status !== "ok"),
    progress: checks.filter(check => baseline[check.id] !== undefined && baseline[check.id] !== "ok" && check.status === "ok"),
    added: checks.filter(check => baseline[check.id] === undefined),
  };
}

export const toBaseline = (results: CaseResult[]): Baseline =>
  Object.fromEntries(results.flatMap(result => result.checks.map(check => [check.id, check.status])));

const cell = (value: unknown) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function markdownReport(results: CaseResult[], { date, baseline }: { date: string; baseline?: Baseline }) {
  const summary = summarize(results);
  const lines: string[] = [];
  lines.push(`# Banc d'essai de la pipeline de recherche — ${date}`, "");
  lines.push("Généré par `pnpm --filter @workspace/api-server bench:pipeline` (aucun appel payant). Chaque demande passe par le vrai code : `interpret()` (réponse du LLM rejouée), `actorRequest()`, `normalize()` et les filtres de lecture, `analyze()` (réponse d'IA simulée). Seul le filtrage fait par Le Bon Coin (cercle, type, fourchettes, mot cherché) et la profondeur de lecture sont modélisés.", "");
  lines.push("## Bilan", "");
  lines.push(`- **${summary.casesPassing} cas sur ${summary.cases}** entièrement réussis ; contrôles : ${summary.ok} ✅, ${summary.failed} ❌, ${summary.uncertain} ❔ (résultat imprévisible : acteur de secours).`);
  lines.push(`- Annonces qui devraient être montrées : **${summary.expectedVisible}**, dont **${summary.missed} perdues** en recherche ponctuelle (${summary.watchMissed} encore perdues avec la veille quotidienne) ; annonces montrées à tort : ${summary.wronglyShown}.`);
  lines.push(`- Où sont perdues les annonces attendues : ${Object.entries(summary.byStage).sort((a, b) => b[1] - a[1]).map(([stage, n]) => `${stage} ${n}`).join(" · ") || "nulle part"}.`);
  if (baseline) {
    const { regressions, progress, added } = compareWithBaseline(results, baseline);
    lines.push(`- Par rapport à la référence (baseline.json) : ${progress.length} progrès, **${regressions.length} régressions**, ${added.length} contrôles nouveaux.`);
    for (const check of regressions) lines.push(`  - ❌ régression : \`${check.id}\` — ${check.detail}`);
    for (const check of progress) lines.push(`  - ✅ progrès : \`${check.id}\``);
  }
  lines.push("");
  lines.push("## Synthèse par cas", "", "| Cas | Thème | Interprétation | Annonces | Statut |", "|---|---|---|---|---|");
  for (const result of results) {
    const interp = result.checks.filter(check => check.id.includes("/interprétation/"));
    const ads = result.checks.filter(check => check.id.includes("/annonce/"));
    const status = result.checks.some(check => check.status === "échec") ? "❌" : result.checks.some(check => check.status === "incertain") ? "❔" : "✅";
    lines.push(`| [${cell(result.id)}](#${result.id}) | ${cell(result.theme)} | ${interp.filter(c => c.status === "ok").length}/${interp.length} | ${ads.filter(c => c.status === "ok").length}/${ads.length} | ${status} |`);
  }
  lines.push("");
  let theme = "";
  for (const result of results) {
    if (result.theme !== theme) { theme = result.theme; lines.push(`## ${theme}`, ""); }
    lines.push(`<a id="${result.id}"></a>`, `### ${result.title} (\`${result.id}\`)`, "", `> ${result.prompt}`, "");
    if (result.why) lines.push(`*${result.why}*`, "");
    const c = result.criteria as Record<string, unknown>;
    const fmt = (min: unknown, max: unknown, unit: string) => min == null && max == null ? null : `${min ?? "…"}–${max ?? "…"} ${unit}`;
    const parts = [
      `lieu **${c.location || "—"}**`, c.propertyType ? `type ${c.propertyType}` : null,
      fmt(c.minPrice, c.maxPrice, "€"), fmt(c.minArea, c.maxArea, "m²"), fmt(c.minRooms, c.maxRooms, "pièces"),
      c.minBedrooms ? `≥ ${c.minBedrooms} chambres` : null, c.minEnergyClass ? `DPE ≤ ${c.minEnergyClass}` : null,
      `rayon ${c.radius} km`, c.keywords ? `mots-clés « ${c.keywords} »` : null,
    ].filter(Boolean);
    lines.push(`- **Interprétation** (LLM : ${result.llmOrigin}) : ${parts.join(" · ")}`);
    const wishes = (c.wishes as string[] | undefined) ?? [];
    if (wishes.length) lines.push(`- **Souhaits** : ${wishes.map(w => `« ${w} »`).join(", ")}`);
    const places = (c.places as string[] | undefined) ?? [];
    if (places.length) lines.push(`- **Lieux de vie** : ${places.join(" ; ")} `);
    const q = result.query;
    if (q.actor === "url") {
      const p = q.params;
      lines.push(`- **Requête Le Bon Coin** : centre ${q.center!.name} (${q.center!.lat.toFixed(4)}, ${q.center!.lon.toFixed(4)}), rayon **${q.radiusKm} km** · type \`${p.real_estate_type}\`${p.rooms ? ` · pièces \`${p.rooms}\`` : ""}${p.square ? ` · surface \`${p.square}\`` : ""}${p.price ? ` · prix \`${p.price}\`` : ""}${p.text ? ` · **mot obligatoire \`${p.text}\`**` : ""}`);
      lines.push(`- **Zone couverte** : ${q.communes.count} communes dont le centre est dans le cercle (${q.communes.names.join(", ")}${q.communes.count > q.communes.names.length ? "…" : ""})`);
    } else {
      lines.push(`- **Requête** : ⚠️ acteur de secours (lieu non reconnu), recherche par nom : \`${JSON.stringify(q.params)}\` — ni type, ni pièces, ni surface, ni pages suivantes`);
    }
    lines.push("", "| Contrôle | Résultat | Détail |", "|---|---|---|");
    for (const check of result.checks) lines.push(`| ${cell(check.label)} | ${ICON[check.status]} | ${cell(check.detail)} |`);
    const ads = result.ads.filter(ad => ad.distanceKm != null || ad.watchStage !== ad.stage);
    if (ads.length) {
      lines.push("", "<details><summary>Annonces : distance au centre, veille quotidienne</summary>", "", "| Annonce | Pourquoi | Distance | Recherche ponctuelle | Veille |", "|---|---|---|---|---|");
      for (const ad of result.ads) lines.push(`| ${cell(ad.id)} | ${cell(ad.note)} | ${ad.distanceKm == null ? "—" : `${ad.distanceKm} km`} | ${cell(ad.stage)} | ${cell(ad.watchStage)} |`);
      lines.push("", "</details>");
    }
    lines.push("");
  }
  return lines.join("\n");
}
