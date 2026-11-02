import { useRef, useState } from 'react'
import { useTypelessDictation, type TypelessStatus } from '@/hooks/useTypelessDictation'
import { useTranslation } from '@/lib/use-translation'

function MicIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    )
}

function SpinnerIcon() {
    return (
        <svg
            className="animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.85" />
        </svg>
    )
}

function LockIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    )
}

function buttonClasses(status: TypelessStatus, supported: boolean): string {
    const base = 'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'

    if (status === 'recording') {
        return `${base} bg-red-500 text-white hover:bg-red-600`
    }
    if (status === 'transcribing') {
        return `${base} bg-[var(--app-bg)] text-[var(--app-fg)]/50 cursor-wait`
    }
    if (status === 'error') {
        return `${base} text-red-500 hover:bg-[var(--app-bg)]`
    }
    if (!supported) {
        return `${base} text-[var(--app-fg)]/30 hover:bg-[var(--app-bg)]`
    }
    return `${base} text-[var(--app-fg)]/60 hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]`
}

export function TypelessVoiceButton(props: {
    getCurrentText: () => string
    onTextChange: (text: string) => void
    disabled?: boolean
}) {
    const { t } = useTranslation()
    const dictation = useTypelessDictation({
        getCurrentText: props.getCurrentText,
        onTextChange: props.onTextChange,
    })
    const buttonRef = useRef<HTMLButtonElement>(null)
    const [showHint, setShowHint] = useState(false)

    // Not a secure context — getUserMedia is unavailable on plain HTTP (non-localhost).
    // Show a lock icon + tooltip instead of silently disabling.
    const insecureContext = typeof window !== 'undefined'
        && !window.isSecureContext
        && window.location.hostname !== 'localhost'
        && window.location.hostname !== '127.0.0.1'

    const effectivelySupported = dictation.supported && !insecureContext

    const label = dictation.status === 'recording'
        ? t('composer.typelessStop')
        : dictation.status === 'transcribing'
            ? t('composer.typelessTranscribing')
            : insecureContext
                ? t('composer.typelessHttpsRequired')
                : t('composer.typelessVoice')

    const handleClick = () => {
        if (!effectivelySupported) {
            setShowHint((v) => !v)
            return
        }
        dictation.toggle()
    }

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                aria-label={label}
                title={label}
                disabled={props.disabled || dictation.status === 'transcribing'}
                onClick={handleClick}
                className={buttonClasses(dictation.status, effectivelySupported)}
            >
                {dictation.status === 'transcribing'
                    ? <SpinnerIcon />
                    : !effectivelySupported
                        ? <LockIcon />
                        : <MicIcon />}
                {dictation.status === 'recording' && (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-red-400/70 motion-safe:animate-ping"
                    />
                )}
            </button>
            {showHint && !effectivelySupported && (
                <div className="absolute bottom-full right-0 mb-2 w-48 rounded-lg bg-[var(--app-fg)] px-3 py-2 text-xs text-[var(--app-bg)] shadow-lg">
                    {t('composer.typelessHttpsHint')}
                    <div className="absolute -bottom-1 right-3 h-2 w-2 rotate-45 bg-[var(--app-fg)]" />
                </div>
            )}
            {dictation.status === 'error' && dictation.error && (
                <div className="absolute bottom-full right-0 mb-2 max-w-56 rounded-lg bg-red-500 px-3 py-2 text-xs text-white shadow-lg">
                    {dictation.error}
                    <div className="absolute -bottom-1 right-3 h-2 w-2 rotate-45 bg-red-500" />
                </div>
            )}
        </div>
    )
}


