'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, VolumeX, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/auth'
import { getRecordingStreamUrl } from '@/lib/customerServiceApi'
import { cn } from '@/lib/utils'

interface CallAudioPlayerProps {
  callId: string
  recUrl?: string
  /** Override the default recording proxy, e.g. care-task device recordings. */
  streamUrl?: string
  compact?: boolean
  className?: string
}

export function CallAudioPlayer({ callId, streamUrl, className }: CallAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const [src, setSrc] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const revoke = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }

    setSrc('')
    setLoading(false)
    setReady(false)
    setError(null)
    revoke()

    if (!callId) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        // <audio src> cannot send Authorization — fetch via apiFetch then play a blob URL
        const res = await apiFetch(streamUrl || getRecordingStreamUrl(callId, 'proxy'), {
          cache: 'no-store',
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(
            (data as { error?: string })?.error ||
              (res.status === 401
                ? 'Unauthorized. Please sign in again.'
                : res.status === 404
                  ? 'Recording not available.'
                  : 'Unable to load recording'),
          )
        }
        const blob = await res.blob()
        if (!blob || blob.size === 0) {
          throw new Error('Recording file is empty.')
        }
        if (cancelled) return
        const type =
          blob.type && blob.type.startsWith('audio/')
            ? blob.type
            : 'audio/mp4'
        const objectUrl = URL.createObjectURL(new Blob([blob], { type }))
        blobUrlRef.current = objectUrl
        setSrc(objectUrl)
        setReady(true)
      } catch (err: any) {
        if (cancelled) return
        setError(err?.message || 'Unable to load recording')
        setReady(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
      revoke()
    }
  }, [callId, streamUrl])

  const handleDownload = async () => {
    if (!callId || downloading) return
    setDownloading(true)
    try {
      const downloadUrl = streamUrl
        ? `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}download=1`
        : `${getRecordingStreamUrl(callId, 'proxy')}&download=1`
      const res = await apiFetch(downloadUrl, { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Download failed')
      }
      const blob = await res.blob()
      const type = blob.type || 'audio/mp4'
      const ext = type.includes('wav') ? 'wav' : type.includes('mpeg') || type.includes('mp3') ? 'mp3' : 'm4a'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recording-${callId}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  if (!callId) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/40">
        <VolumeX className="w-3.5 h-3.5" />
        Recording not available
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2 w-full', className)}>
      <div className="flex items-center gap-2">
        {loading && !ready && (
          <Loader2 className="w-4 h-4 text-purple-300 animate-spin shrink-0" />
        )}
        <audio
          ref={audioRef}
          key={src || callId}
          controls
          preload="metadata"
          className="h-9 flex-1 min-w-0"
          src={src || undefined}
          onCanPlay={() => {
            setReady(true)
          }}
          onError={() => {
            if (!src) return
            setReady(false)
            setError('Unable to play recording')
          }}
        />
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloading || loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/10 transition-colors shrink-0 disabled:opacity-50"
          title="Download recording"
        >
          {downloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Download
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <VolumeX className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </div>
  )
}
