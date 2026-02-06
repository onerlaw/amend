interface IconProps {
  className?: string;
}

export function CloseIcon({ className = 'h-3 w-3' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="currentColor">
      <path d="M9.5 3.205L8.795 2.5 6 5.295 3.205 2.5l-.705.705L5.295 6 2.5 8.795l.705.705L6 6.705 8.795 9.5l.705-.705L6.705 6z" />
    </svg>
  );
}

export function ChevronIcon({ className = 'h-3 w-3' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 4l4 4-4 4V4z" />
    </svg>
  );
}

export function FolderIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M14.5 3H7.707l-.853-.854L6.5 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zM14 13H2V3h4.293l.853.854.354.146H14v9z" />
    </svg>
  );
}

export function FileIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.85 4.44l-3.28-3.3-.35-.14H3.5l-.5.5v13l.5.5h10l.5-.5V4.8l-.15-.36zM10 1.94L12.06 4H10V1.94zM13 14H4V2h5v2.5l.5.5H13v9z" />
    </svg>
  );
}

export function RefreshIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-1.124 2.876l-.021.165.033.163.071.345c.013.065.027.134.041.204H8.46l3.027 3.097L14.58 8.92l-2.857.07.035-.146.019-.074.012-.039v-.039c.212-1.082.211-2.136-.338-3.083zM6.514 6.027L3.487 2.933.393 6.028l2.86-.07-.037.147-.018.072-.013.04v.04c-.211 1.082-.21 2.136.339 3.083l.578.939 1.068-.812.076-.094c.335-.415.927-1.341 1.124-2.876l.021-.165-.033-.163-.071-.345a7.085 7.085 0 00-.041-.204h2.269L6.514 6.027z" />
    </svg>
  );
}

export function SearchIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M15.25 13.371l-3.5-3.5c-.063-.063-.131-.11-.2-.152a5.5 5.5 0 1 0-.879.879c.042.069.09.137.152.2l3.5 3.5a.75.75 0 0 0 1.061-1.061l-.134.134zM6.5 10.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
    </svg>
  );
}

export function PlusIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1v6H2v1h6v6h1V8h6V7H9V1z" />
    </svg>
  );
}
