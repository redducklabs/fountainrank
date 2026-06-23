export const colors = {
  brandBlue: "#0A357E",
  brandYellow: "#F2C200",
  brandYellowHover: "#FFCE1F",
  text: "#0F172A",
  textMuted: "#475569",
  background: "#FFFFFF",
  surface: "#F8FAFC",
  border: "#E2E8F0",
  danger: "#B91C1C",
  onBrand: "#FFFFFF",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const typography = {
  title: { fontSize: 24, fontWeight: "700" as const },
  heading: { fontSize: 18, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  meta: { fontSize: 12, fontWeight: "400" as const },
} as const;
