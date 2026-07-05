import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle from "./ThemeToggle";

function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    // jsdom has no matchMedia; next-themes reads it for `system`.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false, // system = light
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
  });

  it("renders the three theme options after mount", async () => {
    renderToggle();
    // Radiogroup of System/Light/Dark (see component below).
    expect(await screen.findByRole("radio", { name: /system/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
  });

  it("persists an explicit Dark choice to localStorage and sets .dark", async () => {
    renderToggle();
    fireEvent.click(await screen.findByRole("radio", { name: /dark/i }));
    await waitFor(() => expect(localStorage.getItem("theme")).toBe("dark"));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  });
});
