/**
 * What the reader types on a PDF report node, apart from the builder
 * (lib/pdfReport.ts) so the graph module can hold it without importing what
 * the builder imports, which imports the graph.
 */
/** What the reader types on the node: the document's identification and its question. */
export interface PdfReportSettings {
  title: string
  subtitle: string
  number: string
  revision: string
  owner: string
  recipient: string
  author: string
  approver: string
  question: string
  scope: string
  released: boolean
}

export const PDF_REPORT_DEFAULT: PdfReportSettings = {
  title: "",
  subtitle: "",
  number: "",
  revision: "A",
  owner: "",
  recipient: "",
  author: "",
  approver: "",
  question: "",
  scope: "",
  released: false,
}
