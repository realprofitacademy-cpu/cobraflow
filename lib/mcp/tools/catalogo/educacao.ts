/**
 * Capacidades de EDUCAÇÃO e FINANÇAS — Vertical de Academias e Institutos (CobraFlow).
 *
 * Permite ao agente de IA informar cursos, turmas abertas, valores em dólares e bolívares (BCV),
 * consultar a situação do aluno e registrar novas matrículas com fatura automática.
 */
import { declararTools } from "./tipos";

export const TOOLS_EDUCACAO = declararTools([
  {
    name: "crm_list_courses",
    category: "read",
    rotulo: "Consultar cursos e turmas disponíveis",
    explicacao:
      "Mostra os cursos abertos, turmas ativas, datas de início e valores para o assistente orientar os interessados.",
    oQueToca: "Cursos e turmas",
    risco: "seguro",
    pacotes: ["escalar"],
  },
  {
    name: "crm_get_student_enrollments",
    category: "read",
    rotulo: "Consultar situação acadêmica e financeira do aluno",
    explicacao:
      "Verifica em quais turmas o contato está inscrito e se possui pagamentos confirmados ou valores pendentes.",
    oQueToca: "Inscrições do aluno",
    risco: "seguro",
    pacotes: ["escalar"],
  },
  {
    name: "crm_get_bcv_rate",
    category: "read",
    rotulo: "Consultar taxa de câmbio oficial do BCV",
    explicacao:
      "Informa a taxa oficial do dia e converte valores entre dólares e bolívares para respostas precisas de pagamento.",
    oQueToca: "Taxa de câmbio",
    risco: "seguro",
    pacotes: ["escalar"],
  },
  {
    name: "crm_enroll_student",
    category: "write",
    rotulo: "Registrar inscrição de aluno em turma",
    explicacao:
      "Inscreve o contato na turma escolhida e gera a fatura do curso.",
    oQueToca: "Inscrições e faturas",
    risco: "atencao",
    pacotes: ["escalar"],
  },
]);
