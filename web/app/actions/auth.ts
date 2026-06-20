"use server";

import { signIn, signOut } from "@logto/next/server-actions";

import { getLogtoConfig } from "../../lib/logto";

export async function signInAction(): Promise<void> {
  const config = getLogtoConfig();
  await signIn(config, `${config.baseUrl}/callback`);
}

export async function signOutAction(): Promise<void> {
  const config = getLogtoConfig();
  await signOut(config, config.baseUrl);
}
