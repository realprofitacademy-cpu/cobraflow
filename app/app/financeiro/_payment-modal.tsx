"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

/** Modal para registrar un pago contra una factura */
export function PaymentModal({
  invoiceId,
  onClose,
  onPay,
}: {
  invoiceId: string;
  onClose: () => void;
  onPay: (payload: { amount_usd_cents?: number; amount_ves_cents?: number; method: string; reference?: string }) => void;
}) {
  const t = useT();
  const [method, setMethod] = useState("Pago Móvil");
  const [currency, setCurrency] = useState<"USD" | "VES">("USD");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const handleSubmit = () => {
    const payload: any = {
      method,
      reference: reference || undefined,
    };
    if (currency === "USD") {
      payload.amount_usd_cents = Math.round(Number(amount.replace(",", ".")) * 100);
    } else {
      payload.amount_ves_cents = Math.round(Number(amount.replace(",", ".")));
    }
    onPay(payload);
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Registrar pago para factura")}: {invoiceId}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger>
              <SelectValue placeholder={t("Método de pago")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Pago Móvil">Pago Móvil</SelectItem>
              <SelectItem value="Transferencia">Transferencia</SelectItem>
              <SelectItem value="Zelle">Zelle</SelectItem>
              <SelectItem value="Efectivo">Efectivo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={currency} onValueChange={(v) => setCurrency(v as any)}>
            <SelectTrigger>
              <SelectValue placeholder={t("Moneda")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="VES">VES</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={t("Monto") + " (" + (currency === "USD" ? "USD" : "Bs") + ")"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder={t("Referencia (opcional)")} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit}>{t("Pagar")}</Button>
          <Button variant="secondary" onClick={onClose}>{t("Cancelar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
