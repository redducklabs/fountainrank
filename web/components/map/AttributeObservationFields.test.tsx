// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AttributeObservationFields } from "./AttributeObservationFields";
import type { AttributeGroup } from "../../lib/catalog";

afterEach(cleanup);

const groups: AttributeGroup[] = [
  {
    category: "physical",
    controls: [
      {
        id: 1,
        key: "bottle_filler",
        name: "Bottle filler",
        description: "",
        kind: "boolean",
        options: ["yes", "no", "unknown"],
      },
      {
        id: 2,
        key: "temperature",
        name: "Temperature",
        description: "",
        kind: "enum",
        options: ["cold", "ambient", "unknown"],
      },
    ],
  },
];

describe("AttributeObservationFields", () => {
  it("renders boolean Yes/No/Unknown radios and enum select", () => {
    render(<AttributeObservationFields groups={groups} value={{}} onChange={vi.fn()} />);
    // boolean: three radios for "Bottle filler"
    expect(screen.getByRole("radio", { name: /bottle filler: yes/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /bottle filler: no/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /bottle filler: unknown/i })).toBeTruthy();
    // enum: select for "Temperature"
    expect(screen.getByRole("combobox", { name: /temperature/i })).toBeTruthy();
  });

  it("defaults to unknown for both boolean and enum when value is empty", () => {
    render(<AttributeObservationFields groups={groups} value={{}} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /bottle filler: unknown/i })).toHaveProperty(
      "checked",
      true,
    );
    expect(
      (screen.getByRole("combobox", { name: /temperature/i }) as HTMLSelectElement).value,
    ).toBe("unknown");
  });

  it("calls onChange with (id, value) when a boolean radio is selected", () => {
    const onChange = vi.fn();
    render(<AttributeObservationFields groups={groups} value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /bottle filler: yes/i }));
    expect(onChange).toHaveBeenCalledWith(1, "yes");
  });

  it("calls onChange with (id, value) when an enum option is selected", () => {
    const onChange = vi.fn();
    render(<AttributeObservationFields groups={groups} value={{}} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: /temperature/i }), {
      target: { value: "cold" },
    });
    expect(onChange).toHaveBeenCalledWith(2, "cold");
  });

  it("renders nothing when groups is empty", () => {
    const { container } = render(
      <AttributeObservationFields groups={[]} value={{}} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
