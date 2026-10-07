import type { NexusApi } from "./index";

declare global {
    interface Window {
        api: NexusApi;
    }
}
