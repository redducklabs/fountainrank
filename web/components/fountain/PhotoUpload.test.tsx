// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { uploadPhoto, refresh } = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../app/actions/contribute", () => ({ uploadPhoto }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PhotoUpload } from "./PhotoUpload";

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhotoUpload", () => {
  it("calls uploadPhoto with a FormData carrying the selected file on change", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    render(<PhotoUpload fountainId="fid" />);
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    selectFile(input, file);
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    const [fountainId, formData] = uploadPhoto.mock.calls[0];
    expect(fountainId).toBe("fid");
    expect(formData.get("file")).toBe(file);
  });

  it("success shows a confirmation and refreshes the route", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    render(<PhotoUpload fountainId="fid" />);
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    selectFile(input, new File(["bytes"], "photo.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/photo uploaded/i),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("maps photo_limit / rate_limited / file_invalid to friendly messages", async () => {
    render(<PhotoUpload fountainId="fid" />);
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;

    uploadPhoto.mockResolvedValueOnce({ ok: false, error: "photo_limit" });
    selectFile(input, new File(["bytes"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/photo limit/i),
    );

    uploadPhoto.mockResolvedValueOnce({ ok: false, error: "rate_limited" });
    selectFile(input, new File(["bytes"], "b.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/doing that a lot/i),
    );

    uploadPhoto.mockResolvedValueOnce({ ok: false, error: "file_invalid" });
    selectFile(input, new File(["bytes"], "c.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/supported photo/i),
    );
  });

  it("resets the input value after each attempt so re-selecting the same file re-fires", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    render(<PhotoUpload fountainId="fid" />);
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    selectFile(input, new File(["bytes"], "photo.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
  });
});
