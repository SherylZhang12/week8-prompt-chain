export const MEALS = ["Breakfast", "Lunch", "Dinner"] as const;
export type MealSlot = typeof MEALS[number];
export const MEAL_GOALS = ["Balanced eating", "Muscle support", "Anti-inflammatory eating pattern"] as const;
export const ACTIVITIES = ["Mostly seated", "Lightly active", "Regular workouts", "Intense training"] as const;
export const MEAL_CUISINES = ["Any cuisine", "Chinese", "Japanese", "Korean", "Thai", "Indian", "Mexican", "Italian", "Vietnamese", "Mediterranean", "American"] as const;
export type MealCuisine = typeof MEAL_CUISINES[number];
export type MealProfile = { age: number; height_cm: number | null; weight_kg: number | null; sex: string; activity: string; goal: string; cuisine: MealCuisine; preferences: string; restrictions: string };
export type MealObservation = { meal: MealSlot; observation: string; uncertainty: string };
export type MealSuggestion = { meal: MealSlot; idea: string; cuisine: Exclude<MealCuisine, "Any cuisine">; dish: string; why: string; swap: string };
export type MealPlan = { summary: string; observations: MealObservation[]; suggestions: MealSuggestion[]; improvements: string[]; questions: string[] };
export type CoachResult = { error?: string; plan?: MealPlan; day?: "today" | "tomorrow" };
export function planTargets(uploaded: MealSlot[]) {
  const latest = Math.max(...uploaded.map(meal => MEALS.indexOf(meal)));
  return latest === 2 ? { day: "tomorrow" as const, meals: [...MEALS] } : { day: "today" as const, meals: MEALS.slice(latest + 1) };
}
export function readMealProfile(form: FormData): { profile?: MealProfile; error?: string } {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const age = Number(text("age"));
  const height_cm = text("height") ? Number(text("height")) : null;
  const weight_kg = text("weight") ? Number(text("weight")) : null;
  const sex = text("sex"), activity = text("activity"), goal = text("goal");
  const cuisine = text("cuisine") || "Any cuisine";
  if (!(MEAL_CUISINES as readonly string[]).includes(cuisine)) return { error: "Choose an available cuisine." };
  const preferences = text("preferences"), restrictions = text("restrictions");
  if (!Number.isInteger(age) || age < 18 || age > 100) return { error: "This meal coach is for adults. Enter an age from 18 to 100." };
  if (height_cm !== null && (!Number.isFinite(height_cm) || height_cm < 80 || height_cm > 250)) return { error: "Enter your height in centimeters, or leave it blank." };
  if (weight_kg !== null && (!Number.isFinite(weight_kg) || weight_kg < 25 || weight_kg > 350)) return { error: "Enter your weight in kilograms, or leave it blank." };
  if (!["Female", "Male", "Prefer not to say"].includes(sex) || !(ACTIVITIES as readonly string[]).includes(activity) || !(MEAL_GOALS as readonly string[]).includes(goal)) return { error: "Choose an available goal, activity level and sex option." };
  if (preferences.length > 500 || restrictions.length > 500) return { error: "Keep each preference or restriction under 500 characters." };
  return { profile: { age, height_cm, weight_kg, sex, activity, goal, cuisine: cuisine as MealCuisine, preferences, restrictions } };
}
export function parseMealPlan(text: string, uploaded: MealSlot[]): MealPlan {
  const invalid = () => { throw new Error("The AI returned an incomplete meal plan. Try again with clearer photos and portion notes."); };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return invalid(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const plan = raw as MealPlan;
  const string = (value: unknown, max = 1000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const strings = (value: unknown) => Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every(item => string(item, 600));
  const targets = planTargets(uploaded).meals;
  if (!string(plan.summary) || !strings(plan.improvements) || !strings(plan.questions)) return invalid();
  if (!Array.isArray(plan.observations) || plan.observations.length !== uploaded.length || !Array.isArray(plan.suggestions) || plan.suggestions.length !== targets.length) return invalid();
  const observations = plan.observations;
  const suggestions = plan.suggestions;
  if (!observations.every((item, i) => item && item.meal === uploaded[i] && string(item.observation, 600) && string(item.uncertainty, 600))) return invalid();
  if (!suggestions.every((item, i) => item && item.meal === targets[i] && string(item.idea, 600) && string(item.dish, 100) && (MEAL_CUISINES.filter(c => c !== "Any cuisine") as readonly string[]).includes(item.cuisine) && string(item.why, 600) && string(item.swap, 600))) return invalid();
  // Return an explicit allowlist; discard unexpected provider fields.
  return { summary: plan.summary, observations: observations.map(({meal, observation, uncertainty}) => ({meal, observation, uncertainty})), suggestions: suggestions.map(({meal, idea, cuisine, dish, why, swap}) => ({meal, idea, cuisine, dish, why, swap})), improvements: plan.improvements, questions: plan.questions };
}
