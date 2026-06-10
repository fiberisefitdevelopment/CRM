import { getReportData } from './service';
import { generateReportHtml } from './template';
import { generatePdf } from './pdf-generator';

/**
 * Controller orchestrator for the report generation process.
 * Fetches the raw orders data, calculates metrics, generates HTML, and compiles it to PDF.
 * Returns the final raw PDF binary Buffer.
 */
export async function handleDownloadReport(startDateStr?: string, endDateStr?: string): Promise<Buffer> {
  console.log(`📊 [Reports Controller] Processing report for dates: ${startDateStr || 'default'} to ${endDateStr || 'default'}`);
  
  // 1. Fetch CRM data and build KPIs / trend stats
  const data = await getReportData(startDateStr, endDateStr);

  // 2. Generate final print HTML markup
  const htmlContent = generateReportHtml(data);

  // 3. Render HTML and export A4 PDF
  const pdfBuffer = await generatePdf(htmlContent);

  console.log(`✨ [Reports Controller] PDF generated successfully (${pdfBuffer.length} bytes)`);
  return pdfBuffer;
}
