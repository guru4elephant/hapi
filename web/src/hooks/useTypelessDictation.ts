import { useCallback, useEffect, useRef, useState } from 'react'
import { appendTranscript } from './useDictation'

const TYPELESS_BASE = '/asr'
const POLL_INTERVAL_MS = 1200
const POLL_TIMEOUT_MS = 60_000

export type TypelessStatus = 'idle' | 'recording' | 'transcribing' | 'error'

function preferredMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
    return [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
        'audio/ogg;codecs=opus',
    ].find((t) => MediaRecorder.isTypeSupported(t))
}

function recordingExtension(mimeType: string): string {
    if (mimeType.includes('mp4')) return 'm4a'
    if (mimeType.includes('ogg')) return 'ogg'
    return 'webm'
}

async function uploadAndTranscribe(blob: Blob, ext: string): Promise<string> {
    const form = new FormData()
    form.append('file', new File([blob], `speech.${ext}`, { type: blob.type }))
    const uploadRes = await fetch(`${TYPELESS_BASE}/v1/transcriptions`, { method: 'POST', body: form })
    if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail ?? `Upload failed (${uploadRes.status})`)
    }
    const job = await uploadRes.json() as { id: string }

    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS))
        const pollRes = await fetch(`${TYPELESS_BASE}/v1/transcriptions/${job.id}`)
        if (!pollRes.ok) throw new Error(`Poll failed (${pollRes.status})`)
        const state = await pollRes.json() as { status: string; result_url?: string; error?: string }
        if (state.status === 'succeeded' && state.result_url) {
            const textRes = await fetch(state.result_url)
            const data = await textRes.json() as { text?: string }
            return data.text ?? ''
        }
        if (state.status === 'failed') {
            throw new Error(state.error ?? 'Transcription failed')
        }
    }
    throw new Error('Transcription timed out')
}

export function useTypelessDictation(options: {
    getCurrentText: () => string
    onTextChange: (text: string) => void
}) {
    const [status, setStatus] = useState<TypelessStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const mountedRef = useRef(true)
    const recorderRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const operationRef = useRef(0)
    const optionsRef = useRef(options)
    optionsRef.current = options

    const stopTracks = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
    }, [])

    const start = useCallback(async () => {
        if (status !== 'idle' && status !== 'error') return
        setError(null)
        const mimeType = preferredMimeType()
        const op = ++operationRef.current
        setStatus('recording')

        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            })
        } catch (e) {
            if (!mountedRef.current || operationRef.current !== op) return
            setError(e instanceof Error ? e.message : 'Microphone access denied')
            setStatus('error')
            return
        }

        if (operationRef.current !== op) {
            stream.getTracks().forEach((t) => t.stop())
            return
        }

        streamRef.current = stream
        chunksRef.current = []
        const recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream)
        recorderRef.current = recorder
        const actualType = recorder.mimeType || mimeType || 'audio/webm'

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.onstop = async () => {
            stopTracks()
            if (operationRef.current !== op) return
            const blob = new Blob(chunksRef.current, { type: actualType })
            chunksRef.current = []
            recorderRef.current = null

            if (!blob.size) {
                if (mountedRef.current) { setError('No audio recorded'); setStatus('error') }
                return
            }

            if (mountedRef.current) setStatus('transcribing')

            try {
                const text = await uploadAndTranscribe(blob, recordingExtension(actualType))
                if (mountedRef.current && operationRef.current === op) {
                    if (text.trim()) {
                        optionsRef.current.onTextChange(
                            appendTranscript(optionsRef.current.getCurrentText(), text)
                        )
                    }
                    setStatus('idle')
                }
            } catch (e) {
                if (mountedRef.current && operationRef.current === op) {
                    setError(e instanceof Error ? e.message : 'Transcription failed')
                    setStatus('error')
                }
            }
        }

        recorder.start()
    }, [status, stopTracks])

    const stop = useCallback(() => {
        const recorder = recorderRef.current
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop()
        } else {
            stopTracks()
            if (mountedRef.current) setStatus('idle')
        }
    }, [stopTracks])

    const toggle = useCallback(() => {
        if (status === 'recording') stop()
        else if (status === 'idle' || status === 'error') void start()
    }, [status, start, stop])

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            operationRef.current += 1
            const recorder = recorderRef.current
            if (recorder && recorder.state !== 'inactive') recorder.stop()
            stopTracks()
        }
    }, [stopTracks])

    const supported = typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.getUserMedia === 'function'
        && typeof MediaRecorder !== 'undefined'

    return { supported, status, error, toggle }
}
