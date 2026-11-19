import { createNexusClient, fetchTransport } from "@nexus/shared";

// Backend origin and bearer token, inlined from mobile/.env at bundle time
// (EXPO_PUBLIC_* vars; see .env.example). The default is a local dev backend,
// which only a simulator or the web preview on this Mac can reach. A phone
// needs EXPO_PUBLIC_NEXUS_API_URL set to the Pi's tailscale HTTPS URL.
export const API_ORIGIN = process.env.EXPO_PUBLIC_NEXUS_API_URL || "http://127.0.0.1:5055";
const API_TOKEN = process.env.EXPO_PUBLIC_NEXUS_API_TOKEN ?? "";

export const api = createNexusClient(
    fetchTransport({ origin: API_ORIGIN, token: API_TOKEN, client: "mobile", timeoutMs: 8000 }),
);
