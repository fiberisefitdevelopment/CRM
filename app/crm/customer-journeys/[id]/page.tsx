'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import {
  Loader2,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Play,
  Send,
  ArrowLeft,
  Phone,
  Package,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
} from 'lucide-react';

interface Log {
  id: string;
  stage: string;
  templateName: string;
  status: 'sent' | 'failed';
  apiResponse: string;
  error: string;
  triggeredBy: string;
  sentAt: any;
}

interface Journey {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  deliveredAt: any;
  welcomeSent: boolean;
  day1Sent: boolean;
  day3Sent: boolean;
  day4Sent: boolean;
  day5Sent: boolean;
  welcomeSentAt: any;
  day1SentAt: any;
  day3SentAt: any;
  day4SentAt: any;
  day5SentAt: any;
  currentStage: 'DELIVERED' | 'DAY1' | 'DAY3' | 'DAY4' | 'DAY5' | 'COMPLETED';
  lastApiResponse: string;
  lastError: string;
  products: string[];
  orderAmount: number;
}

export default function JourneyDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const journeyId = decodeURIComponent(resolvedParams.id);

  const [journey, setJourney] = useState<Journey | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const fetchJourneyDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/customer-journeys/${encodeURIComponent(journeyId)}`);
      if (res.ok) {
        const data = await res.json();
        setJourney(data.journey);
        setLogs(data.logs);
      }
    } catch (err) {
      console.error('Failed to load journey details:', err);
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => {
    fetchJourneyDetails();
  }, [fetchJourneyDetails]);

  const handleAction = async (action: 'retry' | 'trigger', stageParam?: string) => {
    setActionLoading(`${action}-${stageParam || ''}`);
    try {
      const res = await fetch(`/api/crm/customer-journeys/${encodeURIComponent(journeyId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, stage: stageParam }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Action failed');
      }

      await fetchJourneyDetails();
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '—';
    const seconds = timestamp.seconds ?? timestamp._seconds;
    const date = seconds !== undefined ? new Date(seconds * 1000) : new Date(timestamp);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const parseJSON = (str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

  const getStageLabel = (stage: string) => {
    switch (stage) {
      case 'DELIVERED':
        return 'Welcome (Day 0)';
      case 'DAY1':
        return 'Reminder (Day 1)';
      case 'DAY3':
        return 'Usage Tips (Day 3)';
      case 'DAY4':
        return 'Day 4';
      case 'DAY5':
        return 'Day 5';
      case 'COMPLETED':
        return 'Journey Completed';
      default:
        return stage;
    }
  };

  return (
    <div className="min-h-screen bg-[#030014]">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6 min-h-screen relative overflow-hidden">
        {/* Glow effects */}
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[150px] pointer-events-none" />

        <div className="max-w-7xl mx-auto mt-20 relative z-10">
          {/* Back button */}
          <Link
            href="/crm/customer-journeys"
            className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm mb-6 font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Journeys
          </Link>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-40">
              <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
              <p className="text-white/50 text-sm">Loading journey details...</p>
            </div>
          ) : !journey ? (
            <div className="bg-white/[0.01] border border-white/10 rounded-2xl p-12 text-center">
              <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
              <h3 className="text-white/60 font-semibold text-lg">Journey Not Found</h3>
              <p className="text-white/30 text-sm mt-2">
                The requested customer journey document could not be located in the database.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column - Metadata HUD */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* Customer / Order Info Card */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-md">
                  <h3 className="text-white font-extrabold text-lg mb-4 pb-2 border-b border-white/10">
                    Journey Info
                  </h3>

                  <div className="space-y-4">
                    {/* Customer */}
                    <div>
                      <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Customer Name</p>
                      <h4 className="text-white font-semibold text-base mt-1">{journey.customerName}</h4>
                      <p className="text-white/60 text-xs flex items-center gap-1.5 mt-1 font-mono">
                        <Phone className="w-3.5 h-3.5 text-purple-400" />
                        {journey.customerPhone}
                      </p>
                    </div>

                    {/* Order */}
                    <div>
                      <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Order Reference</p>
                      <h4 className="text-white font-mono text-base font-bold mt-1">{journey.orderId}</h4>
                      <div className="flex items-center gap-4 mt-2">
                        <p className="text-emerald-400 text-sm font-bold flex items-center gap-1">
                          <DollarSign className="w-4 h-4" />
                          ₹{journey.orderAmount}
                        </p>
                      </div>
                    </div>

                    {/* Delivery Date */}
                    <div>
                      <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Order Delivered At</p>
                      <p className="text-white/80 text-sm mt-1 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-purple-400" />
                        {formatDate(journey.deliveredAt)}
                      </p>
                    </div>

                    {/* Current Stage */}
                    <div>
                      <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Current Stage</p>
                      <div className="mt-2">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-extrabold ${
                          journey.currentStage === 'COMPLETED'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        }`}>
                          {journey.currentStage}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Purchased Products */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-md">
                  <h3 className="text-white font-extrabold text-lg mb-4 pb-2 border-b border-white/10 flex items-center gap-2">
                    <Package className="w-5 h-5 text-purple-400" />
                    Products List
                  </h3>
                  <div className="space-y-2">
                    {journey.products && journey.products.length > 0 ? (
                      journey.products.map((p, idx) => (
                        <div key={idx} className="p-3 bg-white/5 border border-white/5 rounded-xl text-white text-xs font-medium">
                          {p}
                        </div>
                      ))
                    ) : (
                      <p className="text-white/30 text-xs">No products listed.</p>
                    )}
                  </div>
                </div>

                {/* Admin Actions Panel */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-md">
                  <h3 className="text-white font-extrabold text-lg mb-4 pb-2 border-b border-white/10">
                    Console Actions
                  </h3>

                  <div className="flex flex-col gap-2.5">
                    {/* Retry Button */}
                    {journey.lastError && journey.currentStage !== 'COMPLETED' && (
                      <button
                        onClick={() => handleAction('retry')}
                        disabled={!!actionLoading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500 hover:bg-rose-600 active:scale-95 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-rose-500/20"
                      >
                        {actionLoading === 'retry-' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        Retry Current Stage ({journey.currentStage})
                      </button>
                    )}

                    {/* Manual Triggers List */}
                    <div className="space-y-2">
                      <p className="text-white/40 text-[10px] font-extrabold uppercase tracking-wider mb-2">Manually Fire Stage Templates</p>
                      
                      {[
                        { stageKey: 'DELIVERED', label: 'Welcome (Day 0)' },
                        { stageKey: 'DAY1', label: 'Reminder (Day 1)' },
                        { stageKey: 'DAY3', label: 'Usage Tips (Day 3)' },
                        { stageKey: 'DAY4', label: 'Day 4' },
                        { stageKey: 'DAY5', label: 'Day 5' },
                      ].map((s) => (
                        <button
                          key={s.stageKey}
                          onClick={() => handleAction('trigger', s.stageKey)}
                          disabled={!!actionLoading}
                          className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-white/70 hover:text-white rounded-xl text-xs font-bold transition-all active:scale-98 disabled:opacity-50"
                        >
                          <span className="flex items-center gap-1.5">
                            <Send className="w-3.5 h-3.5 text-purple-400" />
                            {s.label}
                          </span>
                          {actionLoading === `trigger-${s.stageKey}` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3 text-white/30" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              {/* Right Column - Timeline */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Visual timeline */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-md">
                  <h3 className="text-white font-extrabold text-lg mb-6">
                    Customer Journey Timeline
                  </h3>

                  <div className="relative border-l-2 border-white/10 pl-6 ml-4 space-y-8">
                    {[
                      {
                        key: 'DELIVERED',
                        title: 'Welcome Campaign (Day 0)',
                        description: 'Dispatched immediately when the shipment status updates to Delivered.',
                        sent: journey.welcomeSent,
                        date: journey.welcomeSentAt,
                      },
                      {
                        key: 'DAY1',
                        title: 'Reminder Campaign (Day 1)',
                        description: 'Scheduled for the next calendar day at 4:00 PM IST.',
                        sent: journey.day1Sent,
                        date: journey.day1SentAt,
                      },
                      {
                        key: 'DAY3',
                        title: 'Usage Tips Campaign (Day 3)',
                        description: 'Scheduled for 3 days post-delivery at 4:00 PM IST.',
                        sent: journey.day3Sent,
                        date: journey.day3SentAt,
                      },
                      {
                        key: 'DAY4',
                        title: 'Day 4 Campaign (Day 4)',
                        description: 'Scheduled for 4 days post-delivery at 4:00 PM IST.',
                        sent: journey.day4Sent,
                        date: journey.day4SentAt,
                      },
                      {
                        key: 'DAY5',
                        title: 'Day 5 Campaign (Day 5)',
                        description: 'Scheduled for 5 days post-delivery at 4:00 PM IST.',
                        sent: journey.day5Sent,
                        date: journey.day5SentAt,
                      },
                    ].map((step, idx) => {
                      const isCurrent = journey.currentStage === step.key;
                      const hasFailed = isCurrent && !!journey.lastError;
                      
                      return (
                        <div key={idx} className="relative group">
                          {/* Timeline dot */}
                          <div className={`absolute left-[-33px] top-1.5 w-4.5 h-4.5 rounded-full border-4 flex items-center justify-center shrink-0 w-[18px] h-[18px] transition-all duration-300 ${
                            step.sent 
                              ? 'bg-[#030014] border-emerald-400 shadow-md shadow-emerald-400/20 scale-110'
                              : hasFailed
                              ? 'bg-[#030014] border-rose-400 animate-pulse'
                              : isCurrent
                              ? 'bg-[#030014] border-purple-400 scale-105'
                              : 'bg-[#030014] border-white/20'
                          }`} />

                          {/* Step Content */}
                          <div>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <h4 className={`font-bold text-sm ${
                                step.sent 
                                  ? 'text-emerald-400' 
                                  : hasFailed
                                  ? 'text-rose-400'
                                  : isCurrent
                                  ? 'text-purple-400'
                                  : 'text-white/60'
                              }`}>
                                {step.title}
                              </h4>
                              
                              {step.date && (
                                <span className="text-[10px] text-white/30 font-mono font-bold">
                                  {formatDate(step.date)}
                                </span>
                              )}
                            </div>

                            <p className="text-white/40 text-xs mt-1 max-w-xl">
                              {step.description}
                            </p>

                            {/* Indicators */}
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              {step.sent ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                                  Sent Successfully
                                </span>
                              ) : hasFailed ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold">
                                  Delivery Failed
                                </span>
                              ) : isCurrent ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-bold animate-pulse">
                                  Processing Stage
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/5 text-[10px] font-bold">
                                  Queued
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Audit Logs Inspector */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-md">
                  <h3 className="text-white font-extrabold text-lg mb-4 flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-purple-400" />
                    Message logs inspector
                  </h3>

                  <div className="space-y-3">
                    {logs.length === 0 ? (
                      <p className="text-white/30 text-xs py-4 text-center">No dispatch logs recorded for this journey yet.</p>
                    ) : (
                      logs.map((log) => {
                        const isExpanded = expandedLog === log.id;
                        
                        return (
                          <div key={log.id} className="border border-white/5 rounded-xl bg-white/[0.01] overflow-hidden">
                            {/* Summary row */}
                            <button
                              onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                              className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors text-left"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  log.status === 'sent'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  {log.status.toUpperCase()}
                                </span>
                                <span className="text-white font-bold text-xs">
                                  {getStageLabel(log.stage)}
                                </span>
                                <span className="text-white/30 text-[10px] font-mono">
                                  {formatDate(log.sentAt)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-white/30 font-bold capitalize">
                                  Via {log.triggeredBy.replace('_', ' ')}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4 text-white/30" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-white/30" />
                                )}
                              </div>
                            </button>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div className="p-4 border-t border-white/5 bg-black/40 space-y-3">
                                <div>
                                  <span className="text-white/40 text-[9px] font-extrabold uppercase tracking-wider">Template Name</span>
                                  <p className="text-white text-xs mt-0.5 font-medium">{log.templateName}</p>
                                </div>

                                {log.error && (
                                  <div>
                                    <span className="text-rose-400/60 text-[9px] font-extrabold uppercase tracking-wider">Error Details</span>
                                    <pre className="p-2.5 mt-1 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
                                      {log.error}
                                    </pre>
                                  </div>
                                )}

                                {log.apiResponse && (
                                  <div>
                                    <span className="text-purple-400/60 text-[9px] font-extrabold uppercase tracking-wider font-mono">Raw API Response</span>
                                    <pre className="p-2.5 mt-1 rounded-lg bg-[#06031b] border border-white/5 text-purple-300 font-mono text-[10px] overflow-x-auto">
                                      {JSON.stringify(parseJSON(log.apiResponse), null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}
        </div>
      </main>
    </div>
  );
}
