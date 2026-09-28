const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
function bytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/.test(value)) throw new Error("Invalid encrypted value");
  return Uint8Array.from(value.match(/../g)!, part => parseInt(part, 16));
}
async function key(secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Missing encryption key");
  return crypto.subtle.importKey("raw", bytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}
// Distinct secrets and authenticated purposes prevent credential/snapshot substitution.
export async function seal(value: string, secret: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, await key(secret), encoder.encode(value));
  return `${hex(iv)}.${hex(new Uint8Array(encrypted))}`;
}
export async function unseal(value: string, secret: string, purpose: string): Promise<string> {
  const [iv, encrypted, extra] = value.split(".");
  if (extra || iv.length !== 24 || !encrypted) throw new Error("Invalid encrypted value");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(purpose) }, await key(secret), bytes(encrypted)));
}
