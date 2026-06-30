// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

vi.mock("../app/actions/auth", () => ({ signInWithReturn: vi.fn(), signOutAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/fountains/abc",
  useSearchParams: () => new URLSearchParams(""),
}));

import { AuthControl } from "./AuthControl";

afterEach(cleanup);

describe("AuthControl", () => {
  it("shows Sign in when anonymous", () => {
    render(<AuthControl viewer={{ state: "anonymous" }} />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("shows a Finish setup link (not a name menu) when needsName, never the subject", () => {
    render(
      <AuthControl
        viewer={{
          state: "authed",
          displayName: "",
          avatarUrl: null,
          isAdmin: false,
          needsName: true,
        }}
      />,
    );
    const link = screen.getByRole("link", { name: /finish setup/i });
    expect(link.getAttribute("href")).toBe("/account");
    // No account menu button is rendered in this state.
    expect(screen.queryByRole("button", { name: /open account menu/i })).toBeNull();
  });

  it("authed shows avatar menu with Account + Sign out, no Admin for non-admin", () => {
    render(
      <AuthControl
        viewer={{
          state: "authed",
          displayName: "Aron",
          avatarUrl: null,
          isAdmin: false,
          needsName: false,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.getByRole("menuitem", { name: /your account/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /admin/i })).toBeNull();
  });

  it("authed admin shows the Admin item", () => {
    render(
      <AuthControl
        viewer={{
          state: "authed",
          displayName: "Aron",
          avatarUrl: null,
          isAdmin: true,
          needsName: false,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.getByRole("menuitem", { name: /admin/i })).toBeTruthy();
  });

  it("error state shows a degraded menu without Admin", () => {
    render(<AuthControl viewer={{ state: "error" }} />);
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /admin/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy();
  });

  it("closes the menu on Escape", () => {
    render(
      <AuthControl
        viewer={{
          state: "authed",
          displayName: "Aron",
          avatarUrl: null,
          isAdmin: false,
          needsName: false,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu and restores focus to the button on outside-click", () => {
    render(
      <AuthControl
        viewer={{
          state: "authed",
          displayName: "Aron",
          avatarUrl: null,
          isAdmin: false,
          needsName: false,
        }}
      />,
    );
    const button = screen.getByRole("button", { name: /open account menu/i });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
