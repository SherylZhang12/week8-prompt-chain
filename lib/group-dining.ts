import { parsePreferences, rankRestaurants, type OsmElement, type Restaurant } from "./restaurant-search";
export type Diner = { id: string; name: string; wants: string; avoids: string; restrictions: string; notes: string };
export type GroupRestaurant = Restaurant & { matchedDiners: string[]; unmatchedDiners: string[]; groupScore: number };
export type DinerOrder = { dinerId: string; ideas: string[]; adjustments: string; reason: string };
export type GroupOrder = { summary: string; diners: DinerOrder[]; sharing: string[]; checks: string[] };
export type OrderResult = { error?: string; plan?: GroupOrder };
export function readDiners(value: unknown): Diner[] {
  if (typeof value !== "string" || value.length > 16000) throw new Error("Check your dining group details.");
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { throw new Error("Check your dining group details."); }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 12) throw new Error("Add between 1 and 12 diners per search.");
  const ids = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Check each diner's details.");
    const read = (key: string, max: number) => {
      if (typeof item[key] !== "string" || item[key].length > max) throw new Error("Keep diner names under 40 characters and each opinion under 200 characters.");
      return item[key].trim();
    };
    const id = read("id", 40);
    if (!/^[a-zA-Z0-9-]{1,40}$/.test(id) || ids.has(id)) throw new Error("Each diner needs a unique identifier.");
    ids.add(id);
    return { id, name: read("name", 40) || `Diner ${index + 1}`, wants: read("wants", 200), avoids: read("avoids", 200), restrictions: read("restrictions", 200), notes: read("notes", 200) };
  });
}
export function rankForGroup(elements: OsmElement[], lat: number, lon: number, diners: Diner[], radius: number): GroupRestaurant[] {
  const preferences = diners.map(d => ({ diner: d, ...parsePreferences(d.wants, d.avoids) }));
  const exclusions = [...new Set(preferences.flatMap(p => p.excluded))];
  // Every explicit cuisine veto applies. Wishes get equal weight per person, not per keyword.
  const candidates = rankRestaurants(elements, lat, lon, "", exclusions.join(" "), radius, 1000);
  return candidates.map(r => {
    const tags = r.cuisine.toLowerCase().split(" · ").map(t => t.replaceAll(" ", "_"));
    const hasPreference = preferences.some(p => p.desired.length);
    const matchedDiners = preferences.filter(p => p.desired.length && p.desired.some(tag => tags.includes(tag))).map(p => p.diner.name);
    const unmatchedDiners = preferences.filter(p => p.desired.length && !p.desired.some(tag => tags.includes(tag))).map(p => p.diner.name);
    return { ...r, matchedDiners, unmatchedDiners, groupScore: matchedDiners.length, reason: hasPreference ? `Cuisine wishes matched for ${matchedDiners.length} of ${preferences.filter(p => p.desired.length).length} diners; everyone’s cuisine skips applied. Other needs require menu checks.` : "Everyone’s cuisine skips applied; ranked by distance. Dietary, budget and ingredient needs require menu checks." };
  }).filter(r => !preferences.some(p => p.desired.length) || r.groupScore > 0)
    .sort((a,b) => b.groupScore - a.groupScore || a.distance - b.distance).slice(0,8);
}
export function parseGroupOrder(text: string, diners: Diner[]): GroupOrder {
  const invalid = () => { throw new Error("The AI did not return advice for every diner. Try again."); };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return invalid(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const plan = raw as GroupOrder;
  const string = (s: unknown) => typeof s === "string" && s.trim().length > 0 && s.length <= 600;
  const list = (l: unknown) => Array.isArray(l) && l.length >= 1 && l.length <= 4 && l.every(string);
  if (!string(plan.summary) || !list(plan.sharing) || !list(plan.checks) || !Array.isArray(plan.diners) || plan.diners.length !== diners.length) return invalid();
  if (!plan.diners.every((d,i) => d && d.dinerId === diners[i].id && list(d.ideas) && string(d.adjustments) && string(d.reason))) return invalid();
  return { summary: plan.summary, diners: plan.diners.map(({dinerId,ideas,adjustments,reason}) => ({dinerId,ideas,adjustments,reason})), sharing: plan.sharing, checks: plan.checks };
}
