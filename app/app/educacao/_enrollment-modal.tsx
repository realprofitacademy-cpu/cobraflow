"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

/** Modal para inscribir a un estudiante en una cohorte */
export function EnrollmentModal({
  courses,
  onClose,
  onEnroll,
}: {
  courses: { id: string; name: string }[];
  onClose: () => void;
  onEnroll: (payload: { cohortId: string; studentName: string }) => void;
}) {
  const t = useT();
  const [cohortId, setCohortId] = useState("");
  const [studentName, setStudentName] = useState("");

  const handleSubmit = () => {
    if (!cohortId || !studentName) return;
    onEnroll({ cohortId, studentName });
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Inscribir estudiante")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Select value={cohortId} onValueChange={setCohortId}>
            <SelectTrigger>
              <SelectValue placeholder={t("Seleccionar cohorte")} />
            </SelectTrigger>
            <SelectContent>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder={t("Nombre del estudiante")} value={studentName} onChange={(e) => setStudentName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit}>{t("Inscribir")}</Button>
          <Button variant="secondary" onClick={onClose}>{t("Cancelar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
