import type { ReactNode } from "react";

export function LoadingLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <svg
        className="button-spinner"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 2v4m7.07-1.07-2.83 2.83M22 12h-4m1.07 7.07-2.83-2.83M12 22v-4m-7.07 1.07 2.83-2.83M2 12h4M4.93 4.93l2.83 2.83" />
      </svg>
      {children}
    </>
  );
}
