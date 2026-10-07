'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/app/actions';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** A form bound to a server action that shows its success or error message. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
  'aria-label': ariaLabel,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  'aria-label'?: string;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      aria-label={ariaLabel}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {(state.error || state.ok) && (
        <p role={state.error ? 'alert' : 'status'} className={`msg ${state.error ? 'err' : 'ok'} full`}>
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, className = 'btn primary', pendingText = '처리 중…' }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Current KST time formatted for <input type="datetime-local">. */
export function nowLocal(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16);
}

export function DateTimeField({ name = 'tradeAt', label = '거래 일시 (KST)' }: { name?: string; label?: string }) {
  return (
    <label className="field">
      {label}
      <input type="datetime-local" name={name} defaultValue={nowLocal()} required />
    </label>
  );
}
