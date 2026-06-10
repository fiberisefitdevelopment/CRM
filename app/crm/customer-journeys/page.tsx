'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import {
  Loader2,
  Search,
  RefreshCw,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Play,
  Send,
  Eye,
  Route,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

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
  lastError: string;
}

interface Analytics {
  totalActive: number;
  completed: number;
  welcomeSent: number;
  day1Sent: number;
  day3Sent: number;
  day4Sent: number;
  day5Sent: number;
  failedMessages: number;
  pendingMessages: number;
}

export default function CustomerJourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const [status, setStatus] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const fetchJourneys = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '10',
        search,
        stage,
        status,
        startDate,
        endDate,
      });

      const [resJourneys, resAnalytics] = await Promise.all([
        fetch(`/api/crm/customer-journeys?${queryParams.toString()}`),
        fetch(`/api/crm/customer-journeys/analytics`),
      ]);

      if (resJourneys.ok) {
        const data = await resJourneys.json();
        setJourneys(data.journeys);
        setTotalPages(data.pagination.totalPages);
        setTotalItems(data.pagination.total);
      }
      if (resAnalytics.ok) {
        const analyticsData = await resAnalytics.json();
        setAnalytics(analyticsData);
      }
    } catch (err) {
      console.error('Failed to load journeys data:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, stage, status, startDate, endDate]);

  useEffect(() => {
    fetchJourneys();
  }, [fetchJourneys]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchJourneys();
    setRefreshing(false);
  };

  const handleAction = async (journeyId: string, action: 'retry' | 'trigger', stageParam?: string) => {
    setActionLoading(`${journeyId}-${action}-${stageParam || ''}`);
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

      await fetchJourneys();
    } catch (err: any) {
      alert(`Error executing action: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '—';
    // Firestore Timestamp or IsoString
    const seconds = timestamp.seconds ?? timestamp._seconds;
    const date = seconds !== undefined ? new Date(seconds * 1000) : new Date(timestamp);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderStatusBadge = (sent: boolean, failed: boolean, date: any) => {
    if (sent) {
      return (
        <div className="flex flex-col items-center gap-0.5" title={formatDate(date)}>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" /> Sent
          </span>
          <span className="text-[9px] text-white/30 font-mono">
            {(() => {
              if (!date) return '';
              const seconds = date.seconds ?? date._seconds;
              const d = seconds !== undefined ? new Date(seconds * 1000) : new Date(date);
              return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            })()}
          </span>
        </div>
      );
    }
    if (failed) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold">
          <AlertCircle className="w-3 h-3" /> Failed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/5 text-[10px] font-bold">
        <Clock className="w-3 h-3" /> Pending
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#030014]">
      <Sidebar />
      <TopBar />

      <main className="ml-0 lg:ml-64 p-4 lg:p-6 min-h-screen relative overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[150px] pointer-events-none" />

        <div className="max-w-7xl mx-auto mt-20 relative z-10">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl lg:text-3xl font-extrabold text-white flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center border border-purple-500/30">
                  <Route className="w-5 h-5 text-purple-400" />
                </div>
                Customer Journeys
              </h1>
              <p className="text-white/50 text-sm mt-1">
                Post-delivery WhatsApp template automation funnel tracker
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>

          {/* Analytics Grid */}
          {analytics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {/* Active */}
              <button
                onClick={() => {
                  setStatus(status === 'active' ? 'all' : 'active');
                  setStage('all');
                  setPage(1);
                }}
                className={`w-full text-left bg-white/[0.02] rounded-2xl p-4 backdrop-blur-md relative overflow-hidden group transition-all duration-300 hover:scale-[1.02] focus:outline-none border ${
                  status === 'active'
                    ? 'border-purple-500 bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                    : 'border-white/10 hover:border-purple-500/30'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-purple-500/5 blur-xl group-hover:bg-purple-500/10 transition-colors pointer-events-none" />
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Active Journeys</p>
                <h3 className="text-2xl lg:text-3xl font-extrabold text-white mt-2 font-mono">
                  {analytics.totalActive}
                </h3>
              </button>

              {/* Completed */}
              <button
                onClick={() => {
                  setStatus(status === 'completed' ? 'all' : 'completed');
                  setStage('all');
                  setPage(1);
                }}
                className={`w-full text-left bg-white/[0.02] rounded-2xl p-4 backdrop-blur-md relative overflow-hidden group transition-all duration-300 hover:scale-[1.02] focus:outline-none border ${
                  status === 'completed'
                    ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                    : 'border-white/10 hover:border-emerald-500/30'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-emerald-500/5 blur-xl group-hover:bg-emerald-500/10 transition-colors pointer-events-none" />
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Completed Journeys</p>
                <h3 className="text-2xl lg:text-3xl font-extrabold text-emerald-400 mt-2 font-mono">
                  {analytics.completed}
                </h3>
              </button>

              {/* Messages Dispatched */}
              <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 backdrop-blur-md relative overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
                <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-blue-500/5 blur-xl group-hover:bg-blue-500/10 transition-colors pointer-events-none" />
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Total Sent Messages</p>
                <h3 className="text-2xl lg:text-3xl font-extrabold text-blue-400 mt-2 font-mono">
                  {analytics.welcomeSent + analytics.day1Sent + analytics.day3Sent + analytics.day4Sent + (analytics.day5Sent || 0)}
                </h3>
              </div>
 
              {/* Failed / Pending */}
              <button
                onClick={() => {
                  setStatus(status === 'failed' ? 'all' : 'failed');
                  setStage('all');
                  setPage(1);
                }}
                className={`w-full text-left bg-white/[0.02] rounded-2xl p-4 backdrop-blur-md relative overflow-hidden group transition-all duration-300 hover:scale-[1.02] focus:outline-none border ${
                  status === 'failed'
                    ? 'border-rose-500 bg-rose-500/10 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
                    : 'border-white/10 hover:border-rose-500/30'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-rose-500/5 blur-xl group-hover:bg-rose-500/10 transition-colors pointer-events-none" />
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Failed Message Runs</p>
                <h3 className="text-2xl lg:text-3xl font-extrabold text-rose-400 mt-2 font-mono">
                  {analytics.failedMessages}
                </h3>
              </button>
            </div>
          )}
 
          {/* Funnel Visualisation */}
          {analytics && (
            <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 mb-8 backdrop-blur-md relative overflow-hidden">
              <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                Post-Delivery Funnel Conversion
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
                {[
                  { label: 'Welcome (Day 0)', count: analytics.welcomeSent, stageKey: 'DELIVERED' },
                  { label: 'Reminder (Day 1)', count: analytics.day1Sent, stageKey: 'DAY1' },
                  { label: 'Usage Tips (Day 3)', count: analytics.day3Sent, stageKey: 'DAY3' },
                  { label: 'Day 4', count: analytics.day4Sent, stageKey: 'DAY4' },
                  { label: 'Day 5', count: analytics.day5Sent || 0, stageKey: 'DAY5' },
                ].map((item, idx) => (
                  <div key={idx} className="flex flex-col relative">
                    <button
                      onClick={() => {
                        setStage(stage === item.stageKey ? 'all' : item.stageKey);
                        setStatus('all');
                        setPage(1);
                      }}
                      className={`w-full p-3 rounded-xl text-center relative z-10 transition-all duration-300 hover:scale-[1.02] focus:outline-none border ${
                        stage === item.stageKey
                          ? 'bg-purple-500/10 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                          : 'bg-white/5 border-white/5 hover:border-purple-500/30'
                      }`}
                    >
                      <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider">{item.label}</p>
                      <h4 className="text-lg lg:text-xl font-black text-white mt-1 font-mono">{item.count}</h4>
                    </button>
                    {idx < 4 && (
                      <div className="hidden md:block absolute right-[-10%] top-1/2 -translate-y-1/2 z-0">
                        <ArrowRight className="w-4 h-4 text-white/20" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters Panel */}
          <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 lg:p-6 mb-8 backdrop-blur-md">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
              {/* Search */}
              <div className="flex flex-col gap-1.5">
                <label className="text-white/40 text-xs font-semibold">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    placeholder="Phone or Order ID..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Stage Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-white/40 text-xs font-semibold">Journey Stage</label>
                <select
                  value={stage}
                  onChange={(e) => { setStage(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
                >
                  <option value="all" className="bg-[#100c28]">All Stages</option>
                  <option value="DELIVERED" className="bg-[#100c28]">Day 0: Welcome</option>
                  <option value="DAY1" className="bg-[#100c28]">Day 1: Reminder</option>
                  <option value="DAY3" className="bg-[#100c28]">Day 3: Usage Tips</option>
                  <option value="DAY4" className="bg-[#100c28]">Day 4: Benefits</option>
                  <option value="DAY5" className="bg-[#100c28]">Day 5: Check-in</option>
                  <option value="COMPLETED" className="bg-[#100c28]">Completed</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex flex-col gap-1.5">
                <label className="text-white/40 text-xs font-semibold">Status</label>
                <select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
                >
                  <option value="all" className="bg-[#100c28]">All Statuses</option>
                  <option value="active" className="bg-[#100c28]">Active (In-Progress)</option>
                  <option value="completed" className="bg-[#100c28]">Completed</option>
                  <option value="failed" className="bg-[#100c28]">Failed Run</option>
                </select>
              </div>

              {/* Delivery Start Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-white/40 text-xs font-semibold">Delivery Date From</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                    className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Delivery End Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-white/40 text-xs font-semibold">Delivery Date To</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                    className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Table / List */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
              <p className="text-white/50 text-sm font-semibold">Loading journeys list...</p>
            </div>
          ) : journeys.length === 0 ? (
            <div className="bg-white/[0.01] border border-white/10 rounded-2xl p-12 text-center backdrop-blur-md">
              <Route className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <h3 className="text-white/60 font-semibold text-lg mb-2">No Journeys Found</h3>
              <p className="text-white/30 text-sm max-w-md mx-auto">
                No customer journeys matched the specified criteria. Journeys are created automatically when orders are delivered.
              </p>
            </div>
          ) : (
            <div className="bg-white/[0.01] border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02]">
                      <th className="px-4 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Order ID</th>
                      <th className="px-4 py-4 text-left text-xs font-bold text-white/40 uppercase tracking-wider">Delivered Date</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Stage</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Welcome</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Day 1</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Day 3</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Day 4</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Day 5</th>
                      <th className="px-4 py-4 text-center text-xs font-bold text-white/40 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {journeys.map((j) => (
                      <tr key={j.id} className="hover:bg-white/[0.02] transition-colors">
                        {/* Customer */}
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-white font-semibold text-sm">{j.customerName}</p>
                            <p className="text-white/40 text-xs font-mono mt-0.5">{j.customerPhone}</p>
                          </div>
                        </td>

                        {/* Order ID */}
                        <td className="px-4 py-4">
                          <span className="text-white font-mono text-sm">{j.orderId}</span>
                        </td>

                        {/* Delivered Date */}
                        <td className="px-4 py-4 text-white/60 text-xs">
                          {formatDate(j.deliveredAt)}
                        </td>

                        {/* Current Stage */}
                        <td className="px-4 py-4 text-center">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            j.currentStage === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          }`}>
                            {j.currentStage}
                          </span>
                        </td>

                        {/* Welcome Status */}
                        <td className="px-4 py-4 text-center">
                          {renderStatusBadge(j.welcomeSent, j.currentStage === 'DELIVERED' && !!j.lastError, j.welcomeSentAt)}
                        </td>

                        {/* Day 1 Status */}
                        <td className="px-4 py-4 text-center">
                          {renderStatusBadge(j.day1Sent, j.currentStage === 'DAY1' && !!j.lastError, j.day1SentAt)}
                        </td>

                        {/* Day 3 Status */}
                        <td className="px-4 py-4 text-center">
                          {renderStatusBadge(j.day3Sent, j.currentStage === 'DAY3' && !!j.lastError, j.day3SentAt)}
                        </td>

                        {/* Day 4 Status */}
                        <td className="px-4 py-4 text-center">
                          {renderStatusBadge(j.day4Sent, j.currentStage === 'DAY4' && !!j.lastError, j.day4SentAt)}
                        </td>

                        {/* Day 5 Status */}
                        <td className="px-4 py-4 text-center">
                          {renderStatusBadge(j.day5Sent, j.currentStage === 'DAY5' && !!j.lastError, j.day5SentAt)}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* View Journey */}
                            <Link
                              href={`/crm/customer-journeys/${encodeURIComponent(j.id)}`}
                              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>

                            {/* Retry Action (Enabled if there is a lastError on the current stage) */}
                            {j.lastError && j.currentStage !== 'COMPLETED' && (
                              <button
                                onClick={() => handleAction(j.id, 'retry')}
                                disabled={!!actionLoading}
                                className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 transition-all disabled:opacity-50"
                                title="Retry Failed Message"
                              >
                                {actionLoading === `${j.id}-retry-` ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4" />
                                )}
                              </button>
                            )}

                            {/* Manual Trigger (if no error and not completed) */}
                            {!j.lastError && j.currentStage !== 'COMPLETED' && (
                              <button
                                onClick={() => {
                                  // Manual trigger the next logical stage
                                  const nextStage = j.currentStage === 'DELIVERED' 
                                    ? 'DAY1' 
                                    : j.currentStage === 'DAY1' 
                                      ? 'DAY3' 
                                      : j.currentStage === 'DAY3' 
                                        ? 'DAY4' 
                                        : 'DAY5';
                                  handleAction(j.id, 'trigger', nextStage);
                                }}
                                disabled={!!actionLoading}
                                className="p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border border-purple-500/20 transition-all disabled:opacity-50"
                                title="Trigger Next Stage Manually"
                              >
                                {actionLoading?.startsWith(`${j.id}-trigger-`) ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Send className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls */}
              <div className="px-4 py-4 bg-white/[0.01] border-t border-white/10 flex items-center justify-between">
                <span className="text-white/40 text-xs font-semibold">
                  Showing {journeys.length} of {totalItems} journeys
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white text-xs font-bold transition-all"
                  >
                    Previous
                  </button>
                  <span className="text-white/60 text-xs px-2 font-mono">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 rounded-lg text-white text-xs font-bold transition-all"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
