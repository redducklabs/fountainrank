// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { submitAttributes, fetchAttributeTypes, refresh } = vi.hoisted(() => ({
  submitAttributes: vi.fn(),
  fetchAttributeTypes: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../app/actions/contribute", () => ({ submitAttributes }));
vi.mock("../../lib/catalog", () => ({
  fetchAttributeTypes,
  buildAttributeGroups: () => [
    {
      category: "Access",
      controls: [
        {
          id: 7,
          key: "bottle_filler",
          name: "Bottle filler",
          description: "",
          kind: "boolean",
          options: ["yes", "no", "unknown"],
        },
      ],
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AttributeForm } from "./AttributeForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttributeForm", () => {
  it("refreshes the route after saving observations", async () => {
    fetchAttributeTypes.mockResolvedValue([{ id: 7, place_type: "fountain" }]);
    submitAttributes.mockResolvedValue({ ok: true });
    render(<AttributeForm fountainId="fid" />);

    fireEvent.click(await screen.findByRole("radio", { name: /bottle filler: yes/i }));
    fireEvent.click(screen.getByRole("button", { name: /save details/i }));

    await waitFor(() =>
      expect(submitAttributes).toHaveBeenCalledWith("fid", [
        { attribute_type_id: 7, value: "yes" },
      ]),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
