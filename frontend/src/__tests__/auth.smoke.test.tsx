import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { AuthProvider } from "@/components/AuthProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

global.fetch = vi.fn(async () => ({ ok: false, text: async () => "unauthorized" })) as any;

describe("AuthProvider", () => {
  it("renders children", async () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>
    );
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });
});
