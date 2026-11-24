"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { useT } from "@/hooks/i18n/useT";
import { EnrollmentModal } from "./_enrollment-modal";

interface Course {
  id: string;
  name: string;
  price_usd_cents: number;
  price_ves_cents: number;
}

interface Cohort {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  course_id: string;
}

export function EducacaoDashboard({ podeGerenciar, moedaDaOrg }: { podeGerenciar: boolean; moedaDaOrg: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [showEnroll, setShowEnroll] = useState(false);
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null);

  const { data: courses, isLoading: loadingCourses, isError: errCourses } = useQuery({
    queryKey: ["educacao", "courses"],
    queryFn: async () => (await apiClient.get<{ data: Course[] }>("/api/v1/education/courses")).data,
    retry: false,
  });

  const { data: cohorts, isLoading: loadingCohorts, isError: errCohorts } = useQuery({
    queryKey: ["educacao", "cohorts"],
    queryFn: async () => (await apiClient.get<{ data: Cohort[] }>("/api/v1/education/cohorts")).data,
    retry: false,
  });

  const inscribir = useMutation({
    mutationFn: (payload: { cohortId: string; studentName: string }) =>
      apiClient.post(`/api/v1/education/cohorts/${payload.cohortId}/enroll`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["educacao", "cohorts"] });
    },
    onError: showApiError,
  });

  if (loadingCourses || loadingCohorts) return <p>{t("Cargando…")}</p>;
  if (errCourses || errCohorts) return <p className="text-danger">{t("Error al cargar datos de educación.")}</p>;

  const coursesList: Course[] = Array.isArray(courses) ? courses : (courses as any)?.data ?? [];
  const cohortsList: Cohort[] = Array.isArray(cohorts) ? cohorts : (cohorts as any)?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {podeGerenciar && (
        <Button onClick={() => setShowEnroll(true)}>{t("Inscribir estudiante")}</Button>
      )}
      <h2 className="text-lg font-medium">{t("Cursos")}</h2>
      <table className="min-w-full border">
        <thead className="bg-muted">
          <tr>
            <th className="p-2 text-left">{t("Nombre")}</th>
            <th className="p-2 text-right">{t("Precio USD")}</th>
            <th className="p-2 text-right">{t("Precio VES")}</th>
          </tr>
        </thead>
        <tbody>
          {coursesList.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2">{c.name}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(c.price_usd_cents, "USD")}</td>
              <td className="p-2 text-right tabular-nums">{formatCents(c.price_ves_cents, moedaDaOrg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="text-lg font-medium mt-6">{t("Cohortes")}</h2>
      <table className="min-w-full border">
        <thead className="bg-muted">
          <tr>
            <th className="p-2 text-left">{t("Curso")}</th>
            <th className="p-2 text-left">{t("Cohorte")}</th>
            <th className="p-2 text-left">{t("Fechas")}</th>
          </tr>
        </thead>
        <tbody>
          {cohortsList.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-2">{coursesList.find((cr) => cr.id === c.course_id)?.name ?? "-"}</td>
              <td className="p-2">{c.name}</td>
              <td className="p-2">{new Date(c.start_date).toLocaleDateString()} - {new Date(c.end_date).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {showEnroll && (
        <EnrollmentModal
          courses={coursesList}
          onClose={() => setShowEnroll(false)}
          onEnroll={(payload) => inscribir.mutate(payload)}
        />
      )}
    </div>
  );
}
