'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, VolumeX, Loader2 } from 'lucide-react'
import { getRecordingStreamUrl } from '@/lib/customerServiceApi'
import { cn } from '@/lib/utils'

interface CallAudioPlayerProps {
  callId: string
  recUrl?: string
  compact?: boolean
  className?: string
}

export function CallAudioPlayer({ callId, className }: CallAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Authenticated CRM proxy — Salestrail recUrl requires Basic auth and must not be used in <audio>
  const src = callId ? getRecordingStreamUrl(callId, 'proxy') : ''
  const downloadHref = callId
    ? `${getRecordingStreamUrl(callId, 'proxy')}&download=1`
    : ''

  useEffect(() => {
    setLoading(false)
    setReady(false)
    setError(null)
  }, [callId])

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
          key={src}
          controls
          preload="metadata"
          className="h-9 flex-1 min-w-0"
          src={src}
          onLoadStart={() => {
            setLoading(true)
            setError(null)
          }}
          onLoadedMetadata={() => {
            setLoading(false)
            setReady(true)
          }}
          onCanPlay={() => {
            setLoading(false)
            setReady(true)
          }}
          onError={() => {
            setLoading(false)
            setReady(false)
            setError('Unable to load recording')
          }}
        />
        <a
          href={downloadHref}
          download={`recording-${callId}.m4a`}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm font-semibold hover:bg-white/10 transition-colors shrink-0"
          title="Download recording"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <VolumeX className="w-3.5 h-3.5" />
          {error}. Try Download.
        </p>
      )}
    </div>
  )
}
