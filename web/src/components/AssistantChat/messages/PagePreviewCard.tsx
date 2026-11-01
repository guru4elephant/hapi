import { useState } from 'react'
import type { GeneratedPageBlock } from '@/chat/types'
import { useTranslation } from '@/lib/use-translation'

/**
 * Inline preview for a `generated-page` agent block.
 *
 * Renders the page in a sandboxed iframe so agent-supplied HTML/URLs cannot
 * reach the parent document. The iframe is collapsed by default (a header
 * strip with the title and an Open button) and expands on user intent —
 * avoids auto-loading arbitrary remote content and keeps the chat scroll
 * clean. Sandbox allows scripts (pages often need them) but NOT
 * same-origin, so the iframe cannot read the parent's cookies/storage.
 */
export function PagePreviewCard(props: { block: GeneratedPageBlock }) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)

    const title = props.block.title?.trim() || props.block.url
    const isDataUrl = props.block.url.startsWith('data:')
    const openLabel = expanded ? t('pagePreview.collapse') : t('pagePreview.expand')

    return (
        <div className="my-2 overflow-hidden rounded-xl border border-[var(--app-md-quote-border)] bg-[var(--app-bg)]">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--app-fg)]/70">
                    <svg
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
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="M2 9h20" />
                        <circle cx="5" cy="6.5" r="0.5" fill="currentColor" />
                        <circle cx="7" cy="6.5" r="0.5" fill="currentColor" />
                    </svg>
                    <span className="truncate">{title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {!isDataUrl && (
                        <a
                            href={props.block.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[var(--app-link)] hover:underline"
                        >
                            {t('pagePreview.openExternal')}
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="rounded-md bg-[var(--app-bg)] px-2 py-1 text-xs font-medium text-[var(--app-fg)]/70 hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-expanded={expanded}
                        aria-controls={`page-preview-frame-${props.block.id}`}
                    >
                        {openLabel}
                    </button>
                </div>
            </div>
            {expanded && (
                <div className="border-t border-[var(--app-md-quote-border)]">
                    <iframe
                        id={`page-preview-frame-${props.block.id}`}
                        title={title}
                        src={props.block.url}
                        sandbox="allow-scripts allow-forms allow-popups"
                        className="h-[360px] w-full bg-white"
                        onLoad={() => setLoadError(null)}
                        onError={() => setLoadError(t('pagePreview.loadFailed'))}
                    />
                    {loadError && (
                        <div className="px-3 py-2 text-xs text-red-500">{loadError}</div>
                    )}
                </div>
            )}
        </div>
    )
}
