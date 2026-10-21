import type { Metadata } from "next";
import RuntimeIdentity from '@/components/runtime-identity';
import "./globals.css";

export const metadata: Metadata = {
  title: "PlanRecover · Your plans, connected",
  description: "Plan together, review your shares, and recover when plans change. An interactive beta workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><RuntimeIdentity>{children}</RuntimeIdentity></body>
    </html>
  );
}
