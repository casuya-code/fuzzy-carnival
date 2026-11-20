import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Yakodonyo Studio",
  description:
    "Bilingual AI voice cloning and automated video studio for English and Swahili creators.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <div className="md:flex md:min-h-screen">
          <Sidebar />
          <main className="flex-1 p-4 md:p-6">
            <div className="mx-auto max-w-5xl space-y-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}