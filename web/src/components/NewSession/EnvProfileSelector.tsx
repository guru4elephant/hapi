import { useTranslation } from '@/lib/use-translation'
import { SelectControl } from '@/components/ui/select-control'

/**
 * Runner env profile picker. Only names are shown; the runner reads the
 * values from its own $HAPI_HOME/env-profiles/<name>.env at spawn time.
 */
export function EnvProfileSelector(props: {
    profiles: readonly string[]
    value: string
    isDisabled: boolean
    onChange: (value: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label htmlFor="new-session-env-profile" className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.envProfile')}
            </label>
            <SelectControl
                id="new-session-env-profile"
                value={props.value}
                onChange={(e) => props.onChange(e.target.value)}
                disabled={props.isDisabled}
                className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] py-2 pl-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                <option value="">{t('newSession.envProfile.none')}</option>
                {props.profiles.map((name) => (
                    <option key={name} value={name}>{name}</option>
                ))}
            </SelectControl>
            <span className="text-xs text-[var(--app-hint)]">
                {t('newSession.envProfile.desc')}
            </span>
        </div>
    )
}
