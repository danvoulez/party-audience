/**
 * Autenticação: hash de senha (PBKDF2 via WebCrypto, disponível em Workers e
 * Node) e sessões por cookie HttpOnly. Apenas o hash SHA-256 do token de
 * sessão é persistido.
 */

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
export const SESSION_COOKIE = "sid";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf.buffer);
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toHex(bits);
}

export interface PasswordRecord {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomHex(16);
  return { hash: await pbkdf2(password, salt, PBKDF2_ITERATIONS), salt, iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const candidate = await pbkdf2(password, record.salt, record.iterations);
  // Comparação de strings hex de tamanho fixo; timing não vaza o hash inteiro,
  // mas usamos comparação de todos os bytes mesmo assim.
  if (candidate.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function newSessionToken(): { token: string; expiresAt: number } {
  return { token: randomHex(32), expiresAt: Date.now() + SESSION_TTL_MS };
}

export function newId(): string {
  return crypto.randomUUID();
}

export function sessionCookie(token: string, request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(request: Request): string {
  return sessionCookie("", request, 0);
}

export function readSessionToken(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      if (value) return value;
    }
  }
  return undefined;
}
