'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import {
  FileText,
  Download,
  Calendar,
  Loader2,
  AlertCircle,
  TrendingUp,
  Sparkles,
  Info
} from 'lucide-react';

export default function ReportsPage() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date ranges (Today and Last 7 Days)
  const todayStr = new Date().toISOString().split('T')[0];
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  // Custom picker state
  const [customStart, setCustomStart] = useState(sevenDaysAgoStr);
  const [customEnd, setCustomEnd] = useState(todayStr);

  const downloadReport = async (start: string, end: string) => {
    setGenerating(true);
    setError(null);
    try {
      const url = `/api/reports/shipment/download?startDate=${start}&endDate=${end}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Server error occurred during PDF compilation');
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `shipment_report_${start}_to_${end}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      console.error('Failed to generate report:', err);
      setError(err.message || 'An unexpected error occurred while generating the PDF. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030014]">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6 min-h-screen relative overflow-hidden">
        {/* Atmosphere/Glow Effects */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[150px] pointer-events-none" />

        <div className="max-w-7xl mx-auto mt-20 relative z-10">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl lg:text-3xl font-extrabold text-white flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center border border-purple-500/30">
                  <FileText className="w-5 h-5 text-purple-400" />
                </div>
                Shipment & Fulfillment Reports
              </h1>
              <p className="text-white/50 text-sm mt-1">
                Generate and download enterprise PDF reports containing shipping performance and operational analytics.
              </p>
            </div>
          </div>

          {/* Info Tip */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 mb-8 backdrop-blur-md flex gap-3 items-start">
            <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-white/70 text-xs leading-relaxed">
              <span className="font-bold text-white">Reporting System Architecture:</span> Reports are generated in PDF format matching company branding guidelines. Charts (7-Day trends and today's distribution) are rendered dynamically from real Shopify/Shiprocket order data. PDF compilation occurs server-side and takes 2–5 seconds.
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 mb-8 backdrop-blur-md flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-rose-200 text-sm">
                <span className="font-bold text-white">Generation Failed: </span> {error}
              </div>
            </div>
          )}

          {/* Loading Overlay */}
          {generating && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
              <div className="bg-[#100c28] border border-white/10 rounded-3xl p-8 max-w-sm text-center flex flex-col items-center shadow-[0_0_50px_rgba(168,85,247,0.1)]">
                <Loader2 className="w-10 h-10 text-purple-400 animate-spin mb-4" />
                <h3 className="text-white font-bold text-lg">Compiling PDF Report...</h3>
                <p className="text-white/40 text-xs mt-2 px-4">
                  Fetching Shopify/Shiprocket aggregates, rendering high-res charts, and formatting A4 print pages.
                </p>
              </div>
            </div>
          )}

          {/* Cards Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Daily Report Card */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-md relative overflow-hidden group hover:border-purple-500/20 transition-all duration-300 flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-purple-500/5 blur-xl pointer-events-none" />
              <div>
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-white font-bold text-lg">Daily Shipment Report</h3>
                <p className="text-white/40 text-xs mt-2 leading-relaxed">
                  Export shipment and fulfillment metrics for the current calendar day. Contains today's distribution bar chart, executive summaries, and initial RTO checks.
                </p>
              </div>
              <button
                onClick={() => downloadReport(todayStr, todayStr)}
                disabled={generating}
                className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download Daily Report
              </button>
            </div>

            {/* Weekly Report Card */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-md relative overflow-hidden group hover:border-emerald-500/20 transition-all duration-300 flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-emerald-500/5 blur-xl pointer-events-none" />
              <div>
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                  <Sparkles className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-white font-bold text-lg">Weekly Fulfillment Report</h3>
                <p className="text-white/40 text-xs mt-2 leading-relaxed">
                  Export shipment, fulfillment, and RTO metrics for the last 7 calendar days. Includes dynamic operational insights, growth comparisons, warnings, and recommended actions.
                </p>
              </div>
              <button
                onClick={() => downloadReport(sevenDaysAgoStr, todayStr)}
                disabled={generating}
                className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download Weekly Report
              </button>
            </div>

            {/* Custom Date Range Card */}
            <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-md relative overflow-hidden group hover:border-blue-500/20 transition-all duration-300 flex flex-col justify-between col-span-1 md:col-span-2 lg:col-span-1">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-blue-500/5 blur-xl pointer-events-none" />
              <div>
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                  <Calendar className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-white font-bold text-lg">Custom Report Range</h3>
                <p className="text-white/40 text-xs mt-2 leading-relaxed mb-4">
                  Choose a custom start and end date to compile shipment and fulfillment trends for that exact duration.
                </p>

                {/* Date Picker Fields */}
                <div className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-white/30 text-[10px] uppercase font-bold tracking-wider">Start Date</label>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-white/30 text-[10px] uppercase font-bold tracking-wider">End Date</label>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart}
                      max={todayStr}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => downloadReport(customStart, customEnd)}
                disabled={generating || !customStart || !customEnd}
                className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Generate Custom Report
              </button>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
}
