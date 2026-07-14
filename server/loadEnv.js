import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Load KEY=value files into process.env (does not override existing env).
 * Order: AppData Local\Resablic\.env → project .env
 */
export function loadEnvFiles(projectRoot) {
  const candidates = [
    path.join(os.homedir(), "AppData", "Local", "Resablic", ".env"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Resablic", ".env")
      : null,
    projectRoot ? path.join(projectRoot, ".env") : null,
  ].filter(Boolean);

  const loaded = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      applyEnvFile(file);
      loaded.push(file);
    } catch (err) {
      console.warn(`[env] failed to read ${file}: ${err.message}`);
    }
  }
  return loaded;
}

function applyEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}
