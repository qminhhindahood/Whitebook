export type IconProps = { className?: string };

export function BookMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 64 52" aria-hidden="true">
      <path d="M4 5c11 0 20 3 28 10v33C24 41 15 38 4 38V5Z" />
      <path d="M60 5c-11 0-20 3-28 10v33c8-7 17-10 28-10V5Z" />
    </svg>
  );
}

export function LineIcon({
  name,
  className,
}: {
  name:
    | "library"
    | "upload"
    | "history"
    | "shield"
    | "chevron"
    | "close"
    | "bookmark"
    | "calculator"
    | "reference"
    | "exit"
    | "alert";
  className?: string;
}) {
  const paths = {
    library: (
      <>
        <path d="M4 5.5h13.5A2.5 2.5 0 0 1 20 8v11H6.5A2.5 2.5 0 0 1 4 16.5v-11Z" />
        <path d="M7 5.5v11h13M9.5 9h6M9.5 12h6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
        <path d="M5 13v6h14v-6" />
      </>
    ),
    history: (
      <>
        <path d="M5.2 7.1A8 8 0 1 1 4 13" />
        <path d="M4 5v5h5M12 8v5l3 2" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2 21 5.5V12c0 5.8-3.6 10.5-9 13.5C6.6 22.5 3 17.8 3 12V5.5L12 2Z" />
        <path d="m8.5 12.5 2.5 2.5 5-6" />
      </>
    ),
    chevron: <path d="m6 9.5 6 6 6-6" />,
    close: <path d="M5 5l14 14M19 5 5 19" />,
    bookmark: <path d="M7 3.5h10V21l-5-3.5L7 21V3.5Z" />,
    calculator: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8.5 7h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01M8.5 19h.01M12 19h.01M15.5 19h.01" />
      </>
    ),
    reference: (
      <>
        <path d="M4 18 9 6l5 12M5.8 14h6.4" />
        <path d="M17 6c2.8 0 4 1.6 4 3.6V18M17 12h4" />
      </>
    ),
    exit: (
      <>
        <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
        <path d="M10 8l-4 4 4 4M6 12h10" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
  };
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
