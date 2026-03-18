import clsx from 'clsx'

interface Props {
  label:    string
  value:    string | number
  sub?:     string
  color?:   'cyan' | 'green' | 'amber' | 'red'
  icon?:    React.ReactNode
}

const colorMap = {
  cyan:  'text-accent',
  green: 'text-green',
  amber: 'text-amber',
  red:   'text-red',
}

export default function StatCard({ label, value, sub, color = 'cyan', icon }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div>
        <span className={clsx('text-3xl font-bold font-mono', colorMap[color])}>{value}</span>
        {sub && <p className="text-muted text-xs mt-1">{sub}</p>}
      </div>
    </div>
  )
}
