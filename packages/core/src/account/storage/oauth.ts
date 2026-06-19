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
import { readFileSync } from "node:fs";
import { tokenFile, tokensDir, ensureDir, configFile } from "../../core/paths.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// drive.file = the app may only touch files IT created — but those files live in a
// VISIBLE folder the user can open (unlike the old hidden drive.appdata). Changing
// this scope INVALIDATES old tokens: the user must re-connect Google once.
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const PROVIDER = "google";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expiry: number; // epoch ms
}

// OAuth client creds come from env (CI/dev) OR ~/.agentnet/config.json (so a
// VSCode-launched extension, which gets no shell env, still has them). The
// Desktop-app client_id/secret are not real secrets for installed apps, so keeping
// them in the local config file is fine and avoids hardcoding them into the repo.
function configCreds(): { id?: string; secret?: string } {
  try {
    const c = JSON.parse(readFileSync(configFile(), "utf8")) as {
      google_client_id?: string;
      google_client_secret?: string;
    };
    return { id: c.google_client_id, secret: c.google_client_secret };
  } catch {
    return {};
  }
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID || configCreds().id;
  if (!id) {
    throw new Error(
      "Google client id missing — set GOOGLE_CLIENT_ID or add \"google_client_id\" to ~/.agentnet/config.json",
    );
  }
  return id;
}
function clientSecret(): string {
  // installed-app secret is not confidential; empty string is valid for pure PKCE
  return process.env.GOOGLE_CLIENT_SECRET || configCreds().secret || "";
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
        // Anything thrown HERE (e.g. clientId() with no creds) would otherwise be
        // swallowed by the async callback and leave the promise pending forever —
        // the "connect did nothing, no popup" bug. Catch and reject so it surfaces.
        try {
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
        } catch (e) {
          server.close();
          reject(e);
        }
      });
    },
  );

  await exchangeCode(code, verifier, redirect);
}

export interface GoogleLogin {
  url: string;
  submitCode(code: string): Promise<void>;
  cancel(): void;
  done: Promise<boolean>;
}

export function startGoogleLogin(): Promise<GoogleLogin> {
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));

  let settleDone: (ok: boolean) => void;
  const done = new Promise<boolean>((r) => (settleDone = r));

  let redirect = "";
  const server = createServer((req, res) => {
    const url = new URL(req.url || "", "http://127.0.0.1");
    const code = url.searchParams.get("code");
    const gotState = url.searchParams.get("state");
    res.end("AgentNet: Google connected. You can close this tab.");
    server.close();
    if (code && gotState === state) {
      exchangeCode(code, verifier, redirect)
        .then(() => settleDone(true))
        .catch(() => settleDone(false));
    } else {
      settleDone(false);
    }
  });

  return new Promise<GoogleLogin>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      try {
        const port = (server.address() as { port: number }).port;
        redirect = `http://127.0.0.1:${port}`;
        const url = `${AUTH_URL}?${new URLSearchParams({
          client_id: clientId(),
          redirect_uri: redirect,
          response_type: "code",
          scope: SCOPE,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          access_type: "offline",
          prompt: "consent",
        })}`;

        resolve({
          url,
          async submitCode(codeOrUrl: string) {
            let code = codeOrUrl.trim();
            if (code.startsWith("http://") || code.startsWith("https://") || code.includes("code=")) {
              try {
                const urlParsed = new URL(code);
                code = urlParsed.searchParams.get("code") || code;
              } catch {
                const match = code.match(/[?&]code=([^&]+)/);
                if (match) {
                  code = match[1];
                }
              }
            }
            try {
              await exchangeCode(code, verifier, redirect);
              server.close();
              settleDone(true);
            } catch (e) {
              server.close();
              settleDone(false);
              throw e;
            }
          },
          cancel() {
            server.close();
            settleDone(false);
          },
          done,
        });
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });
}

// Variant that uses a FIXED redirect URI (provided by caller) instead of spinning
// up its own random-port server. The caller's HTTP server must handle the redirect
// and call submitCode(fullUrl). Designed for the Android localhost surface where
// Chrome can reach the main server port but not a second random proot port.
export function startGoogleLoginFixed(redirectUri: string): GoogleLogin {
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));

  let settleDone: (ok: boolean) => void;
  const done = new Promise<boolean>((r) => (settleDone = r));

  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  })}`;

  return {
    url,
    async submitCode(codeOrUrl: string) {
      let code = codeOrUrl.trim();
      // The fixed-redirect flow ALWAYS hands back the full callback URL, which carries
      // ?state=. Validate it unconditionally (fail-closed) to block login-CSRF: a forged
      // callback with an attacker's code but a wrong/absent state must be rejected, never
      // exchanged. No regex fallback — if the URL won't parse or the state doesn't match,
      // refuse rather than salvage a code we can't tie to this request.
      if (code.startsWith("http://") || code.startsWith("https://") || code.includes("code=")) {
        const urlParsed = new URL(code); // throws on malformed input → submission refused
        const gotState = urlParsed.searchParams.get("state");
        if (!gotState || gotState !== state) throw new Error("oauth: state mismatch");
        const gotCode = urlParsed.searchParams.get("code");
        if (!gotCode) throw new Error("oauth: no code in callback");
        code = gotCode;
      }
      try {
        await exchangeCode(code, verifier, redirectUri);
        settleDone(true);
      } catch (e) {
        settleDone(false);
        throw e;
      }
    },
    cancel() {
      settleDone(false);
    },
    done,
  };
}


async function exchangeCode(code: string, verifier: string, redirect: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirect,
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
  });
  const secret = clientSecret();
  if (secret) body.set("client_secret", secret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
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

  const body = new URLSearchParams({
    client_id: clientId(),
    grant_type: "refresh_token",
    refresh_token: tok.refresh_token,
  });
  const secret = clientSecret();
  if (secret) body.set("client_secret", secret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
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

// Best-effort: the email of the connected Google account, for the UI to show
// "saving to Google Drive (you@gmail.com)". Returns null if not signed in or if
// the Drive scope doesn't expose it (never throws, purely informational).
export async function googleAccount(): Promise<string | null> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
    return data.user?.emailAddress ?? data.user?.displayName ?? null;
  } catch {
    return null;
  }
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
