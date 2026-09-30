export function supabaseApiHeaders(apiKey, accessToken = "", extra = {}) {
  // Opaque API keys are not JWTs. Keep Bearer for signed-in users and legacy keys.
  const bearerToken = accessToken || (/^sb_(publishable|secret)_/.test(apiKey) ? "" : apiKey);
  return { apikey: apiKey, ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}), ...extra };
}
