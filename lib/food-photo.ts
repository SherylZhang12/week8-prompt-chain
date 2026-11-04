export const PERSONAS = ["Gordon Ramsay", "Cat", "Dog"] as const;
export const REPLY_STYLES = ["Roast", "Hype", "Roast then hype"] as const;
export const POST_LANGUAGES = ["English"] as const;
export const NEIGHBORHOODS = ["Morningside Heights", "Upper West Side", "Midtown", "East Village", "Lower East Side", "Chinatown", "Brooklyn", "Queens", "Other / home"] as const;
export function ownedPhotoPath(path: string, userId: string) {
  return path.startsWith(`${userId}/`) && /^[a-zA-Z0-9-]+\/[0-9a-f-]{36}\.jpg$/.test(path);
}
export function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  return null;
}
export function validatePhotoDetails(scene: string, dish: string, persona: string, restaurant: string, neighborhood: string, replyStyle: string, language: string) {
  if (scene.length > 500 || !dish.trim() || dish.length > 80) return "Add a dish name and keep your optional food story under 500 characters.";
  if (!(PERSONAS as readonly string[]).includes(persona) || !(REPLY_STYLES as readonly string[]).includes(replyStyle) || !(POST_LANGUAGES as readonly string[]).includes(language)) return "Choose an available voice, reaction and language.";
  if (restaurant.length > 100 || !(NEIGHBORHOODS as readonly string[]).includes(neighborhood)) return "Choose a neighborhood and keep the place name under 100 characters.";
  return null;
}

export function dailyChefChallenge(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const dateKey = `${part("year")}-${part("month")}-${part("day")}`;
  const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
  return { persona: PERSONAS[0], style: REPLY_STYLES[day % REPLY_STYLES.length], dateKey };
}

export function validatePersonalReview(review: string, rating: string) {
  if (review.length > 1000) return "Keep your personal review under 1,000 characters.";
  if (rating && !/^[1-5]$/.test(rating)) return "Choose a personal rating from 1 to 5.";
  return null;
}
export function personaLabel(persona: string) {
  return persona === "Cat" ? "My cat’s take" : persona === "Dog" ? "My dog’s take" : "Gordon Ramsay-style chef’s take";
}

export const PERSONA_DETAILS = {
  "Gordon Ramsay": { emoji: "👨‍🍳", title: "Fiery chef", description: "Gordon Ramsay-style kitchen drama: sharp roasts and hard-earned praise.", example: "That plating has main-character confidence. The vegetables deserve their own spotlight." },
  Cat: { emoji: "🐱", title: "My cat", description: "Your cat found your phone. Expect judgment, attitude and reluctant approval.", example: "My human photographed lunch again. Apparently the plate outranks me now." },
  Dog: { emoji: "🐶", title: "My dog", description: "Your dog found your phone. Expect excitement, affection and dramatic begging.", example: "A whole plate and no invitation? I thought we were a team, human." },
} as const;
