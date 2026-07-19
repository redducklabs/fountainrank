"use client";
import { useCallback, useState, type ImgHTMLAttributes, type ReactNode } from "react";

export function LoadableImage({
  className = "",
  alt,
  src,
  wrapperClassName = "",
  fallback,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { wrapperClassName?: string; fallback?: ReactNode }) {
  const source = typeof src === "string" ? src : "";
  const [state, setState] = useState<{ src: string; status: "loading" | "loaded" | "error" }>({
    src: source,
    status: "loading",
  });
  const current = state.src === source ? state : { src: source, status: "loading" as const };
  if (state.src !== source) setState(current);
  const captureImage = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image?.complete) return;
      setState({ src: source, status: image.naturalWidth > 0 ? "loaded" : "error" });
    },
    [source],
  );
  return (
    <span className={`relative block h-full w-full overflow-hidden bg-surface ${wrapperClassName}`}>
      {current.status === "loading" && (
        <span
          className="absolute inset-0 animate-pulse bg-border/60 motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {current.status === "error" && (
        <span
          className="absolute inset-0 flex items-center justify-center text-xs text-muted"
          role={alt === "" ? undefined : "img"}
          aria-label={alt === "" ? undefined : alt || "Image unavailable"}
          aria-hidden={alt === "" ? true : undefined}
        >
          {fallback ?? "Image unavailable"}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary API/avatar hosts */}
      <img
        ref={captureImage}
        {...props}
        src={source}
        alt={current.status === "error" ? "" : alt}
        aria-hidden={current.status === "error" ? true : undefined}
        onLoad={() => setState({ src: source, status: "loaded" })}
        onError={() => setState({ src: source, status: "error" })}
        className={`${className} transition-opacity ${current.status === "loaded" ? "opacity-100" : "opacity-0"}`}
      />
    </span>
  );
}
