// Polyfill ResizeObserver for jsdom (required by React Flow)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// React Flow also needs DOMMatrixReadOnly
if (!globalThis.DOMMatrixReadOnly) {
  globalThis.DOMMatrixReadOnly = class DOMMatrixReadOnly {
    m22: number;
    constructor() {
      this.m22 = 1;
    }
    inverse() {
      return new DOMMatrixReadOnly();
    }
  } as unknown as typeof DOMMatrixReadOnly;
}
