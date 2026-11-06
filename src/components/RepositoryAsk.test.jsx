import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RepositoryAsk from './RepositoryAsk.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: { askRepositoryQuestion: vi.fn() } }));

const repository = { id: 'repo-1', fullName: 'octo/project', description: 'A small project.' };
const citation = { id: 'S1', chunkId: 'chunk-1', filePath: 'src/auth.js', language: 'javascript', structureType: 'function', symbolName: 'login', startLine: 2, endLine: 4, sourceCode: 'function login() {\n  return true;\n}', explanation: 'This function handles login.' };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('RepositoryAsk', () => {
  it('shows the selected repository and disables empty question submissions', () => {
    render(<RepositoryAsk repository={repository}/>);
    expect(screen.getByRole('heading', { name: /ask about octo\/project/i })).toBeInTheDocument();
    expect(screen.getByText('A small project.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask repository/i })).toBeDisabled();
  });

  it('streams an answer, associates validated citations, and opens citation source safely', async () => {
    api.askRepositoryQuestion.mockImplementation(async (_repositoryId, _question, options) => {
      options.onEvent('token', { text: 'Authentication lives in `login`.' });
      options.onEvent('answer', { answer: 'Authentication lives in `login` [[S1]].' });
      options.onEvent('citations', { citations: [citation] });
      options.onEvent('complete', { status: 'completed', insufficientEvidence: false });
      return { answer: 'Authentication lives in `login` [[S1]].', citations: [citation], insufficientEvidence: false };
    });
    render(<RepositoryAsk repository={repository}/>);
    const input = screen.getByRole('textbox', { name: /ask a question about octo\/project/i });
    fireEvent.change(input, { target: { value: 'Where is authentication?' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(await screen.findByText('Where is authentication?')).toBeInTheDocument();
    expect(await screen.findByText('Authentication lives in', { exact: false })).toBeInTheDocument();
    expect(api.askRepositoryQuestion).toHaveBeenCalledWith('repo-1', 'Where is authentication?', expect.objectContaining({ signal: expect.any(AbortSignal), onEvent: expect.any(Function) }));
    fireEvent.click(screen.getByRole('button', { name: 'Open source S1' }));
    expect(screen.getByText('This function handles login.')).toBeInTheDocument();
    expect(screen.getByText('Lines 2–4')).toBeInTheDocument();
    expect(screen.getByText('function login() {')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /S1 src\/auth\.js/i }));
    expect(screen.queryByText('This function handles login.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('src/auth.js'));
    expect(screen.getByText('This function handles login.')).toBeInTheDocument();
  });

  it('keeps unknown inline IDs non-clickable and citations isolated per answer', async () => {
    const firstCitation = { ...citation, filePath: 'src/first.js', sourceCode: 'firstSource()' };
    const secondCitation = { ...citation, chunkId: 'chunk-2', filePath: 'src/second.js', sourceCode: 'secondSource()' };
    api.askRepositoryQuestion
      .mockImplementationOnce(async (_id, _question, options) => {
        options.onEvent('token', { text: 'First [[S1]] and unknown [[S404]].' });
        options.onEvent('citations', { citations: [firstCitation] });
        options.onEvent('complete', { status: 'completed', insufficientEvidence: false });
        return { answer: 'First [[S1]] and unknown [[S404]].', citations: [firstCitation], insufficientEvidence: false };
      })
      .mockImplementationOnce(async (_id, _question, options) => {
        options.onEvent('token', { text: 'Second [[S1]].' });
        options.onEvent('citations', { citations: [secondCitation] });
        options.onEvent('complete', { status: 'completed', insufficientEvidence: false });
        return { answer: 'Second [[S1]].', citations: [secondCitation], insufficientEvidence: false };
      });
    render(<RepositoryAsk repository={repository}/>);
    const input = screen.getByRole('textbox', { name: /ask a question/i });
    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: /ask repository/i }));
    expect(await screen.findByRole('button', { name: 'Open source S1' })).toBeInTheDocument();
    expect(screen.getByText('[[S404]]')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open source S1' })).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'Second question' } });
    fireEvent.click(screen.getByRole('button', { name: /ask repository/i }));
    expect(await screen.findByText('src/second.js')).toBeInTheDocument();
    expect(screen.getByText('src/first.js')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open source S1' })).toHaveLength(2);
  });

  it('clears an invalid partial stream when the backend rejects its citation', async () => {
    api.askRepositoryQuestion.mockImplementation(async (_id, _question, options) => {
      options.onEvent('token', { text: 'Broken answer [[S404]].' });
      throw Object.assign(new Error('The answer service returned an invalid response.'), { code: 'LLM_INVALID_RESPONSE' });
    });
    render(<RepositoryAsk repository={repository}/>);
    const input = screen.getByRole('textbox', { name: /ask a question/i });
    fireEvent.change(input, { target: { value: 'Check citations' } });
    fireEvent.click(screen.getByRole('button', { name: /ask repository/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid response');
    expect(screen.queryByText('Broken answer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open source S404' })).not.toBeInTheDocument();
  });

  it('displays backend failures and insufficient evidence distinctly', async () => {
    api.askRepositoryQuestion.mockRejectedValueOnce(Object.assign(new Error('Embeddings are not ready.'), { code: 'EMBEDDINGS_NOT_READY' }))
      .mockImplementationOnce(async (_id, _question, options) => {
        options.onEvent('token', { text: 'Unsupported guess.' });
        options.onEvent('citations', { citations: [] });
        options.onEvent('complete', { status: 'completed', insufficientEvidence: true });
        return { answer: 'The retrieved code evidence does not contain enough information.', citations: [], insufficientEvidence: true };
      });
    render(<RepositoryAsk repository={repository}/>);
    const input = screen.getByRole('textbox', { name: /ask a question/i });
    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: /ask repository/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Embeddings are not ready');
    fireEvent.change(input, { target: { value: 'Second question' } });
    fireEvent.click(screen.getByRole('button', { name: /ask repository/i }));
    expect(await screen.findByText('Evidence was insufficient')).toBeInTheDocument();
    expect(screen.getByText('The available code evidence did not support a confident answer.')).toBeInTheDocument();
    expect(screen.queryByText('Unsupported guess.')).not.toBeInTheDocument();
  });
});
