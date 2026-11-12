// Scenario files: the same format and encryption as the Mac app's ScenarioFile.swift
// (JSON; with a password, AES-256-GCM with a PBKDF2-HMAC-SHA256 key, 310,000 iterations).
// Works in browsers and in Node (web/scenario-check.mjs tests it against the Swift code).
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? sortKeys(o[k]) : o[k]]));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function scenarioFileText(calculatorID, title, inputs, password) {
  const plain = JSON.stringify(sortKeys({ format: "wealthdesk-scenario", version: 1, calculatorID, title, inputs, saved: iso(new Date()) }), null, 2);
  if (!password) return plain;
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, 310000);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plain)));
  const box = new Uint8Array(12 + sealed.length); box.set(nonce); box.set(sealed, 12);
  return JSON.stringify(sortKeys({ format: "wealthdesk-scenario-encrypted", version: 1, kdf: "PBKDF2-HMAC-SHA256", iterations: 310000, salt: b64(salt), box: b64(box) }), null, 2);
}

export async function readScenarioFile(text, password) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error("That isn't a Wealth Desk scenario file."); }
  if (obj.format === "wealthdesk-scenario-encrypted") {
    if (!password) throw new Error("This scenario file is password-protected.");
    const box = unb64(obj.box);
    try {
      const key = await deriveKey(password, unb64(obj.salt), obj.iterations);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.slice(0, 12) }, key, box.slice(12));
      obj = JSON.parse(new TextDecoder().decode(plain));
    } catch { throw new Error("Wrong password, or the file is damaged."); }
  }
  if (obj.format !== "wealthdesk-scenario" || typeof obj.calculatorID !== "string") throw new Error("That isn't a Wealth Desk scenario file.");
  return obj;
}

