import type { Metadata } from "next";
// import { Geist, Geist_Mono } from "next/font/google"; // Using generic fonts or matching bomy-front global css
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Design Concept Generator",
  description: "Generate design concepts from planning documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      {/* bomy-front matches globals.css text-slate-800 bg-gray-100 */}
      <body className="antialiased min-h-screen bg-gray-50 text-slate-800">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
