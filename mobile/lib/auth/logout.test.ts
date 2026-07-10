import { describe, expect, it } from "vitest";

import { endSessionUrl } from "./logout";

describe("endSessionUrl (#6)", () => {
  it("builds the end-session URL with client_id and an encoded post_logout_redirect_uri", () => {
    const url = endSessionUrl({
      endSessionEndpoint: "https://auth.example.com/oidc/session/end",
      clientId: "abc",
      postLogoutRedirectUri: "com.x://cb",
    });
    expect(url).toBe(
      "https://auth.example.com/oidc/session/end?client_id=abc&post_logout_redirect_uri=com.x%3A%2F%2Fcb",
    );
  });

  it("omits post_logout_redirect_uri when not supplied", () => {
    const url = endSessionUrl({
      endSessionEndpoint: "https://auth.example.com/oidc/session/end",
      clientId: "abc",
    });
    expect(url).toBe("https://auth.example.com/oidc/session/end?client_id=abc");
  });

  it("never includes an id_token_hint (not part of Logto's end-session contract)", () => {
    const url = endSessionUrl({
      endSessionEndpoint: "https://auth.example.com/oidc/session/end",
      clientId: "abc",
      postLogoutRedirectUri: "com.x://cb",
    });
    expect(url).not.toContain("id_token_hint");
  });
});
