"use client";

import { useEffect, useState } from "react";

import { getApiClient } from "@/lib/api";

type Status = "loading" | "ok" | "error";

export function BackendStatus() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    getApiClient()
      .GET("/healthz")
      .then(({ data, error }) => setStatus(!error && data?.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return <p data-testid="backend-status">Backend status: {status}</p>;
}
