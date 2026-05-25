import { vi } from 'vitest';

// jest-mock-vscode uses jest.fn() internally — shim it for vitest
const jestShim = { fn: vi.fn, spyOn: vi.spyOn };
(globalThis as Record<string, unknown>).jest = jestShim;

// Mock the vscode module for extension host unit tests
vi.mock('vscode', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createVSCodeMock } = require('jest-mock-vscode');
  return createVSCodeMock(jestShim);
});
