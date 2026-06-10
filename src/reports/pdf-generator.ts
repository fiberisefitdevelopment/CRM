import puppeteer from 'puppeteer';

/**
 * Renders an HTML string to a PDF buffer using headless Puppeteer.
 * Automatically waits for Chart.js canvases to paint before capturing.
 */
export async function generatePdf(htmlContent: string): Promise<Buffer> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--font-render-hinting=none',
      ],
    });

    const page = await browser.newPage();

    // Set page content and wait for network connections to idle (loads Google Fonts and Chart.js CDN)
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0' as any,
      timeout: 30000,
    });

    // Wait for the custom window flag indicating charts are fully rendered
    await page.waitForFunction('window.chartsRendered === true', {
      timeout: 10000,
    });

    // Generate print-optimized PDF with standard margins and dynamic page numbers
    const pdfUint8Array = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '15mm',
        right: '15mm',
      },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>', // Blank header
      footerTemplate: `
        <div style="font-size: 7px; color: #94a3b8; width: 100%; border-top: 1px solid #e2e8f0; padding-top: 4px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; display: flex; justify-content: space-between; margin-left: 15mm; margin-right: 15mm;">
          <span style="font-weight: 600;">Fiberise Fit Private Limited</span>
          <span>Daily Shipment &amp; Fulfillment Report</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
    });

    // Convert Uint8Array to Node Buffer
    return Buffer.from(pdfUint8Array);
  } catch (error) {
    console.error('❌ PDF Generation failed in Puppeteer:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
