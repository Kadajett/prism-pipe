/**
 * YAML + ENV config loading
 */
import { defaultConfig } from "./defaults";
export async function loadConfig(_configPath) {
    // TODO: Implement YAML loading from file
    // TODO: Implement ENV variable overrides
    throw new Error("Not implemented");
}
export function getDefaultConfig() {
    return JSON.parse(JSON.stringify(defaultConfig));
}
//# sourceMappingURL=loader.js.map