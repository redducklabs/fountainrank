"use server";

import { signIn, signOut } from "@logto/next/server-actions";
import { cookies } from "next/headers";

import { getLogtoConfig } from "../../lib/logto";
import { RETURN_COOKIE, safeReturnPath } from "../../lib/return-path";

export async function signInAction(): Promise<void> {
  const config = getLogtoConfig();
  await signIn(config, `${config.baseUrl}/callback`);
}

export async function signOutAction(): Promise<void> {
  const config = getLogtoConfig();
  await signOut(config, config.baseUrl);
}

export async function signInWithReturn(returnTo: string): Promise<void> {
  const config = getLogtoConfig();
  const safe = safeReturnPath(returnTo);
  const store = await cookies();
  if (safe) {
    store.set(RETURN_COOKIE, safe, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
  } else {
    store.delete({ name: RETURN_COOKIE, path: "/" });
  }
  await signIn(config, `${config.baseUrl}/callback`);
}
