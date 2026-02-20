import Link from 'next/link';
import { CHANGELOG_ENTRIES, type ChangeType } from '@/lib/changelog-data';

export const metadata = {
  title: 'Changelog — Cayenne',
  description: 'Recent changes and updates to the Cayenne Reddit marketing intelligence agent.',
};

const TYPE_STYLES: Record<ChangeType, { label: string; bg: string; text: string }> = {
  feature: { label: 'Feature', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  fix: { label: 'Fix', bg: 'bg-amber-500/15', text: 'text-amber-400' },
  improvement: { label: 'Improvement', bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-accent)] mb-4 inline-block"
        >
          &larr; Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">Changelog</h1>
        <p className="text-[var(--text-secondary)] mt-1">
          Recent updates to Cayenne.
        </p>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--border-primary)]" />

        <div className="space-y-8">
          {CHANGELOG_ENTRIES.map((entry, i) => {
            const style = TYPE_STYLES[entry.type];
            return (
              <div key={i} className="relative pl-8">
                {/* Dot */}
                <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-[var(--border-primary)] bg-[var(--background-primary)]" />

                <div className="glass-card p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}
                    >
                      {style.label}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">{entry.date}</span>
                  </div>
                  <h3 className="text-[var(--text-primary)] font-semibold mb-1">{entry.title}</h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {entry.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
