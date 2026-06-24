import type { components } from "@fountainrank/api-client";

export type MeProfile = components["schemas"]["MeResponse"];

export function profileInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function isDisplayableEmail(email: string): boolean {
  return !email.endsWith("@users.noreply.fountainrank.com");
}

export function displayEmail(email: string): string | null {
  return isDisplayableEmail(email) ? email : null;
}
