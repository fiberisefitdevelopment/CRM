'use client'

import { useState, useEffect, useCallback } from 'react'
import { SubNav } from '@/components/whatsapp/SubNav'
import { TemplateModal } from '@/components/whatsapp/TemplateModal'
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedTemplates,
} from '@/lib/whatsappApi'
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Hash,
  Tag,
  Zap,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TemplateRow {
  id: string
  templateName: string
  campaignName: string
  templateId: string
  dayNumber: number
  messageContent: string
  variables: string[]
  active: boolean
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingTemplate, setEditingTemplate] = useState<TemplateRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const loadTemplates = useCallback(async (autoSeed = false) => {
    try {
      const data = await fetchTemplates()
      setTemplates(data || [])

      // Auto-seed FYBER templates on first load if none exist
      if (autoSeed && (!data || data.length === 0)) {
        setSeeding(true)
        try {
          await seedTemplates()
          const refreshed = await fetchTemplates()
          setTemplates(refreshed || [])
        } catch (seedErr) {
          console.error('Auto-seed failed:', seedErr)
        } finally {
          setSeeding(false)
        }
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates(true) // Auto-seed on first mount
  }, [loadTemplates])

  const handleSyncTemplates = async () => {
    setSeeding(true)
    try {
      await seedTemplates()
      await loadTemplates()
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSeeding(false)
    }
  }

  const handleCreate = () => {
    setEditingTemplate(null)
    setModalMode('create')
    setModalOpen(true)
  }

  const handleEdit = (template: TemplateRow) => {
    setEditingTemplate(template)
    setModalMode('edit')
    setModalOpen(true)
  }

  const handleSave = async (data: any) => {
    if (modalMode === 'create') {
      await createTemplate(data)
    } else if (editingTemplate) {
      await updateTemplate(editingTemplate.id, data)
    }
    await loadTemplates()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template mapping?')) return
    setDeletingId(id)
    try {
      await deleteTemplate(id)
      await loadTemplates()
    } catch (err) {
      console.error('Failed to delete template:', err)
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleActive = async (template: TemplateRow) => {
    try {
      await updateTemplate(template.id, { active: !template.active })
      await loadTemplates()
    } catch (err) {
      console.error('Failed to toggle template:', err)
    }
  }

  // Day label mapping — FYBER journey
  const getDayLabel = (day: number) => {
    if (day === 0) return 'Welcome — Delivered'
    if (day === 1) return 'Daily FYBER Reminder'
    if (day === 3) return 'Early Wins Check-in'
    if (day === 5) return 'Craving Control Tips'
    if (day === 7) return 'Week One Celebration'
    return `Day ${day} Message`
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="ml-0 lg:ml-64 p-4 lg:p-6">
        <div className="max-w-7xl mx-auto mt-20">
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-emerald-500/30">
                    <FileText className="w-5 h-5 text-emerald-400" />
                  </div>
                  WhatsApp Templates
                </h1>
                <p className="text-white/50 text-sm mt-1">
                  Map AiSensy templates to journey days
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSyncTemplates}
                  disabled={seeding}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {seeding ? 'Syncing...' : 'Sync FYBER Templates'}
                </button>
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                >
                  <Plus className="w-4 h-4" />
                  Map Template
                </button>
              </div>
            </div>
          </div>

          {/* Sub Navigation */}
          <SubNav />

          {/* Template Grid */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                <p className="text-white/50">Loading templates...</p>
              </div>
            </div>
          ) : templates.length === 0 ? (
            <div className="bg-card rounded-2xl p-12 border border-white/10 text-center">
              <FileText className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <h3 className="text-white/60 font-semibold text-lg mb-2">No Templates Mapped</h3>
              <p className="text-white/30 text-sm mb-6">
                Map your AiSensy templates to journey days to enable automated messaging.
              </p>
              <button
                onClick={handleCreate}
                className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-500/20"
              >
                <Plus className="w-4 h-4" />
                Map First Template
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    'bg-card rounded-2xl p-5 border transition-all duration-300 group',
                    template.active
                      ? 'border-white/10 hover:border-emerald-500/30'
                      : 'border-white/5 opacity-60'
                  )}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/15 to-blue-500/15 border border-purple-500/20 flex items-center justify-center">
                        <span className="text-white font-bold text-lg">{template.dayNumber}</span>
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm">{getDayLabel(template.dayNumber)}</p>
                        <p className="text-white/30 text-[11px]">Day {template.dayNumber}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleActive(template)}
                      className="transition-colors"
                      title={template.active ? 'Deactivate' : 'Activate'}
                    >
                      {template.active ? (
                        <ToggleRight className="w-6 h-6 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-white/20" />
                      )}
                    </button>
                  </div>

                  {/* Template Details */}
                  <div className="space-y-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-white/30" />
                      <span className="text-white/60 text-xs font-mono truncate">{template.templateName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-white/30" />
                      <span className="text-white/60 text-xs truncate">{template.campaignName || '—'}</span>
                    </div>
                    {template.messageContent && (
                      <p className="text-white/40 text-xs leading-relaxed line-clamp-2 pl-5">
                        {template.messageContent}
                      </p>
                    )}
                  </div>

                  {/* Variables */}
                  {template.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {template.variables.map((v) => (
                        <span
                          key={v}
                          className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-white/50 font-mono"
                        >
                          {'{{'}{v}{'}}'}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                    <button
                      onClick={() => handleEdit(template)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 hover:text-white text-xs font-semibold transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      disabled={deletingId === template.id}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-lg text-white/30 hover:text-red-400 text-xs font-semibold transition-all"
                    >
                      {deletingId === template.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Template Modal */}
      <TemplateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initialData={editingTemplate || undefined}
        mode={modalMode}
      />
    </div>
  )
}
