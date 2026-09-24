import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { JobDetail } from '../JobDetail';
import { makeJob } from '../../../tests/fixtures/job';

describe('JobDetail', () => {
  it('shows an empty state when no job is selected', () => {
    render(<JobDetail job={null} />);
    expect(screen.getByText('No job selected')).toBeInTheDocument();
  });

  it('renders the file name, status badge, and agent trace for an in-progress job', () => {
    render(<JobDetail job={makeJob()} />);
    expect(screen.getByText('quarterly-report.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('PROCESSING').length).toBeGreaterThan(0);
    expect(screen.getByText('Job queued')).toBeInTheDocument();
    expect(screen.getByText('Extracting text')).toBeInTheDocument();
    expect(screen.getByText('No results yet')).toBeInTheDocument();
  });

  it('renders the result card once the job is completed', () => {
    const job = makeJob({
      status: 'COMPLETED',
      result: {
        summary: 'A concise summary of the document.',
        keyPoints: ['Point one', 'Point two'],
        entities: [{ name: 'Acme Corp', type: 'ORG' }],
        topics: ['finance', 'quarterly-results'],
        sentiment: 'neutral',
        language: 'en',
        pageCount: 12,
        wordCount: 3400,
        extractionMethod: 'databricks-pdf-agent',
        model: 'dbrx-instruct',
      },
    });
    render(<JobDetail job={job} />);

    expect(screen.getByText('A concise summary of the document.')).toBeInTheDocument();
    expect(screen.getByText('Point one')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('ORG')).toBeInTheDocument();
    expect(screen.getByText('finance')).toBeInTheDocument();
    expect(screen.getByText('neutral')).toBeInTheDocument();
  });

  it('renders the error message for a failed job', () => {
    render(
      <JobDetail job={makeJob({ status: 'FAILED', error: 'Extraction failed: corrupt file' })} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Extraction failed: corrupt file');
  });
});
