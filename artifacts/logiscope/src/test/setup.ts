import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom n'a ni ResizeObserver (cartes d'annonces) ni scrollIntoView.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
window.scrollTo = () => {};

beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); });
