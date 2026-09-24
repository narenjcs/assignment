import type { ReactElement } from 'react';

import type { JobStatus } from '../types/job';

export interface StepperProps {
  status: JobStatus;
}

const STEPS: readonly JobStatus[] = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
];

const STEP_LABELS: Record<JobStatus, string> = {
  PENDING_UPLOAD: 'Pending upload',
  UPLOADED: 'Uploaded',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

type StepState = 'done' | 'current' | 'upcoming' | 'failed';

function stateClasses(state: StepState): string {
  switch (state) {
    case 'done':
      return 'border-state-done bg-state-done text-white';
    case 'current':
      return 'border-accent bg-accent text-white';
    case 'failed':
      return 'border-state-failed bg-state-failed text-white';
    default:
      return 'border-slate-300 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900';
  }
}

function stepState(
  step: JobStatus,
  index: number,
  currentIndex: number,
  failed: boolean,
): StepState {
  const isLastStep = index === STEPS.length - 1;
  if (failed && isLastStep) return 'failed';
  if (index < currentIndex || (!failed && index === currentIndex && step === 'COMPLETED'))
    return 'done';
  if (index === currentIndex) return 'current';
  return 'upcoming';
}

/** Horizontal progress stepper for the job status state machine (PLAN §2.4). */
export function Stepper({ status }: StepperProps): ReactElement {
  const failed = status === 'FAILED';
  const currentIndex = failed ? STEPS.length - 1 : STEPS.indexOf(status);

  return (
    <ol className="flex items-center gap-2" aria-label="Job progress">
      {STEPS.map((step, index) => {
        const state = stepState(step, index, currentIndex, failed);
        const label = index === STEPS.length - 1 && failed ? STEP_LABELS.FAILED : STEP_LABELS[step];
        return (
          <li key={step} className="flex flex-1 flex-col items-center gap-1 text-center">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${stateClasses(state)}`}
            >
              {index + 1}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
