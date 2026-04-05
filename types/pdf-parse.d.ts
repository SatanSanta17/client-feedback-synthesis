declare module "pdf-parse/lib/pdf-parse" {
  interface PDFParseResult {
    /** Number of pages */
    numpages: number;
    /** Number of rendered pages */
    numrender: number;
    /** PDF info */
    info: Record<string, unknown>;
    /** PDF metadata */
    metadata: unknown;
    /** PDF.js version */
    version: string;
    /** Extracted text content */
    text: string;
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>
  ): Promise<PDFParseResult>;

  export default pdfParse;
}
