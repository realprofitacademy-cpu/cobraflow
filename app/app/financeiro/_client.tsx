"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { useT } from "@/hooks/i18n/useT";
import { InvoiceModal } from "./_invoice-modal";
import { PaymentModal } from "./_payment-modal";

/** Tipo de factura devuelta por la API */
interface Invoice {
  id: string;
  contact_name: string;
  date: string; // ISO
  due_date: string;
  total_usd_cents: number;
  total_ves_cents: number;
  paid_cents: number;
  balance_cents: number;
  status: string;
}

export function FinanceiroDashboard({ podeGerenciar, moedaDaOrg }: { podeGerenciar: boolean; moedaDaOrg: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [showInvoice, setShowInvoice] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const { data: invoices, isLoading, isError, error } = useQuery({
    queryKey: ["financeiro", "invoices"],
    queryFn: async () => (await apiClient.get<{ data: Invoice[] }>("/api/v1/finance/invoices")).data,
    retry: false,
  });

  const registrarPago = useMutation({
    mutationFn: (payload: { invoiceId: string; amount_usd_cents?: number; amount_ves_cents?: number; method: string; reference?: string }) =>
      apiClient.post(`/api/v1/finance/invoices/${payload.invoiceId}/payments`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["financeiro", "invoices"] });
    },
    onError: showApiError,
  });

  if (isLoading) return <p>{t("Cargando facturas…")}</p>;
  if (isError) return <p className="text-danger">{t("No se pudieron cargar las facturas.")}</p>;

  return (
    <div className="flex flex-col gap-4">
      {podeGerenciar && (
        <Button onClick={() => setShowInvoice(true)}>{t("Nueva factura")}</Button>
      )}
      <table className="min-w-full text-sm border">
        <thead className="bg-muted">
          <tr>
            <th className="p-2 text-left">{t("Nro.")}</th>
            <th className="p-2 text-left">{t("Contacto")}</th>
            <th className="p-2 text-left">{t("Fecha")}</th>
            <th className="p-2 text-left">{t("Vencimiento")}</th>
            <th className="p-2 text-right">{t("Total USD")}</th>
            <th className="p-2 text-right">{t("Total VES")}</th>
            <th className="p-2 text-right">{t("Pagado")}</th>
            <th className="p-2 text-right">{t("Saldo")}</th>
            <th className="p-2 text-left">{t("Estado")}</th>
            {podeGerenciar && <th className="p-2" />}
          </tr>
        </thead>
        <tbody>
          {(Array.isArray(invoices) ? invoices : (invoices as any)?.data ?? []).map((inv: Invoice) => (
            <tr key={inv.id} className="border-t">
              <td className="p-2">{inv.id}</td>
              <td className="p-2">{inv.contact_name}</td>
              <td className="p-2">{new Date(inv.date).toLocaleDateString()}</td>
              <td className="p-2">{new Date(inv.due_date).toLocaleDateString()}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(inv.total_usd_cents, "USD")}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(inv.total_ves_cents, moedaDaOrg)}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(inv.paid_cents, moedaDaOrg)}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(inv.balance_cents, moedaDaOrg)}</td>
              <td className="p-2">{inv.status}</td>
              {podeGerenciar && (
                <td className="p-2 text-center">
                  <Button size="sm" onClick={() => { setSelectedInvoice(inv.id); setShowPayment(true); }}>
                    {t("Pagar")}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {showInvoice && <InvoiceModal onClose={() => setShowInvoice(false)} />}
      {showPayment && selectedInvoice && (
        <PaymentModal
          invoiceId={selectedInvoice}
          onClose={() => {
            setShowPayment(false);
            setSelectedInvoice(null);
          }}
          onPay={(payload) => registrarPago.mutate({ invoiceId: selectedInvoice, ...payload })}
        />
      )}
    </div>
  );
}
