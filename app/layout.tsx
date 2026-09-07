import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description:
    "An AI assistant can read everything on this page but cannot change anything until you approve it — and your approval expires by itself. A WebMCP demo where risky tools are not refused, they simply do not exist until you say yes.",
  applicationName: BRAND.name,
  keywords: [
    "WebMCP",
    "AI agent safety",
    "human in the loop",
    "prompt injection",
    "least authority",
  ],
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description:
      "The AI gets safe tools only. Anything risky, it has to ask you — and what you grant runs out on its own.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#fbfaf8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
