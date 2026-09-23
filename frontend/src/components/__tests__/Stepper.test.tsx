import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Stepper } from '../Stepper';

describe('Stepper', () => {
  it('renders every step label', () => {
    render(<Stepper status="QUEUED" />);
    for (const label of ['Pending upload', 'Uploaded', 'Queued', 'Processing', 'Completed']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('marks the current step with aria-current="step"', () => {
    render(<Stepper status="PROCESSING" />);
    const current = screen.getByText('4');
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('has no aria-current when the job has not started (PENDING_UPLOAD)', () => {
    render(<Stepper status="PENDING_UPLOAD" />);
    const step = screen.getByText('1');
    expect(step).toHaveAttribute('aria-current', 'step');
  });

  it('shows a "Failed" label on the last step when the job failed', () => {
    render(<Stepper status="FAILED" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('renders the list with an accessible name', () => {
    render(<Stepper status="COMPLETED" />);
    expect(screen.getByRole('list', { name: 'Job progress' })).toBeInTheDocument();
  });
});
