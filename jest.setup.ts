// Jest setup for jsdom component/accessibility tests.
// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// and jest-axe's toHaveNoViolations. Imported via setupFilesAfterEnv in the
// jsdom project (see jest.config.js) and compiled by tsc (via **/*.ts), so the
// matcher type augmentations apply across the whole test suite.
import "@testing-library/jest-dom";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);
