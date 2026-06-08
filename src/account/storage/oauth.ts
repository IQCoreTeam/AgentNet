// Google OAuth 2.0 for native apps — loopback IP flow with PKCE.
// Docs: https://developers.google.com/identity/protocols/oauth2/native-app
//
// We open a one-shot localhost HTTP listener, send the user to Google's consent
// page, catch the redirect with ?code=, exchange it (+ PKCE verifier) for tokens,
// and store them at core/paths tokenFile("google"). PER DEVICE, local only — our
// server never sees a token. getAccessToken() refreshes transparently.
//
// Setup: a Google Cloud OAuth client of type "Desktop app" gives a client_id
// (and client_secret, which for installed apps is not secret). Provide via
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env.

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tokenFile, tokensDir, ensureDir } from "../../core/paths.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const PROVIDER = "google";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expiry: number; // epoch ms
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID not set (Desktop-app OAuth client)");
  return id;
}
function clientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || ""; // not secret for installed apps
}

// PKCE: verifier + S256 challenge
function pkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Run the interactive consent once and persist tokens. `openBrowser` is injected
// so the UI (vscode/CLI) decides how to open the URL (shell open, vscode.env.openExternal…).
export async function googleLogin(openBrowser: (url: string) => void): Promise<void> {
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));

  // The listener binds to a random port; redirect_uri is known only inside the
  // listen callback, so we capture the (code, redirect) pair together and exchange
  // after — keeping redirect_uri identical between auth request and token request.
  const { code, redirect } = await new Promise<{ code: string; redirect: string }>(
    (resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url || "", "http://127.0.0.1");
        const code = url.searchParams.get("code");
        const gotState = url.searchParams.get("state");
        res.end("AgentNet: Google connected. You can close this tab.");
        server.close();
        if (!code || gotState !== state) reject(new Error("oauth: bad redirect"));
        else resolve({ code, redirect });
      });
      let redirect = "";
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        redirect = `http://127.0.0.1:${port}`;
        const auth = `${AUTH_URL}?${new URLSearchParams({
          client_id: clientId(),
          redirect_uri: redirect,
          response_type: "code",
          scope: SCOPE,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          access_type: "offline", // ensures a refresh_token
          prompt: "consent",
        })}`;
        openBrowser(auth);
      });
    },
  );

  await exchangeCode(code, verifier, redirect);
}

async function exchangeCode(code: string, verifier: string, redirect: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`oauth token exchange failed: ${res.status} ${await res.text()}`);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await saveToken({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expiry: Date.now() + t.expires_in * 1000,
  });
}

// Valid access token, refreshing if expired. Throws if not logged in.
export async function getAccessToken(): Promise<string> {
  const tok = await loadToken();
  if (!tok) throw new Error("not signed in to Google — run googleLogin first");
  if (Date.now() < tok.expiry - 60_000) return tok.access_token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`oauth refresh failed: ${res.status}`);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  const updated: StoredToken = {
    access_token: t.access_token,
    refresh_token: tok.refresh_token, // refresh token persists
    expiry: Date.now() + t.expires_in * 1000,
  };
  await saveToken(updated);
  return updated.access_token;
}

export async function isSignedIn(): Promise<boolean> {
  return (await loadToken()) !== null;
}

async function saveToken(tok: StoredToken): Promise<void> {
  await ensureDir(tokensDir());
  await writeFile(tokenFile(PROVIDER), JSON.stringify(tok), { mode: 0o600 });
}
async function loadToken(): Promise<StoredToken | null> {
  try {
    return JSON.parse(await readFile(tokenFile(PROVIDER), "utf8")) as StoredToken;
  } catch {
    return null;
  }
}
