import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: { get, post },
}));

vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (str: string) => str,
}));

import { FinanceiroDashboard } from "@/app/app/financeiro/_client";
import { EducacaoDashboard } from "@/app/app/educacao/_client";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("CobraFlow UI Dashboards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza o dashboard financeiro com faturas e taxas", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/finance/invoices") {
        return {
          data: [
            {
              id: "inv-001",
              contact_name: "María Gómez",
              date: "2026-11-23T10:00:00Z",
              due_date: "2026-11-30T10:00:00Z",
              total_usd_cents: 15000,
              total_ves_cents: 1224000,
              paid_cents: 0,
              balance_cents: 1224000,
              status: "pending",
            },
          ],
        };
      }
      return { data: [] };
    });

    render(<FinanceiroDashboard podeGerenciar={true} moedaDaOrg="VES" />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText("inv-001")).toBeInTheDocument();
      expect(screen.getByText("María Gómez")).toBeInTheDocument();
      expect(screen.getByText("Nueva factura")).toBeInTheDocument();
    });
  });

  it("renderiza o dashboard de educação com cursos e cohortes", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/education/courses") {
        return {
          data: [
            {
              id: "course-1",
              name: "Diplomado en Finanzas",
              price_usd_cents: 25000,
              price_ves_cents: 2040000,
            },
          ],
        };
      }
      if (url === "/api/v1/education/cohorts") {
        return {
          data: [
            {
              id: "cohort-1",
              course_id: "course-1",
              name: "Cohorte 2026-I",
              start_date: "2026-03-01",
              end_date: "2026-06-30",
            },
          ],
        };
      }
      return { data: [] };
    });

    render(<EducacaoDashboard podeGerenciar={true} moedaDaOrg="VES" />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getAllByText("Diplomado en Finanzas").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Cohorte 2026-I")).toBeInTheDocument();
      expect(screen.getByText("Inscribir estudiante")).toBeInTheDocument();
    });
  });
});
