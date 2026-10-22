import type { Metadata } from "next";
import RuntimeIdentity from '@/components/runtime-identity';
import "./globals.css";

export const metadata: Metadata = {
  title: "Knota — Connecting people, plans and details.",
  description: "Connecting people, plans and details. Plan together, keep everyone in sync, and recover when plans change.",
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
