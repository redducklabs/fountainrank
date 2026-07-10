// Pure builder for Logto's RP-initiated logout (end-session) URL — the piece @logto/rn's signOut
// deliberately skips (its browser navigation for sign-out is a no-op), which is why signing out
// never ended the IdP session and the next sign-in silently reused it (#6).
//
// Logto's own generator sends ONLY client_id and an optional post_logout_redirect_uri
// (node_modules/@logto/js/lib/core/sign-out.js) — there is no id_token_hint. We mirror that exactly.

export function endSessionUrl({
  endSessionEndpoint,
  clientId,
  postLogoutRedirectUri,
}: {
  endSessionEndpoint: string;
  clientId: string;
  postLogoutRedirectUri?: string;
}): string {
  const params = new URLSearchParams({ client_id: clientId });
  if (postLogoutRedirectUri) {
    params.append("post_logout_redirect_uri", postLogoutRedirectUri);
  }
  return `${endSessionEndpoint}?${params.toString()}`;
}
