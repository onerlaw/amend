interface WorkspaceBadgeProps {
  className?: string;
}

export function WorkspaceBadge({ className = '' }: WorkspaceBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none font-medium ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      <span className="text-amber-300">Isolated</span>
    </span>
  );
}
