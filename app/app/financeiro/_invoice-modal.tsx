"use client";

import { useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useQuery } from "@tanstack/react-query";

/** Modal para crear una nueva factura */
export function InvoiceModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [contactId, setContactId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [currency, setCurrency] = useState<"USD" | "VES">("USD");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");

  const contacts = useQuery({
    queryKey: ["contacts", "list"],
    queryFn: async () => (await apiClient.get<{ data: { id: string; name: string }[] }>("/api/v1/contacts?search=")).data,
    enabled: false, // lazy load when needed
  });

  const handleSubmit = async () => {
    const body: any = {
      contact_id: contactId,
      due_date: dueDate,
      currency,
      amount_cents: Math.round(Number(amount.replace(",", ".")) * (currency === "USD" ? 100 : 1)),
    };
    if (courseId) body.course_id = courseId;
    try {
      await apiClient.post("/api/v1/finance/invoices", body);
      onClose();
    } catch (e) {
      showApiError(e);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Crear factura")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Input placeholder={t("Buscar contacto")} value={contactId} onChange={(e) => setContactId(e.target.value)} />
          <Input placeholder={t("ID del curso (opcional)")} value={courseId} onChange={(e) => setCourseId(e.target.value)} />
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
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit}>{t("Crear")}</Button>
          <Button variant="secondary" onClick={onClose}>{t("Cancelar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
