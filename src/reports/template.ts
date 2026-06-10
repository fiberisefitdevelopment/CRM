import { ReportData } from './service';
import fs from 'fs';
import path from 'path';

export function generateReportHtml(data: ReportData): string {
  // Serialize trend data for chart injection
  const trendLabels = JSON.stringify(data.trendData.dates);
  const trendCounts = JSON.stringify(data.trendData.orderCounts);
  const distData = JSON.stringify([
    data.distribution.shipped,
    data.distribution.inTransit,
    data.distribution.delivered,
    data.distribution.rto
  ]);

  // Read local Chart.js code to support offline loading in Puppeteer
  let chartJsCode = '';
  try {
    const chartJsPath = path.join(process.cwd(), 'node_modules/chart.js/dist/chart.umd.js');
    chartJsCode = fs.readFileSync(chartJsPath, 'utf8');
  } catch (e) {
    console.warn('⚠️ Could not load chart.js from node_modules, falling back to CDN:', e);
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Shipment & Fulfillment Report</title>
  <!-- Load Inter font from Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  
  <!-- Load Chart.js -->
  ${chartJsCode ? `<script>${chartJsCode}</script>` : `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>`}

  <style>
    /* ── RESET & BODY ── */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      font-size: 11px;
      line-height: 1.4;
      padding: 0;
      margin: 0;
      -webkit-print-color-adjust: exact;
    }

    /* ── PAGE BREAK & BOUNDARY ── */
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm 15mm 20mm 15mm;
      position: relative;
      background-color: #ffffff;
      overflow: hidden;
    }
    .page-break {
      page-break-before: always;
      break-before: page;
    }

    /* ── HEADER & META ── */
    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1e3a8a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .company-info {
      display: flex;
      flex-direction: column;
    }
    .company-logo-text {
      font-size: 16px;
      font-weight: 800;
      color: #1e3a8a;
      letter-spacing: -0.025em;
      text-transform: uppercase;
    }
    .report-title {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      margin-top: 2px;
    }
    .meta-info {
      text-align: right;
      font-size: 10px;
      color: #64748b;
    }
    .meta-info div {
      margin-bottom: 2px;
    }
    .meta-value {
      font-weight: 600;
      color: #1e293b;
    }

    /* ── SECTIONS ── */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #1e3a8a;
      margin-top: 16px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-left: 3px solid #3b82f6;
      padding-left: 6px;
    }

    /* ── TABLES ── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 10px;
    }
    th {
      background-color: #1e3a8a;
      color: #ffffff;
      font-weight: 600;
      text-align: left;
      padding: 6px 8px;
      border: 1px solid #1e3a8a;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.02em;
    }
    td {
      padding: 6px 8px;
      border: 1px solid #e2e8f0;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    .text-right {
      text-align: right;
    }
    .text-center {
      text-align: center;
    }
    .font-semibold {
      font-weight: 600;
    }

    /* ── CHARTS GRID ── */
    .charts-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }
    .chart-box {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px;
      background-color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .chart-box h4 {
      font-size: 9.5px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 8px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .chart-wrapper {
      position: relative;
      width: 100%;
      height: 140px;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    /* ── SNAPSHOT GRID ── */
    .snapshot-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .snapshot-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      background-color: #f8fafc;
      text-align: center;
    }
    .snapshot-label {
      font-size: 8px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      margin-bottom: 4px;
    }
    .snapshot-value {
      font-size: 16px;
      font-weight: 700;
      color: #1e3a8a;
    }
    .snapshot-value.green {
      color: #059669;
    }
    .snapshot-value.red {
      color: #dc2626;
    }

    /* ── INSIGHTS & WARNINGS ── */
    .insights-list {
      list-style: none;
      margin-bottom: 16px;
    }
    .insights-list li {
      margin-bottom: 6px;
      padding-left: 18px;
      position: relative;
      font-size: 11px;
    }
    .insights-list li::before {
      content: "✓";
      color: #10b981;
      font-weight: 700;
      position: absolute;
      left: 0;
    }
    .warning-box {
      border: 1px solid #fecaca;
      border-radius: 6px;
      background-color: #fef2f2;
      padding: 10px 12px;
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .warning-box.amber {
      border-color: #fef08a;
      background-color: #fefce8;
    }
    .warning-icon {
      font-weight: 700;
      color: #ef4444;
      font-size: 14px;
    }
    .warning-box.amber .warning-icon {
      color: #eab308;
    }
    .warning-text h5 {
      font-size: 11px;
      font-weight: 600;
      color: #991b1b;
      margin-bottom: 2px;
    }
    .warning-box.amber .warning-text h5 {
      color: #854d0e;
    }
    .warning-text p {
      font-size: 10px;
      color: #7f1d1d;
    }
    .warning-box.amber .warning-text p {
      color: #713f12;
    }

    .observations-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 12px;
    }
    .obs-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px;
      background-color: #f8fafc;
    }
    .obs-header {
      font-size: 9px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .obs-value {
      font-size: 11px;
      font-weight: 600;
      color: #1e293b;
    }
    
    /* ── FOOTER PAGE MARGIN FOR PRINTOUT ── */
    @media print {
      body {
        background-color: transparent;
      }
      .page {
        width: 100%;
        min-height: auto;
        padding: 0;
        margin: 0;
      }
    }
  </style>
</head>
<body>

  <!-- ========================================== -->
  <!-- PAGE 1                                     -->
  <!-- ========================================== -->
  <div class="page">
    <!-- Header -->
    <div class="header-container">
      <div class="company-info">
        <span class="company-logo-text">Fiberise Fit Private Limited</span>
        <span class="report-title">Daily Shipment & Fulfillment Report</span>
      </div>
      <div class="meta-info">
        <div>Report Date: <span class="meta-value">${data.reportDateStr}</span></div>
        <div>Generated: <span class="meta-value">${data.generatedTimeStr}</span></div>
        <div>Period: <span class="meta-value">${data.startDateStr} - ${data.endDateStr}</span></div>
      </div>
    </div>

    <!-- Executive Summary -->
    <div class="section-title">Executive Summary</div>
    <table>
      <thead>
        <tr>
          <th>KPI Metric</th>
          <th class="text-right">Today</th>
          <th class="text-right">This Period (Week)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="font-semibold">Orders Received</td>
          <td class="text-right">${data.kpis.today.ordersReceived}</td>
          <td class="text-right">${data.kpis.thisWeek.ordersReceived}</td>
        </tr>
        <tr>
          <td class="font-semibold">Shipped Orders</td>
          <td class="text-right">${data.kpis.today.shippedOrders}</td>
          <td class="text-right">${data.kpis.thisWeek.shippedOrders}</td>
        </tr>
        <tr>
          <td class="font-semibold">In Transit Orders</td>
          <td class="text-right">${data.kpis.today.inTransitOrders}</td>
          <td class="text-right">${data.kpis.thisWeek.inTransitOrders}</td>
        </tr>
        <tr>
          <td class="font-semibold">Delivered Orders</td>
          <td class="text-right">${data.kpis.today.deliveredOrders}</td>
          <td class="text-right">${data.kpis.thisWeek.deliveredOrders}</td>
        </tr>
        <tr>
          <td class="font-semibold">RTO Orders</td>
          <td class="text-right">${data.kpis.today.rtoOrders}</td>
          <td class="text-right">${data.kpis.thisWeek.rtoOrders}</td>
        </tr>
        <tr>
          <td class="font-semibold">Delivery Rate %</td>
          <td class="text-right">${data.kpis.today.deliveryRate}%</td>
          <td class="text-right">${data.kpis.thisWeek.deliveryRate}%</td>
        </tr>
        <tr>
          <td class="font-semibold">RTO Rate %</td>
          <td class="text-right">${data.kpis.today.rtoRate}%</td>
          <td class="text-right">${data.kpis.thisWeek.rtoRate}%</td>
        </tr>
      </tbody>
    </table>

    <!-- Charts -->
    <div class="charts-row">
      <div class="chart-box">
        <h4>7-Day Shipment Trend</h4>
        <div class="chart-wrapper">
          <canvas id="lineChart" style="width: 320px; height: 130px;"></canvas>
        </div>
      </div>
      <div class="chart-box">
        <h4>Today's Distribution</h4>
        <div class="chart-wrapper">
          <canvas id="barChart" style="width: 320px; height: 130px;"></canvas>
        </div>
      </div>
    </div>

    <!-- Last 7 Days Performance Table -->
    <div class="section-title">Last 7 Days Performance Table</div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th class="text-right">Orders Received</th>
          <th class="text-right">Shipped</th>
          <th class="text-right">In Transit</th>
          <th class="text-right">Delivered</th>
          <th class="text-right">RTO</th>
        </tr>
      </thead>
      <tbody>
        ${data.performanceTable.map(row => `
          <tr>
            <td class="font-semibold">${row.date}</td>
            <td class="text-right">${row.ordersReceived}</td>
            <td class="text-right">${row.shipped}</td>
            <td class="text-right">${row.inTransit}</td>
            <td class="text-right">${row.delivered}</td>
            <td class="text-right">${row.rto}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Weekly Business Snapshot -->
    <div class="section-title">Weekly Business Snapshot</div>
    <div class="snapshot-grid">
      <div class="snapshot-card">
        <div class="snapshot-label">Orders Received</div>
        <div class="snapshot-value">${data.weeklySnapshot.totalOrdersReceived}</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">Delivered</div>
        <div class="snapshot-value green">${data.weeklySnapshot.totalDelivered}</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">Total RTO</div>
        <div class="snapshot-value red">${data.weeklySnapshot.totalRTO}</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">Fulfillment Rate</div>
        <div class="snapshot-value">${data.weeklySnapshot.fulfillmentRate}%</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">RTO Percentage</div>
        <div class="snapshot-value red">${data.weeklySnapshot.rtoPercentage}%</div>
      </div>
    </div>
  </div>

  <!-- ========================================== -->
  <!-- PAGE 2                                     -->
  <!-- ========================================== -->
  <div class="page page-break">
    <!-- Header -->
    <div class="header-container">
      <div class="company-info">
        <span class="company-logo-text">Fiberise Fit Private Limited</span>
        <span class="report-title">Operational Insights & Analysis</span>
      </div>
      <div class="meta-info">
        <div>Report Date: <span class="meta-value">${data.reportDateStr}</span></div>
        <div>Generated: <span class="meta-value">${data.generatedTimeStr}</span></div>
      </div>
    </div>

    <!-- Warnings / Critical Alert Cards -->
    ${data.performanceAnalysis.highRtoWarning ? `
      <div class="warning-box">
        <div class="warning-icon">⚠</div>
        <div class="warning-text">
          <h5>CRITICAL WARNING: HIGH RTO RISK</h5>
          <p>The RTO rate for this period is at <span class="font-semibold">${data.weeklySnapshot.rtoPercentage}%</span>, which exceeds the acceptable limit of 15%. Direct action is recommended to contact COD customers and verify billing addresses before dispatching new orders.</p>
        </div>
      </div>
    ` : ''}

    ${data.performanceAnalysis.lowDeliveryRateWarning ? `
      <div class="warning-box amber">
        <div class="warning-icon">⚠</div>
        <div class="warning-text">
          <h5>ALERT: LOW DELIVERY RATE</h5>
          <p>Delivery rate for this week stands at <span class="font-semibold">${data.kpis.thisWeek.deliveryRate}%</span>. Investigate delayed transit shipments with courier partners (e.g. Delhivery, Shiprocket) immediately.</p>
        </div>
      </div>
    ` : ''}

    <!-- Operational Insights -->
    <div class="section-title">Operational Insights</div>
    <ul class="insights-list">
      ${data.operationalInsights.map(insight => `<li>${insight}</li>`).join('')}
    </ul>

    <!-- Performance Analysis -->
    <div class="section-title">Performance Analysis & Observations</div>
    <div class="observations-grid">
      <div class="obs-card">
        <div class="obs-header">Peak Shipment Day</div>
        <div class="obs-value">${data.performanceAnalysis.peakShipmentDay}</div>
        <div style="font-size: 9px; color: #64748b; margin-top: 2px;">Volume: ${data.performanceAnalysis.peakShipmentCount} orders dispatched</div>
      </div>
      <div class="obs-card">
        <div class="obs-header">Best Performing Day</div>
        <div class="obs-value">${data.performanceAnalysis.bestPerformingDay}</div>
        <div style="font-size: 9px; color: #64748b; margin-top: 2px;">Volume: ${data.performanceAnalysis.bestPerformingCount} deliveries completed</div>
      </div>
      <div class="obs-card">
        <div class="obs-header">Growth Trend</div>
        <div class="obs-value" style="color: #059669;">${data.performanceAnalysis.growthTrend}</div>
      </div>
      <div class="obs-card">
        <div class="obs-header">Decline Trend</div>
        <div class="obs-value" style="${data.performanceAnalysis.declineTrend !== 'None' ? 'color: #dc2626;' : 'color: #64748b;'}">${data.performanceAnalysis.declineTrend}</div>
      </div>
    </div>

    <!-- Recommendations -->
    <div class="section-title" style="margin-top: 24px;">Recommended Action Plan</div>
    <p style="font-size: 11px; color: #475569; margin-bottom: 8px; line-height: 1.5;">
      Based on the order fulfillment and shipment performance data from the period starting <span class="font-semibold">${data.startDateStr}</span> to <span class="font-semibold">${data.endDateStr}</span>, the following actions are advised:
    </p>
    <table style="margin-top: 8px;">
      <thead>
        <tr>
          <th>Focus Area</th>
          <th>Action Item</th>
          <th>Priority</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="font-semibold" style="width: 25%;">COD Risk Management</td>
          <td>Implement automated WhatsApp OTP confirmation for COD orders above ₹1,000 to curb high RTO rates.</td>
          <td class="font-semibold" style="color: #dc2626; width: 15%;">HIGH</td>
        </tr>
        <tr>
          <td class="font-semibold">Courier Accountability</td>
          <td>Coordinate with logistics aggregators to flag shipments exceeding 4 days in "In Transit" status.</td>
          <td class="font-semibold" style="color: #d97706;">MEDIUM</td>
        </tr>
        <tr>
          <td class="font-semibold">Customer Notification</td>
          <td>Trigger proactive post-purchase WhatsApp notifications when orders are marked as 'Out for Delivery'.</td>
          <td class="font-semibold" style="color: #2563eb;">LOW</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ── Chartjs rendering script ── -->
  <script>
    function initCharts() {
      try {
        // Disable global animations for printing
        Chart.defaults.animation = false;
        
        // 1. Line Chart: 7-day Shipment Trend
        const ctxLine = document.getElementById('lineChart').getContext('2d');
        new Chart(ctxLine, {
          type: 'line',
          data: {
            labels: ${trendLabels},
            datasets: [{
              label: 'Orders Placed',
              data: ${trendCounts},
              borderColor: '#1e3a8a',
              backgroundColor: 'rgba(30, 58, 138, 0.05)',
              borderWidth: 1.5,
              pointBackgroundColor: '#1e3a8a',
              pointRadius: 2.5,
              tension: 0.2,
              fill: true
            }]
          },
          options: {
            responsive: false,
            devicePixelRatio: 2, // High-res export support
            plugins: {
              legend: { display: false }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 8, family: 'Inter' }, color: '#475569' }
              },
              y: {
                beginAtZero: true,
                ticks: { 
                  font: { size: 8, family: 'Inter' }, 
                  color: '#475569',
                  precision: 0
                }
              }
            }
          }
        });

        // 2. Bar Chart: Today's Distribution
        const ctxBar = document.getElementById('barChart').getContext('2d');
        new Chart(ctxBar, {
          type: 'bar',
          data: {
            labels: ['Shipped', 'Transit', 'Delivered', 'RTO'],
            datasets: [{
              data: ${distData},
              backgroundColor: ['#2563eb', '#eab308', '#059669', '#dc2626'],
              borderRadius: 3,
              barThickness: 18
            }]
          },
          options: {
            responsive: false,
            devicePixelRatio: 2,
            plugins: {
              legend: { display: false }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 8, family: 'Inter' }, color: '#475569' }
              },
              y: {
                beginAtZero: true,
                ticks: { 
                  font: { size: 8, family: 'Inter' }, 
                  color: '#475569',
                  precision: 0
                }
              }
            }
          }
        });

        // Flag indicating that the charts are completely drawn
        window.chartsRendered = true;
      } catch (err) {
        console.error('Chart.js render error inside Puppeteer context:', err);
        window.chartsRendered = true; // prevent lockup on failure
      }
    }

    // Run charts render safely, preventing window load event race conditions
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      initCharts();
    } else {
      document.addEventListener('DOMContentLoaded', initCharts);
    }
  </script>
</body>
</html>
  `;
}
