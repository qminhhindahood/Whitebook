export const AI_ROUTE_KEY = "whitebook_tutor_route";
export const AI_ACTIVE_MODEL_KEY = "whitebook_active_model";
export const AI_SETTINGS_CHANGED_EVENT = "whitebook_tutor_settings_changed";

export function getSavedAiModel(): string | null {
  try {
    return localStorage.getItem(AI_ACTIVE_MODEL_KEY) || null;
  } catch {
    return null;
  }
}

export function getSavedAiRoute(): string | null {
  try {
    return localStorage.getItem(AI_ROUTE_KEY) || null;
  } catch {
    return null;
  }
}

export function syncAiModel(model: string, fullRoute?: string) {
  try {
    if (model) localStorage.setItem(AI_ACTIVE_MODEL_KEY, model);
    if (fullRoute) {
      localStorage.setItem(AI_ROUTE_KEY, fullRoute);
    } else if (model) {
      const prev = localStorage.getItem(AI_ROUTE_KEY) || "shared_gemini";
      const routeType = prev.startsWith("personal") ? "personal_gemini" : "shared_gemini";
      localStorage.setItem(AI_ROUTE_KEY, `${routeType}:${model}`);
    }
    window.dispatchEvent(new CustomEvent(AI_SETTINGS_CHANGED_EVENT, { detail: { model, fullRoute } }));
  } catch {
    // Ignore storage issues in test/restricted sandboxes
  }
}

export function matchSavedOption<T extends { route: string; model: string }>(options: T[]): T | undefined {
  if (!options || options.length === 0) return undefined;
  const savedRoute = getSavedAiRoute();
  const savedModel = getSavedAiModel();
  if (savedRoute) {
    const matched = options.find(o =>
      `${o.route}:${o.model}` === savedRoute ||
      `${o.route}/${o.model}` === savedRoute ||
      o.model === savedRoute ||
      savedRoute.endsWith(`:${o.model}`) ||
      savedRoute.endsWith(`/${o.model}`)
    );
    if (matched) return matched;
  }
  if (savedModel) {
    const matched = options.find(o => o.model === savedModel);
    if (matched) return matched;
  }
  return options[0];
}
