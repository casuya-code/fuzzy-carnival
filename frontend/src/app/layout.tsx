import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { AuthProvider } from "@/components/AuthProvider";
import PerformanceReporter from "@/components/PerformanceReporter";

export const metadata: Metadata = {
  title: "Yakodonyo Studio",
  description:
    "Easy tools to create speech and videos in English and Swahili.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <PerformanceReporter />
        <AuthProvider>
          <div className="md:flex md:min-h-screen md:items-start">
            <Sidebar />
            <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
              <div className="mx-auto max-w-5xl">{children}</div>
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}