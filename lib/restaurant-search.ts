export const SEARCH_AREAS = [
  { name: "Lower East Side", lat: 40.715, lon: -73.985 },
  { name: "Morningside Heights", lat: 40.808, lon: -73.963 },
  { name: "Upper West Side", lat: 40.787, lon: -73.975 },
  { name: "Midtown", lat: 40.754, lon: -73.984 },
  { name: "East Village", lat: 40.727, lon: -73.985 },
  { name: "Chinatown", lat: 40.717, lon: -73.998 },
  { name: "Williamsburg", lat: 40.714, lon: -73.96 },
  { name: "Flushing", lat: 40.759, lon: -73.83 },
];
const CUISINES: Record<string, string[]> = {
  pizza: ["pizza", "披萨"], japanese: ["japanese", "sushi", "ramen", "日料", "寿司", "拉面"],
  chinese: ["chinese", "dumpling", "中餐", "饺子"], korean: ["korean", "韩餐", "韩式"],
  thai: ["thai", "泰餐", "泰国菜"], indian: ["indian", "印度菜"], mexican: ["mexican", "taco", "墨西哥"],
  italian: ["italian", "pasta", "意大利", "意面"], burger: ["burger", "汉堡"],
  vietnamese: ["vietnamese", "pho", "越南"], mediterranean: ["mediterranean", "地中海"],
  american: ["american", "美式"], seafood: ["seafood", "海鲜"],
};
export type Restaurant = { id: string; name: string; cuisine: string; address: string; lat: number; lon: number; distance: number; reason: string; source: string; maps: string };
export type SearchResult = { error?: string; restaurants?: Restaurant[]; note?: string; location?: string; diners?: import("./group-dining").Diner[] };
export type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
export function coordinates(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
export function preferenceTags(text: string) {
  const lower = text.toLowerCase();
  return Object.entries(CUISINES).filter(([, words]) => words.some(word => /[a-z]/.test(word) ? new RegExp(`\\b${word}(?:s)?\\b`, "i").test(lower) : lower.includes(word))).map(([tag]) => tag);
}
export function parsePreferences(wants: string, avoids: string) {
  const [positive, ...negative] = wants.split(/\b(?:no|not|without|avoid|skip|don't want|do not want)\b|不要|不想吃|不想要/i);
  return { desired: preferenceTags(positive), excluded: preferenceTags([avoids, ...negative].join(" ")) };
}
export function distanceMeters(lat: number, lon: number, otherLat: number, otherLon: number) {
  const rad = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(otherLat * rad) * Math.sin((otherLon - lon) * rad / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
}
export function rankRestaurants(elements: OsmElement[], lat: number, lon: number, wants: string, avoids: string, radius: number, limit = 8) {
  const { desired, excluded } = parsePreferences(wants, avoids);
  const seen = new Set<string>();
  const restaurants: Restaurant[] = [];
  for (const element of elements) {
    const tags = element.tags || {}, point = element.center || element;
    if (!tags.name || typeof point.lat !== "number" || typeof point.lon !== "number" || !coordinates(point.lat, point.lon)) continue;
    if (!["restaurant", "fast_food", "cafe"].includes(tags.amenity) || tags.disused === "yes" || tags.abandoned === "yes") continue;
    const cuisines = (tags.cuisine || "").toLowerCase().split(";");
    // Missing cuisine data cannot establish either a requested match or an exclusion.
    if ((desired.length || excluded.length) && !tags.cuisine) continue;
    const matches = desired.filter(tag => cuisines.includes(tag));
    if (desired.length && !matches.length || excluded.some(tag => cuisines.includes(tag))) continue;
    const distance = distanceMeters(lat, lon, point.lat, point.lon);
    if (distance > radius) continue;
    const duplicate = `${tags.name.toLowerCase()}:${Math.round(point.lat * 10000)}:${Math.round(point.lon * 10000)}`;
    if (seen.has(duplicate)) continue;
    seen.add(duplicate);
    const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ");
    const name = (tags["name:en"] || tags.name).slice(0, 120);
    restaurants.push({ id: `${element.type}/${element.id}`, name, cuisine: tags.cuisine?.replaceAll(";", " · ").replaceAll("_", " ") || "Cuisine not listed", address: address || "Street address not listed — view map", lat: point.lat, lon: point.lon, distance,
      reason: matches.length ? `Tagged ${matches.join(" / ")} on OpenStreetMap; within your search radius.` : "Nearby mapped food spot; ranked by distance.",
      source: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${point.lat},${point.lon}`)}` });
  }
  return restaurants.sort((a, b) => a.distance - b.distance).slice(0, limit);
}
